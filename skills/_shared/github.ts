// `gh api` calls, and the parts of their responses the scripts read, as narrow
// interfaces rather than GitHub's full types.
import { run } from "./cli.ts";

export const api = <T = any>(path: string, ...rest: string[]): T =>
  JSON.parse(run("gh", ["api", path, ...rest]) || "null");
// --paginate --slurp yields one array per page.
export const all = <T = any>(path: string): T[] =>
  api<T[][]>(path, "--paginate", "--slurp").flat();
export const post = (path: string, body: unknown, method = "POST") =>
  run("gh", ["api", "-X", method, path, "--input", "-"], JSON.stringify(body));
export const names = (x: { labels: (string | { name: string })[] }): string[] =>
  x.labels.map((l) => (typeof l === "string" ? l : l.name));

// Pages by hand, newest first, stopping at the first page that reaches past `done`.
export const pages = <T>(path: string, pick: (page: any) => T[], done: (last: T) => boolean) => {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const batch = pick(api(`${path}&per_page=100&page=${page}`));
    out.push(...batch);
    if (batch.length < 100 || done(batch.at(-1)!)) return out;
  }
};

type Label = string | { name: string };
type User = { login: string; type: string };

export type GhIssue = {
  number: number;
  state?: string;
  repository_url?: string;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  labels: Label[];
  assignees: { login: string }[];
  comments: number;
  pull_request?: unknown;
  sub_issues_summary?: { total: number };
  issue_dependencies_summary?: { blocked_by: number };
};

export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  draft: boolean;
  merged_at?: string | null;
  labels: Label[];
  user: { login: string };
  auto_merge: unknown;
  head: { sha: string; ref: string; label: string };
};

export type GhComment = {
  body: string;
  created_at: string;
  html_url: string;
  user: User;
};

export type GhReview = {
  body: string | null;
  state: string;
  submitted_at: string;
  html_url: string;
  user: User;
};

export type GhCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
};
export type GhCheckRuns = { check_runs: GhCheckRun[] };
export type GhSearch = { items: GhPull[] };
