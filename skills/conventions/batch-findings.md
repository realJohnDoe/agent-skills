# Filing a batch of findings

A run that reviews code and files what it finds (a survey, the dependency maintenance pass) files a **parent issue** that records the run and one **sub-issue per finding**. The skill that runs it says where the parent lives, its title and labels, and what its body holds. The parent gets no tier label: it isn't work to dispatch.

## Search first

A re-run mostly re-derives findings that are already open. Search the open parents of earlier runs and their sub-issues, and the repo's open issues for the thing the finding is about. A match gets a comment with the new evidence, not a second issue. Then read the newest *closed* parent's "deliberately not filed" section, which an open-issue search can't see.

## Where

File each finding in the repo whose files the fix changes, even when the parent is elsewhere; a sub-issue may be in another repo. A fix to the workshop's shared files (the dispatcher's prompts, these conventions, the survey skills) goes in the workshop's own repo, the home repo the `dispatcher` skill names.

## Fields

Every finding has these; the running skill adds its own (a category, an impact scale):

- **Title**: short label.
- **Breadth**: the number of **files** affected, from a search (grep/glob) you name; write "est." if you estimated. Where the exposure is a *condition* ("every entry, whenever two tabs are open"), say that instead, still naming the search, including one with **zero** hits where absence is the point.
- **Tier**: per **Choosing a tier** in `SKILL.md`, rated with the Task context present, plus `plan` where the fix spans several PRs.
- **Evidence**: at least one file path plus a short **verbatim quote** from it, grep-safe: one line, or the line range. For a toolchain or registry finding, a config quote plus the command and its output (dated); for a CI failure, the failing step's error line from a job log of this repo (`gh api repos/<owner/repo>/actions/jobs/<id>/logs`), not a sibling repo's.
- **Problem**: one sentence: what is wrong and why it matters.
- **Fix**: one sentence: the concrete change, and the check that shows it's done. Where the run measured something, say how the measurement should read afterwards.
- **Task context**: the specifics **Choosing a tier** lists, verified, with measured numbers dated for re-measuring. For an extraction, state what the moved code depends on *and* what still depends on it, and say you checked both.

## Closing

A finding closes when a PR saying `Fixes #N` merges. Dropping one is a close as `not planned` with a comment saying why; setting one aside is removing `ready-for-agent` plus a comment. At the start of each run, close every open parent of that kind whose sub-issues are all closed, as completed, with a comment linking its findings (`#n` each). Find them with:

```bash
gh api --paginate "repos/<owner/repo>/issues?labels=<label>&state=open&per_page=100" \
  --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>0 and .sub_issues_summary.total==.sub_issues_summary.completed) | .number'
```

A parent with any open sub-issue stays open.
