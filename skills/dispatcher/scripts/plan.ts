// The dispatcher's plan, without I/O: planRepo sorts one repo's RepoSnapshot (from
// snapshot.ts) into what to start, merge and list, and assemble puts every repo's plan
// together into the run: one session cap and the board's lists. A session's
// prompt is written only for the sessions the run starts. See ../SKILL.md.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GhIssue, type GhPull, names } from "../../_shared/github.ts";
import { cantPushRepo, isWorkshopIssue, openQuestion } from "../../_shared/markers.ts";
import {
  afterMerge,
  assertNever,
  AUTOMERGE,
  blockedText,
  ciRunning,
  claimState,
  FAILED,
  issueState,
  prVerdict,
  READY,
  referencedIssues,
  tierOf,
} from "./decide.ts";
import type { Item } from "./lib.ts";
import { type BoardPlan, WAITING_LABEL } from "./board.ts";
import type { RepoSnapshot } from "./snapshot.ts";

export type PlanOptions = {
  today: Date;
  followupsOnly: boolean; // drain: merge and follow up, plan no new dispatch
  maxFollowups: number; // per PR
  staleDays: number; // a claim or follow-up with nothing to show after this is stuck
};

type Candidate = {
  repo: string;
  tier: string | undefined;
  item: Item;
  checkout: string;
  worktree: string;
  created: string;
  title: string;
};
// What a prompt needs beyond the candidate's own fields; not printed.
export type Followup = Candidate & {
  kind: "followup";
  pr: number;
  issue: number | undefined;
  branch: string;
  brief: { url: string; base: string; conflict: boolean; failing: string[]; feedback: string[]; bot: boolean };
};
export type Dispatch = Candidate & { kind: "dispatch"; issue: number; brief: { url: string; base: string; refs: boolean } };
export type Session = (Followup | Dispatch) & { prompt: string };
export type Merge = {
  repo: string;
  pr: number;
  sha: string;
  title: string;
  created: string;
  body: string | null;
  item: Item;
};
export type RepoPlan = {
  repo: string;
  followups: Followup[];
  dispatches: Dispatch[];
  review: Item[];
  unstick: Item[];
  automerge: Merge[];
  inProgress: Item[];
  behind: Item[];
  triage: Item[];
  decide: Item[];
  afterMerge: Item[];
  asks: Item[]; // the other Waiting for human asks: a plan session, a tier label, a hand claim on a ready issue
  missingLabels: string[];
};
type ListKey = Exclude<keyof RepoPlan, "repo" | "missingLabels">;

// Created in each repo on first contact if missing.
export const LABELS: Record<string, string> = {
  haiku: "c5def5",
  sonnet: "0075ca",
  opus: "5319e7",
  plan: "d4c5f9",
  [READY]: "0e8a16",
  [AUTOMERGE]: "0e8a16",
  preview: "1d76db",
  [WAITING_LABEL]: "d93f0b",
};

type Dated = { repo: string; created: string };
const byRepo = (a: Dated, b: Dated) => a.repo.localeCompare(b.repo);
const newestFirst = (a: Dated, b: Dated) => b.created.localeCompare(a.created) || byRepo(a, b);

