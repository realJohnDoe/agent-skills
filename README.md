# agent-skills

Claude Code skills shared across my repositories, as one plugin in a marketplace at the repo root.

```
/plugin marketplace add realJohnDoe/agent-skills
/plugin install joes-workshop@agent-skills
```

| Skill | What it does |
|---|---|
| [`dependency-maintenance`](skills/dependency-maintenance/SKILL.md) | Finds the dependency decisions Dependabot can't make (majors, replacements, removals, gaps in Dependabot's own coverage) in one repository or several, in any language, files one issue per decision in the repo it belongs to, and publishes a report linking them. |
| [`issue-conventions`](skills/issue-conventions/SKILL.md) | The labels and `## Decision needed` sections the dispatcher reads, and what an agent sets when it files an issue or opens a PR in a workshop repo. Each repo's `CLAUDE.md` points here instead of restating them. |
| [`dispatcher`](skills/dispatcher/SKILL.md) | The daily dispatcher over several repos: dispatches tier-labelled issues to subagent sessions, follows up on red or conflicting PRs, merges `automerge` PRs, and keeps one shared digest of what waits on the maintainer, with one label to pause and resume it all. It covers every repo attached to its scheduled task. |

A skill holds only what's true for every repo. Each repo's own rules (pins and why, package manager, labels beyond the workshop's) stay in that repo's `CLAUDE.md`/docs, and the skill reads them before it decides anything.
