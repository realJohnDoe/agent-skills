#!/usr/bin/env node
// The dispatcher's plan over every attached repo: which issues to start,
// which PRs need a follow-up session or get merged, and the one shared digest.
// See ../SKILL.md.
// Usage: node dispatch.ts <command> --digest owner/repo [--max-sessions N] [--max-followups N]
//   [--today YYYY-MM-DD] [--repos o/r,...] [--checkouts dir]
//   plan [--followups-only]   the dry run: prints the plan and writes nothing.
//   apply [--followups-only]  creates the labels a repo is missing, merges the automerge PRs,
//     reads again each repo where something merged, and claims the sessions it starts. It
//     does not write the digest.
//   finish [--no-digest] [--dry-run]  the last step of a run, once the sessions have
//     finished: starts nothing and merges nothing; writes the digest (not with --no-digest,
//     drain's last step), puts `waiting-for-human` on exactly the board's Waiting for human
//     cards and starts the board workflow. --dry-run prints the same and writes nothing.
//   board  prints the board for its workflow (.github/workflows/board.yml), which deploys it
//     to Pages: it covers the repos the digest says the last run covered, needs no clones,
//     builds no prompts or digest, writes nothing and checks no push access, so it runs on
//     the Actions token.
// Every command reads GitHub through snapshot.ts and plans with plan.ts, which does no I/O.
import { all, api, type GhIssue, names, post } from "../../_shared/github.ts";
import { arg, flag, main } from "../../_shared/cli.ts";
import { PAUSE_LABEL } from "../../_shared/markers.ts";
import type { Repo } from "../../_shared/repos.ts";
import { AUTOMERGE, DISPATCH, FOLLOWUP, linkedIssues } from "./decide.ts";
import { digestArg, FOOTER, loadConfig, readPause, unpushable } from "./lib.ts";
import { type LabelSync, WAITING_LABEL, buildBoard, labelSync } from "./board.ts";
import { buildDigest, readDigest, writeDigest } from "./digest.ts";
import { assemble, LABELS, type Merge, planRepo, type RepoPlan, type Session } from "./plan.ts";
import { fetchClosed, fetchRepo, mergedSince, sleep } from "./snapshot.ts";

