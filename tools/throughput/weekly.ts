// The pure part of the throughput report: reading line counts out of `git log`, and
// binning merged PRs into weeks stacked by repo. No I/O, so the tests cover it directly.

export type Pr = { repo: string; number: number; title: string; mergedAt: string };
export type Lines = { added: number; deleted: number };

const DAY = 864e5;
const day = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// The Monday on or before a date: the report's weeks start on Mondays.
export const mondayOf = (iso: string) => {
  const t = day(iso);
  return isoDay(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
};

// Inclusive date ranges of at most one calendar month each, from `since` to `until`.
// Search returns at most 1,000 results per query, so the caller searches each range
// separately and splits one further when it is still too big.
export const months = (since: string, until: string): [string, string][] => {
  const out: [string, string][] = [];
  for (let start = since; start <= until; ) {
    const d = new Date(day(start));
    const next = isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const end = isoDay(Math.min(day(next) - DAY, day(until)));
    out.push([start, end]);
    start = next;
  }
  return out;
};
export const halve = ([a, b]: [string, string]): [string, string][] => {
  const mid = isoDay(day(a) + Math.floor((day(b) - day(a)) / DAY / 2) * DAY);
  return [[a, mid], [isoDay(day(mid) + DAY), b]];
};

// Lines per PR number, from `git log --first-parent -m --format=@@%s --shortstat` on the
// default branch. A squash merge's subject ends in "(#123)"; a merge commit's starts
// "Merge pull request #123". Commits that name no PR are skipped.
export const parseLog = (log: string): Map<number, Lines> => {
  const out = new Map<number, Lines>();
  let pr: number | null = null;
  for (const raw of log.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("@@")) {
      const m = line.match(/\(#(\d+)\)\s*$/) ?? line.match(/^@@Merge pull request #(\d+)\b/);
      pr = m ? Number(m[1]) : null;
    } else if (pr !== null && /\bchanged\b/.test(line)) {
      // The newest commit naming a PR wins: a revert or re-merge comes later in time
      // but earlier in the log, so keep the first one seen.
      if (!out.has(pr))
        out.set(pr, {
          added: Number(line.match(/(\d+) insertion/)?.[1] ?? 0),
          deleted: Number(line.match(/(\d+) deletion/)?.[1] ?? 0),
        });
      pr = null;
    }
  }
  return out;
};

// Lower edges of the PR size histogram's bins, in lines added; the last bin is open-ended.
// They widen as sizes grow, since PR sizes span several orders of magnitude.
export const SIZE_BINS = [0, 10, 50, 100, 250, 500, 1000, 2500];

export type Report = {
  since: string;
  until: string;
  weeks: string[];
  series: string[]; // repo names, biggest first, then "Other" when any are folded
  otherRepos: string[];
  prs: Record<string, number[]>;
  adds: Record<string, number[]>;
  totals: { prs: number; added: number; deleted: number; repos: number };
  missing: Record<string, number>; // PRs with no matching commit, per repo
  excluded: { repo: string; number: number; title: string; added: number }[];
  // PRs per size bin (lines added), stacked by series like the weekly charts. Only PRs
  // with lines and not excluded count, so it sums to the PRs the lines chart covers.
  sizes: { bins: number[]; prs: Record<string, number[]> };
};

// Bins PRs into Monday weeks and folds every repo past the `top` busiest into "Other",
// since more than eight series can't be told apart by color.
export const build = (
  prs: Pr[],
  lines: (pr: Pr) => Lines | undefined,
  opts: { since: string; until: string; top: number; excluded: (pr: Pr) => boolean },
): Report => {
  const first = mondayOf(opts.since);
  const weeks: string[] = [];
  for (let t = day(first); t <= day(opts.until); t += 7 * DAY) weeks.push(isoDay(t));
  const name = (pr: Pr) => pr.repo.split("/")[1];
  const count = new Map<string, number>();
  for (const pr of prs) count.set(name(pr), (count.get(name(pr)) ?? 0) + 1);
  const ranked = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b));
  // Folding a single repo into "Other" would only rename it.
  const keep = ranked.length > opts.top + 1 ? ranked.slice(0, opts.top) : ranked;
  const otherRepos = ranked.filter((r) => !keep.includes(r));
  const series = otherRepos.length ? [...keep, "Other"] : keep;
  const zero = () => Object.fromEntries(series.map((s) => [s, weeks.map(() => 0)]));
  const r: Report = {
    since: opts.since,
    until: opts.until,
    weeks,
    series,
    otherRepos,
    prs: zero(),
    adds: zero(),
    totals: { prs: 0, added: 0, deleted: 0, repos: ranked.length },
    missing: {},
    excluded: [],
    sizes: { bins: SIZE_BINS, prs: Object.fromEntries(series.map((s) => [s, SIZE_BINS.map(() => 0)])) },
  };
  for (const pr of prs) {
    const s = keep.includes(name(pr)) ? name(pr) : "Other";
    const w = Math.floor((day(pr.mergedAt) - day(first)) / (7 * DAY));
    if (w < 0 || w >= weeks.length) continue;
    r.prs[s][w]++;
    r.totals.prs++;
    const l = lines(pr);
    if (!l) {
      r.missing[name(pr)] = (r.missing[name(pr)] ?? 0) + 1;
    } else if (opts.excluded(pr)) {
      r.excluded.push({ repo: name(pr), number: pr.number, title: pr.title, added: l.added });
    } else {
      r.adds[s][w] += l.added;
      r.totals.added += l.added;
      r.totals.deleted += l.deleted;
      r.sizes.prs[s][SIZE_BINS.findLastIndex((lo) => l.added >= lo)]++;
    }
  }
  return r;
};