// Everything one repo contributes to the plan, every item carrying its repo.
export function planRepo(s: RepoSnapshot, opts: PlanOptions): RepoPlan {
  const { repo, name, path } = s.repo;
  const { base, issues, blockers } = s;
  const ref = (n: number) => `${repo}#${n}`;
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const linked = new Set(s.pulls.flatMap((p) => referencedIssues(p.body)));
  const stepIssues = issues.filter((i) => !linked.has(i.number) && afterMerge(i.body));
  const prsFor = (n: number) => s.closed.filter((p) => referencedIssues(p.body).includes(n));
  const item = (x: GhIssue | GhPull, extra: Partial<Item>): Item => ({
    repo,
    ref: ref(x.number),
    url: x.html_url,
    title: x.title,
    kind: "head" in x ? "pr" : "issue",
    tier: tierOf(names(x)) as Item["tier"],
    ...(!("head" in x) && !names(x).includes(READY) && { unready: true }),
    ...extra,
  });
  const worktree = (kind: string, n: number) => join(tmpdir(), "workshop", `${name}-${kind}-${n}`);
  const out: RepoPlan = {
    repo,
    followups: [],
    dispatches: [],
    review: [],
    unstick: [],
    automerge: [],
    inProgress: [],
    behind: [],
    triage: [],
    decide: [],
    afterMerge: [],
    asks: [],
    missingLabels: [],
  };

  // --- PR follow-up ---------------------------------------------------------
  for (const { pr, headDate, runs, mergeable, comments, reviewComments, reviews } of s.prs) {
    const issue = referencedIssues(pr.body)
      .map((n) => byNumber.get(n))
      .find((i) => i && tierOf(names(i)));
    const parentIssue = referencedIssues(pr.body)
      .map((n) => byNumber.get(n))
      .find((i) => i);
    const bot = pr.user.login === "dependabot[bot]";
    // A red bump is undiagnosed and often rooted in a dependency's own change.
    const tier = issue ? tierOf(names(issue)) : bot ? "opus" : "sonnet";
    const finished = runs.length > 0 && runs.every((r) => r.status === "completed");
    const it = item(pr, {
      pr: pr.number,
      created: pr.created_at,
      tier: issue && (tierOf(names(issue)) as Item["tier"]),
      ...(parentIssue && { parent: { number: parentIssue.number, title: parentIssue.title, url: parentIssue.html_url } }),
      automerge: names(pr).includes(AUTOMERGE) || !!pr.auto_merge,
      check:
        mergeable === false || (finished && runs.some((r) => FAILED.includes(r.conclusion ?? "")))
          ? "red"
          : finished
            ? "green"
            : "pending",
    });
    if (ciRunning(runs, mergeable)) {
      out.inProgress.push({ ...it, why: "CI running" });
      continue;
    }
    const v = prVerdict({
      dependabot: bot,
      labels: names(pr),
      autoMerge: !!pr.auto_merge,
      runs,
      mergeable,
      headDate,
      comments,
      reviewComments,
      reviews,
      branch: pr.head.ref,
      body: pr.body,
      base,
      today: opts.today,
      maxFollowups: opts.maxFollowups,
      staleDays: opts.staleDays,
    });
    switch (v.kind) {
      case "wait":
        out.inProgress.push({ ...it, why: v.why });
        break;
      case "review":
        out.review.push(v.why ? { ...it, why: v.why } : it);
        break;
      case "merge":
        out.automerge.push({ repo, pr: pr.number, sha: pr.head.sha, title: pr.title, created: pr.created_at, body: pr.body, item: it });
        break;
      case "unstick":
        out.unstick.push({ ...it, why: v.why });
        break;
      case "followup":
        out.followups.push({
          kind: "followup",
          repo,
          pr: pr.number,
          issue: issue?.number,
          tier,
          item: it,
          branch: pr.head.ref,
          checkout: path,
          worktree: worktree("pr", pr.number),
          created: pr.created_at,
          title: `Follow up ${name}#${pr.number}`,
          brief: {
            url: pr.html_url,
            base,
            conflict: v.conflict,
            failing: v.failing.map((r) => `${r.name}: ${r.html_url}`),
            feedback: v.feedback.map((c) => c.html_url),
            bot,
          },
        });
        break;
      default:
        assertNever(v);
    }
  }

  // --- Dispatch -------------------------------------------------------------
  const doneStep = (i: GhIssue) => {
    const pr = stepIssues.includes(i) ? prsFor(i.number)[0] : undefined;
    return pr && { step: afterMerge(i.body)!, pr: `[${ref(pr.number)}](${pr.html_url})` };
  };
  for (const i of issues) {
    const st = issueState({
      title: i.title,
      labels: names(i),
      assignees: i.assignees.length,
      subIssues: i.sub_issues_summary?.total ?? 0,
      linked: linked.has(i.number),
      blockers: blockers.get(i.number) ?? [],
      question: openQuestion(i.body),
      afterMerge: doneStep(i),
      cantPush: cantPushRepo(i.body),
    });
    switch (st.kind) {
      case "afterMerge":
        out.afterMerge.push(item(i, { issue: i.number, why: `${st.step}; merged in ${st.pr}`, linkedPrs: prsFor(i.number).map((p) => p.number) }));
        break;
      case "dispatchable":
      case "elsewhere":
        break;
      case "cantPush":
        out.unstick.push(item(i, { issue: i.number, why: `can't push to ${st.repo}; give the routine push access, or detach it` }));
        break;
      case "decision":
        out.decide.push(item(i, { issue: i.number, why: st.question, sub: "decide" }));
        break;
      case "awaitingTriage":
        out.triage.push(item(i, { issue: i.number, why: tierOf(names(i)), sub: "goAhead" }));
        break;
      case "blocked":
        out.behind.push(item(i, { issue: i.number, why: blockedText(st.blockers), sub: "blocked" }));
        break;
      case "plan":
        out.asks.push(item(i, { issue: i.number, why: "`plan`; start a plan session", sub: "plan" }));
        break;
      case "untiered":
        out.asks.push(item(i, { issue: i.number, why: "no tier label; add `haiku`, `sonnet` or `opus`", sub: "tier" }));
        break;
      default:
        assertNever(st);
    }
    if (st.kind !== "dispatchable" || opts.followupsOnly) continue;
    out.dispatches.push({
      kind: "dispatch",
      repo,
      issue: i.number,
      tier: tierOf(names(i)),
      checkout: path,
      worktree: worktree("issue", i.number),
      created: i.created_at,
      item: item(i, { issue: i.number }),
      title: `${name}#${i.number} ${i.title}`,
      brief: { url: i.html_url, base, refs: !!afterMerge(i.body) },
    });
  }

  // Claimed by a dispatch, still no PR: stuck. Claimed by hand but ready for an agent: ask.
  for (const i of issues.filter((i) => i.assignees.length && !linked.has(i.number))) {
    if (isWorkshopIssue(i.title) || cantPushRepo(i.body) || (i.sub_issues_summary?.total ?? 0) > 0 || doneStep(i)) continue;
    const at = s.dispatchedAt.get(i.number) ?? null;
    const state = claimState({ ready: names(i).includes(READY), dispatchedAt: at });
    switch (state.kind) {
      case "assigned":
        out.asks.push(
          item(i, {
            issue: i.number,
            why: `assigned to ${i.assignees.map((a) => `@${a.login}`).join(", ")} but ready for an agent; unassign it or remove ${READY}`,
            sub: "assigned",
          }),
        );
        break;
      case "unstick":
        out.unstick.push(item(i, { issue: i.number, why: `dispatched ${at!.slice(0, 10)}, no PR yet; unassign to re-dispatch` }));
        break;
      case "none":
        break;
      default:
        assertNever(state);
    }
  }

  out.missingLabels = Object.keys(LABELS).filter((l) => !s.labels.includes(l));
  return out;
}

