// The shared digest: read its state, build its body from the run's plan, write it.
// dispatch.ts calls these. See ../SKILL.md.
import { AGENT, isDigest, marked, READY } from "./decide.ts";
import type { GhComment, GhIssue } from "./github.ts";
import { type Item, type Repo, FOOTER, all, post } from "./lib.ts";

// The digest is published on the first run of these days.
const DIGEST_WEEKDAYS = [2, 5]; // Tue, Fri (UTC getDay)
const DIGEST_DAYS = 2.5; // minimum window, so a second run that day doesn't publish again
const DIGEST_PREFIX = "Workshop digest";
const RELAYED = "<!-- workshop-relayed -->"; // digest replies up to here are copied to their issues

export type DigestState = {
  repo: string;
  draft: GhIssue | undefined;
  published: GhIssue | undefined;
  since: string;
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
  // What the writes need: the published body, and the next draft's body once `published` is known.
  publishedBody: string;
  nextDraft: (prev: number) => string;
};

const ANSWER =
  "Answer on the issue or PR, or reply here naming the item (e.g. `meridian#12`): the next daily run copies replies onto their issues.";
const NOTE = `_The draft digest is rewritten by every daily run and published on Tuesdays and Fridays. ${ANSWER}_\n\n`;

// The shared digest's state, read first: its window bounds "merged since".
export function readDigest(repo: string, today: Date): DigestState {
  const digests = all<GhIssue>(`repos/${repo}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && isDigest(i.title))
    .sort((a, b) => a.number - b.number);
  const isDraft = (i: GhIssue) => i.title.includes("(draft)");
  const draft = digests.findLast(isDraft);
  const published = digests.findLast((i) => !isDraft(i));
  const marker = /<!-- digest-(?:date|since): (\S+) -->/;
  const since =
    (draft ?? published)?.body?.match(marker)?.[1] ??
    new Date(+today - DIGEST_DAYS * 864e5).toISOString().slice(0, 10);
  return { repo, draft, published, since };
}

// One issue per digest cycle, in the digest repo. Its body is rewritten on
// every run (an edit notifies nobody); publishing it is the ping. Every item
// names its repo with a full reference, so links resolve from here.
export function buildDigest({ repo, draft, published, since }: DigestState, plan: DigestPlan): BuiltDigest {
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
  // Issues that wait on another issue, a decision or the maintainer's own
  // `deferred` would repeat in every digest, so they are only counted.
  const waiting = notPicked.filter((x) => x.waiting);
  const info = [
    ...section("In progress", inProgress),
    ...section("Queue (dispatched next, newest first)", queue),
    ...section("Not picked up", notPicked.filter((x) => !x.waiting)),
    ...(waiting.length
      ? [
          `<details><summary>${waiting.length} items waiting on a blocker, a decision or <code>deferred</code></summary>`,
          "",
          ...waiting.map((x) => line(x)),
          "",
          "</details>",
          "",
        ]
      : []),
  ];
  const render = (start: string, mergedLines: string[], prev?: number | null) =>
    `<!-- digest-since: ${start} -->\n\n${NOTE}${
      [...asks, ...info].join("\n") || "Nothing is waiting on the maintainer.\n"
    }\nRepos covered: ${repos.map((r) => r.repo).join(", ")}.\n${prev ? `\nPrevious digest: #${prev}.\n` : ""}${
      mergedLines.length
        ? `\n<details><summary>${mergedLines.length} merged since ${start.slice(0, 10)}</summary>\n\n${mergedLines.join("\n")}\n\n</details>\n`
        : ""
    }`.trim() + FOOTER;
  const body = render(since, merged, published?.number);
  // A quiet cycle (nothing merged, nothing to act on) stays a draft.
  const publish =
    !plan.followupsOnly &&
    !!draft &&
    (+plan.today - +new Date(since)) / 864e5 >= DIGEST_DAYS &&
    DIGEST_WEEKDAYS.includes(new Date(plan.now).getUTCDay()) &&
    (merged.length > 0 || asks.length > 0);
  // Maintainer replies on either digest not yet copied onto their issues.
  const replies = [draft, published].filter((d) => d !== undefined).flatMap((d) => {
    const cs = all<GhComment>(`repos/${repo}/issues/${d.number}/comments?per_page=100`);
    const relayedAt = cs.findLast((c) => marked(c, RELAYED))?.created_at ?? "";
    return cs
      .filter(
        (c) =>
          c.created_at > relayedAt &&
          c.user.type !== "Bot" &&
          !AGENT.test(c.body),
      )
      .map((c) => ({
        digest: d.number,
        url: c.html_url,
        author: c.user.login,
        body: c.body,
      }));
  });
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
    publishedBody: body.replace(NOTE, `_${ANSWER}_\n\n`),
    nextDraft: (prev) => render(plan.now, [], prev),
  };
}

// Under --apply: rewrite the draft and, when due, publish it and open the next
// draft. Returns the draft and published numbers as they stand afterwards.
export function writeDigest(
  { repo, draft, published, since }: DigestState,
  built: BuiltDigest,
  now: string,
): { draft: number; published: number | null } {
  const newDraft = (start: string, b: string) =>
    JSON.parse(
      post(`repos/${repo}/issues`, {
        title: `${DIGEST_PREFIX} (draft) — from ${start.slice(0, 10)}`,
        body: b,
      }),
    ).number;
  const d = draft?.number ?? newDraft(since, built.body);
  if (draft && draft.body !== built.body)
    post(`repos/${repo}/issues/${d}`, { body: built.body }, "PATCH");
  if (!built.publish) return { draft: d, published: published?.number ?? null };
  post(
    `repos/${repo}/issues/${d}`,
    // A published digest is no draft: keep only where to answer.
    { title: `${DIGEST_PREFIX} — ${now.slice(0, 10)}`, body: built.publishedBody },
    "PATCH",
  );
  // A title or body edit notifies nobody; this comment is the ping.
  const { decide: x, review: r, unstick: u, merged: m } = built.counts;
  post(`repos/${repo}/issues/${d}/comments`, {
    body: `Published: ${r} to review, ${u} to unstick, ${x} to decide, ${m} merged.${FOOTER}`,
  });
  if (published) {
    post(`repos/${repo}/issues/${published.number}/comments`, { body: `Superseded by #${d}.${FOOTER}` });
    post(`repos/${repo}/issues/${published.number}`, { state: "closed", state_reason: "completed" }, "PATCH");
  }
  return { draft: newDraft(now, built.nextDraft(d)), published: d };
}
