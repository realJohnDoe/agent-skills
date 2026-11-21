// The workshop board's page body, rendered from board.json (the `Board` type in
// ../scripts/board.ts). Pure, so index.html and board.test.ts both load it.
/** @import { Board } from "../scripts/board.ts" */

import { esc, link } from "./components/html.js";
import { askCard, card, cardWith } from "./components/card.js";
import { stageModule } from "./components/stage.js";

const DAY = 864e5;
/** How many Closed cards show at first, and how many more each Show more press reveals. */
export const CLOSED_PAGE = 10;

/** @param {string} iso */
const when = (iso) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/**
 * The board below the banner: notices, the status strip and the stage modules, Closed last.
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
  // The open stages' counts, in the modules' order and each in its stage's colour.
  const count = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ n) => `<span class="m-${id}">${name} <b>${n}</b></span>`;
  const status = [
    `last update <b>${esc(when(board.generated))}</b>`,
    `repos <b>${board.repos.length}</b>`,
    count("stuck", "stuck", stuck.length),
    count("waiting", "waiting for human", s.waiting.length),
    count("pr", "PR in progress", s.prInProgress.length),
    count("queue", "queue", s.queue.length),
    count("behind", "behind another issue", behind.length),
  ].join('<span class="sep"></span>');

  // Closed lists every completed issue, newest first: the first CLOSED_PAGE show, and
  // each press of Show more (wired in index.html) shows CLOSED_PAGE more.
  const closed = s.closed.map((c, i) => cardWith(c, false, true, i >= CLOSED_PAGE));
  const more = closed.length > CLOSED_PAGE ? `<button class="more" type="button" data-step="${CLOSED_PAGE}">Show more</button>` : "";

  return [
    ...notices,
    `<div class="status">${status}</div>`,
    `<div class="line">`,
    stuck.length ? stageModule("stuck", "Stuck", "needs a hand", stuck, "") : "",
    stageModule("waiting", "Waiting for human", "after merge, review, go ahead, decide, plan, tier, assigned", s.waiting.map(askCard), "Nothing waits on you"),
    stageModule("pr", "PR in progress", "red first", s.prInProgress.map(card), "No open PRs"),
    stageModule("queue", "Queue", "in pickup order", s.queue.map(card), "Queue empty"),
    stageModule("behind", "Behind another issue", "moves on once its blocker closes", behind.map(card), "Nothing waits on another issue"),
    stageModule("closed", "Closed", "newest first", closed, "Nothing closed yet", more),
    `</div>`,
  ].join("\n");
};
