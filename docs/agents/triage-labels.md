# Triage Labels

The skills speak in terms of five canonical triage roles. This repo has no separate triage labels: the roles map onto the workshop labels the `dispatcher` skill acts on (`skills/dispatcher/SKILL.md`, **Labels**), as in Meridian.

| Label in mattpocock/skills | In our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | an issue with no tier label | Maintainer needs to evaluate this issue |
| `needs-info` | `decision-required` | Waiting on the maintainer to decide |
| `ready-for-agent` | a tier label (`haiku`, `sonnet` or `opus`) and no `decision-required` or `deferred` | Fully specified; the dispatcher starts a session on that model |
| `ready-for-human` | `decision-required` | Requires the maintainer |
| `wontfix` | close as `not planned` (no label) | Will not be actioned |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), apply the tier label for the cheapest model that can do the work well (exactly one), or `opus-plan` for a plan spanning several PRs (never dispatched). `deferred` parks an issue on purpose.
