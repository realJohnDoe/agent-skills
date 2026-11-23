#!/usr/bin/env node
// Builds the throughput report: your merged PRs per week and the lines they added,
// stacked by repo, as one HTML page. See README.md.
// Usage: node throughput.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--out FILE]
//          [--top N] [--exclude owner/repo#N,...] [--cache DIR]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, main, run } from "../../skills/_shared/cli.ts";
import { api } from "../../skills/_shared/github.ts";
import { build, halve, isoDay, type Lines, months, parseExcludes, parseLog, type Pr } from "./weekly.ts";

const here = dirname(fileURLToPath(import.meta.url));
// The search API allows 30 requests a minute.
const SEARCH_PAUSE_MS = 2100;
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

type Item = { number: number; title: string; repository_url: string; pull_request: { merged_at: string | null } };

// Every PR you authored that merged in [from, to]. A range with more than 1,000 results
// is split, because search returns no more than that per query.
const search = (from: string, to: string): Pr[] => {
  const q = encodeURIComponent(`is:pr author:@me is:merged merged:${from}..${to}`);
  const out: Pr[] = [];
  for (let page = 1; ; page++) {
    sleep(SEARCH_PAUSE_MS);
    const res = api<{ total_count: number; items: Item[] }>(`search/issues?q=${q}&per_page=100&page=${page}`);
    if (page === 1 && res.total_count > 1000) {
      if (from === to) throw new Error(`More than 1,000 PRs merged on ${from}: search can't list them all.`);
      return halve([from, to]).flatMap(([a, b]) => search(a, b));
    }
    for (const it of res.items)
      out.push({
        repo: it.repository_url.split("/").slice(-2).join("/"),
        number: it.number,
        title: it.title,
        mergedAt: it.pull_request.merged_at!,
      });
    if (res.items.length < 100) return out;
  }
};

// Lines per PR in one repo, from its default branch's history since `since`. Keeps a
// partial, shallow bare clone in `cache` and only fetches what's new on later runs.
const repoLines = (repo: string, since: string, cache: string): Map<number, Lines> => {
  const dir = join(cache, repo.replace("/", "__") + ".git");
  const git = (...a: string[]) => run("git", ["-C", dir, ...a]);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    git("init", "--quiet", "--bare");
    git("remote", "add", "origin", `https://github.com/${repo}.git`);
    git("config", "remote.origin.promisor", "true");
    git("config", "remote.origin.partialclonefilter", "blob:none");
  }
  // Two weeks of margin: a PR merged on `since` may have been committed earlier.
  const from = isoDay(Date.parse(since) - 14 * 864e5);
  git("fetch", "--quiet", "--filter=blob:none", `--shallow-since=${from}`, "origin", "HEAD");
  return parseLog(git("log", "--first-parent", "-m", `--since=${from}`, "--format=@@%s", "--shortstat", "FETCH_HEAD"));
};

main(() => {
  const until = arg("--until") ?? isoDay(Date.now());
  const back = new Date(until + "T00:00:00Z");
  back.setUTCMonth(back.getUTCMonth() - 6);
  const since = arg("--since") ?? isoDay(back.getTime());
  const top = Number(arg("--top", 7));
  const out = resolve(arg("--out", "throughput.html"));
  const cache = resolve(arg("--cache") ?? join(tmpdir(), "throughput-cache"));
  // owner/repo#N or repo#N: the checked-in list in exclude.txt, plus any passed for this run.
  const excludes = [
    ...parseExcludes(readFileSync(join(here, "exclude.txt"), "utf8")),
    ...(arg("--exclude") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  ];
  const isExcluded = (pr: Pr) =>
    excludes.includes(`${pr.repo}#${pr.number}`.toLowerCase()) ||
    excludes.includes(`${pr.repo.split("/")[1]}#${pr.number}`.toLowerCase());

  const seen = new Set<string>();
  const prs = months(since, until)
    .flatMap(([a, b]) => search(a, b))
    .filter((pr) => !seen.has(`${pr.repo}#${pr.number}`) && seen.add(`${pr.repo}#${pr.number}`));
  const lines = new Map<string, Map<number, Lines>>();
  for (const repo of new Set(prs.map((p) => p.repo))) {
    try {
      lines.set(repo, repoLines(repo, since, cache));
    } catch (e) {
      // A repo that can't be fetched still counts in the PR chart; its PRs show as missing.
      console.error(`throughput: no line counts for ${repo}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  const report = build(prs, (pr) => lines.get(pr.repo)?.get(pr.number), {
    since,
    until,
    top,
    excluded: isExcluded,
  });
  const unmatched = excludes.filter((x) => !report.excluded.some((e) => x.endsWith(`${e.repo}#${e.number}`.toLowerCase())));
  if (unmatched.length) console.error(`throughput: exclusion matched no merged PR in the window: ${unmatched.join(", ")}`);

  const page = readFileSync(join(here, "report.html"), "utf8").replace(
    "__DATA__",
    () => JSON.stringify({ ...report, generated: isoDay(Date.now()) }),
  );
  writeFileSync(out, page);
  console.log(JSON.stringify({ out, ...report.totals, missing: report.missing, excluded: report.excluded }, null, 2));
});
