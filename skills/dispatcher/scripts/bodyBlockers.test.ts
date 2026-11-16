import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyBlockers } from "./bodyBlockers.ts";

const R = "o/this";
const here = (...ns: number[]) => ns.map((number) => ({ repo: R, number }));

test("Blocked by line", () => {
  assert.deepEqual(bodyBlockers("Blocked by: #12, #7\n\n## Problem\nsee #99", R), here(12, 7));
});
test("Blocked by section stops at the next heading", () => {
  const body = "## Problem\nsee #1\n\n## Blocked by\n\n- #5\n- #6 (later)\n\n## Acceptance\n- #8";
  assert.deepEqual(bodyBlockers(body, R), here(5, 6));
});
test("section at end of body, repeated numbers", () => {
  assert.deepEqual(bodyBlockers("## Blocked by\n- #5\n- #5", R), here(5));
});
test("no blockers", () => {
  assert.deepEqual(bodyBlockers("Fixes nothing, mentions #3", R), []);
  assert.deepEqual(bodyBlockers(null, R), []);
});
test("owner/repo#n names that repo, not this one", () => {
  assert.deepEqual(bodyBlockers("Blocked by: o/other#25", R), [{ repo: "o/other", number: 25 }]);
});
test("full issue URL", () => {
  assert.deepEqual(bodyBlockers("Blocked by: https://github.com/o/other/issues/25", R), [
    { repo: "o/other", number: 25 },
  ]);
});
test("all forms together, in a line and in a section", () => {
  const want = [...here(1), { repo: "o/a", number: 2 }, { repo: "o/b", number: 3 }];
  assert.deepEqual(bodyBlockers("Blocked by: #1, o/a#2 and https://github.com/o/b/issues/3", R), want);
  assert.deepEqual(
    bodyBlockers("## Blocked by\n- #1\n- o/a#2\n- https://github.com/o/b/issues/3\n", R),
    want,
  );
});
test("the same issue by two spellings counts once", () => {
  assert.deepEqual(bodyBlockers("Blocked by: #1, o/this#1", R), here(1));
});
