// The workshop board's data: the dispatcher's plan sorted into stages, one card per
// item. dispatch.ts prints it as `board` (board.json). Pure: the closed-issue
// lookup is dispatch.ts's, passed in as `run.closed`. See GLOSSARY.md for the stages.
import type { Item } from "./lib.ts";

export type Card = {
  repo: string; // owner/name
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  tier?: "haiku" | "sonnet" | "opus";
  check?: "green" | "red" | "pending";
  automerge?: boolean;
  needsReview?: boolean; // green, quiet, no automerge
  sub?: "decide" | "goAhead" | "blocked";
  prs?: number[]; // every PR linked to an issue card
  reason: string; // the dispatcher's one-line why
};
export type Parked = { repo: string; number: number; title: string; url: string; reason: string };
export type Board = {
  generated: string; // ISO time of the run
  repos: string[]; // owner/name of every repo covered
  digest: string; // URL of the current digest issue
  cantPush: { repo: string; reason: string }[]; // repos it can't push to: a banner, not a card
  state: "normal" | "paused";
  paused?: { since: string; snapshot: string }; // set only when paused: date, snapshot comment URL
  stages: {
    stuck: Card[];
    waiting: { cards: Card[]; parked: Parked[] }; // parked: a collapsed fold, not a stage of its own
    queue: Card[];
    prInProgress: Card[];
    afterMerge: Card[];
    closed: Card[];
  };
};

/** The plan's lists. Follow-up sessions' PRs sit in `inProgress`; dispatched issues and `merged` have no stage. */
export type BoardPlan = { cantPush: Board["cantPush"] } & Record<
  "review" | "unstick" | "decide" | "afterMerge" | "triage" | "inProgress" | "queue" | "notPicked" | "automerge",
  Item[]
>;
export type BoardRun = Pick<Board, "generated" | "repos" | "digest"> & { closed: Card[] };

const card = (x: Item, reason: string, extra: Partial<Card> = {}): Card => ({
  repo: x.repo,
  kind: x.kind ?? "issue",
  number: (x.pr ?? x.issue)!,
  title: x.title,
  url: x.url,
  ...(x.tier && { tier: x.tier }),
  ...(x.check && { check: x.check }),
  ...(x.automerge && { automerge: true }),
  ...(x.sub && { sub: x.sub }),
  ...(x.linkedPrs?.length && { prs: x.linkedPrs }),
  reason,
  ...extra,
});

// Needs review first, then red, then pending, then the rest (automerge).
const prRank = (c: Card) => (c.needsReview ? 0 : c.check === "red" ? 1 : c.check === "pending" ? 2 : 3);

export const buildBoard = (plan: BoardPlan, run: BoardRun): Board => {
  const why = (fallback: string) => (x: Item) => card(x, x.why ?? fallback);
  const blocked = (x: Item) => x.sub === "blocked";
  const prs = (xs: Item[]) => xs.filter((x) => x.kind === "pr");
  return {
    generated: run.generated,
    repos: run.repos,
    digest: run.digest,
    cantPush: plan.cantPush,
    state: "normal",
    stages: {
      stuck: plan.unstick.map(why("stuck")),
      waiting: {
        cards: [
          ...plan.decide.map((x) => card(x, x.why ?? "needs a decision", { sub: "decide" })),
          ...plan.triage.map((x) => card(x, "waiting for your go-ahead", { sub: "goAhead" })),
          ...plan.notPicked.filter(blocked).map(why("blocked")),
        ],
        parked: plan.notPicked
          .filter((x) => !blocked(x))
          .map((x) => ({ repo: x.repo, number: x.issue!, title: x.title, url: x.url, reason: x.why ?? "" })),
      },
      queue: plan.queue.map(why("dispatched next")),
      prInProgress: [
        ...plan.review.map((x) => card(x, x.why ?? "green; waiting for your review", { needsReview: true })),
        ...prs(plan.inProgress).map(why("in progress")),
        ...plan.automerge.map((x) => card(x, "green; merged by the dispatcher")),
      ]
        .map((c, i) => ({ c, i }))
        .sort((a, b) => prRank(a.c) - prRank(b.c) || a.i - b.i)
        .map(({ c }) => c),
      afterMerge: plan.afterMerge.map(why("after merge")),
      closed: run.closed,
    },
  };
};
