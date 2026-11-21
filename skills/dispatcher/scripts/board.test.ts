import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { moreLabel, render } from "../board/render.js";
import { CHECK, STAGE, busyness, scene } from "../board/components/scene.js";
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
  behind: [it(4, { why: "blocked by o/r#2", sub: "blocked" })],
  // out of order: the board puts plan, then tier, then assigned
  asks: [
    it(9, { why: "assigned to @x but ready for an agent; unassign it or remove ready-for-agent", sub: "assigned", tier: "sonnet" }),
    it(8, { why: "no tier label; add `haiku`, `sonnet` or `opus`", sub: "tier", unready: true }),
    it(5, { why: "`plan`; start a plan session", sub: "plan", unready: true }),
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
const board = buildBoard(plan, { generated: "2026-11-17T00:00:00Z", repos: [R], lastRun: "2026-11-16T20:00:00Z", closed });
const { stages } = board;

describe("buildBoard", () => {
  test("every plan item lands in exactly one stage", () => {
    const all = [
      ...stages.stuck,
      ...stages.waiting,
      ...stages.queue,
      ...stages.prInProgress,
      ...stages.behind,
    ];
    const left = 1; // the dispatched issue
    const total = Object.values(plan).reduce((n, xs) => n + xs.length, 0);
    assert.equal(all.length, total - left);
    const keys = all.map((c) => `${c.repo}#${c.number}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(stages.closed, closed);
  });

  test("stages", () => {
    assert.deepEqual(stages.stuck.map((c) => [c.kind, c.number]), [["pr", 1]]);
    assert.deepEqual(
      stages.waiting.map((c) => [c.number, c.sub ?? (c.needsReview && "review")]),
      [[16, "afterMerge"], [10, "review"], [3, "goAhead"], [2, "decide"], [5, "plan"], [8, "tier"], [9, "assigned"]],
    );
    assert.deepEqual(stages.waiting.find((c) => c.number === 16)?.prs, [40, 41]);
    assert.deepEqual(stages.queue.map((c) => c.number), [6, 7]);
    assert.deepEqual(stages.behind.map((c) => [c.number, c.sub]), [[4, "blocked"]]);
    assert.equal(stages.waiting.find((c) => c.number === 3)?.unready, true);
    assert.equal(stages.waiting.find((c) => c.number === 5)?.unready, true);
    assert.equal(stages.waiting.find((c) => c.number === 2)?.unready, undefined);
  });

  test("PRs in progress: red, pending, then automerge", () => {
    assert.deepEqual(stages.prInProgress.map((c) => c.number), [13, 12, 11, 15]);
  });

  test("the board is normal and carries the run", () => {
    assert.equal(board.state, "normal");
    assert.equal(board.paused, undefined);
    assert.deepEqual([board.generated, board.repos], ["2026-11-17T00:00:00Z", [R]]);
  });
});

describe("render", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const html = render(board, now);
  const section = (h: string, id: string) => h.match(new RegExp(`<section class="module m-${id}"[\\s\\S]*?</section>`))?.[0] ?? "";

  test("one module per stage, each holding its cards", () => {
    const ids = [...html.matchAll(/class="module m-(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["stuck", "waiting", "pr", "queue", "behind", "closed"]);
    const cards = { stuck: stages.stuck, waiting: stages.waiting, closed: stages.closed, pr: stages.prInProgress, queue: stages.queue, behind: stages.behind };
    for (const [id, cs] of Object.entries(cards)) for (const c of cs) assert.match(section(html, id), new RegExp(`>${c.title}</a>`), `${id}: ${c.title}`);
    assert.match(section(html, "waiting"), />Plan<[\s\S]*>Tier\?<[\s\S]*>Assigned</);
    assert.doesNotMatch(html, /parked/);
    assert.match(section(html, "waiting"), /<h2>Waiting for human<\/h2>/);
    assert.match(section(html, "waiting"), /href="https:\/\/github.com\/o\/r\/pull\/40"[^>]*>[\s\S]*?<\/svg>#40</);
    assert.match(section(html, "waiting"), />Needs review</);
    assert.doesNotMatch(section(html, "pr"), />Needs review</);
  });

  test("the status strip shows the last update and each open stage's count, in order and colour", () => {
    const strip = html.match(/<div class="status">[\s\S]*?<\/div>/)?.[0] ?? "";
    assert.match(strip, /last update <b>2026-11-17 00:00 UTC<\/b>/);
    assert.doesNotMatch(strip, /last run|closed/i);
    const counts = [...strip.matchAll(/<span class="m-(\w+)">[^<]* <b>(\d+)<\/b>/g)].map((m) => [m[1], Number(m[2])]);
    assert.deepEqual(counts, [
      ["stuck", stages.stuck.length],
      ["waiting", stages.waiting.length],
      ["pr", stages.prInProgress.length],
      ["queue", stages.queue.length],
      ["behind", stages.behind.length],
    ]);
  });

  test("the status strip leaves out empty stages", () => {
    const strip = render({ ...board, stages: { ...stages, stuck: [], queue: [] } }, now).match(/<div class="status">[\s\S]*?<\/div>/)?.[0] ?? "";
    assert.deepEqual([...strip.matchAll(/<span class="m-(\w+)">/g)].map((m) => m[1]), ["waiting", "pr", "behind"]);
  });

  test("Show more says how many a press shows and how many are hidden", () => {
    assert.equal(moreLabel(13, 10), "Show 10 more · 13 left");
    assert.equal(moreLabel(10, 10), "Show the last 10");
    assert.equal(moreLabel(3, 10), "Show the last 3");
  });

  test("Closed lists every card, the first 10 shown, with Show more while any are hidden", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ ...closed[0], number: 100 + i, title: `C${i}` }));
    const sec = section(render({ ...board, stages: { ...stages, closed: many } }, now), "closed");
    assert.equal(sec.match(/<article /g)?.length, 23);
    assert.equal(sec.match(/<article [^>]*hidden>/g)?.length, 13);
    assert.doesNotMatch(sec.match(/<article [^>]*>[\s\S]*?C9</)?.[0] ?? "", /hidden>[\s\S]*C9</); // C9 is the 10th, shown
    assert.match(sec, /<button class="more" type="button" data-step="10">Show 10 more · 13 left<\/button>/);
    assert.match(sec, /class="readout">23</);
    assert.doesNotMatch(section(html, "closed"), /class="more"|hidden>/);
  });

  test("a PR card leads with the PR and badges its open issue; an issue card leads with the issue", () => {
    const withParent = buildBoard(
      { ...plan, review: [pr(10, { check: "green", parent: { number: 20, title: "Parent <i>", url: `https://github.com/${R}/issues/20` } })] },
      { generated: board.generated, repos: [R], closed },
    );
    const h = render(withParent, now);
    const review = section(h, "waiting").match(/<article class="card pr">[\s\S]*?T10[\s\S]*?<\/article>/)?.[0] ?? "";
    assert.match(review, /class="badge pr open" href="https:\/\/github.com\/o\/r\/issues\/10"[^>]*>[\s\S]*?<\/svg>#10<span class="check green"/);
    assert.match(review, /class="badge issue open wide" href="https:\/\/github.com\/o\/r\/issues\/20"[^>]*>[\s\S]*?<\/svg>#20 <span class="tt">Parent &lt;i&gt;</);
    // a PR without an issue says so; an issue card is issue-led and has no issue badge
    assert.match(section(h, "stuck"), /class="noissue">no issue</);
    const issue = section(h, "waiting").match(/<article class="card issue">[\s\S]*?T16[\s\S]*?<\/article>/)?.[0] ?? "";
    assert.match(issue, /class="badge issue open" href="https:\/\/github.com\/o\/r\/issues\/16"[^>]*>[\s\S]*?<\/svg>#16</);
    assert.doesNotMatch(issue, /badge issue wide|noissue/);
    assert.equal(issue.match(/class="badge pr merged"/g)?.length, 2); // its two merged PRs
    assert.match(issue, /title="Merged pull request #40"/);
    assert.match(issue, /title="Issue #16"/);
  });

  test("a closed issue gets the closed-issue icon; automerge is a chip like the other asks", () => {
    assert.match(section(html, "closed"), /class="badge issue closed"[^>]*title="Closed issue #30"/);
    assert.doesNotMatch(section(html, "queue"), /Closed issue/);
    assert.match(section(html, "pr"), /class="chip sub">automerge</);
  });

  test("a Claude chip on every Stuck and Waiting for human card and each other issue without the label", () => {
    const links = [...html.matchAll(/<a class="chip claude" href="([^"]+)"/g)].map((m) => new URL(m[1].replaceAll("&amp;", "&")));
    assert.deepEqual(
      links.map((u) => [u.origin + u.pathname, u.searchParams.get("repo"), u.searchParams.get("q")]),
      [1, 16, 10, 3, 2, 5, 8, 9].map((n) => ["https://claude.ai/code/new", R, `Regarding ${R}#${n}: `]),
    );
  });

  test("Stuck hides when empty; the other modules show an empty message", () => {
    const empty = buildBoard(
      { review: [], unstick: [], decide: [], afterMerge: [], triage: [], asks: [], inProgress: [], queue: [], behind: [], automerge: [] },
      { generated: board.generated, repos: [R], closed: [] },
    );
    const h = render(empty, now);
    assert.doesNotMatch(h, /module m-stuck/);
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

  test("a fresh board warns when the dispatcher last ran 2 days ago", () => {
    const fresh = { ...board, generated: "2026-11-19T00:00:00Z" };
    const at = new Date("2026-11-19T00:10:00Z");
    assert.match(render(fresh, at), /class="notice stale">The workshop last ran 2 days ago/);
    assert.doesNotMatch(render({ ...fresh, lastRun: "2026-11-18T08:00:00Z" }, at), /stale/);
    assert.doesNotMatch(render({ ...fresh, state: "paused" as const }, at), /last ran/);
  });

  test("escapes what it shows", () => {
    const h = render({ ...board, stages: { ...stages, queue: [{ ...stages.queue[0], title: "<b>&" }] } }, now);
    assert.match(h, />&lt;b&gt;&amp;</);
  });
});

describe("scene", () => {
  const count = (h: string, re: RegExp) => h.match(re)?.length ?? 0;
  const quiet = { ...board, stages: { stuck: [], waiting: [], queue: [], prInProgress: [], closed: [], behind: [] } };

  test("lights a station per stage that has cards", () => {
    const h = scene(board);
    assert.match(h, /class="warning"/); // stuck
    assert.doesNotMatch(h, /class="healthy"/);
    assert.match(h, /class="wait"/);
    assert.equal(count(h, /class="sprout"/g), stages.queue.length);
    assert.equal(count(h, /class="lock"/g), stages.behind.length);
    assert.equal(count(h, /class="row /g), stages.prInProgress.length);
  });

  test("a quiet board: a healthy leaf, idle monitors, nothing lit", () => {
    const h = scene(quiet);
    assert.match(h, /class="healthy"/);
    assert.equal(count(h, /class="ui idle"/g), 2);
    assert.doesNotMatch(h, /class="(warning|wait|sprout|lock|row|pr|plate|bubble)"/);
  });

  test("each lit station carries its stage's count, in its stage's colour", () => {
    const h = scene(board);
    const plates = [...h.matchAll(/<g class="plate">.*?stroke="(#\w+)".*?>(\d+)<\/text><\/g>/g)].map(([, col, n]) => [col, Number(n)]);
    const lit = (["stuck", "waiting", "pr", "queue", "behind"] as const)
      .map((id) => [STAGE[id], { stuck: stages.stuck, waiting: stages.waiting, pr: stages.prInProgress, queue: stages.queue, behind: stages.behind }[id].length] as const)
      .filter(([, n]) => n);
    assert.deepEqual(plates.sort(), lit.map(([col, n]) => [col, n]).sort());
    assert.match(h, /class="bubble"/); // the waiting robot asks
    // the plate counts past the station's cap: ten queued cards light six sprouts and read 10
    const many = scene({ ...board, stages: { ...stages, queue: Array.from({ length: 10 }, () => stages.queue[0]) } });
    assert.match(many, new RegExp(`stroke="${STAGE.queue}"[^>]*/><text[^>]*>10<`));
  });

  test("a station's colour is its module's, and a PR row's is its badge's CI colour", () => {
    // board.css: the tokens, and each module's --c
    const css = readFileSync(new URL("../board/board.css", import.meta.url), "utf8");
    const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];
    const via = (sel: string, prop: string) => token(css.match(new RegExp(`${sel}\\s*\\{[^}]*${prop}:\\s*var\\(--([\\w-]+)\\)`))![1]);
    for (const id of Object.keys(STAGE) as (keyof typeof STAGE)[]) assert.equal(STAGE[id], via(`\\.m-${id}`, "--c"), id);
    for (const check of Object.keys(CHECK) as (keyof typeof CHECK)[]) assert.equal(CHECK[check], via(`\\.check\\.${check}`, "color"), check);
    const h = scene({ ...quiet, stages: { ...quiet.stages, prInProgress: [{ ...stages.prInProgress[0], check: "pending" as const }] } });
    assert.match(h, new RegExp(`class="row pending">.*?fill="${CHECK.pending}"`));
  });

  test("a PR's row takes its CI colour, and only a running one grows", () => {
    const h = scene({ ...quiet, stages: { ...quiet.stages, prInProgress: stages.prInProgress } });
    const rows = (check: string) => count(h, new RegExp(`class="row ${check}"`, "g"));
    assert.equal(rows("green"), stages.prInProgress.filter((c) => c.check === "green").length);
    assert.equal(rows("red"), 1);
    assert.equal(count(h, /attributeName="width"/g), stages.prInProgress.filter((c) => c.check === "pending").length);
  });

  test("caps what a station can show", () => {
    const many = <T,>(xs: T[]) => Array.from({ length: 10 }, () => xs[0]);
    const h = scene({ ...board, stages: { ...stages, queue: many(stages.queue), behind: many(stages.behind), prInProgress: many(stages.prInProgress) } });
    assert.equal(count(h, /class="sprout"/g), 6);
    assert.equal(count(h, /class="lock"/g), 3);
    assert.equal(count(h, /class="row /g), 6);
  });

  test("paused: dimmed and still, eyes shut, no ships", () => {
    const h = scene({ ...board, state: "paused" as const });
    assert.match(h, /class="scene paused"/);
    assert.match(h, /class="night"/);
    assert.doesNotMatch(h, /<animate/);
    assert.doesNotMatch(h, /class="ship"/);
    assert.equal(count(h, /class="lid"/g), 7); // every robot's eyes, the small fourth's too
    assert.doesNotMatch(h, /class="lid"[^>]*ry="0"/);
  });

  test("every robot blinks, the small fourth one too", () => {
    const h = scene(board);
    assert.equal(count(h, /class="lid"[^>]*><animate attributeName="ry"/g), 7);
    assert.match(h, /cx="1982" cy="484" rx="7" ry="0"/);
  });

  test("reduced motion: nothing moves and no ships fly", () => {
    const h = scene(board, false);
    assert.doesNotMatch(h, /<animate/);
    assert.doesNotMatch(h, /class="(ship|ring)"/);
    assert.match(scene(board), /class="ship"/);
  });

  test("the city's traffic grows with the workshop's workload", () => {
    const withWork = (n: number) => ({ ...quiet, stages: { ...quiet.stages, queue: Array.from({ length: n }, () => stages.queue[0]) } });
    assert.deepEqual([0, 5, 10, 30].map((n) => busyness(withWork(n))), [0, 0.5, 1, 1]);
    const traffic = (n: number) => [count(scene(withWork(n)), /class="ship"/g), count(scene(withWork(n)), /class="beacon"/g)];
    assert.deepEqual(traffic(0), [1, 1]); // a quiet workshop still has a ship and a light
    assert.deepEqual(traffic(5), [4, 3]);
    assert.deepEqual(traffic(10), [6, 5]);
  });

  test("the lantern glows brighter with each waiting card, up to six", () => {
    const glow = (n: number) => Number(scene({ ...quiet, stages: { ...quiet.stages, waiting: Array.from({ length: n }, () => stages.waiting[0]) } }).match(/class="wait"><circle[^>]*opacity="([\d.]+)"/)?.[1]);
    assert.ok(glow(1) < glow(3) && glow(3) < glow(6));
    assert.equal(glow(6), glow(9));
  });

  test("every lit station is a link to an existing stage module", () => {
    const stations = (h: string) => [...h.matchAll(/<a class="station" href="#(stage-\w+)"/g)].map((m) => m[1]);
    const modules = [...render(board).matchAll(/<section class="module [^"]*" id="(stage-\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(stations(scene(board)).sort(), ["stage-behind", "stage-pr", "stage-queue", "stage-stuck", "stage-waiting"]);
    for (const id of stations(scene(board))) assert.ok(modules.includes(id), id);
    assert.ok(scene(board).includes(`<a class="station" href="#stage-pr" aria-label="PR in progress: ${stages.prInProgress.length}"><title>PR in progress: ${stages.prInProgress.length}</title>`));
  });

  test("a quiet board has no links", () => assert.doesNotMatch(scene(quiet), /<a /));

  test("no two stations' click boxes overlap", () => {
    const many = (cards: unknown[]) => Array.from({ length: 10 }, () => cards[0]);
    const full = { ...board, stages: { ...stages, queue: many(stages.queue), behind: many(stages.behind), prInProgress: many(stages.prInProgress) } };
    for (const b of [board, full]) {
      const boxes = [...scene(b as typeof board).matchAll(/<a class="station" href="#(stage-\w+)".*?<\/a>/gs)].flatMap(([a, id]) =>
        [...a.matchAll(/<rect class="hit" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(([, x, y, w, h]) => ({ id, x: +x, y: +y, w: +w, h: +h })),
      );
      assert.equal(new Set(boxes.map((b) => b.id)).size, 5);
      for (const [i, a] of boxes.entries())
        for (const c of boxes.slice(i + 1))
          if (a.id !== c.id) assert.ok(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y, `${a.id} overlaps ${c.id}`);
    }
  });

  test("a station's jump scrolls with scrollTo, never scrollIntoView or CSS smooth scrolling", () => {
    // Either one stalls smooth scrolling in the Claude app's Android WebView, which no Chromium test catches.
    const read = (f: string) => readFileSync(new URL(`../board/${f}`, import.meta.url), "utf8");
    assert.match(read("index.html"), /\bscrollTo\(/);
    for (const f of ["index.html", "render.js", "components/scene.js", "components/stage.js"]) assert.doesNotMatch(read(f), /scrollIntoView\(/, f);
    assert.doesNotMatch(read("board.css"), /scroll-behavior\s*:\s*smooth/);
  });

  test("moves only by SVG attributes, never by a CSS transform", () => assert.doesNotMatch(scene(board), /style="[^"]*transform/));
});

describe("labelSync", () => {
  // Waiting for human here: #16 (after merge), #10 (review), #3 (go-ahead), #2 (decide), #5 (plan), #8 (tier), #9 (assigned).
  test("adds to every Waiting for human card, never to another stage", () =>
    assert.deepEqual(labelSync(board, []), [{ repo: R, add: [2, 3, 5, 8, 9, 10, 16], remove: [] }]));

  test("removes it from whatever else has it, and leaves cards that have it alone", () =>
    assert.deepEqual(
      labelSync(board, [{ repo: R, number: 2 }, { repo: R, number: 4 }, { repo: R, number: 1 }, { repo: "O/R", number: 10 }]),
      [{ repo: R, add: [3, 5, 8, 9, 16], remove: [1, 4] }],
    ));

  test("nothing to do, nothing listed; a repo the board doesn't cover is never touched", () => {
    const all = [2, 3, 5, 8, 9, 10, 16].map((number) => ({ repo: R, number }));
    assert.deepEqual(labelSync(board, [...all, { repo: "o/other", number: 1 }]), []);
  });
});
