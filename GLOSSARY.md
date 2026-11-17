# Agent skills

The skills in this repo, and the workshop they run: an automated loop that works through issues in several repos and reports to one maintainer.

## Language

### The workshop

**Workshop**:
The whole system of scheduled runs that dispatches issues to agent sessions, follows up on their PRs and merges them, across every attached repo.
_Avoid_: Factory, pipeline

**Digest**:
The one issue in the digest repo where the workshop lists what waits on the maintainer, and the only place the maintainer takes decisions.
_Avoid_: Report, summary

**Workshop board**:
A read-only public page that shows every open issue and PR of the workshop by stage. You can look at it, but you can't decide anything on it.
_Avoid_: Dashboard, kanban

### On the board

**Stage**:
Where an issue or PR stands in the workshop's flow: Stuck, Waiting, Queue, PR in progress, After merge or Closed. Each item is in exactly one stage.
_Avoid_: Column, status

**Stuck**:
The stage for work the workshop can't move without the maintainer stepping in. That covers a PR at its follow-up cap, a stale follow-up, a dispatched issue with no PR, and a repo it can't push to.
_Avoid_: Blocked, failed

**Parked**:
An issue the workshop deliberately won't pick up: `deferred`, a `plan`, no tier label, or assigned by hand. Parked items are counted under Waiting, not shown as cards that need you.
_Avoid_: Skipped, ignored
