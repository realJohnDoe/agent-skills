# agent-skills

Claude Code skills shared across my repositories, as one plugin in a marketplace at the repo root.

```
/plugin marketplace add realJohnDoe/agent-skills
/plugin install joes-workshop@agent-skills
```

| Skill | What it does |
|---|---|
| [`dependency-maintenance`](skills/dependency-maintenance/SKILL.md) | Finds the dependency decisions Dependabot can't make (majors, replacements, removals, gaps in Dependabot's own coverage) in one repository or several, in any language, files one issue per decision in the repo it belongs to, and publishes a report linking them. |
| [`dispatcher`](skills/dispatcher/SKILL.md) | The daily dispatcher over several repos: dispatches tier-labelled issues to subagent sessions, follows up on red or conflicting PRs, merges `automerge` PRs, and keeps one shared digest of what waits on the maintainer, with one label to pause and resume it all. Repos are listed in [`workshop.json`](skills/dispatcher/workshop.json). |

A skill holds only what's true for every repo. Each repo's own rules (pins and why, package manager, labels) stay in that repo's `CLAUDE.md`/docs, and the skill reads them before it decides anything.
