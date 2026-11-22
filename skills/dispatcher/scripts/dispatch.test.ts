// Runs dispatch.ts and pause.ts end to end over two repos, against a fake `gh`
// and `git` (fake-bin.ts): one smoke test per dispatch.ts command, the command line's
// stops, and pause.ts. What the plan decides is in plan.test.ts, what it reads in
// snapshot.test.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeBin } from "../../_shared/fake-bin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const HOME = "realJohnDoe/joes-workshop";
const M = "realJohnDoe/meridian";
const T = "realJohnDoe/tracemap";
const TODAY = "2026-11-13"; // a Friday

type Any = any;
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
const ALL_LABELS = ["haiku", "sonnet", "opus", "plan", "ready-for-agent", "automerge", "preview", "waiting-for-human"].map(
  (name) => ({ name }),
);
const green = [{ name: "build", status: "completed", conclusion: "success" }];
const red = [{ name: "build", status: "completed", conclusion: "failure", html_url: "https://ci/1" }];

// Answers for one repo's reads; `prs` entries carry their own `runs` and `mergeable`.
const repoFixture = (repo: string, { issues, prs, labels = ALL_LABELS }: Any) => {
  const f: Record<string, unknown> = {
    [`repos/${repo}`]: { default_branch: "main" },
    [`repos/${repo}/issues`]: issues,
    [`repos/${repo}/pulls`]: prs.map(({ runs, mergeable, ...p }: Any) => p),
    [`repos/${repo}/labels`]: labels,
    [`search/issues?q=repo:${repo} is:pr is:merged merged:>=${TODAY}`]: { items: [] },
    [`repos/${repo}/commits/main`]: { sha: `${repo}-main` },
  };
  for (const p of prs) {
    f[`repos/${repo}/commits/${p.head.sha}`] = { commit: { committer: { date: "2026-11-01T00:00:00Z" } } };
    f[`repos/${repo}/commits/${p.head.sha}/check-runs`] = { check_runs: p.runs };
    f[`repos/${repo}/pulls/${p.number}`] = { mergeable: p.mergeable };
    f[`repos/${repo}/issues/${p.number}/comments`] = [];
    f[`repos/${repo}/pulls/${p.number}/comments`] = [];
    f[`repos/${repo}/pulls/${p.number}/reviews`] = [];
  }
  return f;
};

// `homeIssues` are the home repo's open issues, `homeClosed` its newest closed ones, and
// `homeComments` the comments on any of them, by number.
const world = ({
  homeIssues = [],
  homeClosed = [],
  homeComments = {},
  extra = {},
}: { homeIssues?: Any[]; homeClosed?: Any[]; homeComments?: Any; extra?: Any } = {}) => ({
  ...repoFixture(M, {
    issues: [
      issue(10, "Meridian sonnet task", ["sonnet", "ready-for-agent"], { created_at: "2026-10-01T00:00:00Z" }),
      issue(11, "Meridian waits on 10", ["opus", "ready-for-agent"], { body: "Blocked by: #10" }),
      issue(12, "Meridian untriaged", []),
      issue(13, "Meridian needs a call", ["sonnet"], { body: "## Decision needed\n\nKeep the old endpoint?\n\n## Notes\nx" }),
      issue(14, "Meridian filed by an agent", ["haiku"], { created_at: "2026-09-01T00:00:00Z" }),
    ],
    prs: [
      pr(20, "Meridian green automerge", { labels: [{ name: "automerge" }], runs: green, mergeable: true }),
      pr(21, "Meridian red", { runs: red, mergeable: true, created_at: "2026-09-01T00:00:00Z" }),
    ],
  }),
  ...repoFixture(T, {
    issues: [
      issue(3, "Tracemap haiku task", ["haiku", "ready-for-agent"], { created_at: "2026-09-15T00:00:00Z" }),
      issue(4, "Tracemap sonnet task", ["sonnet", "ready-for-agent"], { created_at: "2026-10-20T00:00:00Z" }),
    ],
    prs: [
      pr(8, "Bump x from 1 to 2", { user: { login: "dependabot[bot]" }, runs: green, mergeable: true }),
      pr(9, "Tracemap red", { runs: red, mergeable: true, created_at: "2026-11-01T00:00:00Z" }),
    ],
    labels: [{ name: "haiku" }, { name: "sonnet" }, { name: "ready-for-agent" }],
  }),
  user: { login: "workshop-bot" },
  [`search/issues?q=repo:${M} repo:${T} is:issue is:closed reason:completed`]: {
    items: [
      issue(1, "Old", ["sonnet"], { closed_at: "2026-11-01T00:00:00Z", repository_url: `https://api.github.com/repos/${M}` }),
      issue(2, "Done", ["haiku"], { closed_at: "2026-11-12T00:00:00Z", repository_url: `https://api.github.com/repos/${T}` }),
    ],
  },
  [`repos/${M}/issues/1/timeline`]: [],
  [`repos/${T}/issues/2/timeline`]: [
    { event: "cross-referenced", source: { issue: { number: 7, pull_request: { merged_at: "2026-11-12T00:00:00Z" } } } },
    { event: "cross-referenced", source: { issue: { number: 8, pull_request: { merged_at: "2026-11-12T01:00:00Z" } } } },
    { event: "cross-referenced", source: { issue: { number: 9, pull_request: { merged_at: null } } } },
  ],
  [`repos/${HOME}/issues`]: homeIssues,
  [`repos/${HOME}/issues?state=closed`]: homeClosed,
  ...Object.fromEntries(
    Object.entries(homeComments).map(([n, cs]) => [`repos/${HOME}/issues/${n}/comments`, cs]),
  ),
  ...extra,
});

