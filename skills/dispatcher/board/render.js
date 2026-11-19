// The workshop board's page body, rendered from board.json (the `Board` type in
// ../scripts/board.ts). Pure, so index.html and board.test.ts both load it.
/** @import { Board, Card, Parked } from "../scripts/board.ts" */

/** @param {unknown} s */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
/** @param {string} url @param {string} text @param {string} [cls] */
const link = (url, text, cls) => `<a${cls ? ` class="${cls}"` : ""} href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

// Each repo keeps its colour from run to run: it comes from the name, not the order.
const REPO_COLORS = ["#5ee7f2", "#b99cff", "#ffc36b", "#7fb2ff", "#6fd38a", "#ff9ec2", "#f5a97f", "#c3e88d"];
/** @param {string} repo owner/name */
const repoChip = (repo) => {
  let h = 0;
  for (const c of repo) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="chip repo" style="--repo:${REPO_COLORS[h % REPO_COLORS.length]}">${esc(repo.split("/")[1] ?? repo)}</span>`;
};
// No chip for `blocked`: those cards have a stage of their own, and their reason names the blocker.
const SUB = { decide: "Decide", afterMerge: "After merge", goAhead: "Go ahead?" };
// On an issue without `ready-for-agent`, which the dispatcher won't pick up: a link that
// opens a new Claude Code session on its repo with the issue as the prompt (you press send).
/** @param {{ repo: string, url: string, unready?: boolean }} c */
const claudeChip = (c) =>
  c.unready
    ? `<a class="chip claude" href="${esc(`https://claude.ai/code/new?repo=${encodeURIComponent(c.repo)}&q=${encodeURIComponent(`Work on ${c.url}`)}`)}" target="_blank" rel="noopener" title="Work on this with Claude" aria-label="Work on this with Claude">✳</a>`
    : "";
const DAY = 864e5;

/** @param {Card} c */
const card = (c) => {
  const chips = [repoChip(c.repo), `<span class="chip ref">#${c.number}</span>`];
  for (const n of c.prs ?? []) chips.push(link(`https://github.com/${c.repo}/pull/${n}`, `PR #${n}`, "chip prlink"));
  if (c.tier) chips.push(`<span class="chip tier">${c.tier}</span>`);
  const sub = c.sub && SUB[/** @type {keyof typeof SUB} */ (c.sub)];
  if (sub) chips.push(`<span class="chip sub">${sub}</span>`);
  if (c.needsReview) chips.push(`<span class="chip sub">Needs review</span>`); // styled like the other Waiting for human asks
  if (c.automerge) chips.push(`<span class="chip auto">automerge</span>`);
  if (c.check) chips.push(`<span class="check ${c.check}">${c.check}</span>`);
  chips.push(claudeChip(c));
  return `<article class="card">
<div class="title">${link(c.url, c.title)}</div>
<div class="row">${chips.join("")}</div>
<div class="why">${esc(c.reason)}</div>
</article>`;
};
/** @param {Parked} p */
const parkedCard = (p) => `<article class="card compact">
<div class="title">${link(p.url, p.title)}</div>
<div class="row">${repoChip(p.repo)}<span class="chip ref">#${p.number}</span>${claudeChip(p)}<span class="why">${esc(p.reason)}</span></div>
</article>`;
/**
 * @param {string} id @param {string} name @param {string} hint @param {string[]} cards
 * @param {string} empty @param {string} [foot]
 */
const stageModule = (id, name, hint, cards, empty, foot = "") => `<section class="module m-${id}" aria-label="${name}">
<div class="module-head"><span class="led"></span><h2>${name}</h2><span class="hint">${hint}</span><span class="readout">${String(cards.length).padStart(2, "0")}</span></div>
<div class="stack">${cards.length ? cards.join("") : `<div class="empty">${empty}</div>`}</div>${foot}
</section>`;

/** @param {string} iso */
const when = (iso) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/**
 * The board below the banner: notices, the status strip and the stage modules.
 * @param {Board} board
 * @param {Date} [now] the viewer's clock, for the stale warnings
 */
export const render = (board, now = new Date()) => {
  const s = board.stages;
  const notices = [];
  if (board.state === "paused" && board.paused)
    notices.push(
      `<p class="notice paused">${link(board.paused.snapshot, `Paused since ${board.paused.since.slice(0, 10)}. Nothing is dispatched or merged.`)}</p>`,
    );
  // The board workflow refreshes it every half hour and the dispatcher runs twice a
  // day, so either one quiet for a day has stopped.
  const days = (/** @type {string} */ iso) => Math.floor((now.getTime() - Date.parse(iso)) / DAY);
  if (days(board.generated) >= 1)
    notices.push(`<p class="notice stale">This board is ${days(board.generated)} day(s) old: its workflow has not run since. Check the Workshop board workflow.</p>`);
  else if (board.state !== "paused" && board.lastRun && days(board.lastRun) >= 2)
    notices.push(`<p class="notice stale">The workshop last ran ${days(board.lastRun)} days ago. Check its routine.</p>`);

  const stuck = s.stuck.map(card);
  const behind = s.behind ?? []; // a board.json from before this stage has none
  const status = [
    `as of <b>${esc(when(board.generated))}</b>`,
    ...(board.lastRun ? [`last run <b>${esc(when(board.lastRun))}</b>`] : []),
    `repos <b>${board.repos.length}</b>`,
    `stuck <b class="bad">${stuck.length}</b>`,
    `waiting for human <b>${s.waiting.cards.length}</b>`,
    `queue <b>${s.queue.length}</b>`,
    `behind another issue <b>${behind.length}</b>`,
    link(board.digest, "digest"),
  ].join('<span class="sep"></span>');
  const parked = s.waiting.parked.length
    ? `<details class="parked"><summary>${s.waiting.parked.length} parked</summary><div class="stack">${s.waiting.parked.map(parkedCard).join("")}</div></details>`
    : "";

  return [
    ...notices,
    `<div class="status">${status}</div>`,
    `<div class="line">`,
    stuck.length ? stageModule("stuck", "Stuck", "needs a hand", stuck, "") : "",
    stageModule("waiting", "Waiting for human", "after merge, review, go ahead, decide", s.waiting.cards.map(card), "Nothing waits on you", parked),
    stageModule("closed", "Closed", "latest 5", s.closed.map(card), "Nothing closed yet"),
    stageModule("pr", "PR in progress", "red first", s.prInProgress.map(card), "No open PRs"),
    stageModule("queue", "Queue", "in pickup order", s.queue.map(card), "Queue empty"),
    stageModule("behind", "Behind another issue", "moves on once its blocker closes", behind.map(card), "Nothing waits on another issue"),
    `</div>`,
  ].join("\n");
};
