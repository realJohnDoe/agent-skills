---
name: conventions
description: The labels and body sections the workshop dispatcher reads on issues and PRs, what an agent sets on each, and when and how to open a PR. Use when creating, labelling, ordering or triaging an issue, or opening or updating a PR, in a repo whose CLAUDE.md or AGENTS.md points to this skill.
---

# Conventions

The `dispatcher` skill reads these labels and sections to decide what a session starts on and what waits for the maintainer. `../dispatcher/scripts/decide.ts` is the authority on how it reads them, with `../_shared/markers.ts` for what every skill reads (the pause issue, marker comments, `Decision needed`, the can't-push issue); this skill is the authority on what to set. The `surveys` skill adds the survey labels, and a repo's own docs add labels of their own, such as Structra's `wayfinder:*`. A run that files many issues at once also follows `batch-findings.md` in this folder.

When you ask the maintainer to do something by hand, in an issue, PR, notification or reply, link the page where they do it, e.g. `https://github.com/<owner>/<repo>/settings/secrets/actions`. Skip the link only where no stable URL exists.

## Filing an issue

1. **Tier.** Exactly one tier label: the cheapest model that can do the work well, as the issue is written (see **Choosing a tier**). When in doubt, `opus`.
   - `haiku`: well-specified, mechanical work with a clear done-state: a config change, deleting code, a simple chore.
   - `sonnet`: well-scoped work that follows settled decisions.
   - `opus`: work that needs design, judgement or reasoning across modules.

   Work only a person can do (accounts, secrets, taste) gets no tier: say what is needed in a decision section (step 2). The tier names the model only; a plan (step 3) or a pending decision never moves it.
2. **Decision.** When the maintainer must decide or do something before an agent can work, add this section, keeping the tier the work needs once it is decided:

   ```markdown
   ## Decision needed

   One paragraph: the question, or what the maintainer must do.

   - **Option A:** what it means and what it costs.
   - **Option B:** …
   ```

   The board shows the first paragraph, so make it stand alone. The section stays open until it gains a `**Decided:** <answer>` line, which the maintainer adds on the issue, or a session they start from the board's ✳ chip; any agent recording a decision ends it the same way.
3. **Plan.** Work spanning several PRs that needs a plan first gets the `plan` label next to the tier label (the model the plan session runs on, usually `opus`). A `plan` issue is never dispatched: a person starts a plan session for it, which files the PRs' issues as sub-issues, each with its own tier.
4. **After merge.** When an issue needs a manual step once its PR has merged (switching a Pages source, say), or a check an agent can't observe before merging (a deploy or a workflow run the merge triggers), add an `## After merge` section whose first paragraph says what to do or watch and links the page where it's done (for a check, the workflow's runs page, and what to do if it fails, e.g. "revert #<pr>"); the board shows it. Whoever files the issue adds it, and an agent that discovers such a step adds it to the body. First check whether the PR can do the step itself: only what genuinely needs the maintainer goes there. The maintainer closes the issue once the step is done, and anything blocked by it waits until then.
5. **Order.** When one issue must wait for another, add a native blocked-by edge:

   ```sh
   gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>
   ```

   `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, or the `id` MCP `issue_write` returns), not its `#number`; the blocker may be in another repo. Use `gh api` because the GitHub MCP tools have no dependency tool, and it works where GraphQL is blocked. Check the edge with `gh api repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by --jq '.[].html_url'`. Only where `gh api` can't reach GitHub at all, put a `Blocked by: #n` line (`owner/repo#n` across repos) at the top of the body. To make an issue part of a larger one, make it a sub-issue: MCP `issue_write` with `parent_issue_number`, or `sub_issue_write` afterwards.
6. **Approval.** `ready-for-agent` is the maintainer's go-ahead and nothing is dispatched without it, so the issue waits under the board's **Waiting for human** until they add it. Agents never add it.

## Choosing a tier

The tier rates the work **as the issue is written**, so write it down a tier where you honestly can. Most `opus` ratings are really "`opus`, because the issue withheld what the worker would need". Give the issue the specifics that let a cheaper tier do it without re-deriving them, all verified: exact files and lines plus the call sites to update, the enumerated work with its values, measured numbers, the trap located to a file and line, a precedent in the repo (file and commit). Then rate it with those present.

- **Judge by how the work fails.** A wrong-but-plausible change that breaks the build, a type-check or a test is safe to hand down-tier; one that fails silently is not.
- **Name the hazard that sets the tier**: the trap that would void the fix, the invariant that fails quietly, the call site that's easy to miss. If naming it would let a lower tier do the job, say so, e.g. "`sonnet` if the cache key is specified; else `opus`".
- **Don't fake the downgrade.** Work that needs a judgement call the issue can't settle (a shared mutable singleton with no obvious owner, an abstraction whose shape the code doesn't determine) stays `opus`; say why the context doesn't help. A decision only the maintainer can make is not a reason for `opus`: put it in `## Decision needed` and rate the work that follows it.
- **Split what splits cleanly**: rate the specified half down and leave the rest where it belongs.
- **Rate the fix, not confirming it.** Re-running a build, a test suite, a measurement or a repro is scripted and suits the cheapest tier.

## Opening a PR

When a task leaves pushed commits on a branch with no open PR, open one, even if nobody asked. A draft PR is outside the workshop.

- **Template.** Fill in the repo's PR template if it has one.
- **Trace maps.** Use the `tracemap-pr` skill (from realJohnDoe/tracemap); it decides itself when none would help. If it can't attach them, say so in your reply.
- **Visual changes.** Under an `Acceptance check` heading, add before and after screenshots of each affected screen at desktop (1280px) and phone (390px) width, taken with headless Chromium from builds of the base and PR branches. Attach them with the `tracemap-pr` skill's method. In a cloud session `gh` can't upload, so that is its assets-branch fallback (`push-assets.sh`, which pushes a `tracemap-assets` branch), and that push is expected even when the session is otherwise limited to its own branch. "Can't" means you tried it and it failed: quote the error in the description. Screenshots of a mock or fixture are fine when the live page isn't reachable; say so. In a repo with PR previews, also label the PR `preview`.
- **Linking.** `Fixes #n` closes the issue. Write `Refs #n` instead when the issue has an `## After merge` section (including one you added yourself), or when part of it needs the maintainer's call: do the rest, and add a `## Decision needed` section to the issue body for what's left, since a question that is only in the PR is lost once it merges.
- **Gates.** Before every push, run the repo's gate command, named in its `CLAUDE.md` or `AGENTS.md` (else the checks in its CI workflows). The description gets one line, `Gates: <command> passed`; CI covers everything else.
- **Acceptance check.** Run the issue's before opening; for a browser check, headless Chrome is at `/usr/bin/google-chrome`. Only a limit you can name (a deployed origin, a secret) excuses it: name that limit in the description, and the dispatcher sends the PR to review instead of merging it. A check that can only run after merge (a deploy, a workflow run triggered by merge or close) is not excused by naming it in the PR, where nothing acts on it: add an `## After merge` section to the issue body (step 4 of **Filing an issue**) saying what to watch, where, and what to do if it fails, and link the PR with `Refs #n`. Such a PR may still carry `automerge`: it merges, and the board then asks the maintainer to watch.
- **`automerge`.** Label a PR for a `haiku` or `sonnet` issue `automerge`: the dispatcher merges it once CI is green and nobody has left review feedback. An `opus` PR goes unlabelled and waits for review, as does any PR whose acceptance check can only be done by hand.
- **Later changes.** Push to the same PR only while it is open: check its state right before pushing. If it was merged or closed, start a new branch from the latest default branch and open a new PR. When an open PR's purpose changes, refresh its description, trace maps and screenshots.

## Labels

| Label | Set by | Means |
|---|---|---|
| `automerge` | whoever opens the PR; a repo's Dependabot workflow for non-major bumps | Merged by the dispatcher once green and quiet |
| `preview` | whoever opens a PR that changes what a page looks like; the maintainer on any PR | Deploys a live preview of the PR, in a repo with PR previews |
| `ready-for-agent` | the maintainer only | The go-ahead to dispatch the issue (step 6, **Approval**). Agents never set it |
| `waiting-for-human` | the dispatcher only, each run | The item is in the board's Waiting for human stage: a filter for GitHub, as fresh as the last run. Never set, remove or read it to decide anything |

`decision-required` and `opus-plan` are retired: use a `## Decision needed` section, and `plan` with `opus`. The dispatcher still reads `opus-plan` as `plan` and ignores `decision-required`.
