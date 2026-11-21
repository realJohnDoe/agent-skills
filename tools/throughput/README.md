# Throughput

An HTML report of your merged PRs and the lines they added, per week, stacked by repo: one chart of PR counts, one of lines added. It covers every repo GitHub search finds PRs of yours in. The seven busiest repos get their own color; the rest fold into "Other", since more than eight series can't be told apart.

```
node tools/throughput/throughput.ts --out throughput.html
```

| Option | Default | |
|---|---|---|
| `--since`, `--until` | six months back, today | the window, `YYYY-MM-DD`, both inclusive |
| `--out` | `throughput.html` | where the page goes |
| `--top` | `7` | repos with their own color |
| `--exclude` | none | `owner/repo#N` or `repo#N`, comma-separated: PRs left out of the lines chart (still counted as PRs), such as migrated code or generated data. The page lists each one with its title. |
| `--cache` | `<tmp>/throughput-cache` | the partial clones, reused on later runs |

It needs `gh` signed in and `git`. It prints the totals, the PRs it found no lines for, and the exclusions as JSON. The first run over six months of a busy repo takes several minutes; later runs fetch only what's new.

Check the lines chart before sharing it: one huge bar usually means a bulk PR (vendored or migrated code, a lockfile, generated JSON). Find it in the table view, then rerun with `--exclude`.

## Where the numbers come from

- **PRs:** GitHub search, `is:pr author:@me is:merged`, one query per month. Search returns at most 1,000 results per query, so a busier month is split in half until each part fits. Search allows 30 requests a minute, so the script paces itself.
- **Lines:** search doesn't return line counts, and asking the pulls API for each PR needs access to every repo, so the script reads git history instead. It fetches each repo's default branch back to the window's start into a partial bare clone (commits and trees, no file contents up front), then takes each PR's squash commit (`... (#N)`) or merge commit (`Merge pull request #N`) and counts its insertions against the first parent. For squash merges this matches GitHub's "additions".
- **Missing lines:** a PR merged into another branch has no such commit on the default branch, and a repo `git` can't fetch has none at all. Those PRs still count in the PR chart, and the page says how many there are per repo.

## Developing

`weekly.ts` holds the parsing and binning, and `weekly.test.ts` pins them. `report.html` is the page, with `__DATA__` replaced by the report JSON (`Report` in `weekly.ts`, plus `generated`).
