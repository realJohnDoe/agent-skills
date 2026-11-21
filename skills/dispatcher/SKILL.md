---
name: dispatcher
description: Run the workshop dispatcher over several repositories at once: dispatch tier-labelled issues to subagent sessions, follow up on red or conflicting PRs, merge `automerge` PRs, and keep the workshop board showing what waits on the maintainer. Also pauses, drains and resumes it. Use when the `timetable` skill starts it, when asked to run, pause, resume or configure the workshop, or to add a repo to it.
---

# Dispatcher

The `timetable` skill starts the dispatcher on the ticks its table names (`scripts/schedule.ts` in that skill). Each run moves open work forward in every repo attached to the `Timetable` routine, and the maintainer's part comes down to the [workshop board](https://realjohndoe.github.io/agent-skills/), which shows what waits on them and why anything isn't moving. The workshop's home is **`realJohnDoe/agent-skills`** (the home repo): it holds the board, which keeps when the dispatcher last ran and which repos it covered (see **Board state**), the pause issue (see **Pausing**) and the can't-push issues. The scripts live in `scripts/` next to this file: run them as `node <this skill's directory>/scripts/<name>.ts --home realJohnDoe/agent-skills`. Every command below needs that `--home` flag; it's left out for brevity. `dispatch.ts` takes its command first, before any flag: `plan`, `apply`, `finish` or `board`.

## The run

