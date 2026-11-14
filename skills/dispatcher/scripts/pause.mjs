#!/usr/bin/env node
// The workshop's pause state and its two one-shot transitions, over every
// attached repo at once. See ../SKILL.md (Pausing).
// Usage: node pause.mjs --digest owner/repo [--apply] [--today YYYY-MM-DD]
//   [--repos o/r,...] [--checkouts dir]
// Prints {state, plan}. state is normal | drain | paused | resume. Without --apply
// nothing is written; with it, drain/resume carry out the plan and post their marker
// comment last, so a crash is retried and a second firing in the same state does nothing.
import { FAILED, isDigest, linkedIssues, marked, openQuestion, READY } from "./decide.mjs";
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
} from "./lib.mjs";

const APPLY = flag("--apply");
const TODAY = arg("--today", new Date().toISOString().slice(0, 10));
const SNAPSHOT = "<!-- workshop-snapshot -->";
const RESUMED = "<!-- workshop-resumed -->";
const DRIFT = 100; // a deferred PR this many commits behind its base is closed on resume
const TIERS = ["haiku", "sonnet", "opus", "opus-plan"];
const tiered = (x) => names(x).some((l) => TIERS.includes(l));

main(() => {
  const { digest: DIGEST, repos } = loadConfig();
  preflight(repos);

  // --- State: the label on either open digest; marker comments on the newest (the draft)
  const digests = all(`repos/${DIGEST}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && isDigest(i.title))
    .sort((a, b) => a.number - b.number);
  const digest = digests.at(-1);
  if (!digest) return print("normal", null);
  const labelled = digests.find((d) => names(d).includes(PAUSE_LABEL));
  const comments = all(`repos/${DIGEST}/issues/${digest.number}/comments?per_page=100`);
  const snap = comments.findLast((c) => marked(c, SNAPSHOT));
  const labeledAt = labelled
    ? all(`repos/${DIGEST}/issues/${labelled.number}/events?per_page=100`).findLast(
        (e) => e.event === "labeled" && e.label.name === PAUSE_LABEL,
      )?.created_at
    : null;
  const resumed =
    snap && comments.some((c) => marked(c, RESUMED) && c.created_at > snap.created_at);
  const state = labelled
    ? snap && snap.created_at > labeledAt
      ? "paused"
      : "drain"
    : snap && !resumed
      ? "resume"
      : "normal";
  if (state === "paused" || state === "normal") return print(state, null);

  // --- Plan, per repo ---------------------------------------------------------
  const ref = (repo, n) => `${repo}#${n}`;
  const list = (xs) => xs.join(", ") || "none";
  const plan = { repos: [] };
  for (const { repo } of repos) {
    const base = api(`repos/${repo}`).default_branch;
    const issues = all(`repos/${repo}/issues?state=open&per_page=100`).filter(
      (i) => !i.pull_request,
    );
    const prs = all(`repos/${repo}/pulls?state=open&per_page=100`);
    const linked = new Set(prs.flatMap((p) => linkedIssues(p.body)));
    const pr_ = (p, why) => ({ pr: p.number, title: p.title, why });
    const r = { repo, base };
    if (state === "drain") {
      // `dispatch.mjs --apply --followups-only` ran first: it merged the green PRs
      // and gave red ones their last follow-up. Whatever is still red is deferred.
      r.defer = [];
      for (const p of prs.filter((p) => !p.draft)) {
        const issue = linkedIssues(p.body)
          .map((n) => issues.find((i) => i.number === n))
          .find((i) => i && tiered(i));
        if (!issue || [...names(p), ...names(issue)].includes("opus")) continue; // opus PRs stay open for review
        const runs = api(`repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`).check_runs;
        const red = runs.some((x) => FAILED.includes(x.conclusion));
        const conflict = api(`repos/${repo}/pulls/${p.number}`).mergeable === false;
        if (red || conflict)
          r.defer.push(pr_(p, conflict ? `conflicts with ${base}` : "CI red"));
      }
      r.unassign = issues
        .filter((i) => tiered(i) && i.assignees.length && !linked.has(i.number))
        .map((i) => ({ issue: i.number, title: i.title }));
      r.decisions = issues
        .filter((i) => openQuestion(i.body) && !names(i).includes(READY))
        .map((i) => i.number);
      r.head = api(`repos/${repo}/commits/${base}`).sha;
    } else {
      r.close = [];
      r.undraft = [];
      for (const p of prs.filter((p) => p.draft && names(p).includes("deferred"))) {
        const behind = api(`repos/${repo}/compare/${base}...${p.head.label}`).behind_by;
        (behind > DRIFT ? r.close : r.undraft).push({
          ...pr_(p, `${behind} commits behind ${base}`),
          issues: linkedIssues(p.body),
        });
      }
    }
    plan.repos.push(r);
  }
  const refs = (r, xs, key) => xs.map((x) => ref(r.repo, x[key] ?? x));
  if (state === "drain")
    plan.snapshot =
      [
        SNAPSHOT,
        `Workshop paused ${TODAY}.`,
        ...plan.repos.map((r) =>
          [
            `**${r.repo}**: ${r.base} at \`${r.head}\`.`,
            `Deferred PRs: ${list(r.defer.map((d) => `${ref(r.repo, d.pr)} (${d.why})`))}.`,
            `Unassigned issues: ${list(refs(r, r.unassign, "issue"))}.`,
            `Open decisions: ${list(refs(r, r.decisions))}.`,
          ].join(" "),
        ),
      ].join("\n\n") + FOOTER;
  else
    plan.resumed =
      [
        RESUMED,
        `Workshop resumed ${TODAY}.`,
        ...plan.repos.map((r) =>
          [
            `**${r.repo}**:`,
            `Closed (drifted over ${DRIFT} commits, issues go back to the dispatcher): ${list(refs(r, r.close, "pr"))}.`,
            `Back to ready: ${list(refs(r, r.undraft, "pr"))}.`,
          ].join(" "),
        ),
      ].join("\n\n") + FOOTER;

  // --- Apply ------------------------------------------------------------------
  if (APPLY) {
    for (const r of plan.repos) {
      const note = (n, body) =>
        post(`repos/${r.repo}/issues/${n}/comments`, { body: body + FOOTER });
      const unassignAll = (n) => {
        const as = api(`repos/${r.repo}/issues/${n}`).assignees.map((a) => a.login);
        if (as.length)
          post(`repos/${r.repo}/issues/${n}/assignees`, { assignees: as }, "DELETE");
      };
      if (state === "drain") {
        for (const d of r.defer) {
          post(`repos/${r.repo}/pulls/${d.pr}/ccr/convert_to_draft`, {});
          post(`repos/${r.repo}/issues/${d.pr}/labels`, { labels: ["deferred"] });
          note(d.pr, `Deferred while the workshop is paused: ${d.why}. It resumes on return.`);
        }
        for (const u of r.unassign) unassignAll(u.issue);
      } else {
        for (const c of r.close) {
          note(c.pr, `Closed on resume: ${c.why}. Its issue goes back to the dispatcher.`);
          post(`repos/${r.repo}/pulls/${c.pr}`, { state: "closed" }, "PATCH");
          for (const n of c.issues) unassignAll(n);
        }
        for (const c of r.undraft) {
          post(`repos/${r.repo}/pulls/${c.pr}/ccr/ready_for_review`, {});
          post(`repos/${r.repo}/issues/${c.pr}/labels/deferred`, {}, "DELETE");
        }
      }
    }
    // The marker goes last, so a crash before it is retried next firing.
    post(`repos/${DIGEST}/issues/${digest.number}/comments`, {
      body: state === "drain" ? plan.snapshot : plan.resumed,
    });
  }
  print(state, plan);
});

function print(state, plan) {
  console.log(JSON.stringify({ applied: APPLY && !!plan, state, plan }, null, 2));
}
