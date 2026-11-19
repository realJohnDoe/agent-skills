#!/usr/bin/env node
// The dispatcher's plan over every attached repo: which issues to start,
// which PRs need a follow-up session or get merged, and what the board shows. See ../SKILL.md.
// Usage: node dispatch.ts <command> --home owner/repo [--max-sessions N] [--max-followups N]
//   [--today YYYY-MM-DD] [--repos o/r,...] [--checkouts dir]
//   plan [--followups-only]   the dry run: prints the plan and writes nothing.
//   apply [--followups-only]  creates the labels a repo is missing, merges the automerge PRs,
//     reads again each repo where something merged, and claims the sessions it starts.
//   finish [--no-run-marker] [--dry-run]  the last step of a run, once the sessions have
//     finished: starts nothing and merges nothing; opens and closes the can't-push issues (not
//     with --no-run-marker, drain's last step), closes the retired digest issue, puts
//     `waiting-for-human` on exactly the board's Waiting for human cards and starts the
//     board workflow with this run's time and repos as its inputs (none with
//     --no-run-marker, so the board keeps the last normal run's). --dry-run prints the
//     same and writes nothing.
//   board [--last-run ISO] [--repos-covered "o/a o/b"]  prints the board for its workflow
//     (.github/workflows/board.yml), which deploys it to Pages: it covers the repos the
//     last run covered and shows when it ran, from the flags (the workflow's inputs) or
//     else from the live board.json. It needs no clones, builds no prompts, writes nothing
//     and checks no push access, so it runs on the Actions token.
// Every command reads GitHub through snapshot.ts and plans with plan.ts, which does no I/O.
import { all, api, type GhIssue, names, post } from "../../_shared/github.ts";
import { arg, flag, main, run as sh } from "../../_shared/cli.ts";
import { isRetiredDigest, PAUSE_TITLE } from "../../_shared/markers.ts";
import type { Repo } from "../../_shared/repos.ts";
import { AUTOMERGE, DISPATCH, FOLLOWUP, linkedIssues } from "./decide.ts";
import { FOOTER, homeArg, loadConfig, readPause, REPO_NAME, unpushable } from "./lib.ts";
import { type LabelSync, WAITING_LABEL, buildBoard, labelSync } from "./board.ts";
import { cantPushWrites, readCantPush, writeCantPush } from "./cantPush.ts";
import { assemble, LABELS, type Merge, planRepo, type RepoPlan, type Session } from "./plan.ts";
import { fetchClosed, fetchRepo, mergedSince, sleep } from "./snapshot.ts";

// Each command's own flags; any other one of these stops the run.
const COMMANDS: Record<string, string[]> = {
  plan: ["--followups-only"],
  apply: ["--followups-only"],
  finish: ["--no-run-marker", "--dry-run"],
  board: ["--last-run", "--repos-covered"],
};
// The retired ones are listed too, so passing one stops the run rather than being ignored.
const FLAGS = [
  "--followups-only", "--no-run-marker", "--dry-run", "--last-run", "--repos-covered",
  "--no-digest", "--apply", "--digest-only", "--board-only", "--board-refresh",
];
const BOARD_REPO = "realJohnDoe/agent-skills";
const BOARD_WORKFLOW = "board.yml"; // builds the board and deploys it to Pages
// The label that paused the workshop on the retired digest issue.
const RETIRED_PAUSE_LABEL = "workshop-paused";
const MAX_SESSIONS = Number(arg("--max-sessions", 4)); // across all repos
const TODAY = new Date(arg("--today", new Date().toISOString().slice(0, 10)));
// When this run ran, for the board.
const NOW = arg("--today") ? TODAY.toISOString() : new Date().toISOString();