export type Run = {
  sessions: Session[];
  notStarted: string[]; // past the session cap
  board: BoardPlan;
};

/**
 * Every repo's plan as one run. `maxSessions` caps the sessions it starts across all
 * repos; without it the run starts none and lists nothing as not started (the end of a
 * run, and the board). `automerge` is the automerge PRs still open after this run's merges.
 */
export function assemble(plans: RepoPlan[], { maxSessions, automerge }: { maxSessions?: number; automerge: Item[] }): Run {
  const pick = <K extends ListKey>(k: K): RepoPlan[K] => plans.flatMap((p) => p[k] as unknown[]) as RepoPlan[K];
  // Follow-ups first: finishing beats starting. Follow-ups go newest PR first and
  // dispatches newest issue first, each across every repo.
  const followups = pick("followups").sort(newestFirst);
  const dispatches = pick("dispatches").sort(newestFirst);
  const cap = maxSessions ?? 0;
  const sessions = [...followups, ...dispatches].slice(0, cap).map((c) => ({ ...c, prompt: prompt(c) }));
  const queue = dispatches.slice(Math.max(0, cap - followups.length)).map((q) => q.item);
  // What the workshop is working on: this run's sessions, PRs waiting on CI or
  // a follow-up, follow-ups past today's cap, and dispatched issues with no PR yet.
  const inProgress = [
    ...sessions.map((s) => ({ ...s.item, why: s.kind === "followup" ? "follow-up" : "dispatched" })),
    ...followups.slice(cap).map((s) => ({ ...s.item, why: "follow-up next run" })),
    ...pick("inProgress"),
  ];
  return {
    sessions,
    notStarted: maxSessions === undefined ? [] : [...followups, ...dispatches].slice(cap).map((s) => `${s.repo}: ${s.title}`),
    board: {
      review: pick("review"),
      decide: pick("decide"),
      afterMerge: pick("afterMerge"),
      triage: pick("triage"),
      inProgress,
      queue,
      behind: pick("behind"),
      asks: pick("asks"),
      unstick: pick("unstick"),
      automerge,
    },
  };
}

