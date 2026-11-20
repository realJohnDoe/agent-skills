// The workshop board's page body, rendered from board.json (the `Board` type in
// ../scripts/board.ts). Pure, so index.html and board.test.ts both load it.
/** @import { Board } from "../scripts/board.ts" */

import { esc, link } from "./components/html.js";
import { askCard, card, cardWith } from "./components/card.js";
import { stageModule } from "./components/stage.js";

const DAY = 864e5;

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
