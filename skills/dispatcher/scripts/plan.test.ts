// planRepo and assemble on RepoSnapshot fixtures, and the board built from
// the run: what the dispatcher plans, with no `gh` at all. dispatch.test.ts runs each
// command end to end; snapshot.test.ts covers the reads.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildBoard } from "./board.ts";
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
const runOf = (ps: RepoPlan[], maxSessions?: number) =>
  assemble(ps, { ...(maxSessions !== undefined && { maxSessions }), automerge: automergeOf(ps) });
const boardOf = (run: ReturnType<typeof runOf>) => buildBoard(run.board, { generated: NOW, repos: [M, T], closed: [] }).stages;

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

  test("a dispatched issue with no PR is Unstick; one with a PR is under its PR; one assigned by hand asks only while ready", () => {
    const assigned = { assignees: [{ login: "workshop-bot" }], comments: 1 };
    const p = planRepo(
      snap(M, {
        issues: [
          issue(60, "Dispatched with a PR", ["sonnet", "ready-for-agent"], assigned),
          issue(61, "Dispatched, still no PR", ["sonnet", "ready-for-agent"], assigned),
          issue(62, "Assigned by hand", ["sonnet", "ready-for-agent"], { assignees: [{ login: "someone" }] }),
          issue(63, "Someone's own work", ["sonnet"], { assignees: [{ login: "someone" }] }),
          issue(64, "Someone's own plan", ["plan"], { assignees: [{ login: "someone" }] }),
        ],
        prs: [pr(70, "Do 60", { body: "Fixes #60", runs: [], mergeable: true })],
        dispatchedAt: { 61: "2026-11-13T10:00:00Z", 62: null, 63: null, 64: null },
      }),
      OPTS,
    );
    assert.deepEqual(p.unstick.map((i) => [i.ref, i.why]), [[`${M}#61`, "dispatched 2026-11-13, no PR yet; unassign to re-dispatch"]]);
    assert.deepEqual(p.inProgress.map((i) => i.ref), [`${M}#70`]);
    assert.deepEqual(p.asks.map((i) => [i.ref, i.sub, i.why]), [
      [`${M}#62`, "assigned", "assigned to @someone but ready for an agent; unassign it or remove ready-for-agent"],
    ]);
    assert.deepEqual([p.dispatches, p.behind, p.triage, p.decide], [[], [], [], []]);
  });

  test("a PR carries its open issue as `parent`, whether it closes or only references it; one with no open issue has none", () => {
    const p = planRepo(
      snap(M, {
        issues: [issue(60, "Parent one", ["sonnet", "ready-for-agent"]), issue(61, "Parent two", [])],
        prs: [
          pr(70, "Closes", { body: "Fixes #60", runs: [], mergeable: true }),
          pr(71, "Only refs", { body: "Refs #61", runs: [], mergeable: true }),
          pr(72, "Orphan", { body: "Closes #99", runs: [], mergeable: true }),
        ],
      }),
      OPTS,
    );
    const parent = (n: number) => p.inProgress.find((i) => i.pr === n)?.parent;
    assert.deepEqual(parent(70), { number: 60, title: "Parent one", url: "https://github.com/x/issues/60" });
    assert.equal(parent(71)?.number, 61);
    assert.equal(parent(72), undefined);
  });

  test("the workshop's can't-push issue is Stuck, never dispatched or waiting", () => {
    const body = `<!-- workshop-cant-push: ${T} -->\nThe workshop can't push to it.`;
    const p = planRepo(snap(M, { issues: [issue(70, `Workshop can't push to ${T}`, ["sonnet", "ready-for-agent"], { body })] }), OPTS);
    assert.deepEqual(p.unstick.map((i) => [i.ref, i.why]), [[`${M}#70`, `can't push to ${T}; give the routine push access, or detach it`]]);
    assert.deepEqual([p.dispatches, p.behind, p.triage, p.decide, p.asks], [[], [], [], [], []]);
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
  const board = (prs: Any[], closed: Any[]) => boardOf(runOf([planRepo(repo(prs, closed), OPTS)], 4));
  const numbers = (cs: { number: number }[]) => cs.map((c) => c.number);

  test("while its Refs PR is open it is in progress under the PR", () => {
    const b = board([pr(40, "Do the thing", { body: "Refs #30", runs: green, mergeable: true })], []);
    assert.deepEqual(b.waiting.map((c) => [c.number, c.needsReview]), [[40, true]]);
    assert.deepEqual(b.stuck, []);
    assert.deepEqual(b.behind.map((c) => [c.number, c.reason]), [[31, "blocked by realJohnDoe/meridian#30"]]);
  });

  test("once merged it waits on the maintainer with the step, never Stuck, past STALE_DAYS", () => {
    const b = board([], [pr(41, "Unrelated", { merged_at: "2026-11-12T00:00:00Z" }), pr(40, "Do the thing", { body: "Refs #30", merged_at: "2026-11-12T00:00:00Z" })]);
    const [c] = b.waiting;
    assert.deepEqual([c.number, c.sub, c.prs], [30, "afterMerge", [40]]);
    assert.match(c.reason, /^Switch the Pages source[^;]*; merged in \[realJohnDoe\/meridian#40\]/);
    assert.deepEqual(b.stuck, []);
  });

  test("with no merged PR for it, a dispatched one is Stuck", () => {
    const b = board([], []);
    assert.deepEqual(numbers(b.stuck), [30]);
    assert.deepEqual(b.waiting, []);
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

  test("a Dependabot major's follow-up must check breaking changes, a minor's need not", () => {
    const f = (title: string) =>
      runOf([planRepo(snap(T, { prs: [pr(8, title, { user: { login: "dependabot[bot]" }, runs: red, mergeable: true })] }), OPTS)], 1)
        .sessions[0].prompt;
    assert.ok(f("Bump js-yaml from 4.3.2 to 5.5.0").includes("read the changelog's breaking changes"));
    assert.ok(!f("Bump x from 4.3.2 to 4.4.0").includes("breaking changes"));
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
});

describe("the board of a run", () => {
  const ps = plans();
  const run = runOf(ps, 3);

  test("the board: red PRs first, the Dependabot PR waits for review", () => {
    const { stages } = buildBoard(run.board, { generated: NOW, repos: [M, T], closed: [] });
    assert.deepEqual(stages.prInProgress.map((c) => [c.number, c.check]), [[9, "red"], [21, "red"], [20, "green"]]);
    assert.ok(stages.waiting.some((c) => c.number === 8 && c.needsReview));
  });

  test("the board flags every open issue without ready-for-agent, and nothing else", () => {
    const { stages } = buildBoard(run.board, { generated: NOW, repos: [M, T], closed: [] });
    const all = [...stages.stuck, ...stages.waiting, ...stages.queue, ...stages.prInProgress, ...stages.behind];
    assert.deepEqual(all.filter((c) => c.unready).map((c) => c.number).sort((a, b) => a - b), [12, 13, 14]);
  });

  test("every open non-draft PR shows on the board, once", () => {
    const { stages } = buildBoard(run.board, { generated: NOW, repos: [M, T], closed: [] });
    const all = [...stages.stuck, ...stages.waiting, ...stages.queue, ...stages.prInProgress, ...stages.behind];
    const prs = all.filter((c) => c.kind === "pr").map((c) => `${c.repo}#${c.number}`).sort();
    assert.deepEqual(prs, [`${M}#20`, `${M}#21`, `${T}#8`, `${T}#9`]);
  });

  test("at the end of a run nothing shows as dispatched", () =>
    assert.ok(boardOf(runOf(ps)).prInProgress.every((c) => c.reason !== "dispatched")));
});
