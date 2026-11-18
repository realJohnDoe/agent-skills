---
name: conventions
description: The labels and body sections the workshop dispatcher reads on issues and PRs, what an agent sets on each, and when and how to open a PR. Use when creating, labelling, ordering or triaging an issue, or opening or updating a PR, in a repo whose CLAUDE.md or AGENTS.md points to this skill.
---

# Conventions

The `dispatcher` skill reads these labels and sections to decide what an agent session starts on and what waits for the maintainer. `../dispatcher/scripts/decide.ts` is the authority on how it reads them, and this skill is the authority on what to set. The `surveys` skill adds the survey labels, **Filing a batch of findings** below covers runs that file many issues at once, and a repo's own docs add labels of their own, such as Structra's `wayfinder:*`. Follow those as well.

Whenever you ask the maintainer to do something by hand, in an issue, PR, digest, notification or reply, link the page where they do it, e.g. `https://github.com/<owner>/<repo>/settings/secrets/actions` or `…/labels`, rather than describing how to navigate there. Skip it only where no stable URL exists.

## Filing an issue

1. **Tier.** Put exactly one tier label on the issue: the cheapest model that can do the work well, as the issue is written. See **Choosing a tier** below.
   - `haiku`: well-specified, mechanical work with a clear done-state, such as a config change, deleting code or a simple chore.
   - `sonnet`: well-scoped work that follows settled decisions.
   - `opus`: work that needs design, judgement or reasoning across modules.

   When in doubt, use `opus`. Work only a person can do (accounts, secrets, taste) gets no tier: say what is needed in a decision section (step 2).

   The tier says only which model does the work. Whether the work is a plan (step 3) or waits on a decision (step 2) is set separately and never moves the tier.
2. **Decision.** When the maintainer must decide or do something before an agent can work, add this section to the body. Keep the tier the work needs once it is decided:

   ```markdown
   ## Decision needed

   One paragraph: the question, or what the maintainer must do.

   - **Option A:** what it means and what it costs.
   - **Option B:** …
   ```

   The digest shows the first paragraph, so make it stand alone. The section stays open until it gains a `**Decided:** <answer>` line, which the dispatcher's relay adds when the maintainer answers on the digest. Any agent recording a decision ends the section the same way.
3. **Plan.** When the work spans several PRs and needs a plan before any of them, add the `plan` label next to the tier label. The tier is the model the plan session runs on, usually `opus`. A `plan` issue is never dispatched: a person starts a plan session for it, which files the PRs' issues as sub-issues, each with its own tier. `opus-plan` is retired; the dispatcher still reads it as `plan`.
4. **After merge.** When an issue needs a manual step once its PR has merged, e.g. switching a Pages source, add an `## After merge` section. Its first paragraph says what to do and links the page where it's done; the digest shows it, as with `## Decision needed`. Whoever files the issue adds it, and an agent that discovers such a step while working adds it to the issue body. First check whether the PR can do the step itself: only what genuinely needs the maintainer goes there. The maintainer closes the issue once the step is done. Anything blocked by it waits until then, not just until the merge.
5. **Order.** When one issue must wait for another, add a native blocked-by edge:

   ```sh
   gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>
   ```

   `<blocker-db-id>` is the blocker's numeric database id (the `id` that MCP `issue_write` returns, or `gh api repos/<owner>/<repo>/issues/<n> --jq .id`), not its `#number`. The blocker may be in another repo. This is a REST call, so it works where GraphQL is blocked and `gh issue`/`gh pr` commands fail. The GitHub MCP tools have no dependency tool, so use `gh api` for it. Check the edge took with `gh api repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by --jq '.[].html_url'`. Only where `gh api` can't reach GitHub at all, use a `Blocked by: #n` line at the top of the body instead; it may name an issue in another repo as `owner/repo#n`. To make an issue part of a larger one, make it a sub-issue: MCP `issue_write` with `parent_issue_number` (it may be in another repo), or `sub_issue_write` afterwards.
6. **Approval.** Leave approval to the maintainer. `ready-for-agent` is their go-ahead and nothing is dispatched without it, so the issue waits under the digest's **Waiting on you** until they add it. Agents never add it themselves. The one exception is the dispatcher relaying the maintainer's own `ready` reply.

Done when the issue has one tier label (or a decision section instead), `plan` if it is a multi-PR plan, a decision section if anything waits on the maintainer, and its blockers as edges.

## Choosing a tier

The tier rates the work **as the issue is written**, so write it down a tier where you honestly can. Most `opus` ratings are really "`opus`, because the issue withheld what the worker would need". Give the issue the specifics that let a cheaper tier do it without re-deriving them: exact files and lines (verified), the enumerated work, measured numbers, the trap located to a file and line, a precedent in the repo. Then rate it with those present.

