---
name: throughput
description: Build the code throughput report, an HTML page with two weekly stacked bar charts of your merged PRs and the lines they added, one color per repo, over the last six months or any window. Use when asked how much code you shipped, for PR or lines-of-code counts over time, or to refresh or change the throughput report.
---

# Throughput

The report counts every PR you authored that merged in the window, across every repo GitHub search finds, and bins them by the Monday-to-Sunday week they merged in. One chart stacks PR counts by repo, the other stacks lines added. The seven busiest repos get their own color; the rest fold into "Other", since more than eight series can't be told apart.

## The run

```
node <this skill's directory>/scripts/throughput.ts --out throughput.html
```

| Option | Default | |
|---|---|---|
| `--since`, `--until` | six months back, today | the window, `YYYY-MM-DD`, both inclusive |
| `--out` | `throughput.html` | where the page goes |
| `--top` | `7` | repos with their own color |
| `--exclude` | none | `owner/repo#N` or `repo#N`, comma-separated: PRs left out of the lines chart (still counted as PRs), such as migrated code or generated data. The page lists each one with its title. |
| `--cache` | `<tmp>/throughput-cache` | the partial clones, reused on later runs |

It prints the totals, the PRs it found no lines for, and the exclusions as JSON. Publish the page as an Artifact when the user wants to see it. Look at the lines chart first: one huge bar usually means a bulk PR (vendored code, a lockfile, generated JSON). Show the user which PRs those are and ask before excluding them.

## Where the numbers come from

- **PRs:** GitHub search, `is:pr author:@me is:merged`, one query per month. Search returns at most 1,000 results per query, so a busier month is split in half until each part fits. Search allows 30 requests a minute, so a big window takes a minute or two.
- **Lines:** search doesn't return line counts, and the pulls API needs access to each repo, so the script reads git history instead. It fetches each repo's default branch back to the window's start into a partial bare clone (commits and trees, no file contents up front), then takes each PR's squash commit (`... (#N)`) or merge commit (`Merge pull request #N`) and counts its insertions against the first parent. For squash merges this matches GitHub's "additions".
- **Missing lines:** a PR merged into another branch has no such commit on the default branch, and a repo `git` can't fetch has none at all. Those PRs still count in the PR chart, and the page says how many there are per repo.

## Developing

`scripts/weekly.ts` holds the parsing and binning; `scripts/weekly.test.ts` pins them. `scripts/report.html` is the page, with `__DATA__` replaced by the report JSON (`Report` in `weekly.ts`, plus `generated`).
