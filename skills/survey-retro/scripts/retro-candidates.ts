#!/usr/bin/env node
// Lists one repo's agent-session PRs created since a date with the signals that they
// went badly, worst first, each mapped to the session that wrote it. Step 1 of
// ../SKILL.md. The PRs come from ../../_shared/sessions.ts, which the surveys chooser
// also counts as retro's activity.
// Usage: node retro-candidates.ts --repo owner/repo --since YYYY-MM-DD
import { arg, main } from "../../_shared/cli.ts";
import { pages } from "../../_shared/github.ts";
import { NOT_RUN } from "../../_shared/markers.ts";
import { sessionPrs } from "../../_shared/sessions.ts";

const fixes = (body: string) =>
  [...body.matchAll(/(?:fix|fixes|close|closes|resolves)\s+#(\d+)/gi)].map((m) => m[1]);

main(() => {
  const repo = arg("--repo");
  const since = arg("--since");
  if (!repo || !since) throw new Error("usage: --repo owner/repo --since YYYY-MM-DD");
  const prs = sessionPrs(repo, since);
  // A run started once the PR closed (a `closed`-event cleanup job) says nothing about the session.
  const failed = pages<{ head_branch: string; created_at: string }>(
    `repos/${repo}/actions/runs?status=failure&created=>=${since}`,
    (r) => r.workflow_runs,
    () => false,
  );
  const issueCount: Record<string, number> = {};
  for (const p of prs) for (const n of fixes(p.body)) issueCount[n] = (issueCount[n] ?? 0) + 1;
  const reverted = prs.map((p) => p.title.match(/^Revert "(.*)"$/)?.[1]).filter(Boolean);
  const rows = prs
    .map((p) => {
      const s = [];
      if (failed.some((w) => w.head_branch === p.ref && (!p.closedAt || w.created_at < p.closedAt))) s.push("red-ci");
      if (NOT_RUN.test(p.body)) s.push("not-run");
      if (fixes(p.body).some((n) => issueCount[n] > 1) || /follow-?up/i.test(p.title)) s.push("follow-up");
      if (reverted.includes(p.title)) s.push("reverted");
      if (p.abandoned) s.push("abandoned");
      return { ...p, s };
    })
    .sort((a, b) => b.s.length - a.s.length || b.number - a.number);
  console.log(`${rows.length} session PRs created in ${repo} since ${since}`);
  for (const r of rows)
    console.log(`#${r.number}  ${r.session}  ${r.created}  [${r.s.join(",") || "clean"}]  ${r.title}`);
});
