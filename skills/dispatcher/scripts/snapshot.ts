// Every GitHub read the dispatcher's plan makes, returned as typed data: fetchRepo reads
// one repo into a RepoSnapshot, which plan.ts's planRepo decides on without I/O. (A
// RepoSnapshot lives in memory only; it is not the pause snapshot comment.) The two timing
// reads are here too: `mergeable` read again after a pause, and the wait after a merge.
// See ../SKILL.md.
import type { Repo } from "../../_shared/repos.ts";
import {
  all,
  api,
  type GhCheckRun,
  type GhCheckRuns,
  type GhComment,
  type GhIssue,
  type GhPull,
  type GhReview,
  type GhSearch,
  names,
} from "../../_shared/github.ts";
import { isWorkshopIssue, marked } from "../../_shared/markers.ts";
import { type Blocker, bodyBlockers } from "./bodyBlockers.ts";
import { afterMerge, ciRunning, DISPATCH, referencedIssues, type ResolvedBlocker, tierOf } from "./decide.ts";
import type { Card } from "./board.ts";

export type PrSnapshot = {
  pr: GhPull;
  headDate: string; // the head commit's committer date
  runs: GhCheckRun[];
  mergeable: boolean | null;
  // Read only once there is something to decide (see ciRunning); empty before that.
  comments: GhComment[];
  reviewComments: GhComment[];
  reviews: GhReview[];
};

export type RepoSnapshot = {
  repo: Repo;
  base: string; // the default branch
  issues: GhIssue[]; // open issues, PRs left out
  pulls: GhPull[]; // open PRs, drafts included
  prs: PrSnapshot[]; // the open non-draft PRs, the ones the workshop follows up (a draft is kept out)
  blockers: Map<number, ResolvedBlocker[]>; // each open issue's open blockers, native and named in the body
  // Merged PRs from the newest page of closed ones, read only when an open issue with no
  // open PR has an `## After merge` step.
  closed: GhPull[];
  // Each issue assigned with no open PR (and no sub-issues): when its dispatch marker was left.
  dispatchedAt: Map<number, string | null>;
  labels: string[]; // the repo's label names
};

// Other repos' issues named as blockers, each looked up once per run; one that
// can't be read (unreadable repo, typo) counts as blocking, so a mistake holds work back.
const lookups = new Map<string, "open" | "closed" | "unreadable">();
const lookup = ({ repo, number }: Blocker) => {
  const key = `${repo.toLowerCase()}#${number}`;
  let state = lookups.get(key);
  if (!state) {
    try {
      state = api<{ state: string }>(`repos/${repo}/issues/${number}`).state === "open" ? "open" : "closed";
    } catch {
      state = "unreadable";
    }
    lookups.set(key, state);
  }
  return state;
};

