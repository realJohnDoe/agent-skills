// The workshop board's page body, rendered from board.json (the `Board` type in
// ../scripts/board.ts). Pure, so index.html and board.test.ts both load it.
/** @import { Board, Card } from "../scripts/board.ts" */

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
const SUB = { decide: "Decide", afterMerge: "After merge", goAhead: "Go ahead?", plan: "Plan", tier: "Tier?", assigned: "Assigned" };
// On every Stuck and Waiting for human card, and on any other issue without `ready-for-agent`
// (which the dispatcher won't pick up): a link that opens a new Claude Code session on its
// repo with "Regarding owner/name#n: " prefilled, for you to finish and send. Not on cards the
// dispatcher is working on (Queue, PR in progress), where a second session would collide.
/** @param {{ repo: string, number: number, unready?: boolean }} c @param {boolean} [always] */
const claudeChip = (c, always = false) =>
  always || c.unready
    ? `<a class="chip claude" href="${esc(`https://claude.ai/code/new?repo=${encodeURIComponent(c.repo)}&q=${encodeURIComponent(`Regarding ${c.repo}#${c.number}: `)}`)}" target="_blank" rel="noopener" title="Work on this with Claude" aria-label="Work on this with Claude">✳</a>`
    : "";
const DAY = 864e5;

// GitHub's Octicons (MIT), 16px: the same marks GitHub uses for issues, PRs and check results.
const ICONS = {
  issue: '<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>',
  issueClosed: '<path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/>',
  pr: '<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>',
  merged: '<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"/>',
  green: '<path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z"/>',
  red: '<path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"/>',
  pending: '<path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>',
};
/** @param {keyof typeof ICONS} name */
const icon = (name) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
/**
 * The card's own badge: its icon (open or closed issue; a PR card is always open), its number
 * and, on a PR, its CI. Styled like the badges that link a card to its other kind.
 * @param {Card} c @param {boolean} closed
 */
const refBadge = (c, closed) => {
  const pr = c.kind === "pr";
  const what = pr ? "Pull request" : closed ? "Closed issue" : "Issue";
  // the check icon says it; the word would repeat it
  const check = pr && c.check ? `<span class="check ${c.check}" role="img" title="CI ${c.check}" aria-label="CI ${c.check}">${icon(c.check)}</span>` : "";
  return `<a class="badge ${c.kind}" href="${esc(c.url)}" target="_blank" rel="noopener" title="${what} #${c.number}" aria-label="${what} #${c.number}">${icon(pr ? "pr" : closed ? "issueClosed" : "issue")}#${c.number}${check}</a>`;
};

/**
 * @param {Card} c
 * @param {boolean} claude show the Claude chip whether or not it is unready
 * @param {boolean} [closed] the Closed stage's issues, which get the closed-issue icon
 */
const cardWith = (c, claude, closed = false) => {
  // A card leads with where it is (repo), then what it is (a badge: issue or PR, its number, a PR's CI). A PR card (a PR's stage is about the PR: its CI, its review) names its
  // open issue in a badge; an issue card names its merged PRs in badges.
  const pr = c.kind === "pr";
  const chips = [repoChip(c.repo), refBadge(c, closed)];
  for (const n of c.prs ?? [])
    chips.push(`<a class="badge pr" href="${esc(`https://github.com/${c.repo}/pull/${n}`)}" target="_blank" rel="noopener" title="Merged pull request #${n}">${icon("merged")}#${n}</a>`);
  if (c.tier) chips.push(`<span class="chip tier">${c.tier}</span>`);
  const sub = c.sub && SUB[/** @type {keyof typeof SUB} */ (c.sub)];
  if (sub) chips.push(`<span class="chip sub">${sub}</span>`);
  if (c.needsReview) chips.push(`<span class="chip sub">Needs review</span>`); // styled like the other Waiting for human asks
  if (c.automerge) chips.push(`<span class="chip sub">Automerge</span>`);
  chips.push(claudeChip(c, claude));
  const parent = pr
    ? c.parent
      ? `<a class="badge issue wide" href="${esc(c.parent.url)}" target="_blank" rel="noopener">${icon("issue")}#${c.parent.number} <span class="tt">${esc(c.parent.title)}</span></a>`
      : `<div class="noissue">no issue</div>`
    : "";
  return `<article class="card ${c.kind}">
<div class="row">${chips.join("")}</div>
<div class="title">${link(c.url, c.title)}</div>
${parent}
<div class="why">${esc(c.reason)}</div>
</article>`;
};
/** @param {Card} c */
const card = (c) => cardWith(c, false);
/** @param {Card} c on Stuck and Waiting for human: always with the Claude chip */
const askCard = (c) => cardWith(c, true);
/** @param {string} id @param {string} name @param {string} hint @param {string[]} cards @param {string} empty */
const stageModule = (id, name, hint, cards, empty) => `<section class="module m-${id}" aria-label="${name}">
<div class="module-head"><span class="led"></span><h2>${name}</h2><span class="hint">${hint}</span><span class="readout">${String(cards.length).padStart(2, "0")}</span></div>
<div class="stack">${cards.length ? cards.join("") : `<div class="empty">${empty}</div>`}</div>
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

  const stuck = s.stuck.map(askCard);
  const behind = s.behind ?? []; // a board.json from before this stage has none
  const status = [
    `as of <b>${esc(when(board.generated))}</b>`,
    ...(board.lastRun ? [`last run <b>${esc(when(board.lastRun))}</b>`] : []),
    `repos <b>${board.repos.length}</b>`,
    `stuck <b class="bad">${stuck.length}</b>`,
    `waiting for human <b>${s.waiting.length}</b>`,
    `queue <b>${s.queue.length}</b>`,
    `behind another issue <b>${behind.length}</b>`,
  ].join('<span class="sep"></span>');

  return [
    ...notices,
    `<div class="status">${status}</div>`,
    `<div class="line">`,
    stuck.length ? stageModule("stuck", "Stuck", "needs a hand", stuck, "") : "",
    stageModule("waiting", "Waiting for human", "after merge, review, go ahead, decide, plan, tier, assigned", s.waiting.map(askCard), "Nothing waits on you"),
    stageModule("closed", "Closed", "latest 5", s.closed.map((c) => cardWith(c, false, true)), "Nothing closed yet"),
    stageModule("pr", "PR in progress", "red first", s.prInProgress.map(card), "No open PRs"),
    stageModule("queue", "Queue", "in pickup order", s.queue.map(card), "Queue empty"),
    stageModule("behind", "Behind another issue", "moves on once its blocker closes", behind.map(card), "Nothing waits on another issue"),
    `</div>`,
  ].join("\n");
};
