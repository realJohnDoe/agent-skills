---
name: dispatcher
description: Run the workshop dispatcher over several repositories at once: dispatch tier-labelled issues to subagent sessions, follow up on red or conflicting PRs, merge `automerge` PRs, and keep one shared digest of what waits on the maintainer. Also pauses, drains and resumes it. Use when the `timetable` skill starts it, when asked to run, pause, resume or configure the workshop, or to add a repo to it.
---

# Dispatcher

The `timetable` skill starts the dispatcher on the ticks its table names (`scripts/schedule.ts` in that skill). Each run moves open work forward in every repo attached to the `Timetable` routine, and the maintainer's part comes down to one twice-weekly digest issue in **`realJohnDoe/agent-skills`** (the digest repo), which also says why anything isn't moving. The scripts live in `scripts/` next to this file: run them as `node <this skill's directory>/scripts/<name>.ts --digest realJohnDoe/agent-skills`. Every command below needs that `--digest` flag; it's left out for brevity.

## The run

0. **Every attached repo should have push access.** `pause.ts` stops with an error naming each repo it can't push to. `dispatch.ts` instead skips every write to such a repo (no labels, merges, sessions, follow-ups or claims; its sessions don't count towards `--max-sessions`), lists it under `unpushable` with the reason, puts a **Can't push** entry at the top of the digest's **Unstick** and counts it there, then carries on with the healthy repos. Notify the user which repo, and why.
1. `node scripts/pause.ts` and act on its `state` (see **Pausing**). Anything but `normal` ends this procedure after that section's steps.
2. `node scripts/dispatch.ts` is the **dry run**: it prints the plan as JSON and writes nothing. Read it before applying.
3. `node scripts/dispatch.ts --apply` does what the plan says. It creates any workshop label a repo is missing (`missingLabels`), and merges the `automerge` PRs. It then reads again each repo where something merged, so the rest of the run sees the merge, and claims what the plan starts: it assigns each dispatched issue and leaves a `workshop-dispatch` marker comment, and leaves a `workshop-followup` marker comment on each PR it follows up. It does not write the digest: step 9 does, once the sessions are done. It prints the plan, which differs from the dry run's only where a merge changed it, and the digest it would write, `replies` included.
4. For each entry in `sessions`, start one background subagent with the `Agent` tool. Give it the entry's `prompt`, take `description` from its `title`, and set `model` to its `tier`. Don't pass `isolation: "worktree"`: that would isolate this run's own checkout. The prompt already has the subagent create its own worktree (`worktree`) of its repo's clone (`checkout`) and work only there. Start them all, then wait for every one to finish before ending the run. Scheduled runs have no `create_session`, so subagents are how one run fans out.
5. For each entry in `digest.replies` (the maintainer replying on the digest), work out which issue or PR it is about. Digest items are named `owner/repo#n`. Copy the decision onto that issue or PR in its own repo, as a comment linking the reply. If it answers the issue's `## Decision needed` section, also add a `**Decided:** <answer> ([reply](<link>))` line at the end of that section, so the issue body stays the spec. A `ready` reply naming items adds `ready-for-agent` to each, but only when the reply's `author` is the digest repo's owner: that label is the maintainer's go-ahead, and nobody else's reply grants it. Skip a reply already copied there. Then comment `<!-- workshop-relayed -->` on that digest issue, with the footer, so the next run doesn't relay it again. A reply that names no item gets an answer on the digest instead.
6. Don't subscribe to PR activity, yours or the sessions'. Tomorrow's run is the follow-up. Don't open PRs or issues yourself beyond what the script writes and what the subagents open.
7. Check each **Unstick** issue that says "no PR yet" and was dispatched before today: look for an open or merged PR on its `claude/issue-<n>` branch. If one exists, its description names the wrong issue. Notify the maintainer with both links, and don't call the run quiet.
8. If `sessions`, `automerge`, `unpushable` and `digest.replies` are all empty and step 7 found nothing, the run is quiet: post nothing, but still do step 9.
9. Last, run `node scripts/dispatch.ts --apply --digest-only`. It reads every repo again and makes no write but the digest: no merges, labels, claims or comments, and it starts no sessions. It rewrites the draft, so it shows the PRs the sessions opened and whatever merged during the run, and it publishes the draft when due. Last it pushes `board.json` to the `workshop-board` branch, whose `deploy.yml` (the template `board/deploy.yml`) deploys the board to Pages; read `board.pushed` in its output, and report `board.why` when it is false. Run it on every non-paused run, even a quiet one, and only after step 5 has posted its `<!-- workshop-relayed -->` comment, or the next run relays the same replies again.

### Dry run

When the prompt asks for a dry run (for example after adding a repo), **write nothing**. Never pass `--apply`, start no subagents, relay no replies, and post no comments, issues or labels. Instead:

