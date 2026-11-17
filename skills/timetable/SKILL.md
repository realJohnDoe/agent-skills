---
name: timetable
description: Run one tick of the workshop's schedule: work out which workshop tasks (dispatcher, survey run, dependency maintenance) are due now and start each one. Use when the `Timetable` routine fires, or to see or change when a workshop task runs.
---

# Timetable

The `Timetable` routine fires twice a day and runs only this skill. The schedule is one table in git, `TABLE` in `scripts/schedule.ts`: each entry names a skill, its days, its tick (`am` or `pm`) and the `model` its run gets, as a tier (`haiku`, `sonnet` or `opus`), never a model ID. Changing a schedule means a PR that changes that table.

## The run

1. `node <this skill's directory>/scripts/timetable.ts --digest realJohnDoe/agent-skills` prints the tick it computed from the UTC hour, whether the workshop is `paused`, the entries to `run` and the ones `held` by the pause. It fails on an hour that maps to no tick. Then stop and report its error: every entry would silently stop running. Don't work out the schedule yourself, and don't make up a missed tick.
2. For each entry in `run` except `dispatcher`, start one background subagent with the `Agent` tool. Give it the entry's `prompt`, take `description` from its `skill`, and set `model` to its `model`.
3. If `dispatcher` is in `run`, run the `dispatcher` skill in this session. It can't be a subagent: it starts its sessions as subagents, and a subagent can't start one. So its `model` is the one the routine runs on.
4. Wait for every subagent to finish. A failing task doesn't stop the others. End with one line per task: its skill and how it ended.

## Ticks

`TICKS` in `scripts/schedule.ts` maps each tick to a UTC hour, and a run up to an hour late still counts. The routine's cron must fire at those hours: `0 5,17 * * *` (UTC). Change both together.

## Pausing

The `workshop-paused` label on an open digest (the `dispatcher` skill's **Pausing**) pauses every task. The timetable checks it once per tick. While it's on, only the dispatcher still runs, because it carries out the drain and the resume itself. The other due tasks are `held` and aren't made up later.

## Configuring

**The workshop's repos are the ones attached to the `Timetable` routine**, with push access. Every task covers all of them. Create the routine at https://claude.ai/code/scheduled: the cron above, the `model` of the `dispatcher` entry, and the prompt `Run /joes-workshop:timetable`. Use the full plugin-qualified name there and in the `prompt` of each `TABLE` entry, so a session with other plugins installed can't pick a different skill of the same name.

## Developing

`scripts/timetable.test.ts` pins the table, the ticks and the pause. Change it first.
