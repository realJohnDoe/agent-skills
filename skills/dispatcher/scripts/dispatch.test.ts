// Runs dispatch.ts and pause.ts end to end over two repos, against a fake `gh`
// and `git` (fake-bin.ts): one plan, one session cap, one digest, and a loud stop
// when a repo can't be worked on.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeBin } from "./fake-bin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DIGEST = "realJohnDoe/agent-skills";
const M = "realJohnDoe/meridian";
const T = "realJohnDoe/tracemap";
const TODAY = "2026-11-13"; // a Friday
const SINCE = "2026-11-10";

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
const ALL_LABELS = ["haiku", "sonnet", "opus", "plan", "ready-for-agent", "automerge", "preview"].map(
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
    [`search/issues?q=repo:${repo} is:pr is:merged merged:>=${SINCE}`]: { items: [] },
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

const world = ({
  digestIssues = [],
  digestComments = {},
  digestLabels = [{ name: "workshop-paused" }],
  extra = {},
}: { digestIssues?: Any[]; digestComments?: Any; digestLabels?: Any[]; extra?: Any } = {}) => ({
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
  [`repos/${DIGEST}/issues`]: digestIssues,
  [`repos/${DIGEST}/labels`]: digestLabels,
  ...Object.fromEntries(
    Object.entries(digestComments).map(([n, cs]) => [`repos/${DIGEST}/issues/${n}/comments`, cs]),
  ),
  ...extra,
});

// Runs a workshop script against `fixture` with both repos checked out (attached),
// except those in `missing`. The checkouts folder also holds a plain folder and a
// clone without an origin, which discovery must skip.
const run = (
  script: string,
  args: string[],
  fixture: unknown,
  { apply = false, missing = [], noPush = [] }: { apply?: boolean; missing?: string[]; noPush?: string[] } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "workshop-test-"));
  const checkouts = join(dir, "checkouts");
  const remotes: Record<string, string> = {};
  for (const repo of [M, T]) {
    const name = repo.split("/")[1];
    if (missing.includes(repo)) continue;
    mkdirSync(join(checkouts, name, ".git"), { recursive: true });
    remotes[join(checkouts, name)] = `https://github.com/${repo}.git`;
  }
  mkdirSync(join(checkouts, "notes"), { recursive: true });
  mkdirSync(join(checkouts, "scratch", ".git"), { recursive: true });
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  const log = join(dir, "writes.jsonl");
  writeFileSync(log, "");
  const res = spawnSync(
    process.execPath,
    [join(here, script), ...args, "--today", TODAY, "--digest", DIGEST, "--checkouts", checkouts, ...(apply ? ["--apply"] : [])],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin()}:${process.env.PATH}`,
        FAKE_GH_FIXTURE: join(dir, "fixture.json"),
        FAKE_GIT_REMOTES: JSON.stringify(remotes),
        FAKE_GIT_NOPUSH: JSON.stringify(noPush.map((r) => join(checkouts, r.split("/")[1]))),
        ...(apply ? { FAKE_GH_LOG: log } : {}),
      },
    },
  );
  const writes = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { ...res, checkouts, writes, plan: res.status === 0 ? JSON.parse(res.stdout) : null };
};

describe("dispatch dry run over two repos", () => {
  const res = run("dispatch.ts", ["--max-sessions", "3"], world());

  test("succeeds and writes nothing", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.applied, false);
    assert.deepEqual(res.plan.repos, [M, T]);
    assert.match(res.plan.digest.body, /\nRepos covered: realJohnDoe\/meridian, realJohnDoe\/tracemap\.\n/);
  });

  test("one session cap across repos: newest follow-ups first, then the newest issues anywhere", () => {
    assert.deepEqual(
      res.plan.sessions.map((s: Any) => [s.kind, s.repo, s.pr ?? s.issue]),
      [
        ["followup", T, 9],
        ["followup", M, 21],
        ["dispatch", T, 4],
      ],
    );
    assert.deepEqual(res.plan.notStarted, [
      `${M}: meridian#10 Meridian sonnet task`,
      `${T}: tracemap#3 Tracemap haiku task`,
    ]);
  });

  test("each session works in its own worktree of its repo's clone", () => {
    for (const s of res.plan.sessions) {
      const clone = join(res.checkouts, s.repo.split("/")[1]);
      assert.equal(s.checkout, clone);
      assert.ok(s.prompt.includes(`git -C ${clone} worktree add`), s.prompt);
      assert.ok(s.prompt.includes(s.worktree));
      assert.ok(s.prompt.includes(`${s.worktree}.scratch`), s.prompt);
    }
    const scratch = res.plan.sessions.map((s: { worktree: string }) => `${s.worktree}.scratch`);
    assert.equal(new Set(scratch).size, scratch.length);
    const [, followup, dispatch] = res.plan.sessions;
    assert.ok(followup.prompt.includes("- CI failing: build: https://ci/1"));
    assert.ok(dispatch.prompt.includes("Label the PR `automerge`"));
  });

  test("merges only the automerge PR, naming its repo", () =>
    assert.deepEqual(res.plan.automerge, [{ repo: M, pr: 20, sha: "sha20", title: "Meridian green automerge" }]));

  test("lists the labels each repo is missing", () =>
    assert.deepEqual(res.plan.missingLabels, [
      { repo: T, missing: ["opus", "plan", "automerge", "preview"] },
    ]));

  test("one digest naming every item's repo", () => {
    const body = res.plan.digest.body;
    assert.equal(res.plan.digest.repo, DIGEST);
    assert.match(body, /\*\*Review:\*\* \[realJohnDoe\/tracemap#8\]/);
    assert.match(
      body,
      /## Waiting on you[^]*\*\*Decide:\*\* \[realJohnDoe\/meridian#13\]\(\S+\) Meridian needs a call \(Keep the old endpoint\?\)[^]*\*\*Go ahead\?\*\* \[realJohnDoe\/meridian#14\]/,
    );
    assert.match(
      body,
      /## In progress\n\n- \[realJohnDoe\/tracemap#9\]\(\S+\) Tracemap red \(follow-up\)\n- \[realJohnDoe\/meridian#21\]\(\S+\) Meridian red \(follow-up\)\n- \[realJohnDoe\/tracemap#4\]\(\S+\) .* \(dispatched\)\n/,
    );
    assert.equal(res.plan.digest.counts.inProgress, 3);
    assert.match(body, /## Queue[^]*\[realJohnDoe\/meridian#10\][^]*\[realJohnDoe\/tracemap#3\]/);
    assert.match(body, /\[realJohnDoe\/meridian#14\]\(\S+\) Meridian filed by an agent \(haiku\)/);
    assert.match(body, /\[realJohnDoe\/meridian#12\]\(\S+\) Meridian untriaged \(no tier label/);
    assert.match(body, /\[realJohnDoe\/meridian#11\]\(\S+\) Meridian waits on 10 \(blocked by realJohnDoe\/meridian#10\)/);
  });
});

describe("dispatch apply", () => {
  const res = run("dispatch.ts", ["--max-sessions", "3"], world(), { apply: true });
  const writes = (method: string, path: string) => res.writes.filter((w) => w.method === method && w.path.startsWith(path));

  test("succeeds", () => assert.equal(res.status, 0, res.stderr));

  test("creates missing labels first, in the repo missing them", () => {
    const created = writes("POST", `repos/${T}/labels`).map((w) => w.body.name);
    assert.deepEqual(created, ["opus", "plan", "automerge", "preview"]);
    assert.equal(res.writes[0].path, `repos/${T}/labels`);
    assert.equal(writes("POST", `repos/${M}/labels`).length, 0);
  });

  test("merges in the PR's own repo, pinned to the checked commit", () =>
    assert.deepEqual(writes("PUT", `repos/${M}/pulls/20/merge`).map((w) => w.body), [
      { sha: "sha20", merge_method: "merge" },
    ]));

  test("claims each session in its own repo", () => {
    assert.equal(writes("POST", `repos/${M}/issues/21/comments`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/4/assignees`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/9/comments`).length, 1);
    assert.equal(writes("POST", `repos/${M}/issues/10/assignees`).length, 0);
    assert.equal(writes("POST", `repos/${T}/issues/3/assignees`).length, 0);
  });

  test("writes no digest: that waits for the end of the run", () => {
    assert.equal(res.writes.filter((w) => w.path.startsWith(`repos/${DIGEST}/issues`)).length, 0);
    assert.match(res.plan.digest.body, /realJohnDoe\/meridian#13/);
  });
});

describe("dispatch --apply --digest-only", () => {
  const res = run("dispatch.ts", ["--digest-only"], world(), { apply: true });
  const isDigestWrite = (w: Any) => w.path.startsWith(`repos/${DIGEST}/issues`);

  test("makes no write but the digest: no labels, merges, claims or comments", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.writes.length > 0);
    assert.deepEqual(res.writes.filter((w) => !isDigestWrite(w)), []);
  });

  test("writes one draft, in the digest repo, and starts no session", () => {
    const digests = res.writes.filter((w) => w.method === "POST" && /^repos\/[^/]+\/[^/]+\/issues$/.test(w.path));
    assert.equal(digests.length, 1);
    assert.equal(digests[0].path, `repos/${DIGEST}/issues`);
    assert.match(digests[0].body.title, /^Workshop digest \(draft\) — from /);
    assert.match(digests[0].body.body, /realJohnDoe\/meridian#13/);
    assert.deepEqual(res.plan.sessions, []);
    assert.deepEqual(res.plan.notStarted, []);
    assert.doesNotMatch(res.plan.digest.body, /\(dispatched\)/);
  });

  test("publishes on a due day", () => {
    const draft = issue(90, "Workshop digest (draft) — from 2026-11-10", [], { body: "<!-- digest-since: 2026-11-10 -->" });
    const due = run("dispatch.ts", ["--digest-only"], world({ digestIssues: [draft], digestComments: { 90: [] } }), { apply: true });
    assert.equal(due.status, 0, due.stderr);
    assert.equal(due.plan.digest.publish, true);
    assert.deepEqual(due.writes.filter((w) => !isDigestWrite(w)), []);
    assert.ok(due.writes.some((w) => w.method === "PATCH" && /^Workshop digest — /.test(w.body?.title ?? "")));
  });

  test("without --apply it only prints", () => {
    const dry = run("dispatch.ts", ["--digest-only"], world());
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(dry.writes, []);
    assert.deepEqual(dry.plan.sessions, []);
    assert.match(dry.plan.digest.body, /realJohnDoe\/meridian#13/);
  });
});

describe("the final digest of a run that dispatched an issue", () => {
  const claim = [{ body: "<!-- workshop-dispatch -->", created_at: "2026-11-13T10:00:00Z", html_url: "u", user: { login: "b", type: "User" } }];
  const fixture = (prs: Any[]) => ({
    ...world(),
    ...repoFixture(M, {
      issues: [
        issue(60, "Dispatched with a PR", ["sonnet", "ready-for-agent"], { assignees: [{ login: "workshop-bot" }], comments: 1 }),
        issue(61, "Dispatched, still no PR", ["sonnet", "ready-for-agent"], { assignees: [{ login: "workshop-bot" }], comments: 1 }),
      ],
      prs,
    }),
    [`repos/${M}/issues/60/comments`]: claim,
    [`repos/${M}/issues/61/comments`]: claim,
  });
  const res = run(
    "dispatch.ts",
    ["--repos", M, "--digest-only"],
    fixture([pr(70, "Do 60", { body: "Fixes #60", runs: [], mergeable: true })]),
  );

  test("shows the opened PR, and no PR yet for the other, never a new dispatch", () => {
    assert.equal(res.status, 0, res.stderr);
    const body: string = res.plan.digest.body;
    assert.match(body, /In progress[^]*meridian#70\]/);
    assert.match(body, /meridian#61\]\(\S+\)[^\n]*no PR yet/);
    assert.doesNotMatch(body, /meridian#6[01]\]\(\S+\)[^\n]*\(dispatched\)/);
    assert.deepEqual(res.plan.sessions, []);
  });
});

describe("an issue with an After merge step", () => {
  const STEP = "Switch the Pages source at https://github.com/x/settings/pages.";
  const stale = [{ body: "<!-- workshop-dispatch -->", created_at: "2026-10-01T00:00:00Z", html_url: "u", user: { login: "b", type: "User" } }];
  const fixture = (prs: Any[], closed: Any[]) => ({
    ...world(),
    ...repoFixture(M, {
      issues: [
        issue(30, "Needs a manual step", ["sonnet", "ready-for-agent"], {
          assignees: [{ login: "workshop-bot" }],
          comments: 1,
          body: `## After merge\n\n${STEP}\n\nMore.`,
        }),
        issue(31, "Waits on 30", ["sonnet", "ready-for-agent"], { body: "Blocked by: #30" }),
      ],
      prs,
    }),
    [`repos/${M}/issues/30/comments`]: stale,
    [`repos/${M}/pulls?state=closed`]: closed,
  });
  const plan = (prs: Any[], closed: Any[]) => {
    const res = run("dispatch.ts", ["--repos", M], fixture(prs, closed));
    assert.equal(res.status, 0, res.stderr);
    return res.plan;
  };
  const refs = pr(40, "Do the thing", { body: "Refs #30", runs: green, mergeable: true });

  test("while its Refs PR is open it is in progress under the PR", () => {
    const { digest } = plan([refs], []);
    assert.match(digest.body, /\*\*Review:\*\* \[realJohnDoe\/meridian#40\]/);
    assert.doesNotMatch(digest.body, /meridian#30\]/);
    assert.doesNotMatch(digest.body, /Unstick/);
    assert.match(digest.body, /meridian#31\]\(\S+\) Waits on 30 \(blocked by realJohnDoe\/meridian#30\)/);
  });

  test("once merged it waits on the maintainer with the step, never Unstick, past STALE_DAYS", () => {
    const merged = pr(40, "Do the thing", { body: "Refs #30", merged_at: "2026-11-12T00:00:00Z" });
    const p = plan([], [pr(41, "Unrelated", { merged_at: "2026-11-12T00:00:00Z" }), merged]);
    assert.match(
      p.digest.body,
      new RegExp(`## Waiting on you[^]*\\*\\*After merge:\\*\\* \\[realJohnDoe/meridian#30\\]\\(\\S+\\) Needs a manual step \\(Switch the Pages source[^;]*; merged in \\[realJohnDoe/meridian#40\\]\\(\\S+\\); unblocks realJohnDoe/meridian#31\\)`),
    );
    assert.doesNotMatch(p.digest.body, /Unstick/);
    assert.deepEqual(p.sessions, []);
    assert.equal(p.digest.counts.afterMerge, 1);
    assert.match(p.digest.body, /meridian#31\]\(\S+\) Waits on 30 \(blocked by/);
  });

  test("once this run merges its automerge PR, the same run's digest shows the step", () => {
    const merging = { ...refs, labels: [{ name: "automerge" }] };
    const dry = plan([merging], []);
    assert.equal(dry.digest.counts.afterMerge, 0);
    const res = run("dispatch.ts", ["--repos", M], fixture([merging], []), { apply: true });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.automerge.map((m: Any) => m.pr), [40]);
    assert.match(res.plan.digest.body, /\*\*After merge:\*\* \[realJohnDoe\/meridian#30\][^\n]*merged in \[realJohnDoe\/meridian#40\]/);
    assert.deepEqual(res.plan.sessions, []);
  });

  test("a closed, unmerged PR that Refs it doesn't count", () => {
    const { digest } = plan([], [pr(40, "Abandoned", { body: "Refs #30", merged_at: null })]);
    assert.equal(digest.counts.afterMerge, 0);
    assert.match(digest.body, /## Unstick[^]*meridian#30\]/);
  });
});

describe("the repos are the ones attached", () => {
  test("a repo that isn't attached isn't covered, and the digest says which are", () => {
    const res = run("dispatch.ts", [], world(), { missing: [T] });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [M]);
    assert.match(res.plan.digest.body, /\nRepos covered: realJohnDoe\/meridian\.\n/);
  });
  test("--repos naming a repo that isn't attached stops the run", () => {
    const res = run("dispatch.ts", ["--repos", T], world(), { missing: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--repos names repos not checked out under .*: realjohndoe\/tracemap/);
    assert.equal(res.stdout, "");
  });
  test("no --digest stops the run", () => {
    const res = spawnSync(process.execPath, [join(here, "dispatch.ts")], { encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /pass --digest owner\/repo/);
  });
  test("no attached repo stops the run", () => {
    const res = run("dispatch.ts", [], world(), { missing: [M, T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /No GitHub clone under /);
  });
});

describe("dispatch stops on a repo it can't work on", () => {
  test("can't be pushed to: skipped, listed and in the digest, the others go on", () => {
    const res = run("dispatch.ts", [], world(), { apply: true, noPush: [M] });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.unpushable.length, 1);
    assert.equal(res.plan.unpushable[0].repo, M);
    assert.match(res.plan.unpushable[0].reason, /^can't push/);
    assert.deepEqual(
      res.writes.filter((w: Any) => JSON.stringify(w).includes(`repos/${M}/`)),
      [],
    );
    assert.ok(res.plan.sessions.length > 0);
    assert.ok(res.plan.sessions.every((s: Any) => s.repo === T));
    assert.ok(res.plan.automerge.every((m: Any) => m.repo === T));
    assert.match(res.plan.digest.body, /## Unstick\n\n- \[ \] \*\*Can't push:\*\* \[realJohnDoe\/meridian\]/);
    assert.ok(res.plan.digest.counts.unstick >= 1);
  });
  test("--repos limits the run to one attached repo", () => {
    const res = run("dispatch.ts", ["--repos", M], world());
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [M]);
  });
});

describe("cross-repo blockers", () => {
  const X = "realJohnDoe/other";
  const open = (n: number, title: string, extra: Any = {}) =>
    issue(n, title, ["sonnet", "ready-for-agent"], { created_at: "2026-10-01T00:00:00Z", ...extra });
  // Meridian's plan with `issues` and `prs` added, and `extra` answers.
  const plan = (issues: Any[], prs: Any[], extra: Any = {}) => {
    const w: Any = world({ extra });
    const fresh = repoFixture(M, { issues: [], prs });
    Object.assign(w, fresh, {
      [`repos/${M}/issues`]: [...w[`repos/${M}/issues`], ...issues],
      [`repos/${M}/pulls`]: [...w[`repos/${M}/pulls`], ...fresh[`repos/${M}/pulls`] as Any[]],
    });
    return run("dispatch.ts", ["--max-sessions", "20"], w);
  };
  const dispatched = (res: Any) =>
    res.plan.sessions.filter((s: Any) => s.kind === "dispatch" && s.repo === M).map((s: Any) => s.issue);

  test("an issue blocked by an open issue elsewhere stays blocked, named with its repo", () => {
    const res = plan([open(15, "Waits on other", { body: `Blocked by: ${X}#10` })], [], {
      [`repos/${X}/issues/10`]: { state: "open" },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!dispatched(res).includes(15));
    assert.match(res.plan.digest.body, /Waits on other \(blocked by realJohnDoe\/other#10\)/);
  });

  test("closed there, it is dispatchable; the same number here is not consulted", () => {
    const res = plan([open(15, "Waits on other", { body: `Blocked by: ${X}#10` })], [], {
      [`repos/${X}/issues/10`]: { state: "closed" },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(dispatched(res).includes(15));
  });

  test("an unreadable blocker blocks", () => {
    const res = plan([open(15, "Waits on other", { body: `Blocked by: ${X}#10` })], []);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!dispatched(res).includes(15));
    assert.match(res.plan.digest.body, /Waits on other \(blocker realJohnDoe\/other#10 unreadable\)/);
  });

  test("a native cross-repo blocker is named with its repo", () => {
    const res = plan(
      [open(15, "Waits natively", { issue_dependencies_summary: { blocked_by: 1 } })],
      [],
      {
        [`repos/${M}/issues/15/dependencies/blocked_by`]: [
          { number: 10, state: "open", repository_url: `https://api.github.com/repos/${X}` },
        ],
      },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!dispatched(res).includes(15));
    assert.match(res.plan.digest.body, /Waits natively \(blocked by realJohnDoe\/other#10\)/);
  });
});

describe("pause over two repos", () => {
  const draft = { number: 50, title: "Workshop digest (draft) — from 2026-11-10", labels: [{ name: "workshop-paused" }], body: "" };
  const fixture = world({
    digestIssues: [draft],
    digestComments: { 50: [] },
    extra: {
      [`repos/${DIGEST}/issues/50/events`]: [
        { event: "labeled", label: { name: "workshop-paused" }, created_at: "2026-11-12T00:00:00Z" },
      ],
    },
  });

  test("the label on the shared digest drains every repo", () => {
    const res = run("pause.ts", [], fixture);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.state, "drain");
    assert.deepEqual(res.plan.plan.repos.map((r: Any) => r.repo), [M, T]);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/meridian\*\*: main at `realJohnDoe\/meridian-main`/);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/tracemap\*\*/);
  });

  test("apply posts the one snapshot on the digest, last", () => {
    const res = run("pause.ts", [], fixture, { apply: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.writes.at(-1).path, `repos/${DIGEST}/issues/50/comments`);
    assert.match(res.writes.at(-1).body.body, /workshop-snapshot/);
  });

  test("stops on a repo it can't push to before writing anything", () => {
    const res = run("pause.ts", [], fixture, { apply: true, noPush: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /realJohnDoe\/tracemap: can't push/);
    assert.deepEqual(res.writes, []);
  });

  test("without a digest the workshop runs normally", () => {
    const res = run("pause.ts", [], world());
    assert.equal(res.plan.state, "normal");
  });
});

describe("pause drain closes red PRs", () => {
  const draft = { number: 50, title: "Workshop digest (draft) — from 2026-11-10", labels: [{ name: "workshop-paused" }], body: "" };
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
    digestIssues: [draft],
    digestComments: { 50: [] },
    extra: {
      [`repos/${DIGEST}/issues/50/events`]: [
        { event: "labeled", label: { name: "workshop-paused" }, created_at: "2026-11-12T00:00:00Z" },
      ],
      ...Object.fromEntries(issues.map((i) => [`repos/${M}/issues/${i.number}`, i])),
    },
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
  const res = run("pause.ts", [], world({ digestIssues: [{ number: 50, title: "Workshop digest (draft) — from 2026-11-10", labels: [], body: "" }], digestComments: { 50: [snap] } }), { apply: true });

  test("only posts the resumed comment", () => {
    assert.equal(res.plan.state, "resume");
    assert.deepEqual(res.writes.map((w) => w.path), [`repos/${DIGEST}/issues/50/comments`]);
    assert.match(res.writes[0].body.body, /workshop-resumed/);
  });
});

describe("a merge that closes an issue", () => {
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

  test("waits for GitHub: the PR is listed merged and its issue is not in progress", () => {
    const res = run("dispatch.ts", ["--repos", M], fixture, { apply: true });
    assert.equal(res.status, 0, res.stderr);
    const body: string = res.plan.digest.body;
    assert.match(body, /meridian#50\]\(\S+\) Fix it \(closes realJohnDoe\/meridian#51 · sonnet, ready-for-agent\)/);
    assert.doesNotMatch(body, /meridian#51\]\(\S+\)[^\n]*no PR yet/);
    assert.deepEqual(res.plan.sessions.map((s: Any) => s.issue), [52]);
  });
});
