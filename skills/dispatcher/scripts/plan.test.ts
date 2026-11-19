// planRepo and assemble on RepoSnapshot fixtures, and the board and digest built from
// the run: what the dispatcher plans, with no `gh` at all. dispatch.test.ts runs each
// command end to end; snapshot.test.ts covers the reads.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildBoard } from "./board.ts";
import { buildDigest, digestState } from "./digest.ts";
import { FOOTER } from "./lib.ts";
import { assemble, LABELS, type PlanOptions, planRepo, type RepoPlan } from "./plan.ts";
import type { RepoSnapshot } from "./snapshot.ts";

type Any = any;
const M = "realJohnDoe/meridian";
const T = "realJohnDoe/tracemap";
const TODAY = new Date("2026-11-13"); // a Friday
const NOW = TODAY.toISOString();
const OPTS: PlanOptions = { today: TODAY, followupsOnly: false, maxFollowups: 2, staleDays: 2 };

const issue = (n: number, title: string, labels: string[], extra: Any = {}) => ({
  number: n,
  title,
  labels: labels.map((name) => ({ name })),
  assignees: [] as { login: string }[],
  comments: 0,
  body: "",
  html_url: `https://github.com/x/issues/${n}`,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});
const pr = (n: number, title: string, extra: Any = {}) => ({
  number: n,
  title,
  draft: false,
  labels: [],
  user: { login: "realJohnDoe" },
  auto_merge: null,
  body: "",
  head: { sha: `sha${n}`, ref: `branch-${n}`, label: `x:branch-${n}` },
  html_url: `https://github.com/x/pull/${n}`,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});
const green = [{ name: "build", status: "completed", conclusion: "success" }];
const red = [{ name: "build", status: "completed", conclusion: "failure", html_url: "https://ci/1" }];
const claim = (at: string) => [{ body: "<!-- workshop-dispatch -->", created_at: at, html_url: "u", user: { login: "b", type: "User" } }];

// One repo's snapshot; `prs` entries carry their own `runs`, `mergeable` and `comments`.
const snap = (repo: string, s: Any = {}): RepoSnapshot => {
  const name = repo.split("/")[1];
  const prs = s.prs ?? [];
  return {
    repo: { repo, name, path: `/checkouts/${name}` },
    base: "main",
    issues: s.issues ?? [],
    pulls: prs.map(({ runs, mergeable, comments, ...p }: Any) => p),
    prs: prs.map(({ runs, mergeable, comments = [], ...p }: Any) => ({
      pr: p,
      headDate: "2026-11-01T00:00:00Z",
      runs,
      mergeable,
      comments,
      reviewComments: [],
      reviews: [],
    })),
    blockers: new Map(Object.entries(s.blockers ?? {}).map(([n, b]) => [Number(n), b as Any])),
    closed: s.closed ?? [],
    dispatchedAt: new Map(Object.entries(s.dispatchedAt ?? {}).map(([n, at]) => [Number(n), at as string | null])),
    merged: s.merged ?? [],
    labels: s.labels ?? Object.keys(LABELS),
  };
};

// Two repos, as dispatch.test.ts's world().
const meridian = () =>
  snap(M, {
    issues: [
      issue(10, "Meridian sonnet task", ["sonnet", "ready-for-agent"]),
      issue(11, "Meridian waits on 10", ["opus", "ready-for-agent"], { body: "Blocked by: #10" }),
      issue(12, "Meridian untriaged", []),
      issue(13, "Meridian needs a call", ["sonnet"], { body: "## Decision needed\n\nKeep the old endpoint?\n\n## Notes\nx" }),
      issue(14, "Meridian filed by an agent", ["haiku"], { created_at: "2026-09-01T00:00:00Z" }),
    ],
    blockers: { 11: [{ repo: M, number: 10 }] },
    prs: [
      pr(20, "Meridian green automerge", { labels: [{ name: "automerge" }], runs: green, mergeable: true }),
      pr(21, "Meridian red", { runs: red, mergeable: true, created_at: "2026-09-01T00:00:00Z" }),
    ],
  });
