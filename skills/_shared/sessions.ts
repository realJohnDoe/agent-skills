// The PRs agent sessions opened in a repo: the retro survey reviews them, and the
// surveys chooser counts them as the retro's activity.
import { api, pages } from "./github.ts";

type Pr = { number: number; title: string; body: string; ref: string; abandoned: boolean; created: string; closedAt: string | null };

const SESSION = /session_[A-Za-z0-9]{20,}/;

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
        closedAt: p.closed_at,
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
