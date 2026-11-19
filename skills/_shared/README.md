# Shared script code

Not a skill: there is no `SKILL.md`, so the plugin loads nothing from here. These are the modules more than one skill's scripts import, so no skill reaches into another's `scripts/`.

- `cli.ts`: arguments, child processes, and `main()`'s one-line failure.
- `github.ts`: `gh api` calls and the narrow response types.
- `repos.ts`: the repos attached to the session (`--checkouts`, `--repos`).
- `markers.ts`: how every skill reads the workshop conventions: the digest issue, the pause label, marker comments, `## Decision needed`, the can't-push issue. The `conventions` skill says what to set.
- `sessions.ts`: the PRs agent sessions opened in a repo.
- `fake-bin.ts`: the fake `gh` and `git` the end-to-end tests run against.

A module belongs here only when a second skill needs it. What only one skill uses stays in that skill's `scripts/`.