export const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function fetchRepo(r: Repo): RepoSnapshot {
  const { repo } = r;
  const base = api<{ default_branch: string }>(`repos/${repo}`).default_branch;
  const issues = all<GhIssue>(`repos/${repo}/issues?state=open&per_page=100`).filter((i) => !i.pull_request);
  const pulls = all<GhPull>(`repos/${repo}/pulls?state=open&per_page=100`);
  const open = new Set(issues.map((i) => i.number));
  const linked = new Set(pulls.flatMap((p) => referencedIssues(p.body)));
  const sameRepo = (x: string) => x.toLowerCase() === repo.toLowerCase();

  // Open issues an issue waits on: native blocked-by edges, plus the documented
  // fallback of a blocker named in the body while it is open.
  const blockers = new Map(
    issues.map((i) => {
      const native = (i.issue_dependencies_summary?.blocked_by ?? 0) > 0
        ? all<GhIssue>(`repos/${repo}/issues/${i.number}/dependencies/blocked_by?per_page=100`)
            .filter((b) => b.state === "open")
            .map((b) => ({ repo: b.repository_url?.replace(/^.*\/repos\//, "") ?? repo, number: b.number }))
        : [];
      const body = bodyBlockers(i.body, repo).flatMap((b): ResolvedBlocker[] => {
        const s = sameRepo(b.repo) ? (open.has(b.number) ? "open" : "closed") : lookup(b);
        return s === "closed" ? [] : [s === "open" ? b : { ...b, unreadable: true }];
      });
      const seen = new Set<string>();
      return [
        i.number,
        [...native, ...body].filter((b) => {
          const k = `${b.repo.toLowerCase()}#${b.number}`;
          return !seen.has(k) && !!seen.add(k);
        }),
      ];
    }),
  );

  const closed = issues.some((i) => !linked.has(i.number) && afterMerge(i.body))
    ? all<GhPull>(`repos/${repo}/pulls?state=closed&per_page=100`).filter((p) => p.merged_at)
    : [];

  const prs = pulls.filter((p) => !p.draft).map((pr): PrSnapshot => {
    const head = api<{ commit: { committer: { date: string } } }>(`repos/${repo}/commits/${pr.head.sha}`);
    const runs = api<GhCheckRuns>(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs;
    // GitHub computes `mergeable` in the background after the first read that
    // needs it, so a null usually resolves a few seconds later. Read once more.
    const readMergeable = () => api<{ mergeable: boolean | null }>(`repos/${repo}/pulls/${pr.number}`).mergeable;
    let mergeable = readMergeable();
    if (mergeable == null) {
      sleep(3000);
      mergeable = readMergeable();
    }
    const decided = !ciRunning(runs, mergeable);
    return {
      pr,
      headDate: head.commit.committer.date,
      runs,
      mergeable,
      comments: decided ? all<GhComment>(`repos/${repo}/issues/${pr.number}/comments?per_page=100`) : [],
      reviewComments: decided ? all<GhComment>(`repos/${repo}/pulls/${pr.number}/comments?per_page=100`) : [],
      reviews: decided ? all<GhReview>(`repos/${repo}/pulls/${pr.number}/reviews?per_page=100`) : [],
    };
  });

  const dispatchedAt = new Map(
    issues
      .filter((i) => i.assignees.length && !linked.has(i.number) && !isWorkshopIssue(i.title) && !(i.sub_issues_summary?.total ?? 0))
      .map((i) => [
        i.number,
        i.comments
          ? (all<GhComment>(`repos/${repo}/issues/${i.number}/comments?per_page=100`)
              .filter((c) => marked(c, DISPATCH))
              .at(-1)?.created_at ?? null)
          : null,
      ]),
  );

  return {
    repo: r,
    base,
    issues,
    pulls,
    prs,
    blockers,
    closed,
    dispatchedAt,
    labels: all<{ name: string }>(`repos/${repo}/labels?per_page=100`).map((l) => l.name),
  };
}

// The PRs merged in a repo since a date, from the search index: `apply` waits for its
// merges to show here before it reads the repo again.
export function mergedSince(repo: string, since: string) {
  return api<GhSearch>("search/issues", "-X", "GET", "-f", `q=repo:${repo} is:pr is:merged merged:>=${since}`, "-f", "per_page=100");
}

// Every issue closed as completed across the repos (up to the search's 1000), newest
// first, each with the merged PRs that cross-reference it. One paged search, then one
// timeline read per issue that `known` (the live board's Closed cards) doesn't already
// hold: a closed issue's merged PRs don't change, so each board build reads only the
// newly closed ones. The search can't sort by closing time, so it sorts by update and
// this re-sorts by `closed_at`.
export function fetchClosed(repos: Repo[], known: Card[] = []): Card[] {
  const q = `${repos.map((r) => `repo:${r.repo}`).join(" ")} is:issue is:closed reason:completed`;
  const found = api<{ items: (GhIssue & { closed_at: string })[] }[]>(
    "search/issues", "-X", "GET", "-f", `q=${q}`, "-f", "sort=updated", "-f", "per_page=100", "--paginate", "--slurp",
  ).flatMap((page) => page.items);
  const seen = new Map(known.map((c) => [`${c.repo.toLowerCase()}#${c.number}`, c]));
  return found
    .sort((a, b) => b.closed_at.localeCompare(a.closed_at))
    .map((i): Card => {
      const repo = i.repository_url!.replace(/^.*\/repos\//, "");
      // Same closing day as the cached card, so a reopened and closed-again issue is read afresh.
      const cached = seen.get(`${repo.toLowerCase()}#${i.number}`);
      const prs = cached?.reason.startsWith(`closed ${i.closed_at.slice(0, 10)}`)
        ? (cached.prs ?? [])
        : [
            ...new Set(
              all<{ event: string; source?: { issue?: { number: number; pull_request?: { merged_at: string | null } } } }>(
                `repos/${repo}/issues/${i.number}/timeline?per_page=100`,
              )
                .filter((e) => e.event === "cross-referenced" && e.source?.issue?.pull_request?.merged_at)
                .map((e) => e.source!.issue!.number),
            ),
          ];
      return {
        repo,
        kind: "issue",
        number: i.number,
        title: i.title,
        url: i.html_url,
        ...(tierOf(names(i)) && { tier: tierOf(names(i)) as Card["tier"] }),
        ...(prs.length && { prs }),
        reason: `closed ${i.closed_at.slice(0, 10)}${prs.length ? ` by ${prs.map((n) => `${repo}#${n}`).join(", ")}` : ""}`,
      };
    });
}
