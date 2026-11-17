#!/usr/bin/env node
// The daily dispatcher's plan over every attached repo: which issues to start,
// which PRs need a follow-up session or get merged, and the one shared digest.
// See ../SKILL.md.
// Usage: node dispatch.ts --digest owner/repo [--apply] [--followups-only]
//   [--max-sessions N] [--max-followups N] [--today YYYY-MM-DD] [--repos o/r,...]
//   [--checkouts dir]
// Without --apply it is a dry run: it prints the plan and writes nothing.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Blocker, bodyBlockers } from "./bodyBlockers.ts";
import {
  AUTOMERGE,
  afterMerge,
  DEFERRED,
  FOLLOWUP,
  AGENT,
  assertNever,
  blockedText,
  type ResolvedBlocker,
  claimState,
  isDigest,
  issueState,
  linkedIssues,
  marked,
  prVerdict,
  referencedIssues,
  openQuestion,
  READY,
  tierOf,
} from "./decide.ts";
import type { GhCheckRuns, GhComment, GhIssue, GhPull, GhReview, GhSearch } from "./github.ts";
import {
  type Repo,
  FOOTER,
  PAUSE_LABEL,
  all,
  api,
  arg,
  flag,
  loadConfig,
  main,
  names,
  post,
  preflight,
} from "./lib.ts";

const APPLY = flag("--apply");
const FOLLOWUPS_ONLY = flag("--followups-only"); // drain: merge and follow up, start nothing new
const MAX_SESSIONS = Number(arg("--max-sessions", 4)); // across all repos
const MAX_FOLLOWUPS = Number(arg("--max-followups", 2)); // per PR
const STALE_DAYS = 2; // a claim or follow-up with nothing to show after this is stuck
// The digest is published on the first run of these days.
const DIGEST_WEEKDAYS = [2, 5]; // Tue, Fri (UTC getDay)
const DIGEST_DAYS = 2.5; // minimum window, so a second run that day doesn't publish again
const TODAY = new Date(arg("--today", new Date().toISOString().slice(0, 10)));
// When this run's digest window ends; a new digest's window starts here.
const NOW = arg("--today") ? TODAY.toISOString() : new Date().toISOString();
const DIGEST_PREFIX = "Workshop digest";
const DISPATCH = "<!-- workshop-dispatch -->";
const RELAYED = "<!-- workshop-relayed -->"; // digest replies up to here are copied to their issues
// Created in each repo on first contact if missing.
const LABELS: Record<string, string> = {
  haiku: "c5def5",
  sonnet: "0075ca",
  opus: "5319e7",
  plan: "d4c5f9",
  deferred: "cccccc",
  [READY]: "0e8a16",
  [AUTOMERGE]: "0e8a16",
  preview: "1d76db",
};
const days = (iso: string) => (+TODAY - +new Date(iso)) / 864e5;
type Item = {
  repo: string;
  ref: string;
  url: string;
  title: string;
  why?: string;
  ask?: string;
  waiting?: boolean; // Not picked up, but only counted in the digest
  issue?: number;
  pr?: number;
  created?: string;
};
type Dated = { repo: string; created: string };
type Session = {
  repo: string;
  tier: string | undefined;
  item: Item;
  checkout: string;
  worktree: string;
  created: string;
  title: string;
  prompt: string;
};
type Followup = Session & { kind: "followup"; pr: number; issue: number | undefined; branch: string };
type Dispatch = Session & { kind: "dispatch"; issue: number };
type Merge = { repo: string; pr: number; sha: string; title: string; created: string; body: string | null };
type RepoPlan = {
  repo: string;
  followups: Followup[];
  dispatches: Dispatch[];
  review: Item[];
  unstick: Item[];
  automerge: Merge[];
  inProgress: Item[];
  notPicked: Item[];
  triage: Item[];
  decide: Item[];
  afterMerge: Item[];
  merged: string[];
  unblocks: Map<string, string[]>;
  missingLabels: string[];
};
type ListKey = Exclude<keyof RepoPlan, "repo" | "unblocks" | "missingLabels">;
const byRepo = (a: Dated, b: Dated) => a.repo.localeCompare(b.repo);
const newestFirst = (a: Dated, b: Dated) => b.created.localeCompare(a.created) || byRepo(a, b);

