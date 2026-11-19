// The workshop board's data: the dispatcher's plan sorted into stages, one card per
// item. dispatch.ts prints it as `board` (board.json). Pure: the closed-issue
// lookup is snapshot.ts's `fetchClosed`, passed in as `run.closed`. See GLOSSARY.md for the stages.
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
  sub?: "decide" | "afterMerge" | "goAhead" | "blocked";
  prs?: number[]; // every PR linked to an issue card
  reason: string; // the dispatcher's one-line why
};
export type Parked = { repo: string; number: number; title: string; url: string; reason: string };
export type Board = {
  generated: string; // ISO time it was built: a dispatcher run or the board workflow
  lastRun?: string; // ISO time of the last dispatcher run, from the digest's marker
  repos: string[]; // owner/name of every repo covered
  digest: string; // URL of the current digest issue
  state: "normal" | "paused";
  paused?: { since: string; snapshot: string }; // set only when paused: date, snapshot comment URL
  stages: {
    stuck: Card[];
    waiting: { cards: Card[]; parked: Parked[] }; // Waiting for human. parked: a collapsed fold, not a stage of its own
    queue: Card[];
    prInProgress: Card[];
    closed: Card[];
    behind: Card[]; // Behind another issue: issues blocked by another open issue
  };
};

/** The plan's lists. Follow-up sessions' PRs sit in `inProgress`; dispatched issues and `merged` have no stage. */
export type BoardPlan = Record<
  "review" | "unstick" | "decide" | "afterMerge" | "triage" | "inProgress" | "queue" | "notPicked" | "automerge",
  Item[]
>;
export type BoardRun = Pick<Board, "generated" | "repos" | "digest" | "lastRun"> & { closed: Card[] };

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

// Red first, then pending, then the rest (automerge).
const prRank = (c: Card) => (c.check === "red" ? 0 : c.check === "pending" ? 1 : 2);

export const buildBoard = (plan: BoardPlan, run: BoardRun): Board => {
  const why = (fallback: string) => (x: Item) => card(x, x.why ?? fallback);
  const blocked = (x: Item) => x.sub === "blocked";
  const prs = (xs: Item[]) => xs.filter((x) => x.kind === "pr");
  return {
    generated: run.generated,
    repos: run.repos,
    digest: run.digest,
    ...(run.lastRun && { lastRun: run.lastRun }),
    state: "normal",
    stages: {
      stuck: plan.unstick.map(why("stuck")),
      waiting: {
        cards: [
          ...plan.afterMerge.map((x) => card(x, x.why ?? "after merge", { sub: "afterMerge" })),
          ...plan.review.map((x) => card(x, x.why ?? "green; waiting for your review", { needsReview: true })),
          ...plan.triage.map((x) => card(x, "waiting for your go-ahead", { sub: "goAhead" })),
          ...plan.decide.map((x) => card(x, x.why ?? "needs a decision", { sub: "decide" })),
        ],
        parked: plan.notPicked
          .filter((x) => !blocked(x))
          .map((x) => ({ repo: x.repo, number: x.issue!, title: x.title, url: x.url, reason: x.why ?? "" })),
      },
      queue: plan.queue.map(why("dispatched next")),
      prInProgress: [
        ...prs(plan.inProgress).map(why("in progress")),
        ...plan.automerge.map((x) => card(x, "green; merged by the dispatcher")),
      ]
        .map((c, i) => ({ c, i }))
        .sort((a, b) => prRank(a.c) - prRank(b.c) || a.i - b.i)
        .map(({ c }) => c),
      closed: run.closed,
      behind: plan.notPicked.filter(blocked).map(why("blocked")),
    },
  };
};

// Output only: the dispatcher writes this label to mirror the Waiting for human stage on
// GitHub, and nothing reads it back. decide.ts must never look at it (decide.test.ts pins that).
export const WAITING_LABEL = "waiting-for-human";

export type LabelSync = { repo: string; add: number[]; remove: number[] };

/**
 * The label writes that make `WAITING_LABEL` sit on exactly the Waiting for human cards
 * (not the parked fold), per repo. `labelled` is every issue or PR in a covered repo that
 * has the label now, open or closed: a closed one loses it. Repos with nothing to do are left out.
 */
export const labelSync = (board: Board, labelled: { repo: string; number: number }[]): LabelSync[] => {
  const key = (x: { repo: string; number: number }) => `${x.repo.toLowerCase()}#${x.number}`;
  const want = new Map(board.stages.waiting.cards.map((c) => [key(c), c]));
  const have = new Set(labelled.map(key));
  const numbers = (xs: { number: number }[]) => [...new Set(xs.map((x) => x.number))].sort((a, b) => a - b);
  return board.repos
    .map((repo) => ({
      repo,
      add: numbers([...want.values()].filter((c) => c.repo === repo && !have.has(key(c)))),
      remove: numbers(labelled.filter((x) => x.repo === repo && !want.has(key(x)))),
    }))
    .filter((s) => s.add.length || s.remove.length);
};
