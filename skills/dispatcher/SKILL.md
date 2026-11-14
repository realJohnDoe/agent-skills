---
name: dispatcher
description: Run the daily workshop over several repositories at once: dispatch tier-labelled issues to subagent sessions, follow up on red or conflicting PRs, merge `automerge` PRs, and keep one shared digest of what waits on the maintainer. Also pauses, drains and resumes it. Use when the daily dispatcher fires, when asked to run, pause, resume or configure the workshop, or to add a repo to it.
---

# Dispatcher

One scheduled run a day moves open work forward in every repo listed in [`workshop.json`](workshop.json), and the maintainer's part comes down to one twice-weekly digest issue in the `digest` repo, which also says why anything isn't moving. The scripts live in `scripts/` next to this file: run them with `node <this skill's directory>/scripts/<name>.mjs`.

## The run

0. **Every configured repo must be in the session, with push access.** The scripts check this first and stop with an error naming each repo they can't work on. Don't work around it by skipping the repo: tell the user which repo, and why.
1. `node scripts/pause.mjs` and act on its `state` (see **Pausing**). Anything but `normal` ends this procedure after that section's steps.
2. `node scripts/dispatch.mjs` is the **dry run**: it prints the plan as JSON and writes nothing. Read it before applying.
3. `node scripts/dispatch.mjs --apply` does what the plan says. It creates any workshop label a repo is missing (`missingLabels`), merges the `automerge` PRs, and claims what the plan starts: it assigns each dispatched issue and leaves a `workshop-dispatch` marker comment, and leaves a `workshop-followup` marker comment on each PR it follows up. Then it rewrites the draft digest and publishes it when due. It prints the same plan.
4. For each entry in `sessions`, start one background subagent with the `Agent` tool. Give it the entry's `prompt`, take `description` from its `title`, and set `model` to its `tier`. Don't pass `isolation: "worktree"`: that would isolate this run's own checkout. The prompt already has the subagent create its own worktree (`worktree`) of its repo's clone (`checkout`) and work only there. Start them all, then wait for every one to finish before ending the run. Scheduled runs have no `create_session`, so subagents are how one run fans out.
5. For each entry in `digest.replies` (the maintainer replying on the digest), work out which issue or PR it is about. Digest items are named `owner/repo#n`. Copy the decision onto that issue or PR in its own repo, as a comment linking the reply. If it answers the issue's `## Decision needed` section, also add a `**Decided:** <answer> ([reply](<link>))` line at the end of that section, so the issue body stays the spec. A `ready` reply naming items adds `ready-for-agent` to each, but only when the reply's `author` is the digest repo's owner: that label is the maintainer's go-ahead, and nobody else's reply grants it. Skip a reply already copied there. Then comment `<!-- workshop-relayed -->` on that digest issue, with the footer, so the next run doesn't relay it again. A reply that names no item gets an answer on the digest instead.
6. Don't subscribe to PR activity, yours or the sessions'. Tomorrow's run is the follow-up. Don't open PRs or issues yourself beyond what the script writes and what the subagents open.
7. If `sessions`, `automerge` and `digest.replies` are all empty, stop. Post nothing.

### Dry run

When the prompt asks for a dry run (for example the first run of a new scheduled task, or after adding a repo), **write nothing**. Never pass `--apply`, start no subagents, relay no replies, and post no comments, issues or labels. Instead:

1. Run `node scripts/pause.mjs` and report its `state`. If it is `drain` or `resume`, also report what its plan would defer, unassign, close or mark ready.
2. Run `node scripts/dispatch.mjs` (with `--followups-only` if the state is `drain`) and report the plan as a short summary for the user:
   - the configured repos, and the labels each would get created (`missingLabels`);
   - each session with its repo, kind, issue or PR, and tier, then what's left over (`deferred`);
   - the PRs that would be merged (`automerge`);
   - the digest counts, whether it would be published, and the replies that would be relayed;
   - the digest body as it would be written.
3. Stop. If a script fails, report its error as it is: a repo that isn't checked out or can't be pushed to is exactly what a dry run is for finding.

Each repo's own rules (how to build and check, PR template, label meanings beyond the ones below) stay in that repo's `CLAUDE.md` and docs. The session prompts point there, and nothing in this skill is specific to one repo.

## Configuring

`workshop.json` holds the `digest` repo and the list of `repos`. **Adding a repo is one entry**, `{ "repo": "owner/name" }`, plus attaching that repo to the scheduled task's sessions with push access. The workshop labels it lacks are created on its first apply run.

A repo's clone is found at `<checkouts>/<name>`. Here checkouts is `--checkouts`, else `$WORKSHOP_CHECKOUTS`, else the folder that holds the clone the run started in, which is how a cloud session lays out its repos. An entry can also give `"path"`. `--repos owner/a,owner/b` limits one run to some of the configured repos.

## What the script decides

The two decisions that change what lands on a default branch are in `scripts/decide.mjs` and pinned by `scripts/decide.test.mjs`. One is whether an issue is dispatchable (`skipReason`). The other is whether a PR waits, goes to review, is merged, or gets a follow-up (`prVerdict`).

- **Dispatch**: an open issue is dispatched when it:
  - has a `haiku`/`sonnet`/`opus` label and the `ready-for-agent` label;
  - has no `opus-plan` or `deferred` label;
  - has no assignee;
  - has no open blocker, whether native or named in the body by a `Blocked by: #n` line or a `## Blocked by` section;
  - has no sub-issues;
  - has no open PR that closes it.

  Every other open issue is somewhere else in the digest (its PR, Unstick, Waiting on you), or under **Not picked up** with its reason, so nothing is skipped silently. The reasons are no tier label, `opus-plan`, `deferred`, blocked by `owner/repo#N`, and assigned by hand.

  An issue that needs the maintainer to decide something has a `## Decision needed` section in its body: the question and its options. The section is open until it has a `Decided:` line. Until then, and while the issue has no `ready-for-agent`, it is listed under Waiting on you with its question, tier label or not. `ready-for-agent` settles it either way.
