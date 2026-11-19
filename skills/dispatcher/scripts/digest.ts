// The digest issue: the workshop's state on GitHub. Its body holds the markers the board
// reads (when a run last ran, which repos it covered); the pause label sits on it. What
// waits on the maintainer is on the board, not here. dispatch.ts calls these. See ../SKILL.md.
import type { Repo } from "../../_shared/repos.ts";
import { type GhIssue, names, post } from "../../_shared/github.ts";
import { PAUSE_LABEL } from "../../_shared/markers.ts";
import { FOOTER, openDigests } from "./lib.ts";

const DIGEST_TITLE = "Workshop digest";
export const BOARD_URL = "https://realjohndoe.github.io/agent-skills/";
// When a run last wrote the digest; the board's stale notice reads it. It changes the
// body on every run, so the issue is rewritten every run (an edit notifies nobody).
const RUN = /<!-- digest-run: (\S+) -->/;
// The repos the run covered: the ones attached to its routine. The board workflow
// covers these, so the workshop's repo list lives only in the routine.
const REPOS = /<!-- digest-repos: ([^>]*?) -->/;

export type DigestState = {
  repo: string;
  issue: GhIssue | undefined; // the one digest issue: the newest open one
  older: GhIssue[]; // other open digest issues, to be closed into it
  lastRun?: string; // when a run last wrote the digest, from its RUN marker
  covered?: string[]; // the repos that run covered, from its REPOS marker
};

export function readDigest(repo: string): DigestState {
  return digestState(repo, openDigests(repo));
}

// The state from the open digest issues, oldest first.
export function digestState(repo: string, digests: GhIssue[]): DigestState {
  const [issue, ...older] = [...digests].reverse();
  const lastRun = issue?.body?.match(RUN)?.[1];
  const covered = issue?.body?.match(REPOS)?.[1].split(/\s+/).filter(Boolean);
  return { repo, issue, older, ...(lastRun && { lastRun }), ...(covered && { covered }) };
}

// The digest's body: the markers, and where to look instead. Pure.
export function buildDigest({ repos, now }: { repos: Repo[]; now: string }): string {
  const list = repos.map((r) => r.repo);
  return `<!-- digest-run: ${now} -->
<!-- digest-repos: ${list.join(" ")} -->

This issue holds the workshop's state: when the dispatcher last ran and which repos it covered, which the [workshop board](${BOARD_URL}) reads. Add the \`${PAUSE_LABEL}\` label here to pause the workshop, and remove it to resume. What waits on you is on the board.

Repos covered: ${list.join(", ")}.${FOOTER}`;
}

// On `finish`: create the issue if missing, close any older digest issues into it, and
// rewrite its body. Returns the issue number.
export function writeDigest({ repo, issue, older }: DigestState, body: string): number {
  const n: number = issue?.number ?? JSON.parse(post(`repos/${repo}/issues`, { title: DIGEST_TITLE, body })).number;
  const edit = {
    ...(issue && issue.title !== DIGEST_TITLE && { title: DIGEST_TITLE }),
    ...(issue && issue.body !== body && { body }),
  };
  if (Object.keys(edit).length) post(`repos/${repo}/issues/${n}`, edit, "PATCH");
  // A pause on an older digest carries over, so closing it doesn't resume the workshop.
  const paused = [issue, ...older].some((i) => i && names(i).includes(PAUSE_LABEL));
  if (paused && older.length) post(`repos/${repo}/issues/${n}/labels`, { labels: [PAUSE_LABEL] });
  for (const o of older) {
    post(`repos/${repo}/issues/${o.number}/comments`, { body: `Merged into #${n}, the one digest issue.${FOOTER}` });
    post(`repos/${repo}/issues/${o.number}`, { state: "closed", state_reason: "completed" }, "PATCH");
  }
  return n;
}