const tracemap = () =>
  snap(T, {
    issues: [
      issue(3, "Tracemap haiku task", ["haiku", "ready-for-agent"], { created_at: "2026-09-15T00:00:00Z" }),
      issue(4, "Tracemap sonnet task", ["sonnet", "ready-for-agent"], { created_at: "2026-10-20T00:00:00Z" }),
    ],
    prs: [
      pr(8, "Bump x from 1 to 2", { user: { login: "dependabot[bot]" }, runs: green, mergeable: true }),
      pr(9, "Tracemap red", { runs: red, mergeable: true, created_at: "2026-11-01T00:00:00Z" }),
    ],
    labels: ["haiku", "sonnet", "ready-for-agent"],
  });
const plans = (opts = OPTS) => [planRepo(meridian(), opts), planRepo(tracemap(), opts)];
const automergeOf = (ps: RepoPlan[]) => ps.flatMap((p) => p.automerge.map((m) => m.item));
const runOf = (ps: RepoPlan[], maxSessions?: number, unpushable: Any[] = []) =>
  assemble(ps, { ...(maxSessions !== undefined && { maxSessions }), unpushable, automerge: automergeOf(ps) });
const digestOf = (ps: RepoPlan[], run: ReturnType<typeof runOf>, state = digestState("o/d", [], [], TODAY)) =>
  buildDigest(state, {
    ...run.digest,
    repos: ps.map((p) => ({ repo: p.repo, name: "", path: "" })),
    today: TODAY,
    now: NOW,
    followupsOnly: false,
  });

describe("planRepo", () => {
  test("merges only the green automerge PR, pinned to its head", () =>
    assert.deepEqual(
      plans().flatMap((p) => p.automerge.map(({ repo, pr, sha }) => ({ repo, pr, sha }))),
      [{ repo: M, pr: 20, sha: "sha20" }],
    ));

  test("lists the labels each repo is missing", () =>
    assert.deepEqual(plans().map((p) => p.missingLabels), [[], ["opus", "plan", "automerge", "preview", "waiting-for-human"]]));

  test("a PR whose CI is still running is in progress, with no verdict", () => {
    const p = planRepo(snap(M, { prs: [pr(5, "Running", { runs: [{ name: "b", status: "in_progress", conclusion: null }], mergeable: true })] }), OPTS);
    assert.deepEqual(p.inProgress.map((i) => [i.pr, i.why, i.check]), [[5, "CI running", "pending"]]);
    assert.deepEqual([p.followups, p.review, p.automerge], [[], [], []]);
  });

  test("--followups-only plans no dispatch, but still sorts the issues", () => {
    const p = planRepo(meridian(), { ...OPTS, followupsOnly: true });
    assert.deepEqual(p.dispatches, []);
    assert.deepEqual(p.followups.map((f) => f.pr), [21]);
    assert.equal(p.decide.length, 1);
  });

  test("a dispatched issue with no PR is Unstick; one with a PR is under its PR, never a new dispatch", () => {
    const assigned = { assignees: [{ login: "workshop-bot" }], comments: 1 };
    const p = planRepo(
      snap(M, {
        issues: [
          issue(60, "Dispatched with a PR", ["sonnet", "ready-for-agent"], assigned),
          issue(61, "Dispatched, still no PR", ["sonnet", "ready-for-agent"], assigned),
          issue(62, "Assigned by hand", ["sonnet", "ready-for-agent"], { assignees: [{ login: "someone" }] }),
        ],
        prs: [pr(70, "Do 60", { body: "Fixes #60", runs: [], mergeable: true })],
        dispatchedAt: { 61: "2026-11-13T10:00:00Z", 62: null },
      }),
      OPTS,
    );
    assert.deepEqual(p.unstick.map((i) => [i.ref, i.why]), [[`${M}#61`, "dispatched 2026-11-13, no PR yet; unassign to re-dispatch"]]);
    assert.deepEqual(p.inProgress.map((i) => i.ref), [`${M}#70`]);
    assert.deepEqual(p.notPicked.map((i) => [i.ref, i.why]), [[`${M}#62`, "assigned to @someone; unassign to queue it"]]);
    assert.deepEqual(p.dispatches, []);
  });

  test("what merged, with the issues it closed and their labels", () => {
    const p = planRepo(snap(M, { merged: [{ pr: pr(50, "Fix it", { body: "Fixes #51" }), closes: [{ number: 51, labels: ["sonnet", "ready-for-agent"] }] }] }), OPTS);
    assert.deepEqual(p.merged, [`- [${M}#50](https://github.com/x/pull/50) Fix it (closes ${M}#51 · sonnet, ready-for-agent)`]);
  });
});

