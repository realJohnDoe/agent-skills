# Agent skills

The skills in this repo, and the workshop they run: an automated loop that works through issues in several repos and reports to one maintainer.

## Language

### The workshop

**Workshop**:
The whole system of scheduled runs that dispatches issues to agent sessions, follows up on their PRs and merges them, across every attached repo.
_Avoid_: Factory, pipeline

**Digest**:
The one long-lived issue in the digest repo where the workshop lists what waits on the maintainer, and the only place the maintainer takes decisions. Publishing it means posting a comment on it.
_Avoid_: Report, summary

**Workshop board**:
A read-only public page that shows every open issue and PR of the workshop by stage. You can look at it, but you can't decide anything on it.
_Avoid_: Dashboard, kanban

### On the board

**Stage**:
Where an issue or PR stands in the workshop's flow: Stuck, Waiting for human, Closed, PR in progress, Queue or Behind another issue. Each item is in exactly one stage.
_Avoid_: Column, status

**Stuck**:
The stage for work the workshop can't move without the maintainer stepping in. That covers a PR at its follow-up cap, a stale follow-up and a dispatched issue with no PR. A repo it can't push to isn't on the board: the digest lists it under Unstick.
_Avoid_: Blocked, failed

**Waiting for human**:
The stage for work only the maintainer can move on: an after-merge step, a green PR to review, an issue that needs the go-ahead, and an open decision, in that order. Each run's last step mirrors it onto GitHub as the `waiting-for-human` label, which nothing reads back.

**Behind another issue**:
The stage, at the bottom of the board, for issues blocked by another open issue. Each moves on once its blocker closes, and nothing there needs the maintainer until then.
_Avoid_: Blocked, on hold

**Parked**:
An issue the workshop deliberately won't pick up: a `plan`, no tier label, or assigned by hand. Parked items are counted under Waiting for human, not shown as cards that need you.
_Avoid_: Skipped, ignored
