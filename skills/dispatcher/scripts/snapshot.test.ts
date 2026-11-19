// fetchRepo against a fake `gh` (../../_shared/fake-bin.ts): what it reads, and what it
// resolves while reading (blockers named in other repos). A read missing from the
// fixture fails, so each test also pins what is not read.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fakeBin } from "../../_shared/fake-bin.ts";
import { fetchRepo } from "./snapshot.ts";

type Any = any;
const M = "realJohnDoe/meridian";
const X = "realJohnDoe/other";
const issue = (n: number, extra: Any = {}) => ({
  number: n,
  title: `Issue ${n}`,
  labels: [{ name: "sonnet" }, { name: "ready-for-agent" }],
  assignees: [],
  comments: 0,
  body: "",
  html_url: `https://github.com/x/issues/${n}`,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});
const pull = (n: number, extra: Any = {}) => ({
  number: n,
  title: `PR ${n}`,
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

process.env.PATH = `${fakeBin(["gh"])}:${process.env.PATH}`;
const fetch = (issues: Any[], pulls: Any[] = [], extra: Any = {}) => {
  const file = join(mkdtempSync(join(tmpdir(), "workshop-snapshot-")), "fixture.json");
  writeFileSync(
    file,
    JSON.stringify({
      [`repos/${M}`]: { default_branch: "main" },
      [`repos/${M}/issues`]: issues,
      [`repos/${M}/pulls`]: pulls,
      [`repos/${M}/labels`]: [{ name: "sonnet" }],
      ...extra,
    }),
  );
  process.env.FAKE_GH_FIXTURE = file;
  return fetchRepo({ repo: M, name: "meridian", path: "" }, "2026-11-10", { merged: false });
};

// Each test names a different blocker: a run looks each one up only once.
describe("blockers named in another repo", () => {
  test("open there: it blocks, named with its repo", () =>
    assert.deepEqual(fetch([issue(15, { body: `Blocked by: ${X}#10` })], [], { [`repos/${X}/issues/10`]: { state: "open" } }).blockers.get(15), [
      { repo: X, number: 10 },
    ]));

  test("closed there: it doesn't, and the same number here is not consulted", () =>
    assert.deepEqual(fetch([issue(11), issue(15, { body: `Blocked by: ${X}#11` })], [], { [`repos/${X}/issues/11`]: { state: "closed" } }).blockers.get(15), []));

  test("unreadable: it blocks, marked unreadable", () =>
    assert.deepEqual(fetch([issue(15, { body: `Blocked by: ${X}#12` })]).blockers.get(15), [{ repo: X, number: 12, unreadable: true }]));

  test("a native blocker is named with its repo; a closed one is dropped", () =>
    assert.deepEqual(
      fetch([issue(15, { issue_dependencies_summary: { blocked_by: 2 } })], [], {
        [`repos/${M}/issues/15/dependencies/blocked_by`]: [
          { number: 13, state: "open", repository_url: `https://api.github.com/repos/${X}` },
          { number: 14, state: "closed", repository_url: `https://api.github.com/repos/${X}` },
        ],
      }).blockers.get(15),
      [{ repo: X, number: 13 }],
    ));
});

describe("what it reads", () => {
  const pr = (n: number, runs: Any[]) => ({
    [`repos/${M}/commits/sha${n}`]: { commit: { committer: { date: "2026-11-01T00:00:00Z" } } },
    [`repos/${M}/commits/sha${n}/check-runs`]: { check_runs: runs },
    [`repos/${M}/pulls/${n}`]: { mergeable: true },
  });

  test("a PR's comments and reviews only once CI has finished; nothing for a draft", () => {
    const s = fetch([], [pull(1), pull(2), pull(3, { draft: true })], {
      ...pr(1, [{ name: "b", status: "in_progress", conclusion: null }]),
      ...pr(2, [{ name: "b", status: "completed", conclusion: "success" }]),
      [`repos/${M}/issues/2/comments`]: [{ body: "hi" }],
      [`repos/${M}/pulls/2/comments`]: [],
      [`repos/${M}/pulls/2/reviews`]: [],
    });
    assert.deepEqual(s.pulls.map((p) => p.number), [1, 2, 3]);
    assert.deepEqual(s.prs.map((p) => [p.pr.number, p.comments.length]), [[1, 0], [2, 1]]);
  });

  test("closed PRs only for an After merge step with no open PR, keeping the merged ones", () => {
    assert.deepEqual(fetch([issue(30)]).closed, []);
    const s = fetch([issue(30, { body: "## After merge\n\nDo it." })], [], {
      [`repos/${M}/pulls?state=closed`]: [pull(40, { merged_at: "2026-11-12T00:00:00Z" }), pull(41, { merged_at: null })],
    });
    assert.deepEqual(s.closed.map((p) => p.number), [40]);
  });

  test("the dispatch marker of an assigned issue with no PR", () => {
    const at = "2026-11-12T00:00:00Z";
    const s = fetch([issue(60, { assignees: [{ login: "b" }], comments: 2 }), issue(61, { assignees: [{ login: "b" }] })], [], {
      [`repos/${M}/issues/60/comments`]: [{ body: "<!-- workshop-dispatch -->\nx", created_at: at }, { body: "later", created_at: "2026-11-13T00:00:00Z" }],
    });
    assert.deepEqual([...s.dispatchedAt], [[60, at], [61, null]]);
  });
});
