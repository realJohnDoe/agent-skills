#!/usr/bin/env node
// The workshop's pause state and its two one-shot transitions, over every
// attached repo at once. See ../SKILL.md (Pausing).
// Usage: node pause.ts --digest owner/repo [--apply] [--today YYYY-MM-DD]
//   [--repos o/r,...] [--checkouts dir]
// Prints {state, plan}. state is normal | drain | paused | resume. Without --apply
// nothing is written; with it, drain/resume carry out the plan and post their marker
// comment last, so a crash is retried and a second firing in the same state does nothing.
import { FAILED, assertNever, isDigest, marked, referencedIssues, openQuestion, READY } from "./decide.ts";
import type { GhCheckRuns, GhIssue, GhPull } from "./github.ts";
import {
  FOOTER,
  PAUSE_LABEL,
  all,
  api,
  arg,
  flag,
  loadConfig,
  main,
  names,
  post,
  preflight,
} from "./lib.ts";
import type { Repo } from "./lib.ts";

const APPLY = flag("--apply");
const TODAY = arg("--today", new Date().toISOString().slice(0, 10));
const SNAPSHOT = "<!-- workshop-snapshot -->";
const RESUMED = "<!-- workshop-resumed -->";
const DRIFT = 100; // a deferred PR this many commits behind its base is closed on resume
const TIERS = ["haiku", "sonnet", "opus", "opus-plan"];
const tiered = (x: GhIssue | GhPull) => names(x).some((l) => TIERS.includes(l));

// normal: nothing to do. drain: the label is on a digest and the snapshot isn't
// posted yet. paused: the snapshot is posted. resume: the label is gone and the
// snapshot has no "resumed" comment after it.
type PauseState = "normal" | "drain" | "paused" | "resume";

type Closing = { pr: number; title: string; why: string; issues: number[] };
type Drain = {
  repo: string;
  base: string;
  defer: { pr: number; title: string; why: string }[];
  unassign: { issue: number; title: string }[];
  decisions: number[];
  head: string;
};
type Resume = { repo: string; base: string; close: Closing[]; undraft: Closing[] };

const ref = (repo: string, n: number) => `${repo}#${n}`;
const list = (xs: string[]) => xs.join(", ") || "none";
const prLine = (p: GhPull, why: string) => ({ pr: p.number, title: p.title, why });
const openOf = (repo: string) => ({
  base: api<{ default_branch: string }>(`repos/${repo}`).default_branch,
  issues: all<GhIssue>(`repos/${repo}/issues?state=open&per_page=100`).filter((i) => !i.pull_request),
  prs: all<GhPull>(`repos/${repo}/pulls?state=open&per_page=100`),
});

// `dispatch.ts --apply --followups-only` ran first: it merged the green PRs
// and gave red ones their last follow-up. Whatever is still red is deferred.
function planDrain({ repo }: Repo): Drain {
  const { issues, prs, base } = openOf(repo);
  const linked = new Set(prs.flatMap((p) => referencedIssues(p.body)));
  const defer: Drain["defer"] = [];
  for (const p of prs.filter((p) => !p.draft)) {
    const issue = referencedIssues(p.body)
      .map((n) => issues.find((i) => i.number === n))
      .find((i) => i && tiered(i));
    if (!issue || [...names(p), ...names(issue)].includes("opus")) continue; // opus PRs stay open for review
    const runs = api<GhCheckRuns>(`repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`).check_runs;
    const red = runs.some((x) => FAILED.includes(x.conclusion ?? ""));
    const conflict = api<{ mergeable: boolean | null }>(`repos/${repo}/pulls/${p.number}`).mergeable === false;
    if (red || conflict) defer.push(prLine(p, conflict ? `conflicts with ${base}` : "CI red"));
  }
  return {
    repo,
    base,
    defer,
    unassign: issues
      .filter((i) => tiered(i) && i.assignees.length && !linked.has(i.number))
      .map((i) => ({ issue: i.number, title: i.title })),
    decisions: issues
      .filter((i) => openQuestion(i.body) && !names(i).includes(READY))
      .map((i) => i.number),
    head: api<{ sha: string }>(`repos/${repo}/commits/${base}`).sha,
  };
}

function planResume({ repo }: Repo): Resume {
  const { prs, base } = openOf(repo);
  const r: Resume = { repo, base, close: [], undraft: [] };
  for (const p of prs.filter((p) => p.draft && names(p).includes("deferred"))) {
    const behind = api<{ behind_by: number }>(`repos/${repo}/compare/${base}...${p.head.label}`).behind_by;
    (behind > DRIFT ? r.close : r.undraft).push({
      ...prLine(p, `${behind} commits behind ${base}`),
      issues: referencedIssues(p.body),
    });
  }
  return r;
}