// Runs a workshop script against `fixture` with both repos checked out (attached),
// except those in `missing`. `apply` lets it write (logged in `writes`), and passes
// pause.ts its --apply; without it any write fails the run. The checkouts folder also holds a plain folder and a
// clone without an origin, which discovery must skip.
const run = (
  script: string,
  args: string[],
  fixture: unknown,
  { apply = false, missing = [], noPush = [], attach = [] }: { apply?: boolean; missing?: string[]; noPush?: string[]; attach?: string[] } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "workshop-test-"));
  const checkouts = join(dir, "checkouts");
  const remotes: Record<string, string> = {};
  for (const repo of [M, T, ...attach]) {
    const name = repo.split("/")[1];
    if (missing.includes(repo)) continue;
    mkdirSync(join(checkouts, name, ".git"), { recursive: true });
    remotes[join(checkouts, name)] = `https://github.com/${repo}.git`;
  }
  mkdirSync(join(checkouts, "notes"), { recursive: true });
  mkdirSync(join(checkouts, "scratch", ".git"), { recursive: true });
  // The board's closed-issue search names every covered repo; answer it empty unless the fixture does.
  const only = args.includes("--repos") ? args[args.indexOf("--repos") + 1].split(",") : null;
  const covered = [M, T, ...attach].sort().filter((r) => !missing.includes(r) && (!only || only.includes(r)));
  const closedKey = `search/issues?q=${covered.map((r) => `repo:${r}`).join(" ")} is:issue is:closed reason:completed`;
  writeFileSync(join(dir, "fixture.json"), JSON.stringify({ [closedKey]: { items: [] }, ...(fixture as object) }));
  const log = join(dir, "writes.jsonl");
  const gitLog = join(dir, "git.jsonl");
  writeFileSync(log, "");
  writeFileSync(gitLog, "");
  const res = spawnSync(
    process.execPath,
    [join(here, script), ...args, "--today", TODAY, "--home", HOME, "--checkouts", checkouts, ...(apply && script === "pause.ts" ? ["--apply"] : [])],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin()}:${process.env.PATH}`,
        FAKE_GH_FIXTURE: join(dir, "fixture.json"),
        FAKE_GIT_REMOTES: JSON.stringify(remotes),
        FAKE_GIT_NOPUSH: JSON.stringify(noPush.map((r) => join(checkouts, r.split("/")[1]))),
        FAKE_GIT_LOG: gitLog,
        ...(apply ? { FAKE_GH_LOG: log } : {}),
      },
    },
  );
  const writes = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const gitCalls = readFileSync(gitLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { ...res, checkouts, writes, gitCalls, plan: res.status === 0 ? JSON.parse(res.stdout) : null };
};

// Waiting for human in world(): meridian#13 (decide), meridian#14 (go-ahead), tracemap#8 (review).
const labelled = (repo: string, items: Any[]) => ({ [`repos/${repo}/issues?labels=waiting-for-human&state=all&per_page=100`]: items });
const BOARD_RUN = { method: "POST", path: `repos/${HOME}/actions/workflows/board.yml/dispatches`, body: { ref: "main" } };
const labelWrites = (r: Any) => r.writes.filter((w: Any) => /\/issues\/\d+\/labels/.test(w.path)).map((w: Any) => `${w.method} ${w.path}`);

describe("dispatch plan", () => {
  const res = run("dispatch.ts", ["plan", "--max-sessions", "3"], world());

  test("prints the plan over both repos and writes nothing", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.applied, false);
    assert.deepEqual(res.plan.repos, [M, T]);
    assert.deepEqual(res.plan.sessions.map((s: Any) => [s.kind, s.repo, s.pr ?? s.issue]), [["followup", T, 9], ["followup", M, 21], ["dispatch", T, 4]]);
    assert.ok(res.plan.sessions.every((s: Any) => s.prompt && !("brief" in s) && !("item" in s)));
    assert.deepEqual(res.plan.notStarted, [`${M}: meridian#10 Meridian sonnet task`, `${T}: tracemap#3 Tracemap haiku task`]);
    assert.deepEqual(res.plan.automerge, [{ repo: M, pr: 20, sha: "sha20", title: "Meridian green automerge" }]);
    assert.deepEqual(res.plan.missingLabels, [{ repo: T, missing: ["opus", "plan", "automerge", "preview", "waiting-for-human"] }]);
    assert.deepEqual(res.plan.waitingLabel, []);
  });

  test("the board's closed issues come newest first with their merged PRs", () =>
    assert.deepEqual(
      res.plan.board.stages.closed.map((c: Any) => [c.repo, c.number, c.prs]),
      [[T, 2, [7, 8]], [M, 1, undefined]],
    ));
});

