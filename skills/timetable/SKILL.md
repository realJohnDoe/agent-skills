---
name: timetable
description: Run one tick of the workshop's schedule: work out which workshop tasks (dispatcher, survey run, dependency maintenance) are due now and start each one. Use when the `Timetable` routine fires, or to see or change when a workshop task runs.
---

# Timetable

Run every script from the session's working directory, never after a `cd` into the skill's directory: they look for the attached repos from where they are run.

The `Timetable` routine fires twice a day and runs only this skill. The schedule is one table in git, `TABLE` in `scripts/schedule.ts`: each entry names a skill, its days, its tick (`am` or `pm`) and the `model` its run gets, as a tier (`haiku`, `sonnet` or `opus`), never a model ID. An entry with `everyWeeks: n` runs only every n-th week, counted in whole weeks from `EPOCH`, so its gap is always exactly n weeks; a held or missed run waits for the next one. Schedules stay in this table rather than cron strings: cron has no every-other-week. Changing a schedule means a PR that changes that table. The dispatcher runs on both ticks, every day.

## The run

1. `node <this skill's directory>/scripts/timetable.ts --home realJohnDoe/joes-workshop` prints the tick it computed from the UTC hour, whether the workshop is `paused`, the entries to `run` and the ones `held` by the pause. The tick is `am` before 12:00 UTC and `pm` from then on, so a manual run at any time counts as the tick it falls in. Don't work out the schedule yourself.
2. For each entry in `run` except `dispatcher`, start one background subagent with the `Agent` tool. Give it the entry's `prompt`, take `description` from its `skill`, and set `model` to its `model`.
3. If `dispatcher` is in `run`, run the `dispatcher` skill in this session. It can't be a subagent: it starts its sessions as subagents, and a subagent can't start one. So its `model` is the one the routine runs on.
4. Wait for every subagent to finish. A failing task doesn't stop the others. End with one line per task: its skill and how it ended.

## Ticks

`tickOf` in `scripts/schedule.ts` maps a UTC hour to a tick: `am` before 12:00, `pm` from 12:00. Exact hours aren't checked, so the routine's cron (`0 5,17 * * *` UTC) can change freely and the routine can be triggered by hand at any time.

## Pausing

An open `Pause workshop` issue in the home repo (the `dispatcher` skill's **Pausing**) pauses every task. The timetable checks for one once per tick. While one is open, only the dispatcher still runs, because it carries out the drain and the resume itself. The other due tasks are `held` and aren't made up later.

## Configuring

**The workshop's repos are the ones attached to the `Timetable` routine**, with push access. Every task covers all of them. Create the routine at https://claude.ai/code/scheduled: the cron above, the `model` of the `dispatcher` entry, and the prompt `Run /joes-workshop:timetable`. Use the full plugin-qualified name there and in the `prompt` of each `TABLE` entry, so a session with other plugins installed can't pick a different skill of the same name.

## Developing

`scripts/timetable.test.ts` pins the table, the ticks and the pause. Change it first.