// Other repos' issues named as blockers, each looked up once per run; one that
// can't be read (unreadable repo, typo) counts as blocking, so a mistake holds work back.
const lookups = new Map<string, "open" | "closed" | "unreadable">();
const lookup = ({ repo, number }: Blocker) => {
  const key = `${repo.toLowerCase()}#${number}`;
  let state = lookups.get(key);
  if (!state) {
    try {
      state = api<{ state: string }>(`repos/${repo}/issues/${number}`).state === "open" ? "open" : "closed";
    } catch {
      state = "unreadable";
    }
    lookups.set(key, state);
  }
  return state;
};

main(() => {
  const { digest: DIGEST, repos } = loadConfig();
  preflight(repos);

  // --- The shared digest's state, read first: its window bounds "merged since".
  const digests = all<GhIssue>(`repos/${DIGEST}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && isDigest(i.title))
    .sort((a, b) => a.number - b.number);
  const isDraft = (i: GhIssue) => i.title.includes("(draft)");
  const draft = digests.findLast(isDraft);
  const published = digests.findLast((i) => !isDraft(i));
  const marker = /<!-- digest-(?:date|since): (\S+) -->/;
  const since =
    (draft ?? published)?.body?.match(marker)?.[1] ??
    new Date(+TODAY - DIGEST_DAYS * 864e5).toISOString().slice(0, 10);

  const first = repos.map((r) => planRepo(r, since));
  const automerge = first.flatMap((p) => p.automerge);
  const digestLabels = all<{ name: string }>(`repos/${DIGEST}/labels?per_page=100`).map((l) => l.name);
  const missingLabels = [
    ...first
      .filter((p) => p.missingLabels.length)
      .map((p) => ({ repo: p.repo, missing: p.missingLabels })),
    ...(digestLabels.includes(PAUSE_LABEL)
      ? []
      : [{ repo: DIGEST, missing: [PAUSE_LABEL] }]),
  ];
  // Labels first, then every `automerge` PR, which already has finished, green
  // CI: merge it now, pinned to the head commit that was checked. (GitHub
  // refuses to *enable* auto-merge on a PR that is already mergeable.) A
  // refused merge is logged and retried on the next run, not fatal. A repo
  // where something merged is read again, so sessions and the digest see it.
  const mergedIn = new Set<string>();
  const mergedPrs: Merge[] = [];
  if (APPLY) {
    for (const { repo, missing } of missingLabels)
      for (const name of missing)
        post(`repos/${repo}/labels`, { name, color: name === PAUSE_LABEL ? "fbca04" : LABELS[name] });
    for (const m of automerge)
      try {
        post(`repos/${m.repo}/pulls/${m.pr}/merge`, { sha: m.sha, merge_method: "merge" }, "PUT");
        mergedIn.add(m.repo);
        mergedPrs.push(m);
      } catch (e) {
        const err = e as { stderr?: string; message: string };
        console.error(`merge ${m.repo}#${m.pr} refused: ${err.stderr ?? err.message}`);
      }
  }
  // GitHub closes the merged PR's issues and indexes it for search a moment
  // after the merge, so wait for that before reading again (bounded; on timeout
  // carry on, and the next run corrects it).
  const settled = (m: Merge) =>
    linkedIssues(m.body).every((n) => api<{ state: string }>(`repos/${m.repo}/issues/${n}`).state === "closed") &&
    mergedSince(m.repo, since).items.some((i) => i.number === m.pr);
  for (let waited = 0; mergedPrs.some((m) => !settled(m)); waited += 3000) {
    if (waited >= 30000) {
      console.error("merge not yet reflected by GitHub after 30 s; reading anyway");
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  const plans = first.map((p, k) => (mergedIn.has(p.repo) ? planRepo(repos[k], since) : p));
  const pick = <K extends ListKey>(k: K): RepoPlan[K] => plans.flatMap((p) => p[k] as unknown[]) as RepoPlan[K];

  // Follow-ups first: finishing beats starting. Follow-ups go newest PR first and
  // dispatches newest issue first, each across every repo
  // whichever repo it is in.
  const followups = pick("followups").sort(newestFirst);
  const dispatches = pick("dispatches").sort(newestFirst);
  const sessions = [...followups, ...dispatches].slice(0, MAX_SESSIONS);
  const queue = dispatches.slice(Math.max(0, MAX_SESSIONS - followups.length));
  // What the workshop is working on: this run's sessions, PRs waiting on CI or
  // a follow-up, follow-ups past today's cap, and dispatched issues with no PR yet.
  const inProgress = [
    ...sessions.map((s) => ({ ...s.item, why: s.kind === "followup" ? "follow-up" : "dispatched" })),
    ...followups.slice(MAX_SESSIONS).map((s) => ({ ...s.item, why: "follow-up next run" })),
    ...pick("inProgress"),
  ];
  const review = pick("review");
  const unstick = pick("unstick");
  const decide = pick("decide");
  const afterMerge = pick("afterMerge");
  const triage = pick("triage");
  const notPicked = pick("notPicked");
  const merged = pick("merged");
  const unblocksOf = new Map(plans.flatMap((p) => [...p.unblocks]));

  // --- Digest ---------------------------------------------------------------
  // One issue per digest cycle, in the digest repo. Its body is rewritten on
  // every run (an edit notifies nobody); publishing it is the ping. Every item
  // names its repo with a full reference, so links resolve from here.
  const line = (x: Item, ask?: string) => {
    const unblocks = ask ? (unblocksOf.get(x.ref) ?? []) : [];
    const why = [x.why, ...(unblocks.length ? [`unblocks ${unblocks.join(", ")}`] : [])]
      .filter(Boolean)
      .join("; ");
    return `- ${ask ? `[ ] **${ask}** ` : ""}[${x.ref}](${x.url}) ${x.title}${why ? ` (${why})` : ""}`;
  };
  const section = (h: string, xs: Item[], ask?: string) =>
    xs.length ? [`## ${h}`, "", ...xs.map((x) => line(x, x.ask ?? ask)), ""] : [];
  const ANSWER =
    "Answer on the issue or PR, or reply here naming the item (e.g. `meridian#12`): the next daily run copies replies onto their issues.";
  const NOTE = `_The draft digest is rewritten by every daily run and published on Tuesdays and Fridays. ${ANSWER}_\n\n`;
  // PRs first: they are finished work, and go stale while they wait.
  const asks = [
    ...section("Review", review, "Review:"),
    ...section("Unstick", unstick, "Unstick:"),
    // Questions first: an answer is real work, a go-ahead is a glance.
    ...section(
      `Waiting on you (answer a question, or reply \`ready\` naming items to add \`${READY}\`)`,
      [
        ...decide.map((x) => ({ ...x, ask: "Decide:" })),
        ...afterMerge.map((x) => ({ ...x, ask: "After merge:" })),
        ...triage.map((x) => ({ ...x, ask: "Go ahead?" })),
      ],
    ),
  ];
  // Issues that wait on another issue, a decision or the maintainer's own
  // `deferred` would repeat in every digest, so they are only counted.
  const waiting = notPicked.filter((x) => x.waiting);
  const info = [
    ...section("In progress", inProgress),
    ...section("Queue (dispatched next, newest first)", queue.map((q) => q.item)),
    ...section("Not picked up", notPicked.filter((x) => !x.waiting)),
    ...(waiting.length
      ? [
          `<details><summary>${waiting.length} items waiting on a blocker, a decision or <code>deferred</code></summary>`,
          "",
          ...waiting.map((x) => line(x)),
          "",
          "</details>",
          "",
        ]
      : []),
  ];
  const render = (start: string, mergedLines: string[], prev?: number | null) =>
    `<!-- digest-since: ${start} -->\n\n${NOTE}${
      [...asks, ...info].join("\n") || "Nothing is waiting on the maintainer.\n"
    }\nRepos covered: ${repos.map((r) => r.repo).join(", ")}.\n${prev ? `\nPrevious digest: #${prev}.\n` : ""}${
      mergedLines.length
        ? `\n<details><summary>${mergedLines.length} merged since ${start.slice(0, 10)}</summary>\n\n${mergedLines.join("\n")}\n\n</details>\n`
        : ""
    }`.trim() + FOOTER;
  const body = render(since, merged, published?.number);
  // A quiet cycle (nothing merged, nothing to act on) stays a draft.
  const publish =
    !FOLLOWUPS_ONLY &&
    !!draft &&
    days(since) >= DIGEST_DAYS &&
    DIGEST_WEEKDAYS.includes(new Date(NOW).getUTCDay()) &&
    (merged.length > 0 || asks.length > 0);
  // Maintainer replies on either digest not yet copied onto their issues.
  const replies = [draft, published].filter((d) => d !== undefined).flatMap((d) => {
    const cs = all<GhComment>(`repos/${DIGEST}/issues/${d.number}/comments?per_page=100`);
    const relayedAt = cs.findLast((c) => marked(c, RELAYED))?.created_at ?? "";
    return cs
      .filter(
        (c) =>
          c.created_at > relayedAt &&
          c.user.type !== "Bot" &&
          !AGENT.test(c.body),
      )
      .map((c) => ({
        digest: d.number,
        url: c.html_url,
        author: c.user.login,
        body: c.body,
      }));
  });
  const digest = {
    repo: DIGEST,
    draft: draft?.number ?? null,
    published: published?.number ?? null,
    publish,
    replies,
    counts: {
      decide: decide.length,
      afterMerge: afterMerge.length,
      review: review.length,
      unstick: unstick.length,
      triage: triage.length,
      inProgress: inProgress.length,
      queue: queue.length,
      notPicked: notPicked.length,
      merged: merged.length,
    },
  };

  // --- Apply ----------------------------------------------------------------
  if (APPLY) {
    const me = sessions.length ? api<{ login: string }>("user").login : null;
    for (const s of sessions) {
      if (s.kind === "dispatch") {
        post(`repos/${s.repo}/issues/${s.issue}/assignees`, { assignees: [me] });
        const auto = s.tier !== "opus";
        post(`repos/${s.repo}/issues/${s.issue}/comments`, {
          body: `${DISPATCH}\nDispatched by the daily workshop run to a ${s.tier} session. Its PR ${auto ? "gets" : "doesn't get"} \`${AUTOMERGE}\`: once green it ${auto ? "is merged by the next daily run" : "waits in the digest for your review"}. Add or remove the label on the PR to change that.${FOOTER}`,
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
    if (!FOLLOWUPS_ONLY) {
      const newDraft = (start: string, b: string) =>
        JSON.parse(
          post(`repos/${DIGEST}/issues`, {
            title: `${DIGEST_PREFIX} (draft) — from ${start.slice(0, 10)}`,
            body: b,
          }),
        ).number;
      const d = draft?.number ?? newDraft(since, body);
      if (draft && draft.body !== body)
        post(`repos/${DIGEST}/issues/${d}`, { body }, "PATCH");
      if (publish) {
        post(
          `repos/${DIGEST}/issues/${d}`,
          // A published digest is no draft: keep only where to answer.
          {
            title: `${DIGEST_PREFIX} — ${NOW.slice(0, 10)}`,
            body: body.replace(NOTE, `_${ANSWER}_\n\n`),
          },
          "PATCH",
        );
        // A title or body edit notifies nobody; this comment is the ping.
        const { decide: x, review: r, unstick: u, merged: m } = digest.counts;
        post(`repos/${DIGEST}/issues/${d}/comments`, {
          body: `Published: ${r} to review, ${u} to unstick, ${x} to decide, ${m} merged.${FOOTER}`,
        });
        if (published) {
          post(`repos/${DIGEST}/issues/${published.number}/comments`, {
            body: `Superseded by #${d}.${FOOTER}`,
          });
          post(
            `repos/${DIGEST}/issues/${published.number}`,
            { state: "closed", state_reason: "completed" },
            "PATCH",
          );
        }
        digest.draft = newDraft(NOW, render(NOW, [], d));
        digest.published = d;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        applied: APPLY,
        repos: repos.map((r) => r.repo),
        missingLabels,
        sessions: sessions.map(({ created, item, ...s }) => s),
        automerge: automerge.map(({ created, body, ...m }) => m),
        deferred: [...followups, ...dispatches]
          .slice(MAX_SESSIONS)
          .map((s) => `${s.repo}: ${s.title}`),
        digest: { ...digest, body },
      },
      null,
      2,
    ),
  );
});