describe("dispatch apply", () => {
  // Meridian's automerge PR closes #51, which #52 waits on.
  const sent = issue(51, "Closed by the merge", ["sonnet", "ready-for-agent"], { assignees: [{ login: "workshop-bot" }], state: "open" });
  const fixture = {
    ...world(),
    ...repoFixture(M, {
      issues: [sent, issue(52, "Waits on 51", ["sonnet", "ready-for-agent"], { body: "Blocked by: #51" })],
      prs: [pr(50, "Fix it", { body: "Fixes #51", labels: [{ name: "automerge" }], runs: green, mergeable: true })],
    }),
    [`repos/${M}/issues/51`]: { ...sent, state: "open" },
    [`repos/${M}/issues/51/comments`]: [{ body: "<!-- workshop-dispatch -->", created_at: "2026-11-12T00:00:00Z", html_url: "u", user: { login: "b", type: "User" } }],
  };
  const res = run("dispatch.ts", ["apply", "--max-sessions", "3"], fixture, { apply: true });
  const writes = (method: string, path: string) => res.writes.filter((w) => w.method === method && w.path.startsWith(path));

  test("creates missing labels first, in the repo missing them", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.applied, true);
    assert.deepEqual(writes("POST", `repos/${T}/labels`).map((w) => w.body.name), ["opus", "plan", "automerge", "preview", "waiting-for-human"]);
    assert.equal(res.writes[0].path, `repos/${T}/labels`);
  });

  test("merges pinned to the checked commit, then waits for GitHub and reads the repo again", () => {
    assert.deepEqual(writes("PUT", `repos/${M}/pulls/50/merge`).map((w) => w.body), [{ sha: "sha50", merge_method: "merge" }]);
    assert.ok(!res.plan.board.stages.stuck.some((c: Any) => c.repo === M && c.number === 51));
  });

  test("claims each session in its own repo, the one the merge unblocked included", () => {
    assert.deepEqual(res.plan.sessions.map((s: Any) => [s.repo, s.pr ?? s.issue]), [[T, 9], [T, 4], [M, 52]]);
    assert.equal(writes("POST", `repos/${T}/issues/9/comments`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/4/assignees`).length, 1);
    assert.equal(writes("POST", `repos/${M}/issues/52/assignees`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/3/assignees`).length, 0);
  });

  test("writes nothing in the home repo and no waiting-for-human label: that is finish's", () => {
    assert.equal(res.writes.filter((w) => w.path.startsWith(`repos/${HOME}/`)).length, 0);
    assert.deepEqual(labelWrites(res), []);
    assert.deepEqual(res.plan.waitingLabel, []);
  });
});