- **Judge by how the work fails.** A wrong-but-plausible change that breaks the build, a type-check or a test is safe to hand down-tier; one that fails silently is not.
- **Name the hazard that sets the tier**: the trap that would void the fix, the invariant that fails quietly, the call site that's easy to miss. If naming it would let a lower tier do the job, say so, e.g. "`sonnet` if the cache key is specified; else `opus`".
- **Don't fake the downgrade.** Work that needs a judgement call the issue can't settle (a shared mutable singleton with no obvious owner, an abstraction whose shape the code doesn't determine) stays `opus`; say why the context doesn't help. A decision only the maintainer can make is not a reason for `opus`: put it in a `## Decision needed` section and rate the work that follows it.
- **Split what splits cleanly**: rate the specified half down and leave the rest where it belongs.
- **Rate the fix, not confirming it.** Re-running a build, a test suite, a measurement or a repro is scripted and suits the cheapest tier.

## Filing a batch of findings

A run that reviews code and files what it finds (a survey, the dependency maintenance pass) files a **parent issue** that records the run and one **sub-issue per finding**. The skill that runs it says where the parent lives, its title and labels, and what its body holds. The parent gets no tier label: it isn't work to dispatch.

**Search first.** A re-run mostly re-derives findings that are already open. Search the open parents of earlier runs and their sub-issues, and the repo's open issues for the thing the finding is about. A match gets a comment with the new evidence, not a second issue. Then read the newest *closed* parent's "deliberately not filed" section, which an open-issue search can't see.

**Where.** File each finding in the repo whose files the fix changes, even when the parent is elsewhere; a sub-issue may be in another repo. A fix to the workshop's shared files (the dispatcher's prompts, these conventions, the survey skills) goes in the workshop's own repo, the digest repo the `dispatcher` skill names.

**Fields.** Every finding has these; the running skill adds its own (a category, an impact scale):

- **Title**: short label.
- **Breadth**: the number of **files** affected, from a search (grep/glob) you name; write "est." if you estimated. Where the exposure is a *condition* ("every entry, whenever two tabs are open"), say that instead, still naming the search, including one with **zero** hits where absence is the point.
- **Tier**: per **Choosing a tier**, rated with the Task context present, plus `plan` where the fix spans several PRs.
- **Evidence**: at least one file path plus a short **verbatim quote** from it, grep-safe: quote a span on one line, or give the line range. For a toolchain or registry finding, a config quote plus the command and its output (dated) is evidence.
- **Problem**: one sentence: what is wrong and why it matters.
- **Fix**: one sentence: the concrete change, and the check that shows it's done. Where the run measured something, say how the measurement should read afterwards.
- **Task context**: what lets the tier work without re-deriving it, each item listed under **Choosing a tier**, verified: exact files and lines plus the call sites to update, the enumerated work with its values, measured numbers and when to re-measure, the trap at a file and line, the precedent (file and commit). For an extraction, state what the moved code depends on *and* what still depends on it, and say you checked both.

**Closing.** A finding closes when a PR saying `Fixes #N` merges. Dropping one is a close as `not planned` with a comment saying why; setting one aside is removing `ready-for-agent` plus a comment. At the start of each run, close every open parent of that kind whose sub-issues are all closed, as completed, with a comment linking its findings (`#n` each). Find them with:

```bash
gh api --paginate "repos/<owner/repo>/issues?labels=<label>&state=open&per_page=100" \
  --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>0 and .sub_issues_summary.total==.sub_issues_summary.completed) | .number'
```

A parent with any open sub-issue stays open.

## Opening a PR

When a task leaves pushed commits on a branch with no open PR, open one, even if nobody asked. Fill in the repo's PR template if it has one. Then use the `tracemap-pr` skill (from realJohnDoe/tracemap) to add trace maps to the description; it decides itself when none would help, and if it can't attach them, say so in your reply. When the PR changes what a page looks like, add before and after screenshots of each affected screen at desktop (1280px) and phone (390px) width under an `Acceptance check` heading. Take them with headless Chromium from builds of the base branch and the PR branch, and attach them the way `tracemap-pr` attaches its images. If you can't, say why under that heading. In a repo with PR previews, also label such a PR `preview`, so the reviewer can click through it. Push later changes to the same PR only while it is still open: check its state right before you push, because it may have been merged or closed since you last looked. If it isn't open, start a new branch from the latest default branch and open a new PR for the changes. When an open PR's purpose changes, refresh its description, trace maps and screenshots.

Close the issue from the body with `Fixes #n`. For an issue with an `## After merge` section write `Refs #n` instead, so it stays open until the maintainer has done the step; the PR is otherwise handled the same, `automerge` included. Label a PR for a `haiku` or `sonnet` issue `automerge`: the dispatcher merges it once CI is green and nobody has left review feedback. A PR for an `opus` issue goes without the label and waits for review. A draft PR is outside the workshop.

## Labels

| Label | Where | Set by | Means |
|---|---|---|---|
| `haiku` / `sonnet` / `opus` | issue | whoever files it | The model a session runs on, once the issue is approved and unblocked |
| `plan` | issue | whoever files it | A plan spanning several PRs, alongside a tier label; never dispatched |
| `ready-for-agent` | issue | the maintainer | The go-ahead; with a tier label, the issue is dispatched once unblocked; removing it parks the issue under Go ahead? |
| `automerge` | PR | whoever opens it; a repo's Dependabot workflow for non-major bumps | Merged by the dispatcher once green and quiet |
| `preview` | PR | whoever opens a PR that changes what a page looks like; the maintainer on any PR | Deploys a live preview of the PR, in a repo with PR previews |
| `waiting-for-human` | issue, PR | the dispatcher only, at the end of each run | It is in the board's Waiting for human stage: a filter for GitHub, as fresh as the last run. Never set or remove it by hand, and never read it to decide anything: the dispatcher rewrites it from the stage each run |

`decision-required` is retired. A `## Decision needed` section replaces it, and the dispatcher ignores the label. `opus-plan` is retired too: use `plan` with `opus`.

## Triage roles

Skills written for mattpocock/skills name five triage roles. In a workshop repo they map as follows, unless the repo's `docs/agents/triage-labels.md` says otherwise:

| Role | In a workshop repo |
|---|---|
| `needs-triage` | no `ready-for-agent` yet |
| `needs-info`, `ready-for-human` | an open `## Decision needed` section |
| `ready-for-agent` | a tier label; the maintainer adds `ready-for-agent` itself |
| `wontfix` | close as `not planned` |
