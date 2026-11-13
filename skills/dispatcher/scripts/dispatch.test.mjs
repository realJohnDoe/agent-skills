// Runs dispatch.mjs and pause.mjs end to end over two repos, against a fake `gh`
// and `git` (fake-bin.mjs): one plan, one session cap, one digest, and a loud stop
// when a repo can't be worked on.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeBin } from "./fake-bin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DIGEST = "realJohnDoe/agent-skills";
const M = "realJohnDoe/meridian";
const T = "realJohnDoe/tracemap";
const TODAY = "2026-11-13"; // a Friday
const SINCE = "2026-11-10";

const issue = (n, title, labels, extra = {}) => ({
  number: n,
  title,
  labels: labels.map((name) => ({ name })),
  assignees: [],
  comments: 0,
  body: "",
  html_url: `https://github.com/x/issues/${n}`,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});
const pr = (n, title, extra = {}) => ({
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
const ALL_LABELS = ["haiku", "sonnet", "opus", "opus-plan", "decision-required", "deferred", "automerge"].map(
  (name) => ({ name }),
);
const green = [{ name: "build", status: "completed", conclusion: "success" }];
const red = [{ name: "build", status: "completed", conclusion: "failure", html_url: "https://ci/1" }];

// Answers for one repo's reads; `prs` entries carry their own `runs` and `mergeable`.
const repoFixture = (repo, { issues, prs, labels = ALL_LABELS }) => {
  const f = {
    [`repos/${repo}`]: { default_branch: "main" },
    [`repos/${repo}/issues`]: issues,
    [`repos/${repo}/pulls`]: prs.map(({ runs, mergeable, ...p }) => p),
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

const world = ({ digestIssues = [], digestComments = {}, digestLabels = [{ name: "workshop-paused" }], extra = {} } = {}) => ({
  ...repoFixture(M, {
    issues: [
      issue(10, "Meridian sonnet task", ["sonnet"], { created_at: "2026-10-01T00:00:00Z" }),
      issue(11, "Meridian waits on 10", ["opus"], { body: "Blocked by: #10" }),
      issue(12, "Meridian untriaged", []),
      issue(13, "Meridian needs a call", ["sonnet", "decision-required"]),
    ],
    prs: [
      pr(20, "Meridian green automerge", { labels: [{ name: "automerge" }], runs: green, mergeable: true }),
      pr(21, "Meridian red", { runs: red, mergeable: true, created_at: "2026-09-01T00:00:00Z" }),
    ],
  }),
  ...repoFixture(T, {
    issues: [
      issue(3, "Tracemap haiku task", ["haiku"], { created_at: "2026-09-15T00:00:00Z" }),
      issue(4, "Tracemap sonnet task", ["sonnet"], { created_at: "2026-10-20T00:00:00Z" }),
    ],
    prs: [
      pr(8, "Bump x from 1 to 2", { user: { login: "dependabot[bot]" }, runs: green, mergeable: true }),
      pr(9, "Tracemap red", { runs: red, mergeable: true, created_at: "2026-11-01T00:00:00Z" }),
    ],
    labels: [{ name: "haiku" }, { name: "sonnet" }],
  }),
  user: { login: "workshop-bot" },
  [`repos/${DIGEST}/issues`]: digestIssues,
  [`repos/${DIGEST}/labels`]: digestLabels,
  ...Object.fromEntries(
    Object.entries(digestComments).map(([n, cs]) => [`repos/${DIGEST}/issues/${n}/comments`, cs]),
  ),
  ...extra,
});

// Runs a workshop script against `fixture` with both repos checked out.
const run = (script, args, fixture, { apply = false, missing = [], noPush = [] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "workshop-test-"));
  const checkouts = join(dir, "checkouts");
  const remotes = {};
  for (const repo of [M, T]) {
    const name = repo.split("/")[1];
    if (!missing.includes(repo)) mkdirSync(join(checkouts, name), { recursive: true });
    remotes[join(checkouts, name)] = `https://github.com/${repo}.git`;
  }
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  writeFileSync(join(dir, "workshop.json"), JSON.stringify({ digest: DIGEST, repos: [{ repo: M }, { repo: T }] }));
  const log = join(dir, "writes.jsonl");
  writeFileSync(log, "");
  const res = spawnSync(
    process.execPath,
    [join(here, script), ...args, "--today", TODAY, "--config", join(dir, "workshop.json"), "--checkouts", checkouts, ...(apply ? ["--apply"] : [])],
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
  const res = run("dispatch.mjs", ["--max-sessions", "3"], world());

  test("succeeds and writes nothing", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.applied, false);
    assert.deepEqual(res.plan.repos, [M, T]);
  });

  test("one session cap across repos: newest follow-ups first, then the oldest issues anywhere", () => {
    assert.deepEqual(
      res.plan.sessions.map((s) => [s.kind, s.repo, s.pr ?? s.issue]),
      [
        ["followup", T, 9],
        ["followup", M, 21],
        ["dispatch", T, 3],
      ],
    );
    assert.deepEqual(res.plan.deferred, [
      `${M}: meridian#10 Meridian sonnet task`,
      `${T}: tracemap#4 Tracemap sonnet task`,
    ]);
  });

  test("each session works in its own worktree of its repo's clone", () => {
    for (const s of res.plan.sessions) {
      const clone = join(res.checkouts, s.repo.split("/")[1]);
      assert.equal(s.checkout, clone);
      assert.ok(s.prompt.includes(`git -C ${clone} worktree add`), s.prompt);
      assert.ok(s.prompt.includes(s.worktree));
    }
    const [, followup, dispatch] = res.plan.sessions;
    assert.ok(followup.prompt.includes("- CI failing: build: https://ci/1"));
    assert.ok(dispatch.prompt.includes("Label the PR `automerge`"));
  });

  test("merges only the automerge PR, naming its repo", () =>
    assert.deepEqual(res.plan.automerge, [{ repo: M, pr: 20, sha: "sha20", title: "Meridian green automerge" }]));

  test("lists the labels each repo is missing", () =>
    assert.deepEqual(res.plan.missingLabels, [
      { repo: T, missing: ["opus", "opus-plan", "decision-required", "deferred", "automerge"] },
    ]));

  test("one digest naming every item's repo", () => {
    const body = res.plan.digest.body;
    assert.equal(res.plan.digest.repo, DIGEST);
    assert.match(body, /\*\*Review:\*\* \[realJohnDoe\/tracemap#8\]/);
    assert.match(body, /\*\*Decide:\*\* \[realJohnDoe\/meridian#13\]/);
    assert.match(body, /## Queue[^]*\[realJohnDoe\/meridian#10\][^]*\[realJohnDoe\/tracemap#4\]/);
    assert.match(body, /\[realJohnDoe\/meridian#12\]\(\S+\) Meridian untriaged \(no tier label/);
    assert.match(body, /\[realJohnDoe\/meridian#11\]\(\S+\) Meridian waits on 10 \(blocked by realJohnDoe\/meridian#10\)/);
  });
});

describe("dispatch apply", () => {
  const res = run("dispatch.mjs", ["--max-sessions", "3"], world(), { apply: true });
  const writes = (method, path) => res.writes.filter((w) => w.method === method && w.path.startsWith(path));

  test("succeeds", () => assert.equal(res.status, 0, res.stderr));

  test("creates missing labels first, in the repo missing them", () => {
    const created = writes("POST", `repos/${T}/labels`).map((w) => w.body.name);
    assert.deepEqual(created, ["opus", "opus-plan", "decision-required", "deferred", "automerge"]);
    assert.equal(res.writes[0].path, `repos/${T}/labels`);
    assert.equal(writes("POST", `repos/${M}/labels`).length, 0);
  });

  test("merges in the PR's own repo, pinned to the checked commit", () =>
    assert.deepEqual(writes("PUT", `repos/${M}/pulls/20/merge`).map((w) => w.body), [
      { sha: "sha20", merge_method: "merge" },
    ]));

  test("claims each session in its own repo", () => {
    assert.equal(writes("POST", `repos/${M}/issues/21/comments`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/3/assignees`).length, 1);
    assert.equal(writes("POST", `repos/${T}/issues/9/comments`).length, 1);
    assert.equal(writes("POST", `repos/${M}/issues/10/assignees`).length, 0);
    assert.equal(writes("POST", `repos/${T}/issues/4/assignees`).length, 0);
  });

  test("writes one digest, in the digest repo", () => {
    const digests = res.writes.filter((w) => w.method === "POST" && /^repos\/[^/]+\/[^/]+\/issues$/.test(w.path));
    assert.equal(digests.length, 1);
    assert.equal(digests[0].path, `repos/${DIGEST}/issues`);
    assert.match(digests[0].body.title, /^Workshop digest \(draft\) — from /);
    assert.match(digests[0].body.body, /realJohnDoe\/meridian#13/);
    assert.match(digests[0].body.body, /realJohnDoe\/tracemap#8/);
  });
});

describe("dispatch stops on a repo it can't work on", () => {
  test("not checked out", () => {
    const res = run("dispatch.mjs", [], world(), { missing: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /realJohnDoe\/tracemap: not checked out at /);
    assert.equal(res.stdout, "");
  });
  test("can't be pushed to", () => {
    const res = run("dispatch.mjs", [], world(), { apply: true, noPush: [M] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /realJohnDoe\/meridian: can't push/);
    assert.deepEqual(res.writes, []);
  });
  test("--repos limits the run to one configured repo", () => {
    const res = run("dispatch.mjs", ["--repos", M], world(), { missing: [T] });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.plan.repos, [M]);
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
    const res = run("pause.mjs", [], fixture);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.plan.state, "drain");
    assert.deepEqual(res.plan.plan.repos.map((r) => r.repo), [M, T]);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/meridian\*\*: main at `realJohnDoe\/meridian-main`/);
    assert.match(res.plan.plan.snapshot, /\*\*realJohnDoe\/tracemap\*\*/);
  });

  test("apply posts the one snapshot on the digest, last", () => {
    const res = run("pause.mjs", [], fixture, { apply: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.writes.at(-1).path, `repos/${DIGEST}/issues/50/comments`);
    assert.match(res.writes.at(-1).body.body, /workshop-snapshot/);
  });

  test("stops on a repo it can't push to before writing anything", () => {
    const res = run("pause.mjs", [], fixture, { apply: true, noPush: [T] });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /realJohnDoe\/tracemap: can't push/);
    assert.deepEqual(res.writes, []);
  });

  test("without a digest the workshop runs normally", () => {
    const res = run("pause.mjs", [], world());
    assert.equal(res.plan.state, "normal");
  });
});