// A session's prompt: its own worktree, the work, and how it ends.
export function prompt(c: Followup | Dispatch): string {
  const { repo, checkout: path, worktree: wt } = c;
  const ref = (n: number) => `${repo}#${n}`;
  const end = `When you're done, remove the worktree and the scratch folder: \`git -C ${path} worktree remove ${wt}\` and \`rm -rf ${wt}.scratch\`.`;
  if (c.kind === "followup") {
    const b = c.brief;
    return [
      `PR ${ref(c.pr)} (${b.url}, branch \`${c.branch}\`) ${c.issue ? `for ${ref(c.issue)} ` : ""}needs a narrow fix. Work on that branch and push to it; do not open a new PR.`,
      ...setup(path, wt, [`git -C ${path} fetch origin ${c.branch}`, `git -C ${path} worktree add -B ${c.branch} ${wt} origin/${c.branch}`]),
      ...(b.conflict
        ? [
            `- Merge conflict with ${b.base}: merge or rebase \`${b.base}\` into the branch, resolve the conflicts and push. This is a conflict resolution, not a CI fix; CI runs once it pushes.`,
          ]
        : []),
      ...b.failing.map((r) => `- CI failing: ${r}`),
      ...b.feedback.map((u) => `- Unanswered review feedback: ${u}`),
      `Fix only that. For CI, reproduce the failure first and show the same check passing. Before pushing, run the checks ${repo}'s CLAUDE.md asks for. Reply to each review comment you address.`,
      b.bot
        ? `This is a Dependabot bump: adapt the code or config to the new versions rather than reverting a bump, and leave the PR description as Dependabot wrote it. If a bump can't be adopted narrowly, say why in a PR comment instead of pushing.`
        : `If the repo has a PR template, the PR description must still meet it.`,
      `Do not subscribe to PR activity: the dispatcher checks this PR again on its next run.`,
      end,
    ].join("\n");
  }
  const { url, base, refs } = c.brief;
  const n = c.issue;
  const branch = `claude/issue-${n}`;
  return [
    `Implement ${ref(n)} (${url}), following ${repo}'s CLAUDE.md and the docs it points to.`,
    ...setup(path, wt, [`git -C ${path} fetch origin ${base}`, `git -C ${path} worktree add -b ${branch} ${wt} origin/${base}`]),
    `Push the branch \`${branch}\` and open a PR in ${repo} that says ${refs ? `\`Refs #${n}\`` : `\`Fixes #${n}\`, or \`Refs #${n}\` when the \`conventions\` skill says so`}. If the repo has a PR template, fill it in. Before pushing, run the checks ${repo}'s CLAUDE.md asks for, and give their result in the PR.`,
    c.tier === "opus"
      ? `Don't label the PR \`${AUTOMERGE}\`: it waits for the maintainer's review.`
      : `Label the PR \`${AUTOMERGE}\`: the dispatcher merges it once green.`,
    `Do not subscribe to PR activity: the dispatcher follows up on red CI and review comments.`,
    end,
  ].join("\n");
}

// The lines that put a session in its own worktree of its repo's clone.
function setup(path: string, wt: string, commands: string[]) {
  return [
    `Work only in your own worktree of that repo's clone, never in ${path} itself or the run's working directory. Create it first:`,
    "```",
    ...commands,
    "```",
    `then do everything from \`${wt}\`.`,
    `Put every temporary file (PR description, check logs, JSON, anything else) in your own scratch folder \`${wt}.scratch\`, never directly in /tmp or the run's scratchpad: other sessions share them. Remove it along with the worktree.`,
  ];
}