describe("dispatch finish", () => {
  // The retired digest issues, and a can't-push issue for a repo it can push to again.
  const stale = issue(95, `Workshop can't push to ${T}`, [], { body: `<!-- workshop-cant-push: ${T} -->\nold` });
  const digests = [issue(90, "Workshop digest — 2026-11-06", []), issue(91, "Workshop digest", [])];
  const waiting = {
    ...labelled(M, [
      issue(13, "Meridian needs a call", ["sonnet", "waiting-for-human"]),
      issue(10, "Meridian sonnet task", ["sonnet", "ready-for-agent", "waiting-for-human"]),
      issue(5, "Closed since", ["waiting-for-human"], { state: "closed" }),
    ]),
    ...labelled(T, []),
  };
  const fixture = world({ homeIssues: [...digests, stale], extra: waiting });
  const res = run("dispatch.ts", ["finish"], fixture, { apply: true });
  const d = (r: Any, path: string) => r.writes.filter((w: Any) => w.path === `repos/${HOME}/issues/${path}`);

  test("starts nothing and merges nothing", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.sessions, []);
    assert.deepEqual(res.plan.notStarted, []);
    assert.deepEqual(res.writes.filter((w) => !w.path.startsWith(`repos/${HOME}/`) && !/\/issues\/\d+\/labels/.test(w.path)), []);
  });

  test("closes the retired digest issues with a comment, and opens no pause issue for unpaused ones", () => {
    assert.deepEqual(res.plan.retire, { close: [90, 91], openPause: false });
    for (const n of [90, 91]) {
      assert.match(d(res, `${n}/comments`)[0].body.body, /Retired/);
      assert.deepEqual([d(res, `${n}`)[0].body.state, d(res, `${n}`)[0].body.state_reason], ["closed", "completed"]);
    }
    assert.equal(res.writes.filter((w) => w.path === `repos/${HOME}/issues`).length, 0);
  });

  test("a retired digest that pauses the workshop gets a pause issue first, so closing it doesn't resume", () => {
    const paused = run("dispatch.ts", ["finish"], world({ homeIssues: [issue(91, "Workshop digest", ["workshop-paused"])], extra: waiting }), { apply: true });
    assert.equal(paused.status, 0, paused.stderr);
    assert.deepEqual(paused.plan.retire, { close: [91], openPause: true });
    const home = paused.writes.filter((w: Any) => w.path.startsWith(`repos/${HOME}/issues`)).map((w: Any) => w.path);
    assert.deepEqual(home, [`repos/${HOME}/issues`, `repos/${HOME}/issues/91/comments`, `repos/${HOME}/issues/91`]);
    assert.equal(paused.writes.find((w: Any) => w.path === `repos/${HOME}/issues`).body.title, "Pause workshop");
  });

  test("a retired digest that pauses the workshop opens none while a pause issue is open", () => {
    const both = world({ homeIssues: [issue(91, "Workshop digest", ["workshop-paused"]), issue(92, "Pause workshop", [])], homeComments: { 92: [] }, extra: waiting });
    const r = run("dispatch.ts", ["finish"], both, { apply: true });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.plan.retire, { close: [91], openPause: false });
  });

  test("closes the can't-push issue of a repo it can push to again", () => {
    assert.deepEqual(res.plan.cantPush, { open: [], close: [{ repo: T, number: 95 }] });
    assert.match(d(res, "95/comments")[0].body.body, /can push to realJohnDoe\/tracemap again/);
    assert.equal(d(res, "95")[0].body.state, "closed");
  });

  test("mirrors the Waiting for human stage onto the label, closed items included, then starts the board workflow with this run", () => {
    assert.deepEqual(labelWrites(res).sort(), [
      `DELETE repos/${M}/issues/10/labels/waiting-for-human`,
      `DELETE repos/${M}/issues/5/labels/waiting-for-human`,
      `POST repos/${M}/issues/12/labels`, // no tier label: a Waiting for human card
      `POST repos/${M}/issues/14/labels`,
      `POST repos/${T}/issues/8/labels`,
    ]);
    const inputs = { last_run: "2026-11-13T00:00:00.000Z", repos: `${M} ${T}` };
    assert.deepEqual(res.writes.at(-1), { ...BOARD_RUN, body: { ref: "main", inputs } });
    assert.deepEqual(res.plan.boardInputs, inputs);
    assert.equal(res.plan.board.lastRun, inputs.last_run);
    assert.deepEqual(res.plan.boardRefresh, { triggered: true });
  });

  test("--dry-run plans the same and writes nothing", () => {
    const dry = run("dispatch.ts", ["finish", "--dry-run"], fixture);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.plan.applied, false);
    assert.deepEqual(dry.plan.waitingLabel, res.plan.waitingLabel);
    assert.deepEqual(dry.plan.retire, res.plan.retire);
    assert.deepEqual(dry.plan.boardInputs, res.plan.boardInputs);
    assert.equal(dry.plan.boardRefresh, undefined);
  });

  test("never labels in a repo it can't push to", () => {
    const blocked = run("dispatch.ts", ["finish"], fixture, { apply: true, noPush: [T] });
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.ok(labelWrites(blocked).every((w: string) => !w.includes(T)));
    assert.deepEqual(blocked.plan.waitingLabel.map((s: Any) => s.repo), [M]);
  });

  test("--no-run-marker, drain's last step: only the label, and the board workflow with no run", () => {
    const drain = run("dispatch.ts", ["finish", "--no-run-marker"], world({ homeIssues: [stale], extra: waiting }), { apply: true });
    assert.equal(drain.status, 0, drain.stderr);
    assert.deepEqual(drain.writes.filter((w) => !/\/issues\/\d+\/labels/.test(w.path) && w.path !== BOARD_RUN.path), []);
    assert.deepEqual(drain.writes.at(-1), BOARD_RUN);
    assert.equal(drain.plan.boardInputs, null);
    assert.equal(drain.plan.board.lastRun, undefined);
  });
});