1. Run `node scripts/pause.ts` and report its `state`. If it is `drain` or `resume`, also report what its plan would defer, unassign, close or mark ready.
2. Run `node scripts/dispatch.ts` (with `--followups-only` if the state is `drain`) and report the plan as a short summary for the user:
   - the repos it found attached, the labels each would get created (`missingLabels`), and the repos it can't push to (`unpushable`);
   - each session with its repo, kind, issue or PR, and tier, then what's left over (`notStarted`);
   - the PRs that would be merged (`automerge`);
   - the digest counts, whether it would be published, and the replies that would be relayed;
   - the digest body as it would be written.
3. Stop. If a script fails, report its error as it is: a repo that isn't checked out is exactly what a dry run is for finding.

Each repo's own rules (how to build and check, PR template, label meanings beyond the ones below) stay in that repo's `CLAUDE.md` and docs. The session prompts point there, and nothing in this skill is specific to one repo.

## Configuring

**The workshop's repos are the ones attached to the `Timetable` routine** (the `timetable` skill's **Configuring**). To add a repo, attach it with push access; to remove one, detach it. The workshop labels a repo lacks are created on its first apply run. Every repo attached to that routine is dispatched, so attach nothing there that the workshop shouldn't touch.

The scripts find the repos as every clone with a GitHub `origin` directly under the checkouts folder: `--checkouts`, else `$WORKSHOP_CHECKOUTS`, else the folder that holds the clone the run started in (or the working directory, when that isn't a clone). That is how a cloud session lays out its repos. A repo that isn't attached is simply not covered, so the digest ends with a `Repos covered:` line: a repo missing from it has lost its attachment. `--repos owner/a,owner/b` limits one run to some of them, and stops if one isn't attached.

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

To move the digest, change the repo named at the top of this file.

## What the script decides

The two decisions that change what lands on a default branch are in `scripts/decide.ts` and pinned by `scripts/decide.test.ts`. One is whether an issue is dispatchable (`issueState`). The other is whether a PR waits, goes to review, is merged, or gets a follow-up (`prVerdict`).

- **Dispatch**: an open issue is dispatched when it:
  - has a `haiku`/`sonnet`/`opus` label and the `ready-for-agent` label;
  - has no `plan` (or retired `opus-plan`) label;
  - has no assignee;
  - has no open blocker, whether native or named in the body by a `Blocked by: #n` line or a `## Blocked by` section, which may name `owner/repo#n` in another repo (one that can't be read blocks);
  - has no sub-issues;
  - has no open PR that closes it.

  Every other open issue is somewhere else in the digest (its PR, Unstick, Waiting on you), or under **Not picked up** with its reason, so nothing is skipped silently. The reasons are `plan`, no tier label, blocked by `owner/repo#N`, and assigned by hand.

  A PR for an issue with an `## After merge` section says `Refs #n`, which keeps the issue open after merge. An open PR that `Refs` an issue counts as linked to it, as one that closes it does. Once that PR has merged and no open one remains, the issue is Waiting on you, never dispatched again nor Unstick, until the maintainer closes it. Finding the merged PR reads the newest page of closed PRs, and only for issues that have the section.

  An issue that needs the maintainer to decide something has a `## Decision needed` section in its body: the question and its options. The section is open until it has a `Decided:` line. Until then, and while the issue has no `ready-for-agent`, it is listed under Waiting on you with its question, tier label or not. `ready-for-agent` settles it either way.
- **Follow-up**: every open, non-draft PR gets one narrow session (on `opus` for Dependabot's, `sonnet` for one with no tier-labelled issue) when it:
  - conflicts with its base branch, which is checked without waiting for CI because GitHub runs none on a conflicting PR. The session merges the base in and pushes. GitHub computes mergeability lazily, so the script reads it a second time after a short pause. A green PR whose mergeability is still unknown waits for the next run, and is neither reviewed nor merged.
  - has a failing check, once CI has finished;
  - has review feedback newer than its head commit that isn't an agent's (no Claude Code footer).

  It waits while a follow-up is newer than the head commit. Green, quiet PRs cost nothing.
- **Auto-merge**: the `automerge` label on the PR is the only condition. Whoever opens the PR sets it: a dispatched session for a `haiku`/`sonnet` issue, a repo's Dependabot workflow for every non-major bump, or anyone else deliberately. A green, quiet `automerge` PR is merged by the script, pinned to the head commit it checked, unless its branch is `claude/issue-N` and its description doesn't say `Fixes #N` or `Refs #N` (a session opened it with another session's description): that one goes in Review with the mismatch as its reason. Any other green, quiet non-draft PR goes in the digest's Review list. The script merges Dependabot's PRs instead of GitHub's native auto-merge because a merge made with a workflow's own token starts no `push` workflow, so nothing would deploy. A PR already on native auto-merge waits for it.
- **Caps**: at most `--max-sessions` (4) sessions per run **across all repos**. Follow-ups come first, then dispatches. Follow-ups go newest PR first, dispatches newest issue first, whichever repo they're in. At most `--max-followups` (2) follow-ups per PR. After that the PR goes in the digest instead.
- **Digest**: one draft issue in the `digest` repo, `Workshop digest (draft) — from <date>`. It is rewritten once per run, as the last step, after the sessions have finished (an edit notifies nobody). Every item names its repo as `owner/repo#n`. It lists what waits on the maintainer, PRs first:
  - **Review**: green, quiet PRs without `automerge`, Dependabot majors among them.
  - **Unstick**: PRs at their follow-up cap, a follow-up with no push after 2 days, and a dispatched issue with no PR. An attached repo the run can't push to comes first, as **Can't push:** with the reason.
  - **Waiting on you**: first issues with an open question (**Decide:**, showing the question), then issues whose PR has merged and that have an `## After merge` section (**After merge:**, showing its first paragraph and the merged PR), then unblocked tier-labelled ones without `ready-for-agent` that only need the go-ahead (**Go ahead?**, showing the tier). Agents file most of these, and nothing runs until the maintainer says so.

  Each ask says which issues it unblocks. Then comes what's coming: **In progress** (follow-ups not yet run, PRs waiting on CI, a follow-up or mergeability, so every open non-draft PR shows somewhere), **Queue** (dispatchable issues past today's cap) and **Not picked up**. Blocked issues are only counted, in a collapsed list. Last, also collapsed, is what merged in each repo since the draft opened.

  The first run on a Tuesday or Friday publishes the draft, if something merged or waits. Publishing retitles it `Workshop digest — <date>` and comments the counts (that comment is the ping). It also closes the previous published digest and opens the next draft. A quiet cycle stays a draft. Nothing is decided on silence.

To re-dispatch a stuck issue, unassign it. To keep a PR out of the workshop, mark it draft. To hold a PR the workshop would merge, remove its `automerge` label; add the label to let one merge.

### Labels

What each issue and PR label means, and who sets it, is in the `conventions` skill (`../conventions/SKILL.md`). Change a meaning there and in `decide.ts` together. The one label of the workshop's own is `workshop-paused`, on the digest, which pauses every repo (below).

## Pausing

The maintainer pauses and resumes the whole workshop, every repo at once, with the `workshop-paused` label on an open `Workshop digest` issue, the draft or the published one. To pause, add the label. To resume, remove it. Nothing is published while paused. State lives on GitHub (the label plus marker comments on the newest digest), not in any session.

| `state` from `pause.ts` | The run |
|---|---|
| `drain` (label on, no snapshot newer than it) | Drain, once |
| `paused` (label on, snapshot posted) | Exits |
| `resume` (label off, latest snapshot has no later "resumed" comment) | Resume, once, then the normal run |
| `normal` | The normal run |

Each transition posts its marker comment (`workshop-snapshot`, `workshop-resumed`) last, so a second firing in the same state sees the new state and does nothing.

**Drain**

1. Dry runs: `node scripts/dispatch.ts --followups-only` lists what would merge and be followed up, and `node scripts/pause.ts` lists, per repo, what would be closed and unassigned, plus the snapshot.
2. `node scripts/dispatch.ts --apply --followups-only` merges green PRs, gives red ones their last follow-up, and starts no new issue. Run its sessions as in step 4 and wait for them.
3. `node scripts/pause.ts --apply` handles each repo:
   - PRs still red or conflicting are closed with a comment. Their issues lose `ready-for-agent` and are unassigned, so they wait under Go ahead?. `opus` PRs stay open for review.
   - Issues assigned with no PR are unassigned.

   Then it posts one snapshot on the digest: per repo, the date, the base commit, what was closed, and open decisions.
4. `node scripts/dispatch.ts --apply --board-only` pushes the board with `state: paused`, linked to the snapshot. It reads every repo and writes nothing else: no digest, merges, labels, claims, comments or sessions.

**Resume**

1. `node scripts/pause.ts --apply` posts the "resumed" comment. Then continue with the normal run. The digest goes out as usual.

## Developing

`node --test 'skills/**/*.test.ts'` runs the decision tests, the `Blocked by:` parser test, and `dispatch.test.ts`. That last file runs both scripts end to end over two repos against a fake `gh` and `git` (`scripts/fake-bin.ts`). CI runs them on every PR. A change to a decision changes what lands on every attached repo's default branch: change its test first.

The workshop board's page is `board/`: `index.html` fetches `board.json` and renders it with `render.js` (tested in `scripts/board.test.ts`). To preview it, write a dry run's board next to it and serve the folder: `node scripts/dispatch.ts --digest realJohnDoe/agent-skills | jq .board > board/board.json`, then `python3 -m http.server -d board` (`board.json` is gitignored). `board/deploy.yml` is not run from `main`: `dispatch.ts` commits it with `board.json` onto the `workshop-board` branch, so a change to it reaches Pages with the next push.

The scripts are TypeScript that Node runs directly, with no build step, so use only erasable syntax (no `enum`, `namespace` or parameter properties) and `import type` for types. `npm ci && npx tsc` must pass; CI runs it before the tests. A state is a union member (`IssueState`, `PrVerdict`, `ClaimState`, `PauseState`), and every `switch` over one ends in `assertNever`. To add a state, add the union member: `tsc` then flags each `switch` that doesn't handle it.