- **Follow-up**: every open, non-draft PR gets one narrow session (on `opus` for Dependabot's, `sonnet` for one with no tier-labelled issue) when it:
  - conflicts with its base branch, which is checked without waiting for CI because GitHub runs none on a conflicting PR. The session merges the base in and pushes. An "unknown" mergeability is skipped until the next run.
  - has a failing check, once CI has finished;
  - has review feedback newer than its head commit that isn't an agent's (no Claude Code footer).

  It waits while a follow-up is newer than the head commit. Green, quiet PRs cost nothing.
- **Auto-merge**: the `automerge` label on the PR is the only condition. Whoever opens the PR sets it: a dispatched session for a `haiku`/`sonnet` issue, or anyone else deliberately. A green, quiet `automerge` PR is merged by the script, pinned to the head commit it checked. Any other green, quiet non-draft PR goes in the digest's Review list. Dependabot PRs aren't merged by the script: a repo's own auto-merge workflow queues those, and a green Dependabot PR without native auto-merge goes in the Review list.
- **Caps**: at most `--max-sessions` (4) sessions per run **across all repos**. Follow-ups come first, then dispatches. Follow-ups go newest PR first, dispatches oldest issue first, whichever repo they're in. At most `--max-followups` (2) follow-ups per PR. After that the PR goes in the digest instead.
- **Digest**: one draft issue in the `digest` repo, `Workshop digest (draft) — from <date>`. It is rewritten on every run (an edit notifies nobody). Every item names its repo as `owner/repo#n`. It lists what waits on the maintainer, PRs first:
  - **Review**: green, quiet PRs without `automerge`, and Dependabot PRs without auto-merge.
  - **Unstick**: PRs at their follow-up cap, a follow-up with no push after 2 days, and a dispatched issue with no PR after 2 days.
  - **Waiting on you**: unblocked issues without `ready-for-agent`. First those with an open question (**Decide:**, showing the question), then tier-labelled ones that only need the go-ahead (**Go ahead?**, showing the tier). Agents file most of these, and nothing runs until the maintainer says so.

  Each ask says which issues it unblocks. Then comes what's coming: **Queue** (dispatchable issues past today's cap) and **Not picked up**. Blocked and `deferred` issues are only counted, in a collapsed list. Last, also collapsed, is what merged in each repo since the draft opened.

  The first run on a Tuesday or Friday publishes the draft, if something merged or waits. Publishing retitles it `Workshop digest — <date>` and comments the counts (that comment is the ping). It also closes the previous published digest and opens the next draft. A quiet cycle stays a draft. Nothing is decided on silence.

To re-dispatch a stuck issue, unassign it. To keep a PR out of the workshop, mark it draft. To hold a PR the workshop would merge, remove its `automerge` label; add the label to let one merge.

### Labels

What each issue and PR label means, and who sets it, is in the `issue-conventions` skill (`../issue-conventions/SKILL.md`). Change a meaning there and in `decide.mjs` together. The one label of the workshop's own is `workshop-paused`, on the digest, which pauses every repo (below).

## Pausing

The maintainer pauses and resumes the whole workshop, every repo at once, with the `workshop-paused` label on an open `Workshop digest` issue, the draft or the published one. To pause, add the label. To resume, remove it. Nothing is published while paused. State lives on GitHub (the label plus marker comments on the newest digest), not in any session.

| `state` from `pause.mjs` | The run |
|---|---|
| `drain` (label on, no snapshot newer than it) | Drain, once |
| `paused` (label on, snapshot posted) | Exits |
| `resume` (label off, latest snapshot has no later "resumed" comment) | Resume, once, then the normal run |
| `normal` | The normal run |

Each transition posts its marker comment (`workshop-snapshot`, `workshop-resumed`) last, so a second firing in the same state sees the new state and does nothing.

**Drain**

1. Dry runs: `node scripts/dispatch.mjs --followups-only` lists what would merge and be followed up, and `node scripts/pause.mjs` lists, per repo, what would be deferred and unassigned, plus the snapshot.
2. `node scripts/dispatch.mjs --apply --followups-only` merges green PRs, gives red ones their last follow-up, and starts no new issue. Run its sessions as in step 4 and wait for them.
3. `node scripts/pause.mjs --apply` handles each repo:
   - PRs still red or conflicting are converted to draft, labelled `deferred` and commented. `opus` PRs stay open for review.
   - Issues assigned with no PR are unassigned.

   Then it posts one snapshot on the digest: per repo, the date, the base commit, what was deferred, and open decisions.

**Resume**

1. Dry run: `node scripts/pause.mjs` lists, per repo, the deferred PRs to close (over 100 commits behind their base; their issues go back to the dispatcher by unassigning) and the ones to mark ready again.
2. `node scripts/pause.mjs --apply` does it and posts the "resumed" comment. Then continue with the normal run. The digest goes out as usual.

## Developing

`node --test 'skills/**/*.test.mjs'` runs the decision tests, the `Blocked by:` parser test, and `dispatch.test.mjs`. That last file runs both scripts end to end over two repos against a fake `gh` and `git` (`scripts/fake-bin.mjs`). CI runs them on every PR. A change to a decision changes what lands on every configured repo's default branch: change its test first.