main(() => {
  const cmd = process.argv[2] ?? "";
  if (!(cmd in COMMANDS))
    throw new Error(`name a command first: dispatch.ts ${Object.keys(COMMANDS).join("|")} (got ${cmd || "none"})`);
  const wrong = FLAGS.filter((f) => flag(f) && !COMMANDS[cmd].includes(f));
  if (wrong.length) throw new Error(`${wrong.join(", ")}: not an option of \`dispatch.ts ${cmd}\``);
  const board = cmd === "board";
  const finish = cmd === "finish";
  const dry = cmd === "plan" || board || flag("--dry-run");
  const noRunMarker = flag("--no-run-marker");

  const HOME = homeArg();
  // Attached clones are read before any GitHub call, so a run started from the wrong
  // folder stops on that, not on a failed lookup. The board covers the repos the last
  // run did rather than attached clones.
  const attached = board ? [] : loadConfig().repos;
  const last = board ? lastRun(HOME) : finish && !noRunMarker ? { repos: attached.map((r) => r.repo), lastRun: NOW } : undefined;
  const repos = board ? last!.repos.map((repo) => ({ repo, name: repo.split("/")[1], path: "" })) : attached;
  // A repo it can't push to gets no writes and an issue in the home repo, not a stopped run.
  // The board writes nothing, and runs on a token that can push to no other repo.
  const unpushableRepos = board ? [] : unpushable(repos);
  const noPush = new Set(unpushableRepos.map((u) => u.repo));
  const opts = { today: TODAY, followupsOnly: flag("--followups-only"), maxFollowups: Number(arg("--max-followups", 2)), staleDays: 2 };
  const read = (r: Repo): RepoPlan => {
    const p = planRepo(fetchRepo(r), opts);
    return noPush.has(r.repo) ? { ...p, automerge: [], followups: [], dispatches: [], missingLabels: [] } : p;
  };

  const first = repos.map(read);
  const automerge = first.flatMap((p) => p.automerge);
  const missingLabels = first.filter((p) => p.missingLabels.length).map((p) => ({ repo: p.repo, missing: p.missingLabels }));
  const { plans, merged } = cmd === "apply" ? applyMerges(first, repos, missingLabels, automerge, read, TODAY.toISOString().slice(0, 10)) : { plans: first, merged: [] };

  const run = assemble(plans, {
    ...(cmd === "plan" || cmd === "apply" ? { maxSessions: MAX_SESSIONS } : {}),
    automerge: automerge.filter((m) => !merged.includes(m)).map((m) => m.item),
  });
  const boardOut = buildBoard(run.board, {
    generated: NOW,
    repos: repos.map((r) => r.repo),
    ...(last?.lastRun && { lastRun: last.lastRun }),
    closed: fetchClosed(repos),
  });
  // Read where the board is the output that matters: a paused board says so.
  const pause = board || finish ? readPause(HOME) : undefined;
  if (pause?.state === "paused" && pause.snap) {
    boardOut.state = "paused";
    boardOut.paused = { since: pause.snap.created_at.slice(0, 10), snapshot: pause.snap.html_url ?? pause.issue!.html_url };
  }
  const common = {
    applied: !dry,
    repos: repos.map((r) => r.repo),
    missingLabels,
    unpushable: unpushableRepos,
    automerge: automerge.map(({ created, body, item, ...m }) => m),
  };
  if (board) {
    console.log(JSON.stringify({ ...common, waitingLabel: [], board: boardOut }, null, 2));
    return;
  }

  // One open issue per repo it can't push to; read dry or not, so the plan shows it.
  const cantPush = finish && !noRunMarker ? cantPushWrites(readCantPush(HOME), unpushableRepos) : { open: [], close: [] };
  // The retired digest issue is closed. One that still pauses the workshop first gets a
  // pause issue in its place, so closing it doesn't resume the workshop.
  const digests = finish ? all<GhIssue>(`repos/${HOME}/issues?state=open&per_page=100`).filter((i) => !i.pull_request && isRetiredDigest(i.title)) : [];
  const retire = {
    close: digests.map((i) => i.number),
    openPause: digests.some((i) => names(i).includes(RETIRED_PAUSE_LABEL)) && !["drain", "paused"].includes(pause!.state),
  };
  // The last step mirrors the Waiting for human stage onto GitHub as a label; never
  // in a repo it can't push to. Read dry or not, so the plan shows it.
  const waitingLabel: LabelSync[] = finish
    ? labelSync(
        boardOut,
        repos
          .filter((r) => !noPush.has(r.repo))
          .flatMap((r) =>
            all<GhIssue>(`repos/${r.repo}/issues?labels=${WAITING_LABEL}&state=all&per_page=100`)
              .filter((i) => names(i).includes(WAITING_LABEL))
              .map((i) => ({ repo: r.repo, number: i.number })),
          ),
      ).filter((s) => !noPush.has(s.repo))
    : [];
  // What the board workflow is started with: none on drain's last step.
  const boardInputs = last && { last_run: last.lastRun!, repos: last.repos.join(" ") };

  let refresh: { triggered: boolean; why?: string } | undefined;
  if (cmd === "apply") claim(run.sessions);
  if (finish && !dry) {
    if (!noRunMarker) writeCantPush(HOME, cantPush);
    // Each write on its own: one refused is logged and corrected on the next run.
    const write = (what: string, path: string, body: unknown, method?: string) => {
      try {
        post(path, body, method);
        return true;
      } catch (e) {
        const err = e as { stderr?: string; message: string };
        console.error(`${what} refused: ${err.stderr ?? err.message}`);
        return false;
      }
    };
    const paused =
      !retire.openPause ||
      write(`pause issue in ${HOME}`, `repos/${HOME}/issues`, {
        title: PAUSE_TITLE,
        body: `The workshop is paused: the retired digest issue carried \`${RETIRED_PAUSE_LABEL}\`. Close this issue to resume it.${FOOTER}`,
      });
    for (const n of paused ? retire.close : []) {
      write(`comment ${HOME}#${n}`, `repos/${HOME}/issues/${n}/comments`, {
        body: `Retired: the workshop board keeps when the dispatcher last ran and which repos it covered, and the workshop is paused by opening a \`${PAUSE_TITLE}\` issue here and resumed by closing it.${FOOTER}`,
      });
      write(`close ${HOME}#${n}`, `repos/${HOME}/issues/${n}`, { state: "closed", state_reason: "completed" }, "PATCH");
    }
    for (const { repo, add, remove } of waitingLabel) {
      for (const n of add) write(`label ${repo}#${n}`, `repos/${repo}/issues/${n}/labels`, { labels: [WAITING_LABEL] });
      for (const n of remove) write(`unlabel ${repo}#${n}`, `repos/${repo}/issues/${n}/labels/${WAITING_LABEL}`, {}, "DELETE");
    }
    refresh = triggerBoard(boardInputs);
  }

  console.log(
    JSON.stringify(
      {
        // First, so a truncated read of the output still sees what to start.
        sessions: run.sessions.map(({ created, item, brief, ...s }) => s),
        ...common,
        notStarted: run.notStarted,
        cantPush,
        ...(finish && { retire, boardInputs: boardInputs ?? null }),
        waitingLabel,
        board: boardOut,
        ...(refresh && { boardRefresh: refresh }),
      },
      null,
      2,
    ),
  );
});

