import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type BoardPlan, buildBoard } from "./board.ts";
import type { Item } from "./lib.ts";

const R = "o/r";
const it = (n: number, extra: Partial<Item> = {}): Item => ({
  repo: R,
  ref: `${R}#${n}`,
  url: `https://github.com/${R}/issues/${n}`,
  title: `T${n}`,
  kind: "issue",
  issue: n,
  ...extra,
});
const pr = (n: number, extra: Partial<Item> = {}) => it(n, { kind: "pr", issue: undefined, pr: n, ...extra });

const plan: BoardPlan = {
  cantPush: [{ repo: "o/x", reason: "can't push (403)" }],
  unstick: [pr(1, { why: "CI red after 2 follow-up(s)" })],
  decide: [it(2, { why: "Keep it?", sub: "decide" })],
  triage: [it(3, { why: "sonnet", sub: "goAhead", tier: "sonnet" })],
  notPicked: [
    it(4, { why: "blocked by o/r#2", waiting: true, sub: "blocked" }),
    it(5, { why: "`plan`; start a plan session by hand" }),
  ],
  queue: [it(6, { tier: "haiku" }), it(7, { tier: "opus" })],
  review: [pr(10, { check: "green" })],
  inProgress: [
    pr(11, { check: "green", automerge: true, why: "auto-merge enabled" }),
    pr(12, { check: "pending", why: "CI running" }),
    pr(13, { check: "red", why: "follow-up" }),
    it(14, { why: "dispatched" }), // a dispatched issue: no stage until its PR exists
  ],
  automerge: [pr(15, { check: "green", automerge: true })],
  afterMerge: [it(16, { why: "switch Pages; merged in x", linkedPrs: [40, 41] })],
};
const closed = [{ repo: R, kind: "issue" as const, number: 30, title: "Done", url: "u", prs: [31, 32], reason: "closed" }];
const board = buildBoard(plan, { generated: "2026-11-17T00:00:00Z", repos: [R], digest: "d", closed });
const { stages } = board;

describe("buildBoard", () => {
  test("every plan item lands in exactly one stage", () => {
    const all = [
      ...stages.stuck,
      ...stages.waiting.cards,
      ...stages.waiting.parked,
      ...stages.queue,
      ...stages.prInProgress,
      ...stages.afterMerge,
    ];
    const left = 1; // the dispatched issue
    const { cantPush, ...lists } = plan; // a banner, not a card
    const total = Object.values(lists).reduce((n, xs) => n + xs.length, 0);
    assert.equal(all.length, total - left);
    const keys = all.map((c) => `${c.repo}#${"number" in c ? c.number : ""}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(stages.closed, closed);
  });

  test("stages", () => {
    assert.deepEqual(stages.stuck.map((c) => [c.kind, c.number]), [["pr", 1]]);
    assert.deepEqual(board.cantPush, plan.cantPush);
    assert.deepEqual(stages.waiting.cards.map((c) => [c.number, c.sub]), [[2, "decide"], [3, "goAhead"], [4, "blocked"]]);
    assert.deepEqual(stages.waiting.parked.map((p) => p.number), [5]);
    assert.deepEqual(stages.queue.map((c) => c.number), [6, 7]);
    assert.deepEqual(stages.afterMerge.map((c) => [c.number, c.prs]), [[16, [40, 41]]]);
  });

  test("PRs in progress: needs review, red, pending, then automerge", () => {
    assert.deepEqual(stages.prInProgress.map((c) => c.number), [10, 13, 12, 11, 15]);
    assert.equal(stages.prInProgress[0].needsReview, true);
  });

  test("the board is normal and carries the run", () => {
    assert.equal(board.state, "normal");
    assert.equal(board.paused, undefined);
    assert.deepEqual([board.generated, board.repos, board.digest], ["2026-11-17T00:00:00Z", [R], "d"]);
  });
});