const drainSnapshot = (plan: Drain[]) =>
  [
    SNAPSHOT,
    `Workshop paused ${TODAY}.`,
    ...plan.map((r) =>
      [
        `**${r.repo}**: ${r.base} at \`${r.head}\`.`,
        `Deferred PRs: ${list(r.defer.map((d) => `${ref(r.repo, d.pr)} (${d.why})`))}.`,
        `Unassigned issues: ${list(r.unassign.map((x) => ref(r.repo, x.issue)))}.`,
        `Open decisions: ${list(r.decisions.map((x) => ref(r.repo, x)))}.`,
      ].join(" "),
    ),
  ].join("\n\n") + FOOTER;

const resumeComment = (plan: Resume[]) =>
  [
    RESUMED,
    `Workshop resumed ${TODAY}.`,
    ...plan.map((r) =>
      [
        `**${r.repo}**:`,
        `Closed (drifted over ${DRIFT} commits, issues go back to the dispatcher): ${list(r.close.map((x) => ref(r.repo, x.pr)))}.`,
        `Back to ready: ${list(r.undraft.map((x) => ref(r.repo, x.pr)))}.`,
      ].join(" "),
    ),
  ].join("\n\n") + FOOTER;

const note = (repo: string, n: number, body: string) =>
  post(`repos/${repo}/issues/${n}/comments`, { body: body + FOOTER });
const unassignAll = (repo: string, n: number) => {
  const as = api<GhIssue>(`repos/${repo}/issues/${n}`).assignees.map((a) => a.login);
  if (as.length) post(`repos/${repo}/issues/${n}/assignees`, { assignees: as }, "DELETE");
};

function applyDrain(r: Drain) {
  for (const d of r.defer) {
    post(`repos/${r.repo}/pulls/${d.pr}/ccr/convert_to_draft`, {});
    post(`repos/${r.repo}/issues/${d.pr}/labels`, { labels: ["deferred"] });
    note(r.repo, d.pr, `Deferred while the workshop is paused: ${d.why}. It resumes on return.`);
  }
  for (const u of r.unassign) unassignAll(r.repo, u.issue);
}

function applyResume(r: Resume) {
  for (const c of r.close) {
    note(r.repo, c.pr, `Closed on resume: ${c.why}. Its issue goes back to the dispatcher.`);
    post(`repos/${r.repo}/pulls/${c.pr}`, { state: "closed" }, "PATCH");
    for (const n of c.issues) unassignAll(r.repo, n);
  }
  for (const c of r.undraft) {
    post(`repos/${r.repo}/pulls/${c.pr}/ccr/ready_for_review`, {});
    post(`repos/${r.repo}/issues/${c.pr}/labels/deferred`, {}, "DELETE");
  }
}

function print(state: PauseState, plan: object | null) {
  console.log(JSON.stringify({ applied: APPLY && !!plan, state, plan }, null, 2));
}

main(() => {
  const { digest: DIGEST, repos } = loadConfig();
  preflight(repos);

  // --- State: the label on either open digest; marker comments on the newest (the draft)
  const digests = all<GhIssue>(`repos/${DIGEST}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && isDigest(i.title))
    .sort((a, b) => a.number - b.number);
  const digest = digests.at(-1);
  if (!digest) return print("normal", null);
  const labelled = digests.find((d) => names(d).includes(PAUSE_LABEL));
  const comments = all<{ body: string; created_at: string }>(
    `repos/${DIGEST}/issues/${digest.number}/comments?per_page=100`,
  );
  const snap = comments.findLast((c) => marked(c, SNAPSHOT));
  const labeledAt = labelled
    ? all<{ event: string; label: { name: string }; created_at: string }>(
        `repos/${DIGEST}/issues/${labelled.number}/events?per_page=100`,
      ).findLast((e) => e.event === "labeled" && e.label.name === PAUSE_LABEL)?.created_at
    : null;
  const resumed =
    snap && comments.some((c) => marked(c, RESUMED) && c.created_at > snap.created_at);
  const state: PauseState = labelled
    ? snap && labeledAt && snap.created_at > labeledAt
      ? "paused"
      : "drain"
    : snap && !resumed
      ? "resume"
      : "normal";

  let marker: string;
  let plan: object;
  switch (state) {
    case "normal":
    case "paused":
      return print(state, null);
    case "drain": {
      const drain = repos.map(planDrain);
      marker = drainSnapshot(drain);
      plan = { repos: drain, snapshot: marker };
      if (APPLY) for (const r of drain) applyDrain(r);
      break;
    }
    case "resume": {
      const resume = repos.map(planResume);
      marker = resumeComment(resume);
      plan = { repos: resume, resumed: marker };
      if (APPLY) for (const r of resume) applyResume(r);
      break;
    }
    default:
      return assertNever(state);
  }
  // The marker goes last, so a crash before it is retried next firing.
  if (APPLY) post(`repos/${DIGEST}/issues/${digest.number}/comments`, { body: marker });
  print(state, plan);
});
