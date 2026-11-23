import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { build, halve, mondayOf, months, parseExcludes, parseLog, type Pr } from "./weekly.ts";

describe("parseLog", () => {
  test("reads squash merges and merge commits, and skips commits that name no PR", () => {
    const log = [
      "@@Add the C Parser (#59)",
      "",
      " 20 files changed, 10440 insertions(+), 18 deletions(-)",
      "@@Merge pull request #56 from realJohnDoe/some-branch",
      "",
      " 9 files changed, 18929 insertions(+)",
      "@@chore: bump version",
      "",
      " 1 file changed, 1 insertion(+), 1 deletion(-)",
      "@@Remove dead code (#12)",
      "",
      " 2 files changed, 40 deletions(-)",
    ].join("\n");
    assert.deepEqual(
      [...parseLog(log)],
      [
        [59, { added: 10440, deleted: 18 }],
        [56, { added: 18929, deleted: 0 }],
        [12, { added: 0, deleted: 40 }],
      ],
    );
  });

  test("keeps the newest commit when a PR number appears twice", () => {
    const log = "@@Redo (#7)\n\n 1 file changed, 5 insertions(+)\n@@First try (#7)\n\n 1 file changed, 99 insertions(+)";
    assert.deepEqual(parseLog(log).get(7), { added: 5, deleted: 0 });
  });
});

describe("dates", () => {
  test("weeks start on the Monday on or before a date", () => {
    assert.equal(mondayOf("2026-05-20"), "2026-05-18");
    assert.equal(mondayOf("2026-05-18"), "2026-05-18");
    assert.equal(mondayOf("2026-05-24"), "2026-05-18");
  });

  test("search ranges are calendar months, clipped to the window, and halve without gaps", () => {
    assert.deepEqual(months("2026-05-20", "2026-07-03"), [
      ["2026-05-20", "2026-05-31"],
      ["2026-06-01", "2026-06-30"],
      ["2026-07-01", "2026-07-03"],
    ]);
    assert.deepEqual(halve(["2026-06-01", "2026-06-30"]), [
      ["2026-06-01", "2026-06-15"],
      ["2026-06-16", "2026-06-30"],
    ]);
  });
});

describe("build", () => {
  const pr = (repo: string, number: number, mergedAt: string): Pr => ({ repo: `me/${repo}`, number, title: `${repo} ${number}`, mergedAt });
  const prs = [
    pr("big", 1, "2026-05-20T10:00:00Z"),
    pr("big", 2, "2026-05-26T10:00:00Z"),
    pr("big", 3, "2026-05-27T10:00:00Z"),
    pr("mid", 1, "2026-05-21T10:00:00Z"),
    pr("mid", 2, "2026-05-28T10:00:00Z"),
    pr("small", 1, "2026-05-22T10:00:00Z"),
    pr("tiny", 1, "2026-05-29T10:00:00Z"),
  ];
  const lines = (p: Pr) => (p.repo === "me/big" && p.number === 3 ? undefined : { added: p.number * 100, deleted: 1 });
  const opts = { since: "2026-05-20", until: "2026-05-31", top: 2, excluded: (p: Pr) => p.repo === "me/mid" && p.number === 2 };

  test("bins by Monday week, folds repos past the top ones into Other, and keeps exclusions in the PR counts", () => {
    const r = build(prs, lines, opts);
    assert.deepEqual(r.weeks, ["2026-05-18", "2026-05-25"]);
    assert.deepEqual(r.series, ["big", "mid", "Other"]);
    assert.deepEqual(r.otherRepos, ["small", "tiny"]);
    assert.deepEqual(r.prs, { big: [1, 2], mid: [1, 1], Other: [1, 1] });
    assert.deepEqual(r.adds, { big: [100, 200], mid: [100, 0], Other: [100, 100] });
    assert.deepEqual(r.missing, { big: 1 });
    assert.deepEqual(r.excluded, [{ repo: "mid", number: 2, title: "mid 2", added: 200 }]);
    assert.deepEqual(r.totals, { prs: 7, added: 600, deleted: 5, repos: 4 });
  });

  test("bins PR sizes by lines added, leaving out missing and excluded PRs", () => {
    const sized = (added: number) => ({ added, deleted: 0 });
    const sizes = [0, 9, 10, 99, 100, 2500, 40000];
    const many = sizes.map((_, i) => pr("big", i + 1, "2026-05-20T10:00:00Z"));
    const r = build([...many, pr("big", 99, "2026-05-20T10:00:00Z"), pr("mid", 1, "2026-05-21T10:00:00Z")],
      (p) => (p.number === 99 ? undefined : sized(p.repo === "me/mid" ? 5 : sizes[p.number - 1])),
      { ...opts, excluded: (p) => p.repo === "me/mid" });
    assert.deepEqual(r.sizes.bins, [0, 10, 50, 100, 250, 500, 1000, 2500]);
    assert.deepEqual(r.sizes.prs.big, [2, 1, 1, 1, 0, 0, 0, 2]);
    assert.deepEqual(r.sizes.prs.mid, [0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("doesn't fold a single repo into Other", () => {
    assert.deepEqual(build(prs, lines, { ...opts, top: 3 }).series, ["big", "mid", "small", "tiny"]);
  });
});

describe("parseExcludes", () => {
  test("reads one reference per line, dropping comments and blank lines", () => {
    const text = ["# header comment", "", "realJohnDoe/Structra#61  # 25.8k lines", "kenpo-notes#90", "  "].join("\n");
    assert.deepEqual(parseExcludes(text), ["realjohndoe/structra#61", "kenpo-notes#90"]);
  });
});
