// The shared digest: read its state, build its body from the run's plan, write it.
// dispatch.ts calls these. See ../SKILL.md.
import type { Repo } from "../../_shared/repos.ts";
import { all, type GhComment, type GhIssue, names, post } from "../../_shared/github.ts";
import { marked, PAUSE_LABEL } from "../../_shared/markers.ts";
import { AGENT, READY } from "./decide.ts";
import { FOOTER, type Item, openDigests } from "./lib.ts";

// The digest is published on the first run of these days.
const DIGEST_WEEKDAYS = [2, 5]; // Tue, Fri (UTC getDay)
const DIGEST_DAYS = 2.5; // minimum window, so a second run that day doesn't publish again
const DIGEST_TITLE = "Workshop digest";
// Starts the comment that publishes the digest: its date opens the next window.
const PUBLISHED = "<!-- workshop-published -->";
const RELAYED = "<!-- workshop-relayed -->"; // digest replies up to here are copied to their issues
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
  since: string;
  lastRun?: string; // when a run last wrote the digest, from its RUN marker
  covered?: string[]; // the repos that run covered, from its REPOS marker
};

// The plan's digest-ready lists, plus the run's clock and mode.
export type DigestPlan = {
  repos: Repo[];
  review: Item[];
  unstick: Item[];
  decide: Item[];
  afterMerge: Item[];
  triage: Item[];
  inProgress: Item[];
  queue: Item[];
  notPicked: Item[];
  merged: string[];
  unblocksOf: Map<string, string[]>;
  today: Date;
  now: string; // when this run's window ends; a new digest's window starts here
  followupsOnly: boolean;
};

export type BuiltDigest = {
  body: string;
  publish: boolean;
  replies: { digest: number; url: string; author: string; body: string }[];
  counts: Record<
    "decide" | "afterMerge" | "review" | "unstick" | "triage" | "inProgress" | "queue" | "notPicked" | "merged",
    number
  >;
  // The comment that publishes the digest, when it is due.
  publishedComment: string;
};

const ANSWER =
  "Answer on the issue or PR, or reply here naming the item (e.g. `meridian#12`): the next dispatcher run copies replies onto their issues.";
const NOTE = `_The digest is rewritten by every dispatcher run and published as a comment on Tuesdays and Fridays. ${ANSWER}_\n\n`;

// The shared digest's state, read first: its window bounds "merged since".
export function readDigest(repo: string, today: Date): DigestState {
  const [issue, ...older] = openDigests(repo).reverse();
  const publishedAt = issue
    ? all<GhComment>(`repos/${repo}/issues/${issue.number}/comments?per_page=100`).findLast((c) =>
        marked(c, PUBLISHED),
      )?.created_at
    : undefined;
  const since =
    publishedAt ??
    issue?.body?.match(/<!-- digest-(?:date|since): (\S+) -->/)?.[1] ??
    new Date(+today - DIGEST_DAYS * 864e5).toISOString().slice(0, 10);
  const lastRun = issue?.body?.match(RUN)?.[1];
  const covered = issue?.body?.match(REPOS)?.[1].split(/\s+/).filter(Boolean);
  return { repo, issue, older, since, ...(lastRun && { lastRun }), ...(covered && { covered }) };
}

