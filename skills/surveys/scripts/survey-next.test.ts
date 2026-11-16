// Runs survey-next.ts end to end over two repos: real git clones for the history, a fake
// `gh` (../../dispatcher/scripts/fake-bin.ts) for the issues and PRs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeBin } from "../../dispatcher/scripts/fake-bin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const M = "realJohnDoe/meridian";
const T = "realJohnDoe/tracemap";
const SESSION = "session_0123456789abcdefghijKL";

type Any = any;
const issue = (n: number, labels: string[], extra: Any = {}) => ({
  number: n,
  title: `#${n}`,
  body: "",
  state: "open",
  labels: labels.map((name) => ({ name })),
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});
const pr = (n: number, created: string, body = "") => ({
  number: n,
  title: `PR ${n}`,
  body,
  state: "open",
  merged_at: null,
  head: { ref: `b${n}` },
  created_at: `${created}T12:00:00Z`,
});
const skill = (label: string, scope: string) => `---\nname: x\nlabel: ${label}\nscope: ${scope}\n---\n\nBody.\n`;

// A clone of `repo` under `checkouts` with one commit per [date, file], and local skills.
const clone = (checkouts: string, repo: string, commits: [string, string][], skills: Record<string, string> = {}) => {
  const dir = join(checkouts, repo.split("/")[1]);
  const git = (args: string[], date?: string) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` } : {}) },
    });
  mkdirSync(dir, { recursive: true });
  git(["init", "--quiet"]);
  git(["remote", "add", "origin", `https://github.com/${repo}.git`]);
  for (const [name, body] of Object.entries(skills)) {
    mkdirSync(join(dir, ".claude/skills", name), { recursive: true });
    writeFileSync(join(dir, ".claude/skills", name, "SKILL.md"), body);
  }
  for (const [date, file] of commits) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), date);
    git(["add", "-A"]);
    git(["commit", "--quiet", "-m", `${file} on ${date}`], date);
  }
};

const world = ({ trackerPrs = [pr(5, "2026-11-10", `https://claude.ai/code/${SESSION}`)], trackerFindings = 3 } = {}) => ({
  // Meridian: health ran 2026-10-01 (a parent from before the `survey` label) and closed; ui has an open run with a workable
  // finding; retro's open run has only a deferred finding and an undecided one left.
  [`repos/${M}/issues?labels=health&state=all&per_page=100`]: [
    issue(51, ["health", "survey-finding"], { state: "closed", created_at: "2026-10-02T00:00:00Z" }),
    issue(50, ["health"], { state: "closed", sub_issues_summary: { total: 1 } }),
    issue(30, ["survey", "health"], { state: "closed", created_at: "2026-06-01T00:00:00Z" }),
  ],
  [`repos/${M}/issues?labels=ui&state=all&per_page=100`]: [issue(45, ["survey", "ui"], { created_at: "2026-09-01T00:00:00Z" })],
  [`repos/${M}/issues?labels=retro&state=all&per_page=100`]: [
    issue(60, ["survey", "retro"], { created_at: "2026-11-01T00:00:00Z" }),
  ],
  [`repos/${M}/issues?labels=survey-finding&state=open&per_page=100`]: [
    issue(46, ["survey-finding", "ui"]),
    issue(61, ["survey-finding", "retro", "deferred"]),
    { ...issue(99, []), pull_request: {} },
  ],
  [`repos/${M}/issues/45/sub_issues?per_page=100`]: [issue(46, ["survey-finding", "ui"])],
  [`repos/${M}/issues/60/sub_issues?per_page=100`]: [
    issue(61, ["survey-finding", "retro", "deferred"]),
    issue(62, ["survey-finding", "retro"], { body: "## Decision needed\n\nKeep it?\n" }),
    issue(63, ["survey-finding", "retro"], { state: "closed" }),
  ],
  // Session PRs since retro's run: #70 by its body, #71 by a commit trailer; #72 names
  // no session, and #69 predates the run.
  [`repos/${M}/pulls`]: [
    pr(72, "2026-11-06"),
    pr(71, "2026-11-04"),
    pr(70, "2026-11-02", `https://claude.ai/code/${SESSION}`),
    pr(69, "2026-10-20", `https://claude.ai/code/${SESSION}`),
  ],
  [`repos/${M}/pulls/71/commits`]: [{ commit: { message: `fix\n\nClaude-Session: https://claude.ai/code/${SESSION}` } }],
  [`repos/${M}/pulls/72/commits`]: [{ commit: { message: "chore" } }],
  // Tracemap has never been surveyed.
  [`repos/${T}/issues?labels=retro&state=all&per_page=100`]: [],
  [`repos/${T}/issues?labels=survey-finding&state=open&per_page=100`]: Array.from({ length: trackerFindings }, (_, i) =>
    issue(80 + i, ["survey-finding", "health"]),
  ),
  [`repos/${T}/pulls`]: trackerPrs,
});

