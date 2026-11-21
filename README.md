![Robots tending a rooftop garden above a floating city](docs/images/banner.jpg)

# agent-skills

Claude Code skills shared across my repositories, as one plugin (`joes-workshop`) in a marketplace at the repo root. Together they run the **workshop**: scheduled runs that work through issues in several repos, follow up on their PRs and merge them, and report to one maintainer. See [`GLOSSARY.md`](GLOSSARY.md) for the terms.

**[Workshop board](https://realjohndoe.github.io/agent-skills/)**: a read-only page with every open issue and PR of the workshop by stage, rebuilt every half hour by [`board.yml`](.github/workflows/board.yml).

```
/plugin marketplace add realJohnDoe/agent-skills
/plugin install joes-workshop@agent-skills
```

## Skills

| Skill | What it does |
|---|---|
| [`timetable`](skills/timetable/SKILL.md) | The workshop's one schedule, as a table in git: the `Timetable` routine fires twice a day and runs only this skill, which starts each task due on that tick (dispatcher, survey run, dependency maintenance) with the model its entry names. |
| [`dispatcher`](skills/dispatcher/SKILL.md) | Runs over every repo attached to the `Timetable` routine: dispatches tier-labelled issues to subagent sessions, follows up on red or conflicting PRs, merges `automerge` PRs, and keeps the workshop board up to date with what waits on the maintainer, with a `Pause workshop` issue to pause it all, closed to resume. Its `board/` folder is the workshop board's page. |
| [`conventions`](skills/conventions/SKILL.md) | The labels and body sections (such as `## Decision needed`) the dispatcher reads, and what an agent sets when it files an issue or opens a PR in a workshop repo. Each repo's `CLAUDE.md` points here instead of restating them. |
| [`surveys`](skills/surveys/SKILL.md) | The conventions every survey follows, and the chooser that picks the one (survey, repo) pair to run next across the attached repos, by days since that survey last ran there × activity in its scope since. A repo's own `.claude/skills/survey-*/` are ranked alongside the plugin's. |
| [`survey-health`](skills/survey-health/SKILL.md) | Surveys one repo's code health (architecture, simplicity, layout, security, testing, tooling and more), runs its quality gates, and files the ranked findings as sub-issues. A repo can narrow its scope or add categories in an overlay. |
| [`survey-retro`](skills/survey-retro/SKILL.md) | Reviews the agent sessions that worked in one repo since its last retro and files the top changes to their environment (checks, review, steering files, tools) that would have stopped them going wrong. |
| [`dependency-maintenance`](skills/dependency-maintenance/SKILL.md) | Finds the dependency decisions Dependabot can't make (majors, held-back pins, replacements, removals, gaps in Dependabot's own coverage) in one repository or several, in any language, files one issue per decision in the repo it belongs to, and publishes a report linking them. |
| [`throughput`](skills/throughput/SKILL.md) | Builds an HTML report of your merged PRs and the lines they added per week, stacked by repo, over the last six months or any window. Counts PRs with GitHub search and lines from each PR's merge or squash commit on the default branch. |

A skill holds only what's true for every repo. Each repo's own rules (pins and why, package manager, labels beyond the workshop's) stay in that repo's `CLAUDE.md`/docs, and the skill reads them before it decides anything.

## Developing

The skills' scripts are TypeScript that Node runs directly, with no build step. CI ([`workshop-tests.yml`](.github/workflows/workshop-tests.yml)) runs both checks on every PR:

```
npm ci && npx tsc
node --test 'skills/**/*.test.ts'
```

How to preview the board locally, and what each script decides, is in the dispatcher's [Developing](skills/dispatcher/SKILL.md#developing) section. Issues for this repo follow [`conventions`](skills/conventions/SKILL.md); see [`docs/agents/`](docs/agents/).
