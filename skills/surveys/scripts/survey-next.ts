#!/usr/bin/env node
// Scores every (survey, repo) pair over the repos attached to the session and names the
// top one: the survey to run next, and where. Read-only; prints JSON. See "Choosing the
// next survey" in ../SKILL.md.
// Usage: node survey-next.ts [--today YYYY-MM-DD] [--checkouts DIR] [--repos a/b,c/d]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openQuestion } from "../../dispatcher/scripts/decide.ts";
import type { GhIssue } from "../../dispatcher/scripts/github.ts";
import { all, arg, attachedRepos, main, names, run } from "../../dispatcher/scripts/lib.ts";
import { sessionPrs } from "../../survey-retro/scripts/retro-candidates.ts";

// The plugin's own skills folder: its survey-* skills run in every repo.
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_OPEN_FINDINGS = 3;

type Survey = { name: string; label: string; scope: string; skill: string };

// The survey-* skills in a skills folder, from their `label` and `scope` frontmatter.
const surveysIn = (dir: string): Survey[] =>
  (existsSync(dir) ? readdirSync(dir) : [])
    .filter((d) => d.startsWith("survey-") && existsSync(join(dir, d, "SKILL.md")))
    .map((name) => {
      const skill = join(dir, name, "SKILL.md");
      const head = readFileSync(skill, "utf8").split("\n---\n")[0];
      const fm = Object.fromEntries([...head.matchAll(/^([\w-]+): (.*)$/gm)].map((m) => [m[1], m[2]]));
      if (!fm.label || !fm.scope) throw new Error(`${skill}: frontmatter needs both label and scope`);
      return { name, label: fm.label, scope: fm.scope, skill };
    });

// Pathspec words; double quotes allow ones with spaces or colons.
const words = (s: string) => [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

// The repo's `## <label> scope` heading in its overlay (see ../SKILL.md), overriding a survey's frontmatter scope.
const overlayScope = (path: string, label: string) => {
  const file = join(path, "docs/agents/survey.md");
  const body = existsSync(file) ? readFileSync(file, "utf8").match(new RegExp(`^## ${label} scope[ \\t]*\\n+([^#\\n][^\\n]*)`, "im")) : null;
  return body?.[1].replaceAll("`", "").trim();
};

main(() => {
  const today = new Date(arg("--today") ?? new Date().toISOString().slice(0, 10));
  const plugin = surveysIn(PLUGIN);
  const pairs = attachedRepos().repos.flatMap(({ repo, path }) => {
    const git = (...a: string[]) => run("git", ["-C", path, ...a]).trim();
    // A shallow clone's history ends at its boundary: dates and counts would be wrong.
    if (git("rev-parse", "--is-shallow-repository") === "true") git("fetch", "--quiet", "--unshallow");
    const firstCommit = git("log", "--max-parents=0", "--format=%cs").split("\n").sort()[0];
    const issues = (q: string) => all<GhIssue>(`repos/${repo}/issues?${q}&per_page=100`).filter((i) => !i.pull_request);
    const openFindings = issues("labels=survey-finding&state=open").length;
    // A survey local to the repo replaces the plugin's survey of the same name.
    const local = surveysIn(join(path, ".claude/skills"));
    const surveys = [...plugin.filter((p) => !local.some((l) => l.name === p.name)), ...local];
    return surveys.map((s) => {
      // A run's parent has the `survey` label, or (filed before that label) sub-issues.
      const runs = issues(`labels=${s.label}&state=all`)
        .filter((i) => names(i).includes("survey") || (i.sub_issues_summary?.total ?? 0) > 0)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const since = runs[0]?.created_at.slice(0, 10) ?? firstCommit;
      const scope = overlayScope(path, s.label) ?? s.scope;
      const activity =
        scope === "sessions"
          ? sessionPrs(repo, since).length
          : git("log", "--first-parent", "-m", `--since=${since}T00:00:00Z`, "--format=%H", "--", ...words(scope))
              .split("\n")
              .filter(Boolean).length;
      const days = Math.round((today.getTime() - new Date(since).getTime()) / 864e5);
      const workable = runs
        .filter((r) => r.state === "open")
        .map((r) => ({
          parent: r.number,
          findings: all<GhIssue>(`repos/${repo}/issues/${r.number}/sub_issues?per_page=100`).filter(
            (f) => f.state === "open" && !names(f).includes("deferred") && !openQuestion(f.body),
          ).length,
        }))
        .find((r) => r.findings > 0);
      const skip = workable
        ? `open run #${workable.parent} has ${workable.findings} finding(s) to work on`
        : openFindings >= MAX_OPEN_FINDINGS
          ? `${openFindings} open survey-finding issues`
          : undefined;
      return {
        repo,
        survey: s.name,
        skill: s.skill,
        lastRun: runs[0] ? `#${runs[0].number}` : `never; counting from the first commit`,
        since,
        days,
        activity,
        score: days * activity,
        ...(skip ? { skip } : {}),
      };
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.repo.localeCompare(b.repo) || a.survey.localeCompare(b.survey));
  const top = pairs.find((p) => !p.skip && p.score > 0) ?? null;
  console.log(JSON.stringify({ today: today.toISOString().slice(0, 10), pairs, top }, null, 1));
});
