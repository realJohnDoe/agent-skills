# Agent skills

The skills in this repo, and the workshop they run: an automated loop that works through issues in several repos and reports to one maintainer.

## Language

### The workshop

**Workshop**:
The whole system of scheduled runs that dispatches issues to agent sessions, follows up on their PRs and merges them, across every attached repo.
_Avoid_: Factory, pipeline

**Home repo**:
The workshop's own repo, `realJohnDoe/agent-skills`, which the scripts take as `--home`: it holds the pause issue, the can't-push issues and the workshop board. What waits on the maintainer is on the board, and they decide on each issue itself.
_Avoid_: Digest repo

**Pause issue**:
An issue titled `Pause workshop` in the home repo. While one is open the workshop is paused: the dispatcher drains it once and then only waits. Closing it resumes the workshop. The drain's snapshot and the resume's marker are comments on it, so each pause is one short-lived issue.
_Avoid_: Pause label, digest

**Workshop board**:
A read-only public page that shows every open issue and PR of the workshop by stage: where the maintainer sees what waits on them. You can't decide anything on it, but its ✳ chips open a Claude Code session on a card's issue.
_Avoid_: Dashboard, kanban

### On the board

**Stage**:
Where an issue or PR stands in the workshop's flow: Stuck, Waiting for human, PR in progress, Queue, Behind another issue or Closed. Each item is in exactly one stage.
_Avoid_: Column, status

**Stuck**:
The stage for work the workshop can't move without the maintainer stepping in. That covers a PR at its follow-up cap, a stale follow-up, a dispatched issue with no PR, and the issue the dispatcher files in the home repo for a repo it can't push to.
_Avoid_: Blocked, failed

**Waiting for human**:
The stage for work only the maintainer can move on: an after-merge step, a green PR to review, an issue that needs the go-ahead, an open decision, a `plan` issue that needs a plan session, an issue with no tier label, and an issue assigned by hand that also has `ready-for-agent`, in that order. An issue assigned by hand without `ready-for-agent` is the assignee's own work and is not on the board. Each run's last step mirrors it onto GitHub as the `waiting-for-human` label, which nothing reads back.

**Behind another issue**:
The stage, at the bottom of the board, for issues blocked by another open issue. Each moves on once its blocker closes, and nothing there needs the maintainer until then.
_Avoid_: Blocked, on hold

