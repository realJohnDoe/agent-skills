import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { render } from "../board/render.js";
import { type BoardPlan, buildBoard, labelSync } from "./board.ts";
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
  unstick: [pr(1, { why: "CI red after 2 follow-up(s)" })],
  decide: [it(2, { why: "Keep it?", sub: "decide" })],
  triage: [it(3, { why: "sonnet", sub: "goAhead", tier: "sonnet", unready: true })],
  notPicked: [
    it(4, { why: "blocked by o/r#2", waiting: true, sub: "blocked" }),
    it(5, { why: "`plan`; start a plan session by hand", unready: true }),
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
const board = buildBoard(plan, { generated: "2026-11-17T00:00:00Z", repos: [R], digest: "d", lastRun: "2026-11-16T20:00:00Z", closed });
const { stages } = board;

describe("buildBoard", () => {
  test("every plan item lands in exactly one stage", () => {
    const all = [
      ...stages.stuck,
      ...stages.waiting.cards,
      ...stages.waiting.parked,
      ...stages.queue,
      ...stages.prInProgress,
      ...stages.behind,
    ];
    const left = 1; // the dispatched issue
    const total = Object.values(plan).reduce((n, xs) => n + xs.length, 0);
    assert.equal(all.length, total - left);
    const keys = all.map((c) => `${c.repo}#${"number" in c ? c.number : ""}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(stages.closed, closed);
  });

  test("stages", () => {
    assert.deepEqual(stages.stuck.map((c) => [c.kind, c.number]), [["pr", 1]]);
    assert.deepEqual(
      stages.waiting.cards.map((c) => [c.number, c.sub ?? (c.needsReview && "review")]),
      [[16, "afterMerge"], [10, "review"], [3, "goAhead"], [2, "decide"]],
    );
    assert.deepEqual(stages.waiting.cards.find((c) => c.number === 16)?.prs, [40, 41]);
    assert.deepEqual(stages.waiting.parked.map((p) => p.number), [5]);
    assert.deepEqual(stages.queue.map((c) => c.number), [6, 7]);
    assert.deepEqual(stages.behind.map((c) => [c.number, c.sub]), [[4, "blocked"]]);
    assert.equal(stages.waiting.cards.find((c) => c.number === 3)?.unready, true);
    assert.equal(stages.waiting.parked[0].unready, true);
    assert.equal(stages.waiting.cards.find((c) => c.number === 2)?.unready, undefined);
  });

  test("PRs in progress: red, pending, then automerge", () => {
    assert.deepEqual(stages.prInProgress.map((c) => c.number), [13, 12, 11, 15]);
  });

  test("the board is normal and carries the run", () => {
    assert.equal(board.state, "normal");
    assert.equal(board.paused, undefined);
    assert.deepEqual([board.generated, board.repos, board.digest], ["2026-11-17T00:00:00Z", [R], "d"]);
  });
});

describe("render", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const html = render(board, now);
  const section = (h: string, id: string) => h.match(new RegExp(`<section class="module m-${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

  test("one module per stage, each holding its cards", () => {
    const ids = [...html.matchAll(/class="module m-(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["stuck", "waiting", "closed", "pr", "queue", "behind"]);
    const cards = { stuck: stages.stuck, waiting: stages.waiting.cards, closed: stages.closed, pr: stages.prInProgress, queue: stages.queue, behind: stages.behind };
    for (const [id, cs] of Object.entries(cards)) for (const c of cs) assert.match(section(html, id), new RegExp(`>${c.title}</a>`), `${id}: ${c.title}`);
    assert.match(section(html, "waiting"), /<summary>1 parked<\/summary>[\s\S]*>T5<\/a>/);
    assert.match(section(html, "waiting"), /<h2>Waiting for human<\/h2>/);
    assert.match(section(html, "waiting"), /href="https:\/\/github.com\/o\/r\/pull\/40"[^>]*>PR #40</);
    assert.match(section(html, "waiting"), />Needs review</);
    assert.doesNotMatch(section(html, "pr"), />Needs review</);
    assert.match(html, /as of <b>2026-11-17 00:00 UTC<\/b>/);
  });

  test("a Mark ready for agent button on each issue without the label, naming it", () => {
    const buttons = [...html.matchAll(/<button type="button" class="ready" data-repo="([^"]+)" data-number="(\d+)">Mark ready for agent<\/button>/g)];
    assert.deepEqual(buttons.map((m) => [m[1], Number(m[2])]), [[R, 3], [R, 5]]);
  });

  test("Stuck hides when empty; the other modules show an empty message", () => {
    const empty = buildBoard(
      { review: [], unstick: [], decide: [], afterMerge: [], triage: [], inProgress: [], queue: [], notPicked: [], automerge: [] },
      { generated: board.generated, repos: [R], digest: "d", closed: [] },
    );
    const h = render(empty, now);
    assert.doesNotMatch(h, /m-stuck/);
    assert.equal(h.match(/class="empty"/g)?.length, 5);
  });

  test("a paused board shows the paused banner and no stale warning", () => {
    const paused = { ...board, generated: "2026-11-29T23:00:00Z", state: "paused" as const, paused: { since: "2026-11-01", snapshot: "https://snap" } };
    const h = render(paused, new Date("2026-11-30T00:00:00Z"));
    assert.match(h, /href="https:\/\/snap"[^>]*>Paused since 2026-11-01\. Nothing is dispatched or merged\./);
    assert.doesNotMatch(h, /stale/);
  });

  test("a board a day old is stale: its workflow stopped", () => {
    assert.doesNotMatch(render(board, new Date("2026-11-17T23:00:00Z")), /stale/);
    assert.match(render(board, new Date("2026-11-18T01:00:00Z")), /class="notice stale">This board is 1 day\(s\) old/);
  });

  test("a fresh board says when the dispatcher last ran, and warns after 2 days", () => {
    const fresh = { ...board, generated: "2026-11-19T00:00:00Z" };
    const at = new Date("2026-11-19T00:10:00Z");
    assert.match(render(fresh, at), /last run <b>2026-11-16 20:00 UTC<\/b>/);
    assert.match(render(fresh, at), /class="notice stale">The workshop last ran 2 days ago/);
    assert.doesNotMatch(render({ ...fresh, lastRun: "2026-11-18T08:00:00Z" }, at), /stale/);
    assert.doesNotMatch(render({ ...fresh, state: "paused" as const }, at), /last ran/);
  });

  test("escapes what it shows", () => {
    const h = render({ ...board, stages: { ...stages, queue: [{ ...stages.queue[0], title: "<b>&" }] } }, now);
    assert.match(h, />&lt;b&gt;&amp;</);
  });
});

describe("labelSync", () => {
  // Waiting for human here: #16 (after merge), #10 (review), #3 (go-ahead), #2 (decide); #5 is parked.
  test("adds to every Waiting for human card, never to a parked one or another stage", () =>
    assert.deepEqual(labelSync(board, []), [{ repo: R, add: [2, 3, 10, 16], remove: [] }]));

  test("removes it from whatever else has it, and leaves cards that have it alone", () =>
    assert.deepEqual(
      labelSync(board, [{ repo: R, number: 2 }, { repo: R, number: 5 }, { repo: R, number: 1 }, { repo: "O/R", number: 10 }]),
      [{ repo: R, add: [3, 16], remove: [1, 5] }],
    ));

  test("nothing to do, nothing listed; a repo the board doesn't cover is never touched", () => {
    const all = [2, 3, 10, 16].map((number) => ({ repo: R, number }));
    assert.deepEqual(labelSync(board, [...all, { repo: "o/other", number: 1 }]), []);
  });
});