describe("an issue with an After merge step", () => {
  const STEP = "Switch the Pages source at https://github.com/x/settings/pages.";
  const repo = (prs: Any[], closed: Any[]) =>
    snap(M, {
      issues: [
        issue(30, "Needs a manual step", ["sonnet", "ready-for-agent"], { assignees: [{ login: "workshop-bot" }], comments: 1, body: `## After merge\n\n${STEP}\n\nMore.` }),
        issue(31, "Waits on 30", ["sonnet", "ready-for-agent"], { body: "Blocked by: #30" }),
      ],
      blockers: { 31: [{ repo: M, number: 30 }] },
      prs,
      closed,
      dispatchedAt: { 30: "2026-10-01T00:00:00Z" },
    });
  const digest = (prs: Any[], closed: Any[]) => {
    const ps = [planRepo(repo(prs, closed), OPTS)];
    return digestOf(ps, runOf(ps, 4));
  };

  test("while its Refs PR is open it is in progress under the PR", () => {
    const { body } = digest([pr(40, "Do the thing", { body: "Refs #30", runs: green, mergeable: true })], []);
    assert.match(body, /\*\*Review:\*\* \[realJohnDoe\/meridian#40\]/);
    assert.doesNotMatch(body, /meridian#30\]/);
    assert.doesNotMatch(body, /Unstick/);
    assert.match(body, /meridian#31\]\(\S+\) Waits on 30 \(blocked by realJohnDoe\/meridian#30\)/);
  });

  test("once merged it waits on the maintainer with the step, never Unstick, past STALE_DAYS", () => {
    const d = digest([], [pr(41, "Unrelated", { merged_at: "2026-11-12T00:00:00Z" }), pr(40, "Do the thing", { body: "Refs #30", merged_at: "2026-11-12T00:00:00Z" })]);
    assert.match(
      d.body,
      new RegExp(`## Waiting on you[^]*\\*\\*After merge:\\*\\* \\[realJohnDoe/meridian#30\\]\\(\\S+\\) Needs a manual step \\(Switch the Pages source[^;]*; merged in \\[realJohnDoe/meridian#40\\]\\(\\S+\\); unblocks realJohnDoe/meridian#31\\)`),
    );
    assert.doesNotMatch(d.body, /Unstick/);
    assert.equal(d.counts.afterMerge, 1);
  });

  test("with no merged PR for it, a dispatched one is Unstick", () => {
    const d = digest([], []);
    assert.equal(d.counts.afterMerge, 0);
    assert.match(d.body, /## Unstick[^]*meridian#30\]/);
  });
});

describe("assemble", () => {
  test("one session cap across repos: newest follow-ups first, then the newest issues anywhere", () => {
    const run = runOf(plans(), 3);
    assert.deepEqual(
      run.sessions.map((s) => [s.kind, s.repo, s.kind === "followup" ? s.pr : s.issue]),
      [["followup", T, 9], ["followup", M, 21], ["dispatch", T, 4]],
    );
    assert.deepEqual(run.notStarted, [`${M}: meridian#10 Meridian sonnet task`, `${T}: tracemap#3 Tracemap haiku task`]);
    assert.deepEqual(run.board.queue.map((i) => i.ref), [`${M}#10`, `${T}#3`]);
  });

  test("each session works in its own worktree of its repo's clone", () => {
    const { sessions } = runOf(plans(), 3);
    for (const s of sessions) {
      assert.equal(s.checkout, join("/checkouts", s.repo.split("/")[1]));
      assert.ok(s.prompt.includes(`git -C ${s.checkout} worktree add`), s.prompt);
      assert.ok(s.prompt.includes(`${s.worktree}.scratch`), s.prompt);
    }
    assert.equal(new Set(sessions.map((s) => s.worktree)).size, sessions.length);
    const [, followup, dispatch] = sessions;
    assert.ok(followup.prompt.includes("- CI failing: build: https://ci/1"));
    assert.ok(dispatch.prompt.includes("Label the PR `automerge`"));
    assert.ok(dispatch.prompt.includes("`Fixes #4`, or `Refs #4` when"));
  });

  test("without a session cap it starts nothing, lists nothing as not started, and queues every dispatch", () => {
    const run = runOf(plans());
    assert.deepEqual(run.sessions, []);
    assert.deepEqual(run.notStarted, []);
    assert.deepEqual(run.board.queue.map((i) => i.ref), [`${T}#4`, `${M}#10`, `${T}#3`]);
    assert.deepEqual(
      run.board.inProgress.filter((i) => i.why === "follow-up next run").map((i) => i.ref),
      [`${T}#9`, `${M}#21`],
    );
  });

  test("a repo it can't push to heads the digest's Unstick, not the board's", () => {
    const run = runOf(plans(), 3, [{ repo: M, reason: "can't push (403)" }]);
    assert.deepEqual(run.digest.unstick.map((i) => [i.ref, i.ask]), [[M, "Can't push:"]]);
    assert.deepEqual(run.board.unstick, []);
  });
});

describe("the board and digest of a run", () => {
  const ps = plans();
  const run = runOf(ps, 3);

  test("the board: red PRs first, the Dependabot PR waits for review", () => {
    const { stages } = buildBoard(run.board, { generated: NOW, repos: [M, T], digest: "u", closed: [] });
    assert.deepEqual(stages.prInProgress.map((c) => [c.number, c.check]), [[9, "red"], [21, "red"], [20, "green"]]);
    assert.ok(stages.waiting.cards.some((c) => c.number === 8 && c.needsReview));
  });

  test("one digest naming every item's repo", () => {
    const { body, counts } = digestOf(ps, run);
    assert.match(body, /\nRepos covered: realJohnDoe\/meridian, realJohnDoe\/tracemap\.\n/);
    assert.match(body, /\*\*Review:\*\* \[realJohnDoe\/tracemap#8\]/);
    assert.match(
      body,
      /## Waiting on you[^]*\*\*Decide:\*\* \[realJohnDoe\/meridian#13\]\(\S+\) Meridian needs a call \(Keep the old endpoint\?\)[^]*\*\*Go ahead\?\*\* \[realJohnDoe\/meridian#14\]/,
    );
    assert.match(
      body,
      /## In progress\n\n- \[realJohnDoe\/tracemap#9\]\(\S+\) Tracemap red \(follow-up\)\n- \[realJohnDoe\/meridian#21\]\(\S+\) Meridian red \(follow-up\)\n- \[realJohnDoe\/tracemap#4\]\(\S+\) .* \(dispatched\)\n/,
    );
    assert.equal(counts.inProgress, 3);
    assert.match(body, /## Queue[^]*\[realJohnDoe\/meridian#10\][^]*\[realJohnDoe\/tracemap#3\]/);
    assert.match(body, /\[realJohnDoe\/meridian#12\]\(\S+\) Meridian untriaged \(no tier label/);
    assert.match(body, /\[realJohnDoe\/meridian#11\]\(\S+\) Meridian waits on 10 \(blocked by realJohnDoe\/meridian#10\)/);
    assert.match(body, /\n<!-- digest-run: 2026-11-13T00:00:00.000Z -->\n/);
    assert.match(body, new RegExp(`\n<!-- digest-repos: ${M} ${T} -->\n`));
  });

  test("at the end of a run nothing shows as dispatched", () =>
    assert.doesNotMatch(digestOf(ps, runOf(ps)).body, /\(dispatched\)/));
});

describe("the digest's state and when it is published", () => {
  const ps = plans();
  const run = runOf(ps);
  const digestIssue = (n: number, title = "Workshop digest", body = "<!-- digest-since: 2026-11-10 -->") => issue(n, title, [], { body }) as Any;
  const comment = (body: string, at: string, type = "User") => ({ body, created_at: at, html_url: `c-${at}`, user: { login: "x", type } });
  const published = (at: string) => comment("<!-- workshop-published -->\nPublished: 0 to review", at);
  const publish = (state: ReturnType<typeof digestState>) => digestOf(ps, run, state).publish;

  test("due on a Tuesday or Friday 2.5 days into its window, with something to show", () => {
    assert.equal(publish(digestState("o/d", [digestIssue(90)], [], TODAY)), true);
    assert.equal(publish(digestState("o/d", [], [], TODAY)), false); // no issue yet: it is created first
  });

  test("the window runs from the newest published comment, and a recent one means not due", () => {
    const fresh = digestState("o/d", [digestIssue(90)], [published("2026-11-10T00:00:00Z"), published("2026-11-12T00:00:00Z")], TODAY);
    assert.equal(fresh.since, "2026-11-12T00:00:00Z");
    assert.equal(publish(fresh), false);
    assert.equal(publish(digestState("o/d", [digestIssue(90)], [published("2026-11-10T00:00:00Z")], TODAY)), true);
  });

  test("drain never publishes", () =>
    assert.equal(buildDigest(digestState("o/d", [digestIssue(90)], [], TODAY), { ...run.digest, repos: [], today: TODAY, now: NOW, followupsOnly: true }).publish, false));

  test("replies: the maintainer's since the last relay, never a bot's, an agent's or a published comment", () => {
    const { replies } = digestState(
      "o/d",
      [digestIssue(90)],
      [
        comment("old", "2026-11-10T00:00:00Z"),
        comment("<!-- workshop-relayed -->", "2026-11-11T00:00:00Z"),
        comment("ready meridian#14", "2026-11-12T00:00:00Z"),
        comment("beep", "2026-11-12T01:00:00Z", "Bot"),
        comment(`<!-- workshop-published -->\nhi${FOOTER}`, "2026-11-12T02:00:00Z"),
      ],
      TODAY,
    );
    assert.deepEqual(replies, [{ digest: 90, url: "c-2026-11-12T00:00:00Z", author: "x", body: "ready meridian#14" }]);
  });

  test("the newest open digest is the digest; older ones are closed into it; its markers are read back", () => {
    const s = digestState(
      "o/d",
      [digestIssue(90, "Workshop digest — 2026-11-06"), digestIssue(91, "Workshop digest", `<!-- digest-since: 2026-11-10 -->\n<!-- digest-run: 2026-11-12T20:00:00.000Z -->\n<!-- digest-repos: ${M} ${T} -->`)],
      [],
      TODAY,
    );
    assert.equal(s.issue?.number, 91);
    assert.deepEqual(s.older.map((i) => i.number), [90]);
    assert.equal(s.lastRun, "2026-11-12T20:00:00.000Z");
    assert.deepEqual(s.covered, [M, T]);
  });
});
