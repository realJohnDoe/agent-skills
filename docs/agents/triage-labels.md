# Triage Labels

The skills speak in terms of five canonical triage roles. This repo has no separate triage labels: the roles map onto the workshop labels the `dispatcher` skill acts on (`skills/dispatcher/SKILL.md`, **Labels**), as in Meridian.

| Label in mattpocock/skills | In our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | an issue without `ready-for-agent` (listed under the digest's Triage once it has a tier label) | Maintainer needs to evaluate this issue |
| `needs-info` | `decision-required` | Waiting on the maintainer to decide |
| `ready-for-agent` | `ready-for-agent` plus a tier label (`haiku`, `sonnet` or `opus`), and no `decision-required` or `deferred` | Fully specified and approved; the dispatcher starts a session on that model |
| `ready-for-human` | `decision-required` | Requires the maintainer |
| `wontfix` | close as `not planned` (no label) | Will not be actioned |

Only the maintainer adds `ready-for-agent`. When a skill mentions a role (e.g. "apply the AFK-ready triage label"), don't add it: apply the tier label for the cheapest model that can do the work well (exactly one), or `opus-plan` for a plan spanning several PRs (never dispatched). The issue then waits under the digest's Triage until the maintainer approves it. `deferred` parks an issue on purpose.