0. **Every attached repo should have push access.** `pause.ts` stops with an error naming each repo it can't push to. `dispatch.ts` instead skips every write to such a repo (no labels, merges, sessions, follow-ups or claims; its sessions don't count towards `--max-sessions`), lists it under `unpushable` with the reason, and carries on with the healthy repos. Step 8 files an issue for it in the home repo, which the board shows as Stuck (see **Can't push**).
1. `node <this skill's directory>/scripts/pause.ts` and act on its `state` (see **Pausing**). Anything but `normal` ends this procedure after that section's steps.
2. `node <this skill's directory>/scripts/dispatch.ts plan` is the **dry run**: it prints the plan as JSON and writes nothing. Read it before applying.
3. `node <this skill's directory>/scripts/dispatch.ts apply` does what the plan says. It creates any workshop label a repo is missing (`missingLabels`), and merges the `automerge` PRs. It then reads again each repo where something merged, so the rest of the run sees the merge, and claims what the plan starts: it assigns each dispatched issue and leaves a `workshop-dispatch` marker comment, and leaves a `workshop-followup` marker comment on each PR it follows up. It writes no can't-push issue and starts no board build: step 8 does, once the sessions are done. It prints the plan, which differs from the dry run's only where a merge changed it.
4. For each entry in `sessions` in step 3's `apply` output, start one background subagent with the `Agent` tool. Give it the entry's `prompt`, take `description` from its `title`, and set `model` to its `tier`. Don't pass `isolation: "worktree"`: that would isolate this run's own checkout. The prompt already has the subagent create its own worktree (`worktree`) of its repo's clone (`checkout`) and work only there. Take `sessions` from that output, not the dry run's: a merge during apply can unblock an issue, which apply then claims. Read the output in full, never through `head`: a session that is claimed but never started leaves its issue assigned with no PR. Start them all, then wait for every one to finish before ending the run. Scheduled runs have no `create_session`, so subagents are how one run fans out.
5. Don't subscribe to PR activity, yours or the sessions'. Tomorrow's run is the follow-up. Don't open PRs or issues yourself beyond what the script writes and what the subagents open.
6. Check each **Stuck** issue that says "no PR yet" and was dispatched before today: look for an open or merged PR on its `claude/issue-<n>` branch. If one exists, its description names the wrong issue. Notify the maintainer with both links, and don't call the run quiet.
7. If `sessions`, `automerge` and `unpushable` are all empty and step 6 found nothing, the run is quiet: notify nobody, but still do step 8.
8. Last, run `node <this skill's directory>/scripts/dispatch.ts finish`. It reads every repo again and makes no write but the can't-push issues, the retired digest issue's closing and the `waiting-for-human` label: no merges, other labels, claims or comments, and it starts no sessions (it writes no session prompts either). It files a can't-push issue for each repo in `unpushable` that has none open, and closes the open ones whose repo it can push to again or that is no longer attached; `cantPush` in its output lists both. It closes any open `Workshop digest` issue, which is retired, with a comment saying so; one that still carries the retired `workshop-paused` label first gets a `Pause workshop` issue in its place (unless one is open), so closing it doesn't resume the workshop. `retire` in its output lists both. Then it puts the `waiting-for-human` label on every issue and PR in the board's Waiting for human stage and removes it from everything else, closed items included, except in repos it can't push to; `waitingLabel` in its output lists what it added and removed, and `finish --dry-run` lists the same without writing. Last it starts the board workflow (`.github/workflows/board.yml`) with this run's time and repos as its inputs (`boardInputs` in its output), so the board shows the run now rather than at its next half-hourly refresh; read `boardRefresh.triggered` in its output, and report `boardRefresh.why` when it is false (the schedule still catches up). Run it on every non-paused run, even a quiet one.

### Dry run

When the prompt asks for a dry run (for example after adding a repo), **write nothing**. Never run `dispatch.ts apply`, `dispatch.ts finish` without `--dry-run`, or `pause.ts --apply`; start no subagents, and post no comments, issues or labels. Instead:

1. Run `node <this skill's directory>/scripts/pause.ts` and report its `state`. If it is `drain` or `resume`, also report what its plan would defer, unassign, close or mark ready.
2. Run `node <this skill's directory>/scripts/dispatch.ts plan` (with `--followups-only` if the state is `drain`) and report the plan as a short summary for the user:
   - the repos it found attached, the labels each would get created (`missingLabels`), and the repos it can't push to (`unpushable`);
   - each session with its repo, kind, issue or PR, and tier, then what's left over (`notStarted`);
   - the PRs that would be merged (`automerge`);
   - the board's stage counts: Stuck, Waiting for human, Queue, Behind another issue.
3. Stop. If a script fails, report its error as it is: a repo that isn't checked out is exactly what a dry run is for finding.

Each repo's own rules (how to build and check, PR template, label meanings beyond the ones below) stay in that repo's `CLAUDE.md` and docs. The session prompts point there, and nothing in this skill is specific to one repo.

## Configuring

**The workshop's repos are the ones attached to the `Timetable` routine** (the `timetable` skill's **Configuring**). To add a repo, attach it with push access; to remove one, detach it. The board follows from the next run on. The workshop labels a repo lacks are created on its first apply run. Every repo attached to that routine is dispatched, so attach nothing there that the workshop shouldn't touch.