describe("dispatch board, the board workflow's build", () => {
  // As in the workflow: only joes-workshop is checked out, nothing can be pushed to, and
  // the live board, as the last build left it, names the repos to cover. The workshop is paused.
  const snapshot = { body: "<!-- workshop-snapshot -->\nWorkshop paused.", created_at: "2026-11-13T00:00:00Z", html_url: "https://github.com/x/issues/50#c1", user: { login: "b", type: "User" } };
  const PAGES = "https://realjohndoe.github.io/joes-workshop/";
  const { [`search/issues?q=repo:${M} repo:${T} is:issue is:closed reason:completed`]: closedMT, ...w } = world({ homeComments: { 50: [snapshot] } }) as Any;
  // No merged-since search in the fixture: the board reads none.
  const fixture = {
    ...Object.fromEntries(Object.entries({ ...repoFixture(HOME, { issues: [], prs: [] }), ...w }).filter(([k]) => !k.includes("is:merged"))),
    [`repos/${HOME}/issues`]: [issue(50, "Pause workshop", [])],
    [`search/issues?q=repo:${HOME} repo:${M} repo:${T} is:issue is:closed reason:completed`]: { items: [] },
    [`repos/${HOME}/pages`]: { html_url: PAGES },
    [`${PAGES}board.json`]: { repos: [HOME, M, T], lastRun: "2026-11-12T20:00:00.000Z", stages: {} },
  };
  const res = run("dispatch.ts", ["board"], fixture, { apply: true, missing: [M, T], noPush: [HOME] });

  test("with no inputs, covers the repos and shows the run the live board has, not the clones, and shows the pause", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [HOME, M, T]);
    assert.equal(res.plan.board.lastRun, "2026-11-12T20:00:00.000Z");
    assert.equal(res.plan.board.state, "paused");
    assert.deepEqual(res.plan.board.paused, { since: "2026-11-13", snapshot: "https://github.com/x/issues/50#c1" });
    assert.ok(!("digest" in res.plan.board));
  });

  test("with inputs, covers and shows those instead", () => {
    const given = { ...fixture, [`search/issues?q=repo:${M} repo:${T} is:issue is:closed reason:completed`]: closedMT };
    const r = run("dispatch.ts", ["board", "--repos-covered", `${M} ${T}`, "--last-run", "2026-11-13T17:00:00.000Z"], given, { missing: [M, T] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.plan.repos, [M, T]);
    assert.equal(r.plan.board.lastRun, "2026-11-13T17:00:00.000Z");
  });

  test("reuses the live board's merged PRs for an issue closed the same day, and reads the rest", () => {
    const { [`repos/${T}/issues/2/timeline`]: _, ...noTimeline } = { ...fixture, [`search/issues?q=repo:${M} repo:${T} is:issue is:closed reason:completed`]: closedMT } as Any;
    const cached = (number: number, day: string, prs: number[]) => ({ repo: T, kind: "issue", number, title: "x", url: "u", prs, reason: `closed ${day}` });
    const live = { ...fixture[`${PAGES}board.json`], stages: { closed: [cached(2, "2026-11-12", [99])] } };
    const r = run("dispatch.ts", ["board", "--repos-covered", `${M} ${T}`, "--last-run", "2026-11-13T17:00:00.000Z"], { ...noTimeline, [`${PAGES}board.json`]: live }, { missing: [M, T] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.plan.board.stages.closed.map((c: Any) => [c.number, c.prs]), [[2, [99]], [1, undefined]]);
    // closed again on another day: read afresh, and the timeline it needs isn't there
    const stale = { ...live, stages: { closed: [cached(2, "2026-11-01", [99])] } };
    assert.notEqual(run("dispatch.ts", ["board", "--repos-covered", `${M} ${T}`, "--last-run", "2026-11-13T17:00:00.000Z"], { ...noTimeline, [`${PAGES}board.json`]: stale }, { missing: [M, T] }).status, 0);
  });

  test("writes nothing, checks no push access, and prints no sessions", () => {
    assert.deepEqual(res.writes, []);
    assert.equal(res.gitCalls.some((c) => c.args.includes("--dry-run")), false);
    assert.deepEqual(res.plan.unpushable, []);
    for (const k of ["sessions", "notStarted", "retire", "boardRefresh"]) assert.ok(!(k in res.plan), k);
  });

  test("no inputs and no live board stops it with why", () => {
    const fresh = run("dispatch.ts", ["board"], world());
    assert.equal(fresh.status, 1);
    assert.match(fresh.stderr, /no covered repos: pass --repos-covered, or run the dispatcher once first/);
  });

  test("an input that isn't a repo stops it", () => {
    const bad = run("dispatch.ts", ["board", "--repos-covered", "meridian", "--last-run", "2026-11-13T17:00:00.000Z"], world());
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not owner\/repo: meridian/);
  });
});

