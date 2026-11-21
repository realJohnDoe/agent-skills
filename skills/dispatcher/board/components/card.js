/** @import { Card } from "../../scripts/board.ts" */
import { esc, link } from "./html.js";
import { icon } from "./icons.js";
import { SUB, claudeChip, refBadge, repoChip } from "./chips.js";

/**
 * @param {Card} c
 * @param {boolean} claude show the Claude chip whether or not it is unready
 * @param {boolean} [closed] the Closed stage's issues, which get the closed-issue icon
 * @param {boolean} [hidden] rendered hidden, for Show more to reveal
 */
export const cardWith = (c, claude, closed = false, hidden = false) => {
  // A card leads with where it is (repo), then what it is (a badge: issue or PR, its number, a PR's CI). A PR card (a PR's stage is about the PR: its CI, its review) names its
  // open issue in a badge; an issue card names its merged PRs in badges.
  const pr = c.kind === "pr";
  const chips = [repoChip(c.repo), refBadge(c, closed)];
  for (const n of c.prs ?? [])
    chips.push(`<a class="badge pr merged" href="${esc(`https://github.com/${c.repo}/pull/${n}`)}" target="_blank" rel="noopener" title="Merged pull request #${n}">${icon("merged")}#${n}</a>`);
  if (c.tier) chips.push(`<span class="chip tier">${c.tier}</span>`);
  const sub = c.sub && SUB[/** @type {keyof typeof SUB} */ (c.sub)];
  if (sub) chips.push(`<span class="chip sub">${sub}</span>`);
  if (c.needsReview) chips.push(`<span class="chip sub">Needs review</span>`); // styled like the other Waiting for human asks
  if (c.automerge) chips.push(`<span class="chip sub">automerge</span>`);
  chips.push(claudeChip(c, claude));
  const parent = pr
    ? c.parent
      ? `<a class="badge issue open wide" href="${esc(c.parent.url)}" target="_blank" rel="noopener">${icon("issue")}#${c.parent.number} <span class="tt">${esc(c.parent.title)}</span></a>`
      : `<div class="noissue">no issue</div>`
    : "";
  return `<article class="card ${c.kind}"${hidden ? " hidden" : ""}>
<div class="row">${chips.join("")}</div>
<div class="title">${link(c.url, c.title)}</div>
${parent}
<div class="why">${esc(c.reason)}</div>
</article>`;
};
/** @param {Card} c */
export const card = (c) => cardWith(c, false);
/** @param {Card} c on Stuck and Waiting for human: always with the Claude chip */
export const askCard = (c) => cardWith(c, true);