The scripts find the repos as every clone with a GitHub `origin` directly under the checkouts folder: `--checkouts`, else `$WORKSHOP_CHECKOUTS`, else the folder that holds the clone the run started in (or the working directory, when that isn't a clone). That is how a cloud session lays out its repos. A repo that isn't attached is simply not covered, so the plan lists the `repos` it covers, and the board counts them: a repo missing from them has lost its attachment. `--repos owner/a,owner/b` limits one run to some of them, and stops if one isn't attached.

A repo with Dependabot gets its non-major PRs labelled `automerge` by the shared workflow in this repo (`.github/workflows/dependabot-automerge.yml`). The repo calls it from `.github/workflows/dependabot-automerge.yml` of its own:

```yaml
name: Dependabot automerge label
on: pull_request
permissions:
  pull-requests: write
  issues: write
jobs:
  automerge:
    uses: realJohnDoe/agent-skills/.github/workflows/dependabot-automerge.yml@main
```

Don't also turn on GitHub's native auto-merge there (see **Auto-merge** below).

To move the home repo, change the repo named at the top of this file, `BOARD_REPO` in `scripts/dispatch.ts`, and the board workflow's Pages site.

## What the script decides

The two decisions that change what lands on a default branch are in `scripts/decide.ts` and pinned by `scripts/decide.test.ts`. One is whether an issue is dispatchable (`issueState`). The other is whether a PR waits, goes to review, is merged, or gets a follow-up (`prVerdict`).

- **Dispatch**: an open issue is dispatched when it:
  - has a `haiku`/`sonnet`/`opus` label and the `ready-for-agent` label;
  - has no `plan` (or retired `opus-plan`) label;
  - has no assignee;
  - has no open blocker, whether native or named in the body by a `Blocked by: #n` line or a `## Blocked by` section, which may name `owner/repo#n` in another repo (one that can't be read blocks);
  - has no sub-issues;
  - has no open PR that closes it.

  Every other open issue is somewhere else on the board (under its PR, Stuck, Waiting for human, Behind another issue), so nothing is skipped silently. A `plan` issue waits for human for a plan session, and one with no tier label for a tier. An issue assigned by hand (no dispatch marker) is the assignee's own work and is not on the board, unless it also has `ready-for-agent`: then it waits for human, to be unassigned or have the label removed.

  A PR for an issue with an `## After merge` section says `Refs #n`, which keeps the issue open after merge. An open PR that `Refs` an issue counts as linked to it, as one that closes it does. Once that PR has merged and no open one remains, the issue is Waiting for human, never dispatched again nor Stuck, until the maintainer closes it. Finding the merged PR reads the newest page of closed PRs, and only for issues that have the section.

  An issue that needs the maintainer to decide something has a `## Decision needed` section in its body: the question and its options. The section is open until it has a `Decided:` line. Until then, and while the issue has no `ready-for-agent`, it is Waiting for human with its question, tier label or not. `ready-for-agent` settles it either way. The maintainer answers on the issue itself: they add the `Decided:` line or `ready-for-agent`, or start a session from the card's ✳ chip to record the answer.
- **Follow-up**: every open, non-draft PR gets one narrow session (on `opus` for Dependabot's, `sonnet` for one with no tier-labelled issue) when it:
  - conflicts with its base branch, which is checked without waiting for CI because GitHub runs none on a conflicting PR. The session merges the base in and pushes. GitHub computes mergeability lazily, so the script reads it a second time after a short pause. A green PR whose mergeability is still unknown waits for the next run, and is neither reviewed nor merged.
  - has a failing check, once CI has finished;
  - has review feedback newer than its head commit that isn't an agent's (no Claude Code footer).

  It waits while a follow-up is newer than the head commit. Green, quiet PRs cost nothing.
- **Auto-merge**: the `automerge` label on the PR is the only condition. Whoever opens the PR sets it: a dispatched session for a `haiku`/`sonnet` issue, a repo's Dependabot workflow for every non-major bump, or anyone else deliberately. A green, quiet `automerge` PR is merged by the script, pinned to the head commit it checked, unless its branch is `claude/issue-N` and its description doesn't say `Fixes #N` or `Refs #N` (a session opened it with another session's description): that one goes in Review with the mismatch as its reason. So does one whose description says a check was not run (Dependabot's excepted), with that sentence as its reason. (`conventions` says when a session may write that.) Any other green, quiet non-draft PR waits for review under Waiting for human. The script merges Dependabot's PRs instead of GitHub's native auto-merge because a merge made with a workflow's own token starts no `push` workflow, so nothing would deploy. A PR already on native auto-merge waits for it.
- **Caps**: at most `--max-sessions` (4) sessions per run **across all repos**. Follow-ups come first, then dispatches. Follow-ups go newest PR first, dispatches newest issue first, whichever repo they're in. At most `--max-followups` (2) follow-ups per PR. After that the PR is Stuck instead.
- **Board state**: when the dispatcher last ran and which repos it covered live in the deployed `board.json` (`lastRun` and `repos`), not in an issue. A run's last step starts the board workflow with both as its inputs (`last_run`, and `repos` space-separated); every other build of the board carries them over from the live `board.json`. Drain's last step passes none, so the board keeps the last normal run's. What waits on the maintainer is on the board, whose Waiting for human cards also carry the `waiting-for-human` label, so GitHub's own issue lists show them too.
- **Can't push**: for each attached repo it can't push to, the last step files one issue in the home repo, titled `Workshop can't push to <owner/repo>`, whose body starts with `<!-- workshop-cant-push: <owner/repo> -->` and says how to fix it. `issueState` puts that issue in Stuck, never in a dispatch. The first run that can push to the repo again, or no longer has it attached, closes the issue. The issue only shows on the board while the home repo is attached to the routine, as it always should be.

To re-dispatch a stuck issue, unassign it. To keep a PR out of the workshop, mark it draft. To hold a PR the workshop would merge, remove its `automerge` label; add the label to let one merge.

### Labels

What each issue and PR label means, and who sets it, is in the `conventions` skill (`../conventions/SKILL.md`). Change a meaning there and in `decide.ts` together. The workshop's own label is `waiting-for-human`, which the final step writes (step 8); the workshop is paused by an issue, not a label (below). That one is output only: `labelSync` in `scripts/board.ts` computes it from the board, and `decide.test.ts` pins that no decision reads it.

## Pausing

The maintainer pauses and resumes the whole workshop, every repo at once, with a pause issue in the home repo. To pause, open an issue titled `Pause workshop` (anything may follow the title, such as a reason). To resume, close it. State lives on GitHub (the pause issue plus marker comments on it), not in any session; `pauseState` in `scripts/lib.ts` reads it and `scripts/lib.test.ts` pins every case.

| `state` from `pause.ts` | The run |
|---|---|
| `drain` (a pause issue open, no snapshot since the last "resumed" comment) | Drain, once |
| `paused` (a pause issue open, snapshot posted) | Exits |
| `resume` (none open; the one closed last has a snapshot with no later "resumed" comment) | Resume, once, then the normal run |
| `normal` (none open, and the one closed last is resumed or never drained) | The normal run |

Two open pause issues count as one pause, and the markers go on the older one. A pause issue reopened after a resume drains again.

Each transition posts its marker comment (`workshop-snapshot`, `workshop-resumed`) last, so a second firing in the same state sees the new state and does nothing.

**Drain**

1. Dry runs: `node <this skill's directory>/scripts/dispatch.ts plan --followups-only` lists what would merge and be followed up, and `node <this skill's directory>/scripts/pause.ts` lists, per repo, what would be closed and unassigned, plus the snapshot.
2. `node <this skill's directory>/scripts/dispatch.ts apply --followups-only` merges green PRs, gives red ones their last follow-up, and starts no new issue. Run its sessions as in step 4 and wait for them.
3. `node <this skill's directory>/scripts/pause.ts --apply` handles each repo:
   - PRs still red or conflicting are closed with a comment. Their issues lose `ready-for-agent` and are unassigned, so they wait for the go-ahead under Waiting for human. `opus` PRs stay open for review.
   - Issues assigned with no PR are unassigned.

   Then it posts one snapshot on the pause issue: per repo, the date, the base commit, what was closed, and open decisions.
4. `node <this skill's directory>/scripts/dispatch.ts finish --no-run-marker` updates the `waiting-for-human` label as step 8 does and starts the board workflow without this run's time and repos, which shows the board with `state: paused`, linked to the snapshot, and the last normal run's time. It reads every repo and writes nothing else: no can't-push issues, merges, other labels, claims, comments or sessions.

**Resume**

1. `node <this skill's directory>/scripts/pause.ts --apply` posts the "resumed" comment on the closed pause issue. Then continue with the normal run.

## Developing

The generic parts the other skills' scripts reuse (arguments, `gh api`, the attached repos, the shared markers) are in `../_shared/`, not here; nothing outside this folder imports from `scripts/`. `node --test 'skills/**/*.test.ts'` runs the decision tests, the `Blocked by:` parser test, and the dispatcher's own. `dispatch.ts` is a thin command over two halves: `scripts/snapshot.ts` makes every GitHub read (`fetchRepo` returns a repo's `RepoSnapshot`, and the timing reads, the second `mergeable` read and the wait after a merge, live there and in `apply`), and `scripts/plan.ts` plans from snapshots with no I/O (`planRepo` per repo, `assemble` for the run, prompts only for the sessions it starts); `buildBoard` and `pauseState` are pure too. So a planning change is tested in `plan.test.ts` on snapshot fixtures, a read in `snapshot.test.ts`, and `dispatch.test.ts` keeps one end-to-end smoke test per command (and `pause.ts`'s) against a fake `gh` and `git` (`../_shared/fake-bin.ts`, which fakes `curl` for the live board too). Each command runs only the steps it needs: `plan` and `apply` build prompts, `finish` builds none but writes the can't-push issues and starts the board workflow, and `board` does neither. CI runs the tests on every PR. A change to a decision changes what lands on every attached repo's default branch: change its test first.

The workshop board's page is `board/`: `index.html` fetches `board.json` and renders it with `render.js` (tested in `scripts/board.test.ts`). Over the banner image, `components/scene.js` (tested there too) lights up the painting's stations from the stages (a sprout per queued card, a growth row per PR in progress, a red warning when something is stuck, an amber lantern when something waits for you, a padlock per blocked issue) and moves the city; a paused board dims it and holds it still. To preview it, write a dry run's board next to it and serve the folder: `node <this skill's directory>/scripts/dispatch.ts plan --home realJohnDoe/agent-skills | jq .board > board/board.json`, then `python3 -m http.server -d board` (`board.json` is gitignored). The board is built and deployed by `.github/workflows/board.yml` on `main`, never by a dispatcher run, so it also shows changes made by hand between runs. It runs `dispatch.ts board`, which prints the plan's board and writes nothing: no label, issue or workflow run, and no push-access check, because it runs on the Actions token, which can push to no other repo. So it can't tell which repos the routine can't push to: it shows the can't-push issues a run filed, as Stuck cards. The workflow runs every half hour, on this repo's issue and PR changes and finished test runs, when `main` changes the dispatcher, when a run's last step (or drain's) starts it, and by hand from the Actions tab. It skips the deploy when only `generated` changed. It needs no clones and keeps no repo list: it covers the repos a run's last step passes as its `repos` input (`--repos-covered`), which are the ones attached to the routine, and otherwise the `repos` of the live `board.json`; with neither it stops with an error. Every workshop repo is public, which is what lets the Actions token read them; a private one would need a token secret. Every Stuck and Waiting for human card, and every other open issue without `ready-for-agent` (which the dispatcher won't pick up; `unready` on its card, set in `plan.ts`), gets a coral **✳** chip (tooltip "Work on this with Claude"): a `https://claude.ai/code/new?repo=…&q=…` link that opens a new Claude Code session on the card's repo with `Regarding <owner/name>#<n>: ` filled in for the maintainer to finish, under their own claude.ai login; nothing is sent until they press send. Queue and PR in progress cards get none: the dispatcher is working on those, and a second session would collide. The board's `lastRun` comes the same way, from the `last_run` input (`--last-run`) or the live `board.json`; the page warns when the board is a day old (the workflow stopped) or the last run is two days old (the routine stopped).

The scripts are TypeScript that Node runs directly, with no build step, so use only erasable syntax (no `enum`, `namespace` or parameter properties) and `import type` for types. `npm ci && npx tsc` must pass; CI runs it before the tests. A state is a union member (`IssueState`, `PrVerdict`, `ClaimState`, `PauseState`), and every `switch` over one ends in `assertNever`. To add a state, add the union member: `tsc` then flags each `switch` that doesn't handle it.
