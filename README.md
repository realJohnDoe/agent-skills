# agent-skills

Claude Code skills shared across my repositories, as one plugin in a marketplace at the repo root.

```
/plugin marketplace add realJohnDoe/agent-skills
/plugin install joes-workshop@agent-skills
```

| Skill | What it does |
|---|---|
| [`dependency-maintenance`](skills/dependency-maintenance/SKILL.md) | Finds the dependency decisions Dependabot can't make (majors, replacements, removals, gaps in Dependabot's own coverage) in one repository or several, in any language, files one issue per decision in the repo it belongs to, and publishes a report linking them. |
| [`conventions`](skills/conventions/SKILL.md) | The labels and `## Decision needed` sections the dispatcher reads, and what an agent sets when it files an issue or opens a PR in a workshop repo. Each repo's `CLAUDE.md` points here instead of restating them. |
| [`surveys`](skills/surveys/SKILL.md) | The conventions every survey follows, and the chooser that picks the one (survey, repo) pair to run next across the attached repos, by days since that survey last ran there × activity in its scope since. A repo's own `.claude/skills/survey-*/` are ranked alongside the plugin's. |
| [`survey-retro`](skills/survey-retro/SKILL.md) | Reviews the agent sessions that worked in one repo since its last retro and files the top changes to their environment (checks, review, steering files, tools) that would have stopped them going wrong. |
| [`timetable`](skills/timetable/SKILL.md) | The workshop's one schedule, as a table in git: the `Timetable` routine fires twice a day and runs only this skill, which starts each task due on that tick (dispatcher, survey run, dependency maintenance) with the model its entry names. |
| [`dispatcher`](skills/dispatcher/SKILL.md) | The dispatcher over several repos, started by the timetable: dispatches tier-labelled issues to subagent sessions, follows up on red or conflicting PRs, merges `automerge` PRs, and keeps one shared digest of what waits on the maintainer, with one label to pause and resume it all. It covers every repo attached to the `Timetable` routine. |

A skill holds only what's true for every repo. Each repo's own rules (pins and why, package manager, labels beyond the workshop's) stay in that repo's `CLAUDE.md`/docs, and the skill reads them before it decides anything.