// One long-lived issue in the digest repo. Its body is rewritten on every run
// (an edit notifies nobody); a comment that publishes it is the ping. Every item
// names its repo with a full reference, so links resolve from here.
export function buildDigest({ repo, issue, since }: DigestState, plan: DigestPlan): BuiltDigest {
  const { repos, review, unstick, decide, afterMerge, triage, inProgress, queue, notPicked, merged, unblocksOf } =
    plan;
  const line = (x: Item, ask?: string) => {
    const unblocks = ask ? (unblocksOf.get(x.ref) ?? []) : [];
    const why = [x.why, ...(unblocks.length ? [`unblocks ${unblocks.join(", ")}`] : [])]
      .filter(Boolean)
      .join("; ");
    return `- ${ask ? `[ ] **${ask}** ` : ""}[${x.ref}](${x.url}) ${x.title}${why ? ` (${why})` : ""}`;
  };
  const section = (h: string, xs: Item[], ask?: string) =>
    xs.length ? [`## ${h}`, "", ...xs.map((x) => line(x, x.ask ?? ask)), ""] : [];
  // PRs first: they are finished work, and go stale while they wait.
  const asks = [
    ...section("Review", review, "Review:"),
    ...section("Unstick", unstick, "Unstick:"),
    // Questions first: an answer is real work, a go-ahead is a glance.
    ...section(
      `Waiting on you (answer a question, or reply \`ready\` naming items to add \`${READY}\`)`,
      [
        ...decide.map((x) => ({ ...x, ask: "Decide:" })),
        ...afterMerge.map((x) => ({ ...x, ask: "After merge:" })),
        ...triage.map((x) => ({ ...x, ask: "Go ahead?" })),
      ],
    ),
  ];
  // Issues that wait on another issue, or a decision
  // would repeat in every digest, so they are only counted.
  const waiting = notPicked.filter((x) => x.waiting);
  const info = [
    ...section("In progress", inProgress),
    ...section("Queue (dispatched next, newest first)", queue),
    ...section("Not picked up", notPicked.filter((x) => !x.waiting)),
    ...(waiting.length
      ? [
          `<details><summary>${waiting.length} items waiting on a blocker or a decision</summary>`,
          "",
          ...waiting.map((x) => line(x)),
          "",
          "</details>",
          "",
        ]
      : []),
  ];
  const render = (start: string, mergedLines: string[]) =>
    `<!-- digest-since: ${start} -->\n<!-- digest-run: ${plan.now} -->\n<!-- digest-repos: ${repos.map((r) => r.repo).join(" ")} -->\n\n${NOTE}${
      [...asks, ...info].join("\n") || "Nothing is waiting on the maintainer.\n"
    }\nRepos covered: ${repos.map((r) => r.repo).join(", ")}.\n${
      mergedLines.length
        ? `\n<details><summary>${mergedLines.length} merged since ${start.slice(0, 10)}</summary>\n\n${mergedLines.join("\n")}\n\n</details>\n`
        : ""
    }`.trim() + FOOTER;
  const body = render(since, merged);
  // A quiet cycle (nothing merged, nothing to act on) is not published.
  const publish =
    !plan.followupsOnly &&
    !!issue &&
    (+plan.today - +new Date(since)) / 864e5 >= DIGEST_DAYS &&
    DIGEST_WEEKDAYS.includes(new Date(plan.now).getUTCDay()) &&
    (merged.length > 0 || asks.length > 0);
  // Maintainer replies on the digest not yet copied onto their issues.
  const cs = issue ? all<GhComment>(`repos/${repo}/issues/${issue.number}/comments?per_page=100`) : [];
  const relayedAt = cs.findLast((c) => marked(c, RELAYED))?.created_at ?? "";
  const replies = cs
    .filter((c) => c.created_at > relayedAt && c.user.type !== "Bot" && !AGENT.test(c.body))
    .map((c) => ({ digest: issue!.number, url: c.html_url, author: c.user.login, body: c.body }));
  return {
    body,
    publish,
    replies,
    counts: {
      decide: decide.length,
      afterMerge: afterMerge.length,
      review: review.length,
      unstick: unstick.length,
      triage: triage.length,
      inProgress: inProgress.length,
      queue: queue.length,
      notPicked: notPicked.length,
      merged: merged.length,
    },
    // The counts line and the snapshot, with the note naming where to answer.
    publishedComment: `${PUBLISHED}\nPublished: ${review.length} to review, ${unstick.length} to unstick, ${decide.length} to decide, ${merged.length} merged.\n\n${body.replace(NOTE, `_${ANSWER}_\n\n`)}`,
  };
}

// Under --apply: create the issue if missing, close any older digest issues into it,
// rewrite its body and, when due, post the published comment. Returns the issue
// number and the comment's url (null when none was posted).
export function writeDigest(
  { repo, issue, older }: DigestState,
  built: BuiltDigest,
): { issue: number; publishedComment: string | null } {
  const n: number = issue?.number ?? JSON.parse(post(`repos/${repo}/issues`, { title: DIGEST_TITLE, body: built.body })).number;
  const edit = {
    ...(issue && issue.title !== DIGEST_TITLE && { title: DIGEST_TITLE }),
    ...(issue && issue.body !== built.body && { body: built.body }),
  };
  if (Object.keys(edit).length) post(`repos/${repo}/issues/${n}`, edit, "PATCH");
  // A pause on an older digest carries over, so closing it doesn't resume the workshop.
  const paused = [issue, ...older].some((i) => i && names(i).includes(PAUSE_LABEL));
  if (paused && older.length) post(`repos/${repo}/issues/${n}/labels`, { labels: [PAUSE_LABEL] });
  for (const o of older) {
    post(`repos/${repo}/issues/${o.number}/comments`, { body: `Merged into #${n}, the one digest issue.${FOOTER}` });
    post(`repos/${repo}/issues/${o.number}`, { state: "closed", state_reason: "completed" }, "PATCH");
  }
  if (!built.publish) return { issue: n, publishedComment: null };
  // An edit notifies nobody; this comment is the ping.
  const c = JSON.parse(post(`repos/${repo}/issues/${n}/comments`, { body: built.publishedComment }));
  return { issue: n, publishedComment: c.html_url ?? null };
}