// Each command's own flags; any other one of these stops the run.
const COMMANDS: Record<string, string[]> = {
  plan: ["--followups-only"],
  apply: ["--followups-only"],
  finish: ["--no-digest", "--dry-run"],
  board: [],
};
const FLAGS = ["--followups-only", "--no-digest", "--dry-run", "--apply", "--digest-only", "--board-only", "--board-refresh"];
const BOARD_REPO = "realJohnDoe/agent-skills";
const BOARD_WORKFLOW = "board.yml"; // builds the board and deploys it to Pages
const MAX_SESSIONS = Number(arg("--max-sessions", 4)); // across all repos
const TODAY = new Date(arg("--today", new Date().toISOString().slice(0, 10)));
// When this run's digest window ends; a new digest's window starts here.
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
  const noDigest = flag("--no-digest");

  // The digest's state is read first: its window bounds "merged since", and the board
  // covers the repos the last run did, read from it, rather than attached clones.
  const DIGEST = digestArg();
  // Attached clones are read before any GitHub call, so a run started from the wrong
  // folder stops on that, not on a failed lookup.
  const attached = board ? [] : loadConfig().repos;
  const state = readDigest(DIGEST, TODAY);
  const repos = board ? coveredRepos(state.covered) : attached;
  // A repo it can't push to gets no writes and a digest entry, not a stopped run.
  // The board writes nothing, and runs on a token that can push to no other repo.
  const unpushableRepos = board ? [] : unpushable(repos);
  const noPush = new Set(unpushableRepos.map((u) => u.repo));
  const opts = { today: TODAY, followupsOnly: flag("--followups-only"), maxFollowups: Number(arg("--max-followups", 2)), staleDays: 2 };
  const read = (r: Repo): RepoPlan => {
    const p = planRepo(fetchRepo(r, state.since, { merged: !board }), opts);
    return noPush.has(r.repo) ? { ...p, automerge: [], followups: [], dispatches: [], missingLabels: [] } : p;
  };

  const first = repos.map(read);
  const automerge = first.flatMap((p) => p.automerge);
  const digestLabels = all<{ name: string }>(`repos/${DIGEST}/labels?per_page=100`).map((l) => l.name);
  const missingLabels = [
    ...first.filter((p) => p.missingLabels.length).map((p) => ({ repo: p.repo, missing: p.missingLabels })),
    ...(digestLabels.includes(PAUSE_LABEL) ? [] : [{ repo: DIGEST, missing: [PAUSE_LABEL] }]),
  ];
  const { plans, merged } = cmd === "apply" ? applyMerges(first, repos, missingLabels, automerge, read, state.since) : { plans: first, merged: [] };

  const run = assemble(plans, {
    ...(cmd === "plan" || cmd === "apply" ? { maxSessions: MAX_SESSIONS } : {}),
    unpushable: unpushableRepos,
    automerge: automerge.filter((m) => !merged.includes(m)).map((m) => m.item),
  });
  const boardOut = buildBoard(run.board, {
    generated: NOW,
    repos: repos.map((r) => r.repo),
    digest: state.issue?.html_url ?? `https://github.com/${DIGEST}/issues`,
    ...(state.lastRun && { lastRun: state.lastRun }),
    closed: fetchClosed(repos),
  });
  // Read where the board is the output that matters: a paused board says so.
  if (board || finish) {
    const { state: pause, snap } = readPause(DIGEST);
    if (pause === "paused" && snap) {
      boardOut.state = "paused";
      boardOut.paused = { since: snap.created_at.slice(0, 10), snapshot: snap.html_url ?? boardOut.digest };
    }
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

  const built = buildDigest(state, { ...run.digest, repos, today: TODAY, now: NOW, followupsOnly: opts.followupsOnly });
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
  const digest = {
    repo: DIGEST,
    issue: state.issue?.number ?? null,
    publishedComment: null as string | null,
    closes: state.older.map((i) => i.number), // older digest issues closed into the newest
    publish: built.publish,
    replies: state.replies,
    counts: built.counts,
  };

  let refresh: { triggered: boolean; why?: string } | undefined;
  if (cmd === "apply") claim(run.sessions);
  if (finish && !dry) {
    if (!noDigest) Object.assign(digest, writeDigest(state, built));
    // Each write on its own: one refused is logged and corrected on the next run.
    const write = (what: string, path: string, body: unknown, method?: string) => {
      try {
        post(path, body, method);
      } catch (e) {
        const err = e as { stderr?: string; message: string };
        console.error(`${what} refused: ${err.stderr ?? err.message}`);
      }
    };
    for (const { repo, add, remove } of waitingLabel) {
      for (const n of add) write(`label ${repo}#${n}`, `repos/${repo}/issues/${n}/labels`, { labels: [WAITING_LABEL] });
      for (const n of remove) write(`unlabel ${repo}#${n}`, `repos/${repo}/issues/${n}/labels/${WAITING_LABEL}`, {}, "DELETE");
    }
    refresh = triggerBoard();
  }

  console.log(
    JSON.stringify(
      {
        // First, so a truncated read of the output still sees what to start.
        sessions: run.sessions.map(({ created, item, brief, ...s }) => s),
        ...common,
        notStarted: run.notStarted,
        digest: { ...digest, body: built.body },
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
// sessions and the digest see it.
function applyMerges(
  first: RepoPlan[],
  repos: Repo[],
  missingLabels: { repo: string; missing: string[] }[],
  automerge: Merge[],
  read: (r: Repo) => RepoPlan,
  since: string,
): { plans: RepoPlan[]; merged: Merge[] } {
  for (const { repo, missing } of missingLabels)
    for (const name of missing) post(`repos/${repo}/labels`, { name, color: name === PAUSE_LABEL ? "fbca04" : LABELS[name] });
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
    mergedSince(m.repo, since).items.some((i) => i.number === m.pr);
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
        body: `${DISPATCH}\nDispatched by the workshop dispatcher to a ${s.tier} session. Its PR ${auto ? "gets" : "doesn't get"} \`${AUTOMERGE}\`: once green it ${auto ? "is merged by the next dispatcher run" : "waits in the digest for your review"}. Add or remove the label on the PR to change that.${FOOTER}`,
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

// The repos the last run covered, as the digest names them, without clones: the board
// reads only GitHub, so a repo's path is never used.
function coveredRepos(covered: string[] | undefined): Repo[] {
  if (!covered?.length)
    throw new Error("the digest names no covered repos yet (no digest-repos marker): run the dispatcher once first");
  return covered.map((repo) => ({ repo, name: repo.split("/")[1], path: "" }));
}

// Starts the board workflow on main, so the board shows this run's writes now rather
// than at its next scheduled refresh. A refusal is reported, not fatal: the schedule
// catches up.
function triggerBoard(): { triggered: boolean; why?: string } {
  try {
    post(`repos/${BOARD_REPO}/actions/workflows/${BOARD_WORKFLOW}/dispatches`, { ref: "main" });
    return { triggered: true };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message: string };
    return { triggered: false, why: (err.stderr || err.message).toString().trim().split("\n").at(-1) };
  }
}
