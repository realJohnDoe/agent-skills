# agent-skills

Claude Code skills shared across my repositories, as one plugin in a marketplace at the repo root.

```
/plugin marketplace add realJohnDoe/agent-skills
/plugin install maintenance@agent-skills
```

| Skill | What it does |
|---|---|
| [`dependency-maintenance`](skills/dependency-maintenance/SKILL.md) | Finds the dependency decisions Dependabot can't make (majors, replacements, removals, gaps in Dependabot's own coverage) across every repo attached to the session, files one issue per decision in the repo it belongs to, and publishes a report linking them. |

A skill holds only what's true for every repo. Each repo's own rules (pins and why, package manager, labels) stay in that repo's `CLAUDE.md`/docs, and the skill reads them before it decides anything.