const run = (fixture: unknown, args: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), "survey-next-test-"));
  const checkouts = join(dir, "checkouts");
  clone(
    checkouts,
    M,
    [
      ["2026-01-01", "README.md"],
      ["2026-10-05", "src/a.ts"],
      ["2026-10-20", "src/b.ts"],
      ["2026-10-21", "docs/c.md"],
    ],
    {
      "survey-health": skill("health", "src"),
      "survey-ui": skill("ui", '"src/a.ts" src/b.ts'),
      "survey-retro": skill("retro", "sessions"),
      "not-a-survey": "---\nname: y\n---\n",
    },
  );
  clone(checkouts, T, [
    ["2026-11-03", "README.md"],
    ["2026-11-04", "src/x.ts"],
  ]);
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  const res = spawnSync(
    process.execPath,
    [join(here, "survey-next.ts"), "--today", "2026-11-13", "--checkouts", checkouts, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin(["gh"])}:${process.env.PATH}`, FAKE_GH_FIXTURE: join(dir, "fixture.json") },
    },
  );
  return { ...res, checkouts, out: res.status === 0 ? JSON.parse(res.stdout) : null };
};

describe("survey chooser over two repos", () => {
  const res = run(world());
  const pair = (repo: string, survey: string) => res.out.pairs.find((p: Any) => p.repo === repo && p.survey === survey);

  test("scores every pair, highest first, with both inputs", () => {
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(
      res.out.pairs.map((p: Any) => [p.repo, p.survey, p.since, p.days, p.activity, p.score, p.skip]),
      [
        [M, "survey-ui", "2026-09-01", 73, 2, 146, "open run #45 has 1 finding(s) to work on"],
        [M, "survey-health", "2026-10-01", 43, 2, 86, undefined],
        [M, "survey-retro", "2026-11-01", 12, 2, 24, undefined],
        [T, "survey-retro", "2026-11-03", 10, 1, 10, "3 open survey-finding issues"],
      ],
    );
  });

  test("the last run is the newest survey parent, not a finding; a repo never surveyed counts from its first commit", () => {
    assert.equal(pair(M, "survey-health").lastRun, "#50");
    assert.match(pair(T, "survey-retro").lastRun, /^never/);
  });

  test("a repo's own survey replaces the plugin's of the same name; the plugin's covers the rest", () => {
    assert.equal(pair(M, "survey-retro").skill, join(res.checkouts, "meridian/.claude/skills/survey-retro/SKILL.md"));
    assert.equal(pair(T, "survey-retro").skill, join(here, "../../survey-retro/SKILL.md"));
  });

  test("the top pair is the best one neither gate skips; each gate holds per repo", () =>
    assert.deepEqual([res.out.top.repo, res.out.top.survey], [M, "survey-health"]));
});

describe("survey chooser with nothing to do", () => {
  test("with every score 0 there is no top pair", () => {
    const res = run(world({ trackerPrs: [], trackerFindings: 0 }), ["--repos", T]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.out.pairs[0].score, 0);
    assert.equal(res.out.top, null);
  });
});
