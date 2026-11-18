import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { render } from "../board/render.js";
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
      ...stages.blocked,
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
    assert.deepEqual(
      stages.waiting.cards.map((c) => [c.number, c.sub ?? (c.needsReview && "review")]),
      [[2, "decide"], [16, "afterMerge"], [10, "review"], [3, "goAhead"]],
    );
    assert.deepEqual(stages.waiting.cards.find((c) => c.number === 16)?.prs, [40, 41]);
    assert.deepEqual(stages.waiting.parked.map((p) => p.number), [5]);
    assert.deepEqual(stages.queue.map((c) => c.number), [6, 7]);
    assert.deepEqual(stages.blocked.map((c) => [c.number, c.sub]), [[4, "blocked"]]);
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
    assert.deepEqual(ids, ["stuck", "waiting", "closed", "pr", "queue", "blocked"]);
    const cards = { stuck: stages.stuck, waiting: stages.waiting.cards, closed: stages.closed, pr: stages.prInProgress, queue: stages.queue, blocked: stages.blocked };
    for (const [id, cs] of Object.entries(cards)) for (const c of cs) assert.match(section(html, id), new RegExp(`>${c.title}</a>`), `${id}: ${c.title}`);
    assert.match(section(html, "stuck"), /Can&#39;t push to o\/x/);
    assert.match(section(html, "waiting"), /<summary>1 parked<\/summary>[\s\S]*>T5<\/a>/);
    assert.match(section(html, "waiting"), /<h2>Waiting for human<\/h2>/);
    assert.match(section(html, "waiting"), /href="https:\/\/github.com\/o\/r\/pull\/40"[^>]*>PR #40</);
    assert.match(section(html, "waiting"), /needs review/);
    assert.doesNotMatch(section(html, "pr"), /needs review/);
    assert.match(html, /as of <b>2026-11-17 00:00 UTC<\/b>/);
  });

  test("Stuck hides when empty; the other modules show an empty message", () => {
    const empty = buildBoard(
      { cantPush: [], review: [], unstick: [], decide: [], afterMerge: [], triage: [], inProgress: [], queue: [], notPicked: [], automerge: [] },
      { generated: board.generated, repos: [R], digest: "d", closed: [] },
    );
    const h = render(empty, now);
    assert.doesNotMatch(h, /m-stuck/);
    assert.equal(h.match(/class="empty"/g)?.length, 5);
  });

  test("a paused board shows the paused banner and no stale warning", () => {
    const paused = { ...board, state: "paused" as const, paused: { since: "2026-11-01", snapshot: "https://snap" } };
    const h = render(paused, new Date("2026-11-30T00:00:00Z"));
    assert.match(h, /href="https:\/\/snap"[^>]*>Paused since 2026-11-01\. Nothing is dispatched or merged\./);
    assert.doesNotMatch(h, /stale/);
  });

  test("a board more than 2 days old is stale", () => {
    assert.doesNotMatch(render(board, new Date("2026-11-18T23:00:00Z")), /stale/);
    assert.match(render(board, new Date("2026-11-19T01:00:00Z")), /class="notice stale">This board is 2 days old/);
  });

  test("escapes what it shows", () => {
    const h = render({ ...board, stages: { ...stages, queue: [{ ...stages.queue[0], title: "<b>&" }] } }, now);
    assert.match(h, />&lt;b&gt;&amp;</);
  });
});
