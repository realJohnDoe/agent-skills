// The issue the dispatcher files in the digest repo for each attached repo it can't push
// to: one per repo, opened while the problem lasts and closed by the first run that can
// push again. The board shows it as Stuck (decide.ts, `cantPush`). See ../SKILL.md.
import { all, type GhIssue, post } from "../../_shared/github.ts";
import { cantPushMarker, cantPushRepo } from "../../_shared/markers.ts";
import { FOOTER } from "./lib.ts";

export type CantPush = {
  open: { repo: string; reason: string }[]; // repos to file an issue for
  close: { repo: string; number: number }[]; // issues whose repo can be pushed to again, or is detached
};

/** The open can't-push issues in the digest repo, each with the repo it names. */
export const readCantPush = (digest: string) =>
  all<GhIssue>(`repos/${digest}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && cantPushRepo(i.body))
    .map((i) => ({ repo: cantPushRepo(i.body)!, number: i.number }));

/** What to open and close so there is exactly one open issue per repo it can't push to. Pure. */
export const cantPushWrites = (
  existing: { repo: string; number: number }[],
  unpushable: { repo: string; reason: string }[],
): CantPush => {
  const key = (r: string) => r.toLowerCase();
  const filed = new Set(existing.map((e) => key(e.repo)));
  const broken = new Set(unpushable.map((u) => key(u.repo)));
  return {
    open: unpushable.filter((u) => !filed.has(key(u.repo))),
    close: existing.filter((e) => !broken.has(key(e.repo))),
  };
};

export const cantPushBody = ({ repo, reason }: { repo: string; reason: string }) =>
  `${cantPushMarker(repo)}
The workshop ${reason.replace(/^can't push/, "can't push to " + repo)}, so the dispatcher makes no writes there: no labels, merges, sessions or follow-ups.

Give the \`Timetable\` routine push access to [${repo}](https://github.com/${repo}) at https://claude.ai/code/scheduled (if the Claude GitHub App isn't on it, install it at https://github.com/apps/claude/installations/select_target), or detach the repo from the routine. The first dispatcher run that can push to it again closes this issue.${FOOTER}`;

// On `finish`: file and close the issues. Each write on its own: one refused is logged and
// retried on the next run.
export function writeCantPush(digest: string, { open, close }: CantPush) {
  const tryPost = (what: string, path: string, body: unknown, method?: string) => {
    try {
      post(path, body, method);
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      console.error(`${what} refused: ${err.stderr ?? err.message}`);
    }
  };
  for (const u of open)
    tryPost(`can't-push issue for ${u.repo}`, `repos/${digest}/issues`, { title: `Workshop can't push to ${u.repo}`, body: cantPushBody(u) });
  for (const c of close) {
    tryPost(`comment ${digest}#${c.number}`, `repos/${digest}/issues/${c.number}/comments`, {
      body: `The workshop can push to ${c.repo} again, or it is no longer attached.${FOOTER}`,
    });
    tryPost(`close ${digest}#${c.number}`, `repos/${digest}/issues/${c.number}`, { state: "closed", state_reason: "completed" }, "PATCH");
  }
}
