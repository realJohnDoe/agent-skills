/** @import { Card } from "../../scripts/board.ts" */
import { esc } from "./html.js";
import { icon } from "./icons.js";

// Each repo keeps its colour from run to run: it comes from the name, not the order.
const REPO_COLORS = ["#5ee7f2", "#b99cff", "#ffc36b", "#7fb2ff", "#6fd38a", "#ff9ec2", "#f5a97f", "#c3e88d"];
/** @param {string} repo owner/name */
export const repoChip = (repo) => {
  let h = 0;
  for (const c of repo) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="chip repo" style="--repo:${REPO_COLORS[h % REPO_COLORS.length]}">${esc(repo.split("/")[1] ?? repo)}</span>`;
};
// No chip for `blocked`: those cards have a stage of their own, and their reason names the blocker.
export const SUB = { decide: "Decide", afterMerge: "After merge", goAhead: "Go ahead?", plan: "Plan", tier: "Tier?", assigned: "Assigned" };
// On every Stuck and Waiting for human card, and on any other issue without `ready-for-agent`
// (which the dispatcher won't pick up): a link that opens a new Claude Code session on its
// repo with "Regarding owner/name#n: " prefilled, for you to finish and send. Not on cards the
// dispatcher is working on (Queue, PR in progress), where a second session would collide.
/** @param {{ repo: string, number: number, unready?: boolean }} c @param {boolean} [always] */
export const claudeChip = (c, always = false) =>
  always || c.unready
    ? `<a class="chip claude" href="${esc(`https://claude.ai/code/new?repo=${encodeURIComponent(c.repo)}&q=${encodeURIComponent(`Regarding ${c.repo}#${c.number}: `)}`)}" target="_blank" rel="noopener" title="Work on this with Claude" aria-label="Work on this with Claude">✳</a>`
    : "";
/**
 * The card's own badge: its icon (open or closed issue; a PR card is always an open, non-draft PR),
 * its number and, on a PR, its CI. Styled like the badges that link a card to its other kind, and
 * coloured by state as GitHub does: open green, merged or closed (done) purple.
 * @param {Card} c @param {boolean} closed
 */
export const refBadge = (c, closed) => {
  const pr = c.kind === "pr";
  const what = pr ? "Pull request" : closed ? "Closed issue" : "Issue";
  // the check icon says it; the word would repeat it
  const check = pr && c.check ? `<span class="check ${c.check}" role="img" title="CI ${c.check}" aria-label="CI ${c.check}">${icon(c.check)}</span>` : "";
  return `<a class="badge ${c.kind} ${closed ? "closed" : "open"}" href="${esc(c.url)}" target="_blank" rel="noopener" title="${what} #${c.number}" aria-label="${what} #${c.number}">${icon(pr ? "pr" : closed ? "issueClosed" : "issue")}#${c.number}${check}</a>`;
};
