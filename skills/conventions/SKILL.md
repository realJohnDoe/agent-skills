---
name: conventions
description: The labels and body sections the workshop dispatcher reads on issues and PRs, what an agent sets on each, and when and how to open a PR. Use when creating, labelling, ordering or triaging an issue, or opening or updating a PR, in a repo the workshop dispatches (meridian, tracemap, structra, kenpo-notes, rentenluecke, agent-skills).
---

# Conventions

The `dispatcher` skill reads these labels and sections to decide what an agent session starts on and what waits for the maintainer. `../dispatcher/scripts/decide.ts` is the authority on how it reads them, and this skill is the authority on what to set. A repo's own docs add labels of their own, such as Meridian's survey labels or Structra's `wayfinder:*`. Follow those as well.

Whenever you ask the maintainer to do something by hand, in an issue, PR, digest, notification or reply, link the page where they do it, e.g. `https://github.com/<owner>/<repo>/settings/secrets/actions` or `…/labels`, rather than describing how to navigate there. Skip it only where no stable URL exists.

## Filing an issue

1. **Tier.** Put exactly one tier label on the issue: the cheapest model that can do the work well.
   - `haiku`: well-specified, mechanical work with a clear done-state, such as a config change, deleting code or a simple chore.
   - `sonnet`: well-scoped work that follows settled decisions.
   - `opus`: work that needs design, judgement or reasoning across modules.
   - `opus-plan`: a plan spanning several PRs. It is never dispatched; a person starts a plan session for it.

   When in doubt, use `opus`. Work only a person can do (accounts, secrets, taste) gets no tier: say what is needed in a decision section (step 2).
2. **Decision.** When the maintainer must decide or do something before an agent can work, add this section to the body:

   ```markdown
   ## Decision needed

   One paragraph: the question, or what the maintainer must do.

   - **Option A:** what it means and what it costs.
   - **Option B:** …
   ```

   The digest shows the first paragraph, so make it stand alone. The section stays open until it gains a `**Decided:** <answer>` line, which the dispatcher's relay adds when the maintainer answers on the digest. Any agent recording a decision ends the section the same way.
3. **After merge.** When an issue needs a manual step once its PR has merged, e.g. switching a Pages source, add an `## After merge` section. Its first paragraph says what to do and links the page where it's done; the digest shows it, as with `## Decision needed`. Whoever files the issue adds it, and an agent that discovers such a step while working adds it to the issue body. First check whether the PR can do the step itself: only what genuinely needs the maintainer goes there. The maintainer closes the issue once the step is done. Anything blocked by it waits until then, not just until the merge.
4. **Order.** When one issue must wait for another, add a native blocked-by edge:

   ```sh
   gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>
   ```

   `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`), not its `#number`. Only where native dependencies are unavailable, use a `Blocked by: #n` line at the top of the body instead. To make an issue part of a larger one, make it a sub-issue: `gh issue create --parent <n>`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards. Where `gh` is missing, use the GitHub MCP tools (`issue_write`, `sub_issue_write`, …) the same way.
5. **Approval.** Leave approval to the maintainer. `ready-for-agent` is their go-ahead and nothing is dispatched without it, so the issue waits under the digest's **Waiting on you** until they add it. Agents never add it themselves. The one exception is the dispatcher relaying the maintainer's own `ready` reply.

Done when the issue has one tier label (or a decision section instead), a decision section if anything waits on the maintainer, and its blockers as edges.

## Opening a PR

When a task leaves pushed commits on a branch with no open PR, open one, even if nobody asked. Fill in the repo's PR template if it has one. Then use the `tracemap-pr` skill (from realJohnDoe/tracemap) to add trace maps to the description; it decides itself when none would help, and if it can't attach them, say so in your reply. When the PR changes what a page looks like, add before and after screenshots of each affected screen at desktop (1280px) and phone (390px) width under an `Acceptance check` heading. Take them with headless Chromium from builds of the base branch and the PR branch, and attach them the way `tracemap-pr` attaches its images. If you can't, say why under that heading. Push later changes to the same PR, and refresh its description, trace maps and screenshots when the PR's purpose changes.

Close the issue from the body with `Fixes #n`. For an issue with an `## After merge` section write `Refs #n` instead, so it stays open until the maintainer has done the step; the PR is otherwise handled the same, `automerge` included. Label a PR for a `haiku` or `sonnet` issue `automerge`: the dispatcher merges it once CI is green and nobody has left review feedback. A PR for an `opus` issue goes without the label and waits for review. A draft PR is outside the workshop.

## Labels

| Label | Where | Set by | Means |
|---|---|---|---|
| `haiku` / `sonnet` / `opus` | issue | whoever files it | The model a session runs on, once the issue is approved and unblocked |
| `opus-plan` | issue | whoever files it | A plan spanning several PRs; never dispatched |
| `ready-for-agent` | issue | the maintainer | The go-ahead; with a tier label, the issue is dispatched once unblocked |
| `deferred` | issue, PR | the maintainer, or a workshop pause | Parked on purpose; listed under Not picked up until removed |
| `automerge` | PR | whoever opens it; a repo's Dependabot workflow for non-major bumps | Merged by the dispatcher once green and quiet |

`decision-required` is retired. A `## Decision needed` section replaces it, and the dispatcher ignores the label.

## Triage roles

Skills written for mattpocock/skills name five triage roles. In a workshop repo they map as follows, unless the repo's `docs/agents/triage-labels.md` says otherwise:

| Role | In a workshop repo |
|---|---|
| `needs-triage` | no `ready-for-agent` yet |
| `needs-info`, `ready-for-human` | an open `## Decision needed` section |
| `ready-for-agent` | a tier label; the maintainer adds `ready-for-agent` itself |
| `wontfix` | close as `not planned` |