// Everything one repo contributes to the plan, every item carrying its repo.
function planRepo({ repo, name, path }: Repo, since: string): RepoPlan {
  const ref = (n: number) => `${repo}#${n}`;
  const base = api<{ default_branch: string }>(`repos/${repo}`).default_branch;
  const issues = all<GhIssue>(`repos/${repo}/issues?state=open&per_page=100`).filter(
    (i) => !i.pull_request,
  );
  const prs = all<GhPull>(`repos/${repo}/pulls?state=open&per_page=100`);
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const linked = new Set(prs.flatMap((p) => referencedIssues(p.body)));
  // Open issues an issue waits on: native blocked-by edges, plus the documented
  // fallback of a blocker named in the body while it is open.
  const sameRepo = (r: string) => r.toLowerCase() === repo.toLowerCase();
  const blockersOf = new Map(
    issues.map((i) => {
      const native = (i.issue_dependencies_summary?.blocked_by ?? 0) > 0
        ? all<GhIssue>(`repos/${repo}/issues/${i.number}/dependencies/blocked_by?per_page=100`)
            .filter((b) => b.state === "open")
            .map((b) => ({ repo: b.repository_url?.replace(/^.*\/repos\//, "") ?? repo, number: b.number }))
        : [];
      const body = bodyBlockers(i.body, repo).flatMap((b): ResolvedBlocker[] => {
        const s = sameRepo(b.repo) ? (byNumber.has(b.number) ? "open" : "closed") : lookup(b);
        return s === "closed" ? [] : [s === "open" ? b : { ...b, unreadable: true }];
      });
      const seen = new Set<string>();
      return [
        i.number,
        [...native, ...body].filter((b) => {
          const k = `${b.repo.toLowerCase()}#${b.number}`;
          return !seen.has(k) && !!seen.add(k);
        }),
      ];
    }),
  );
  // Merged PRs that reference an issue with an `## After merge` step, read only
  // when there is one: the newest page of closed PRs is as far back as it looks.
  const stepIssues = issues.filter((i) => !linked.has(i.number) && afterMerge(i.body));
  const closed = stepIssues.length
    ? all<GhPull>(`repos/${repo}/pulls?state=closed&per_page=100`).filter((p) => p.merged_at)
    : [];
  const mergedFor = (n: number) => closed.find((p) => referencedIssues(p.body).includes(n));
  const item = (x: GhIssue | GhPull, extra: Partial<Item>): Item => ({
    repo,
    ref: ref(x.number),
    url: x.html_url,
    title: x.title,
    ...extra,
  });
  const worktree = (kind: string, n: number) => join(tmpdir(), "workshop", `${name}-${kind}-${n}`);
  const out: RepoPlan = {
    repo,
    followups: [],
    dispatches: [],
    review: [],
    unstick: [],
    automerge: [],
    inProgress: [],
    notPicked: [],
    triage: [],
    decide: [],
    afterMerge: [],
    merged: [],
    unblocks: new Map(),
    missingLabels: [],
  };

  // --- PR follow-up ---------------------------------------------------------
  // Ours to follow up: every non-draft PR (draft = keep out of the workshop).
  for (const pr of prs.filter((p) => !p.draft)) {
    if (names(pr).includes("deferred")) {
      out.notPicked.push(item(pr, { pr: pr.number, created: pr.created_at, why: DEFERRED, waiting: true }));
      continue;
    }
    const issue = referencedIssues(pr.body)
      .map((n) => byNumber.get(n))
      .find((i) => i && tierOf(names(i)));
    const bot = pr.user.login === "dependabot[bot]";
    // A red bump is undiagnosed and often rooted in a dependency's own change.
    const tier = issue ? tierOf(names(issue)) : bot ? "opus" : "sonnet";
    const head = api<{ commit: { committer: { date: string } } }>(`repos/${repo}/commits/${pr.head.sha}`);
    const runs = api<GhCheckRuns>(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs;
    // GitHub computes `mergeable` in the background after the first read that
    // needs it, so a null usually resolves a few seconds later. Read once more.
    let mergeable = api<{ mergeable: boolean | null }>(`repos/${repo}/pulls/${pr.number}`).mergeable;
    if (mergeable == null) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      mergeable = api<{ mergeable: boolean | null }>(`repos/${repo}/pulls/${pr.number}`).mergeable;
    }
    const it = item(pr, { pr: pr.number, created: pr.created_at });
    // CI still running and no conflict: nothing to decide yet, skip the reads below.
    if (mergeable !== false && !(runs.length && runs.every((r) => r.status === "completed"))) {
      out.inProgress.push({ ...it, why: "CI running" });
      continue;
    }
    const v = prVerdict({
      dependabot: bot,
      labels: names(pr),
      autoMerge: !!pr.auto_merge,
      runs,
      mergeable,
      headDate: head.commit.committer.date,
      comments: all<GhComment>(`repos/${repo}/issues/${pr.number}/comments?per_page=100`),
      reviewComments: all<GhComment>(`repos/${repo}/pulls/${pr.number}/comments?per_page=100`),
      reviews: all<GhReview>(`repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      branch: pr.head.ref,
      body: pr.body,
      base,
      today: TODAY,
      maxFollowups: MAX_FOLLOWUPS,
      staleDays: STALE_DAYS,
    });
    switch (v.kind) {
      case "wait":
        out.inProgress.push({ ...it, why: v.why });
        break;
      case "review":
        out.review.push(v.why ? { ...it, why: v.why } : it);
        break;
      case "merge":
        out.automerge.push({ repo, pr: pr.number, sha: pr.head.sha, title: pr.title, created: pr.created_at, body: pr.body });
        break;
      case "unstick":
        out.unstick.push({ ...it, why: v.why });
        break;
      case "followup": {
        const wt = worktree("pr", pr.number);
        out.followups.push({
          kind: "followup",
          repo,
          pr: pr.number,
          issue: issue?.number,
          tier,
          item: it,
          branch: pr.head.ref,
          checkout: path,
          worktree: wt,
          created: pr.created_at,
          title: `Follow up ${name}#${pr.number}`,
          prompt: [
            `PR ${ref(pr.number)} (${pr.html_url}, branch \`${pr.head.ref}\`) ${issue ? `for ${ref(issue.number)} ` : ""}needs a narrow fix. Work on that branch and push to it; do not open a new PR.`,
            ...setup(path, wt, [
              `git -C ${path} fetch origin ${pr.head.ref}`,
              `git -C ${path} worktree add -B ${pr.head.ref} ${wt} origin/${pr.head.ref}`,
            ]),
            ...(v.conflict
              ? [
                  `- Merge conflict with ${base}: merge or rebase \`${base}\` into the branch, resolve the conflicts and push. This is a conflict resolution, not a CI fix; CI runs once it pushes.`,
                ]
              : []),
            ...v.failing.map((r) => `- CI failing: ${r.name}: ${r.html_url}`),
            ...v.feedback.map((c) => `- Unanswered review feedback: ${c.html_url}`),
            `Fix only that. For CI, reproduce the failure first and show the same check passing. Before pushing, run the checks ${repo}'s CLAUDE.md asks for. Reply to each review comment you address.`,
            bot
              ? `This is a Dependabot bump: adapt the code or config to the new versions rather than reverting a bump, and leave the PR description as Dependabot wrote it. If a bump can't be adopted narrowly, say why in a PR comment instead of pushing.`
              : `If the repo has a PR template, the PR description must still meet it.`,
            `Do not subscribe to PR activity: the daily workshop run checks this PR again tomorrow.`,
            `When you're done, remove the worktree and the scratch folder: \`git -C ${path} worktree remove ${wt}\` and \`rm -rf ${wt}.scratch\`.`,
          ].join("\n"),
        });
        break;
      }
      default:
        assertNever(v);
    }
  }

  // --- Dispatch -------------------------------------------------------------
  const doneStep = (i: GhIssue) => {
    const pr = stepIssues.includes(i) ? mergedFor(i.number) : undefined;
    return pr && { step: afterMerge(i.body)!, pr: `[${ref(pr.number)}](${pr.html_url})` };
  };
  for (const i of issues) {
    const st = issueState({
        title: i.title,
        labels: names(i),
        assignees: i.assignees.length,
        subIssues: i.sub_issues_summary?.total ?? 0,
        linked: linked.has(i.number),
        blockers: blockersOf.get(i.number) ?? [],
        question: openQuestion(i.body),
        afterMerge: doneStep(i),
    });
    switch (st.kind) {
      case "afterMerge":
        out.afterMerge.push(item(i, { issue: i.number, why: `${st.step}; merged in ${st.pr}` }));
        break;
      case "dispatchable":
      case "elsewhere":
        break;
      case "decision":
        out.decide.push(item(i, { issue: i.number, why: st.question }));
        break;
      case "awaitingTriage":
        out.triage.push(item(i, { issue: i.number, why: tierOf(names(i)) }));
        break;
      case "deferred":
        out.notPicked.push(item(i, { issue: i.number, why: DEFERRED, waiting: true }));
        break;
      case "blocked":
        out.notPicked.push(
          item(i, { issue: i.number, why: blockedText(st.blockers), waiting: true }),
        );
        break;
      case "notPicked":
        out.notPicked.push(item(i, { issue: i.number, why: st.reason }));
        break;
      default:
        assertNever(st);
    }
    if (st.kind !== "dispatchable" || FOLLOWUPS_ONLY) continue;
    const tier = tierOf(names(i));
    const wt = worktree("issue", i.number);
    const branch = `claude/issue-${i.number}`;
    out.dispatches.push({
      kind: "dispatch",
      repo,
      issue: i.number,
      tier,
      checkout: path,
      worktree: wt,
      created: i.created_at,
      item: item(i, { issue: i.number }),
      title: `${name}#${i.number} ${i.title}`,
      prompt: [
        `Implement ${ref(i.number)} (${i.html_url}), following ${repo}'s CLAUDE.md and the docs it points to.`,
        ...setup(path, wt, [
          `git -C ${path} fetch origin ${base}`,
          `git -C ${path} worktree add -b ${branch} ${wt} origin/${base}`,
        ]),
        `Push the branch \`${branch}\` and open a PR in ${repo} that says \`${afterMerge(i.body) ? "Refs" : "Fixes"} #${i.number}\`. If the repo has a PR template, fill it in. Before pushing, run the checks ${repo}'s CLAUDE.md asks for, and give their result in the PR.`,
        tier === "opus"
          ? `Don't label the PR \`${AUTOMERGE}\`: it waits for the maintainer's review.`
          : `Label the PR \`${AUTOMERGE}\`: the daily workshop run merges it once green.`,
        `Do not subscribe to PR activity: the daily workshop run follows up on red CI and review comments.`,
        `When you're done, remove the worktree and the scratch folder: \`git -C ${path} worktree remove ${wt}\` and \`rm -rf ${wt}.scratch\`.`,
      ].join("\n"),
    });
  }

  // Claimed by a dispatch, still no PR: stuck.
  for (const i of issues.filter((i) => i.assignees.length && !linked.has(i.number))) {
    if (isDigest(i.title) || (i.sub_issues_summary?.total ?? 0) > 0 || doneStep(i)) continue;
    const mark = i.comments
      ? all<GhComment>(`repos/${repo}/issues/${i.number}/comments?per_page=100`)
          .filter((c) => marked(c, DISPATCH))
          .at(-1)
      : null;
    const state = claimState({
      tiered: !!tierOf(names(i)),
      dispatchedAt: mark?.created_at ?? null,
      today: TODAY,
      staleDays: STALE_DAYS,
    });
    const day = mark?.created_at.slice(0, 10);
    switch (state.kind) {
      case "notPicked":
        out.notPicked.push(
          item(i, {
            issue: i.number,
            why: `assigned to ${i.assignees.map((a) => `@${a.login}`).join(", ")}; unassign to queue it`,
          }),
        );
        break;
      case "inProgress":
        out.inProgress.push(item(i, { issue: i.number, why: `dispatched ${day}, no PR yet` }));
        break;
      case "unstick":
        out.unstick.push(
          item(i, {
            issue: i.number,
            why: `dispatched ${day}, no PR yet; unassign to re-dispatch`,
          }),
        );
        break;
      case "none":
        break;
      default:
        assertNever(state);
    }
  }

  // What finishing an ask frees: the open issues waiting on it (or, for a PR, on
  // the issues it closes).
  for (const pr of prs)
    out.unblocks.set(ref(pr.number), unblocked(linkedIssues(pr.body)));
  for (const i of issues) out.unblocks.set(ref(i.number), unblocked([i.number]));
  function unblocked(done: number[]) {
    return issues
      .filter((i) =>
        done.some((n) => blockersOf.get(i.number)?.some((b) => sameRepo(b.repo) && b.number === n)),
      )
      .map((i) => ref(i.number));
  }

  // What merged in this digest's window, each with the issue it closed and its labels.
  out.merged = mergedSince(repo, since)
    .items.sort((a, b) => a.number - b.number)
    .map((pr) => {
      const closes = linkedIssues(pr.body).map(
        (n) => `${ref(n)} · ${names(api(`repos/${repo}/issues/${n}`)).join(", ")}`,
      );
      return `- [${ref(pr.number)}](${pr.html_url}) ${pr.title}${closes.length ? ` (closes ${closes.join("; ")})` : ""}`;
    });

  const have = all<{ name: string }>(`repos/${repo}/labels?per_page=100`).map((l) => l.name);
  out.missingLabels = Object.keys(LABELS).filter((l) => !have.includes(l));
  return out;
}

// The PRs merged in a repo since a date, from the search index.
function mergedSince(repo: string, since: string) {
  return api<GhSearch>("search/issues", "-X", "GET", "-f", `q=repo:${repo} is:pr is:merged merged:>=${since}`, "-f", "per_page=100");
}

// The lines that put a session in its own worktree of its repo's clone.
function setup(path: string, wt: string, commands: string[]) {
  return [
    `Work only in your own worktree of that repo's clone, never in ${path} itself or the run's working directory. Create it first:`,
    "```",
    ...commands,
    "```",
    `then do everything from \`${wt}\`.`,
    `Put every temporary file (PR description, check logs, JSON, anything else) in your own scratch folder \`${wt}.scratch\`, never directly in /tmp or the run's scratchpad: other sessions share them. Remove it along with the worktree.`,
  ];
}
