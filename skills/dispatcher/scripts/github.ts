// The parts of the `gh api` responses the scripts read, as narrow interfaces
// rather than GitHub's full types.
type Label = string | { name: string };
type User = { login: string; type: string };

export type GhIssue = {
  number: number;
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