describe("the command line", () => {
  test("no command, or a flag of another command, stops the run before any read", () => {
    const none = run("dispatch.ts", [], world());
    assert.equal(none.status, 1);
    assert.match(none.stderr, /name a command first: dispatch\.ts plan\|apply\|finish\|board/);
    const retired = run("dispatch.ts", ["finish", "--apply", "--digest-only"], world());
    assert.equal(retired.status, 1);
    assert.match(retired.stderr, /--apply, --digest-only: not an option of `dispatch\.ts finish`/);
    assert.match(run("dispatch.ts", ["board", "--dry-run"], world()).stderr, /--dry-run: not an option/);
    assert.match(run("dispatch.ts", ["finish", "--no-digest"], world()).stderr, /--no-digest: not an option/);
  });
});

describe("the repos are the ones attached", () => {
  test("a repo that isn't attached isn't covered, and the plan says which are", () => {
    const res = run("dispatch.ts", ["plan"], world(), { missing: [T] });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [M]);
    assert.deepEqual(res.plan.board.repos, [M]);
  });
  test("--repos naming a repo that isn't attached stops the run", () => {
    const res = run("dispatch.ts", ["plan", "--repos", T], world(), { missing: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--repos names repos not checked out under .*: realjohndoe\/tracemap/);
    assert.equal(res.stdout, "");
  });
  test("no --home stops the run, and the retired --digest says so", () => {
    const res = spawnSync(process.execPath, [join(here, "dispatch.ts"), "plan"], { encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /pass --home owner\/repo/);
    const old = spawnSync(process.execPath, [join(here, "dispatch.ts"), "plan", "--digest", HOME], { encoding: "utf8" });
    assert.match(old.stderr, /--digest is retired: pass --home owner\/repo/);
  });
  test("run from inside the skill's folder without --checkouts stops the run", () => {
    // An installed plugin's skill folder isn't a git clone, so copy the scripts out of this one.
    const skills = mkdtempSync(join(tmpdir(), "installed-skills-"));
    const skillDir = join(skills, "dispatcher");
    cpSync(here, join(skillDir, "scripts"), { recursive: true });
    cpSync(join(here, "..", "..", "_shared"), join(skills, "_shared"), { recursive: true });
    const res = spawnSync(process.execPath, [join(skillDir, "scripts", "dispatch.ts"), "plan", "--home", HOME], {
      cwd: skillDir,
      encoding: "utf8",
      env: { ...process.env, WORKSHOP_CHECKOUTS: "" },
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Run from the session's working directory, not the skill's folder/);
  });
  test("no attached repo stops the run", () => {
    const res = run("dispatch.ts", ["plan"], world(), { missing: [M, T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /No GitHub clone under /);
  });
  test("--repos limits the run to one attached repo", () => {
    const res = run("dispatch.ts", ["plan", "--repos", M], world());
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [M]);
  });
});

describe("dispatch apply on a repo it can't push to", () => {
  test("skips it and lists it; the others go on", () => {
    const res = run("dispatch.ts", ["apply"], world(), { apply: true, noPush: [M] });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.unpushable.map((u: Any) => u.repo), [M]);
    assert.match(res.plan.unpushable[0].reason, /^can't push/);
    assert.deepEqual(res.writes.filter((w: Any) => JSON.stringify(w).includes(`repos/${M}/`)), []);
    assert.ok(res.plan.sessions.length > 0);
    assert.ok(res.plan.sessions.every((s: Any) => s.repo === T));
    assert.ok(res.plan.automerge.every((m: Any) => m.repo === T));
  });
});

describe("dispatch finish on a repo it can't push to", () => {
  const res = run("dispatch.ts", ["finish"], world(), { apply: true, noPush: [M] });
  const filed = res.writes.filter((w: Any) => w.path === `repos/${HOME}/issues`);

  test("files one issue for it in the home repo, with the marker the board reads", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.cantPush.open.map((u: Any) => u.repo), [M]);
    assert.equal(filed.length, 1);
    assert.equal(filed[0].body.title, `Workshop can't push to ${M}`);
    assert.match(filed[0].body.body, new RegExp(`^<!-- workshop-cant-push: ${M} -->\nThe workshop can't push to ${M} \\(`));
    assert.match(filed[0].body.body, /claude\.ai\/code\/scheduled/);
  });

  test("files none while one is open", () => {
    const open = issue(96, `Workshop can't push to ${M}`, [], { body: `<!-- workshop-cant-push: ${M} -->` });
    const again = run("dispatch.ts", ["finish"], world({ homeIssues: [open] }), { apply: true, noPush: [M] });
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(again.plan.cantPush, { open: [], close: [] });
    assert.equal(again.writes.filter((w: Any) => w.path.startsWith(`repos/${HOME}/issues/96`) || w.path === `repos/${HOME}/issues`).length, 0);
  });
});

describe("pause over two repos", () => {
  const fixture = world({ homeIssues: [issue(50, "Pause workshop", [])], homeComments: { 50: [] } });

  test("an open pause issue drains every repo", () => {
    const res = run("pause.ts", [], fixture);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.state, "drain");
    assert.deepEqual(res.plan.plan.repos.map((r: Any) => r.repo), [M, T]);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/meridian\*\*: main at `realJohnDoe\/meridian-main`/);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/tracemap\*\*/);
  });

  test("apply posts the one snapshot on the pause issue, last", () => {
    const res = run("pause.ts", [], fixture, { apply: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.writes.at(-1).path, `repos/${HOME}/issues/50/comments`);
    assert.match(res.writes.at(-1).body.body, /workshop-snapshot/);
    assert.match(res.writes.at(-1).body.body, /Close this issue to resume the workshop\./);
  });

  test("stops on a repo it can't push to before writing anything", () => {
    const res = run("pause.ts", [], fixture, { apply: true, noPush: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /realJohnDoe\/tracemap: can't push/);
    assert.deepEqual(res.writes, []);
  });

  test("paused: writes nothing", () => {
    const snap = { body: "<!-- workshop-snapshot -->", created_at: "2026-11-12T00:00:00Z" };
    const res = run("pause.ts", [], world({ homeIssues: [issue(50, "Pause workshop", [])], homeComments: { 50: [snap] } }), { apply: true });
    assert.equal(res.plan.state, "paused");
    assert.deepEqual(res.writes, []);
  });

  test("without a pause issue the workshop runs normally", () => {
    const res = run("pause.ts", [], world());
    assert.equal(res.plan.state, "normal");
  });
});

describe("pause drain closes red PRs", () => {
  const linkedIssue = (n: number, tier: string) =>
    issue(n, `Issue ${n}`, [tier, "ready-for-agent"], { assignees: [{ login: "workshop-bot" }] });
  const prs = [
    pr(30, "Red sonnet", { body: "Fixes #60", runs: red, mergeable: true }),
    pr(31, "Red opus", { body: "Fixes #61", runs: red, mergeable: true }),
    pr(32, "Green sonnet", { body: "Fixes #62", runs: green, mergeable: true }),
    pr(33, "Conflicting sonnet", { body: "Fixes #63", runs: green, mergeable: false }),
  ];
  const issues = [60, 62, 63].map((n) => linkedIssue(n, "sonnet")).concat(linkedIssue(61, "opus"));
  const w: Any = world({
    homeIssues: [issue(50, "Pause workshop", [])],
    homeComments: { 50: [] },
    extra: Object.fromEntries(issues.map((i) => [`repos/${M}/issues/${i.number}`, i])),
  });
  Object.assign(w, repoFixture(M, { issues, prs }));
  const res = run("pause.ts", [], w, { apply: true });
  const wrote = (method: string, path: string) => res.writes.filter((x) => x.method === method && x.path === path);

  test("closes the red and the conflicting sonnet PRs, with a comment", () => {
    assert.equal(res.status, 0, res.stderr);
    for (const n of [30, 33]) {
      assert.equal(wrote("PATCH", `repos/${M}/pulls/${n}`)[0].body.state, "closed");
      assert.equal(wrote("POST", `repos/${M}/issues/${n}/comments`).length, 1);
    }
  });

  test("their issues lose ready-for-agent and are unassigned", () => {
    for (const n of [60, 63]) {
      assert.equal(wrote("DELETE", `repos/${M}/issues/${n}/labels/ready-for-agent`).length, 1);
      assert.equal(wrote("DELETE", `repos/${M}/issues/${n}/assignees`).length, 1);
    }
  });

  test("an opus PR stays open and a green one is untouched", () => {
    for (const n of [31, 32]) assert.equal(res.writes.filter((x) => x.path.includes(`/${n}`)).length, 0);
    for (const n of [61, 62]) assert.equal(res.writes.filter((x) => x.path.includes(`/issues/${n}/`)).length, 0);
  });

  test("the snapshot lists what was closed", () =>
    assert.match(res.writes.at(-1).body.body, /Closed PRs: realJohnDoe\/meridian#30 \(CI red\), realJohnDoe\/meridian#33 \(conflicts with main\)/));
});

describe("pause resume", () => {
  const snap = { body: "<!-- workshop-snapshot -->", created_at: "2026-11-12T00:00:00Z" };
  const closed = issue(50, "Pause workshop", [], { state: "closed", closed_at: "2026-11-13T00:00:00Z" });
  const res = run("pause.ts", [], world({ homeClosed: [closed], homeComments: { 50: [snap] } }), { apply: true });

  test("only posts the resumed comment, on the closed pause issue", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.state, "resume");
    assert.deepEqual(res.writes.map((w) => w.path), [`repos/${HOME}/issues/50/comments`]);
    assert.match(res.writes[0].body.body, /workshop-resumed/);
  });
});
