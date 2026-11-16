#!/usr/bin/env node
// Lists one repo's agent-session PRs created since a date with the signals that they
// went badly, worst first, each mapped to the session that wrote it. Step 1 of
// ../SKILL.md. The surveys chooser counts the same PRs as retro's activity.
// Usage: node retro-candidates.ts --repo owner/repo --since YYYY-MM-DD
import { fileURLToPath } from "node:url";
import { api, arg, main } from "../../dispatcher/scripts/lib.ts";

type Pr = { number: number; title: string; body: string; ref: string; abandoned: boolean; created: string };

const SESSION = /session_[A-Za-z0-9]{20,}/;

// Pages by hand, newest first, stopping at the first page that reaches past `done`.
const pages = <T>(path: string, pick: (page: any) => T[], done: (last: T) => boolean) => {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const batch = pick(api(`${path}&per_page=100&page=${page}`));
    out.push(...batch);
    if (batch.length < 100 || done(batch.at(-1)!)) return out;
  }
};

/**
 * The PRs created in `repo` since `since` that name an agent session, with that session:
 * the `session_…` link in the PR body, else a commit's `Claude-Session:` trailer.
 */
export const sessionPrs = (repo: string, since: string) =>
  pages<Pr>(
    `repos/${repo}/pulls?state=all&sort=created&direction=desc`,
    (ps: any[]) =>
      ps.map((p) => ({
        number: p.number,
        title: p.title,
        body: p.body ?? "",
        ref: p.head.ref,
        abandoned: p.state === "closed" && !p.merged_at,
        created: p.created_at.slice(0, 10),
      })),
    (p) => p.created < since,
  )
    .filter((p) => p.created >= since)
    .map((p) => ({
      ...p,
      session:
        p.body.match(SESSION)?.[0] ??
        api<{ commit: { message: string } }[]>(`repos/${repo}/pulls/${p.number}/commits`)
          .map((c) => c.commit.message)
          .join("\n")
          .match(SESSION)?.[0],
    }))
    .filter((p) => p.session);

const NOT_RUN = /\b(did not|didn't|not) (run|re-?run|re-?measured?|verified|tested)\b|\bunverified\b/i;
const fixes = (body: string) =>
  [...body.matchAll(/(?:fix|fixes|close|closes|resolves)\s+#(\d+)/gi)].map((m) => m[1]);

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(() => {
    const repo = arg("--repo");
    const since = arg("--since");
    if (!repo || !since) throw new Error("usage: --repo owner/repo --since YYYY-MM-DD");
    const prs = sessionPrs(repo, since);
    const red = new Set(
      pages<string>(
        `repos/${repo}/actions/runs?status=failure&created=>=${since}`,
        (r) => r.workflow_runs.map((w: { head_branch: string }) => w.head_branch),
        () => false,
      ),
    );
    const issueCount: Record<string, number> = {};
    for (const p of prs) for (const n of fixes(p.body)) issueCount[n] = (issueCount[n] ?? 0) + 1;
    const reverted = prs.map((p) => p.title.match(/^Revert "(.*)"$/)?.[1]).filter(Boolean);
    const rows = prs
      .map((p) => {
        const s = [];
        if (red.has(p.ref)) s.push("red-ci");
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