// `apply`'s first writes: labels, then every `automerge` PR, which already has finished,
// green CI: merge it now, pinned to the head commit that was checked. (GitHub refuses to
// *enable* auto-merge on a PR that is already mergeable.) A refused merge is logged and
// retried on the next run, not fatal. A repo where something merged is read again, so
// the sessions see it.
function applyMerges(
  first: RepoPlan[],
  repos: Repo[],
  missingLabels: { repo: string; missing: string[] }[],
  automerge: Merge[],
  read: (r: Repo) => RepoPlan,
  today: string, // the merges just made show in the search index from this date
): { plans: RepoPlan[]; merged: Merge[] } {
  for (const { repo, missing } of missingLabels)
    for (const name of missing) post(`repos/${repo}/labels`, { name, color: LABELS[name] });
  const merged: Merge[] = [];
  for (const m of automerge)
    try {
      post(`repos/${m.repo}/pulls/${m.pr}/merge`, { sha: m.sha, merge_method: "merge" }, "PUT");
      merged.push(m);
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      console.error(`merge ${m.repo}#${m.pr} refused: ${err.stderr ?? err.message}`);
    }
  // GitHub closes the merged PR's issues and indexes it for search a moment
  // after the merge, so wait for that before reading again (bounded; on timeout
  // carry on, and the next run corrects it).
  const settled = (m: Merge) =>
    linkedIssues(m.body).every((n) => api<{ state: string }>(`repos/${m.repo}/issues/${n}`).state === "closed") &&
    mergedSince(m.repo, today).items.some((i) => i.number === m.pr);
  for (let waited = 0; merged.some((m) => !settled(m)); waited += 3000) {
    if (waited >= 30000) {
      console.error("merge not yet reflected by GitHub after 30 s; reading anyway");
      break;
    }
    sleep(3000);
  }
  const mergedIn = new Set(merged.map((m) => m.repo));
  return { plans: first.map((p, k) => (mergedIn.has(p.repo) ? read(repos[k]) : p)), merged };
}

// `apply`'s last writes: assign each dispatched issue and leave a marker on it, and on
// each PR it follows up.
function claim(sessions: Session[]) {
  const me = sessions.length ? api<{ login: string }>("user").login : null;
  for (const s of sessions) {
    if (s.kind === "dispatch") {
      post(`repos/${s.repo}/issues/${s.issue}/assignees`, { assignees: [me] });
      const auto = s.tier !== "opus";
      post(`repos/${s.repo}/issues/${s.issue}/comments`, {
        body: `${DISPATCH}\nDispatched by the workshop dispatcher to a ${s.tier} session. Its PR ${auto ? "gets" : "doesn't get"} \`${AUTOMERGE}\`: once green it ${auto ? "is merged by the next dispatcher run" : "waits on the board for your review"}. Add or remove the label on the PR to change that.${FOOTER}`,
      });
    } else {
      post(`repos/${s.repo}/issues/${s.pr}/comments`, {
        body: `${FOLLOWUP}\nFollow-up session started for:\n${s.prompt
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .join("\n")}${FOOTER}`,
      });
    }
  }
}

// The board's covered repos and last run: from the flags, which the board workflow
// passes from its inputs when a run's `finish` starts it, or else carried over from the
// live board.json, so the workshop's repo list lives only in the Timetable routine.
function lastRun(HOME: string): { repos: string[]; lastRun?: string } {
  const given = arg("--repos-covered")?.split(/[\s,]+/).filter(Boolean) ?? [];
  const givenRun = arg("--last-run") || undefined;
  const live: { repos?: string[]; lastRun?: string } = given.length && givenRun ? {} : liveBoard(HOME);
  const repos = given.length ? given : (live.repos ?? []);
  if (!repos.length)
    throw new Error("no covered repos: pass --repos-covered, or run the dispatcher once first so the live board names them");
  const bad = repos.filter((r) => !REPO_NAME.test(r));
  if (bad.length) throw new Error(`not owner/repo: ${bad.join(", ")}`);
  const at = givenRun ?? live.lastRun;
  if (at && Number.isNaN(Date.parse(at))) throw new Error(`--last-run is not a time: ${at}`);
  return { repos, ...(at && { lastRun: at }) };
}

// The deployed board.json, or {} when there is none or it can't be read.
function liveBoard(HOME: string): { repos?: string[]; lastRun?: string } {
  try {
    const url = new URL("board.json", api<{ html_url: string }>(`repos/${HOME}/pages`).html_url);
    return JSON.parse(sh("curl", ["-fsS", url.href]));
  } catch {
    return {};
  }
}

// Starts the board workflow on main, so the board shows this run's writes now rather
// than at its next scheduled refresh. A refusal is reported, not fatal: the schedule
// catches up.
function triggerBoard(inputs?: { last_run: string; repos: string }): { triggered: boolean; why?: string } {
  try {
    post(`repos/${BOARD_REPO}/actions/workflows/${BOARD_WORKFLOW}/dispatches`, { ref: "main", ...(inputs && { inputs }) });
    return { triggered: true };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message: string };
    return { triggered: false, why: (err.stderr || err.message).toString().trim().split("\n").at(-1) };
  }
}
