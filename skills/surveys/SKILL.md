---
name: surveys
description: Shared conventions for every survey skill (`survey-*`, the plugin's and a repo's own), and the chooser that picks which survey runs next in which workshop repo. Use when the `timetable` skill starts the survey run, before running or editing any survey, or to see which survey is due.
---

# Surveys

Run every script from the session's working directory, never after a `cd` into the skill's directory: they look for the attached repos from where they are run.

A survey reviews one repo for one kind of problem and files what it finds as issues there. Each `survey-*` skill states only what is specific to it (its categories, its findings cap, its targets) and points here for the rest. The plugin ships `survey-retro`. A repo can add its own in `.claude/skills/survey-*/`; one with the same name as a plugin survey replaces it for that repo. A survey run produces no file: it is a parent issue with its findings as sub-issues (see **Reporting**).

## Starting the next survey

The survey run, which the `timetable` skill starts, follows these steps. Each run surveys one repo, with one survey.

1. **Close finished parents.** In each attached repo, close the finished parents labelled `survey`, per `../conventions/batch-findings.md`, **Closing**.
2. **Choose.** Run `node <this skill's directory>/scripts/survey-next.ts` (see **Choosing the next survey**). If `top` is `null`, stop: post nothing, open nothing.
3. **List the top five.** Before starting anything, print the five highest-scoring pairs in `pairs` that have no `skip` (fewer if fewer qualify), as a table in rank order: survey, repo, `days`, `activity`, `score`. The first row is `top`.
4. **Run it.** Run the skill at `top.skill` on `top.repo`, in a worktree of that repo's checkout. The parent issue's body opens with a **Why this survey** line: `top`'s `lastRun`, `since`, `days`, `activity` and `score`, and that it ranked first of the pairs the chooser scored, followed by the top-five table from step 3.

## Choosing the next survey

`scripts/survey-next.ts` scores every (survey, repo) pair over the repos attached to the session, found as the dispatcher finds them (`--checkouts`, `--repos`; see the `dispatcher` skill's **Configuring**). It is read-only apart from un-shallowing a shallow clone, and prints JSON: every pair with its inputs, highest score first, and `top`.

`score = days since that survey last ran on that repo × activity in its scope since then`

- **Last run:** the newest issue in that repo labelled `survey` plus the survey's `label` (or, filed before the `survey` label, one with that `label` and sub-issues). A repo that has none counts from its first commit, so a repo never surveyed ranks high.
- **Activity:** set by the survey's `scope` frontmatter, which a repo's overlay overrides with a `## <label> scope` heading holding the pathspecs. `sessions` (retro) counts the PRs opened since that name an agent session (`_shared/sessions.ts`, which the retro's `retro-candidates.ts` also reads). Anything else is git pathspecs, and counts the first-parent commits (merged PRs) touching them.
- **Skipped** (`skip` says why), each per repo: the pair while that repo has an open parent for that survey with a finding the workshop can still work on (open, no undecided `## Decision needed`), and every pair of a repo with 3 or more open `survey-finding` issues.
- **`top`** is the highest-scoring pair not skipped, or `null` when every such score is 0.

A survey skill declares `label` (its survey-type label) and `scope` in its frontmatter; one without both stops the chooser.

`scripts/survey-next.test.ts` pins the scoring and both gates, running the chooser over two real git clones against the dispatcher's fake `gh`. Change it first when you change either.

## Per-repo overlay

A repo may describe itself to the surveys in `docs/agents/survey.md`. Every heading is optional, and a missing file or heading means its default. The skills name the headings they read:

- `## Gates`: the commands a session must pass before pushing (lint, typecheck, tests, build). Default: what the repo's CI workflows, build scripts and `CLAUDE.md` say.
- `## Environment limits`: what a survey session can't do there (a backend it can't reach, types to generate before lint means anything, fixtures to use instead of writing a generator). Record them in the coverage statement up front rather than discovering them mid-pass. Default: none known.

A survey may read headings of its own, named after its label (`## Health scope`, `## Health corpora`): its skill says which.

Nothing in this plugin names a repo, its paths or its issues: those belong in the overlay or the repo's own survey skills.

## Running a survey

- **Survey first, write second.** State your plan before you start (scan plan, trace plan, threat plan, or Phase 0, whichever the survey calls for), complete it, and only then write the report. For each category say what you'll look for *beyond* the listed examples: the bullets are illustrations, not your search space. Do not draft the verdict early and select findings to confirm it.
- **Evaluate the code on its merits.** Treat claims in `CLAUDE.md`, `AGENTS.md` files, READMEs and code comments ("this exception is deliberate", "this is debounced", "a refactor is planned") as hypotheses to verify, not settled exceptions. A documented rationale that no longer holds is itself a finding, and so is an invariant asserted in a doc but neither enforced nor tested. That includes the repo's claims about its own history.
- **Verify capability claims by inspection, not memory.** Check the *installed* version of a plugin or library (its actual rule set, exports, component inventory or API) against what the config enables; never infer it from a version number, and never let "latest" come from training data instead of a registry query. Where cheap, verify by dry-run: run the tool with the candidate config and report the real count and distribution. Clean up temp files and instrumentation afterwards; leave the working tree clean.
- **The category ranking is a tiebreaker, not a filter.** A serious finding in any category outranks a minor finding in a higher-priority one. Never omit a high-impact issue because its category ranks lower.
- **Un-shallow the clone before you read any git history.** A session's checkout is often a shallow clone, and `git log` then answers silently from a truncated graph: the boundary looks exactly like the start of the project. Check with `git rev-parse --is-shallow-repository`, fix with `git fetch --unshallow`, and record the history's true span next to any tally you report.
- **Read the merged-PR history for defect classes, not just for churn.** Commits tell you what changed; PR titles tell you what was *wrong*, which is the question a survey is asking. Sample the last ~200 and tally what was being fixed. A class the repo keeps paying for that no category names is a finding *about the survey*: fix it with a diff on the survey file (see the last section).
- **Run what you need.** A survey that requires a measurement, a screenshot or the dev server says so, and that pass is the ask, whatever a repo's rule about not driving the dev server unprompted says. Without preview tools, start the dev server yourself on a unique port (`--strictPort`) and drive Chromium with Playwright at 390×844 and 1440×900; a repo that pins its own Playwright launches with `executablePath: '/opt/pw-browsers/chromium'`. The overlay's `## Environment limits` holds the repo's part (the dev-server command, storage keys to set in an init script). Only if that fails too, say so in the coverage statement and mark the categories it affects **partially assessed**: an admitted gap beats an impression inferred from tokens or source.
- **Expect vendor sites to be blocked.** The sandbox's egress proxy refuses many hosts. Before giving up on a claim, try `WebSearch` and the vendor's secondary hosts (its GitHub, its developer docs). A claim no source could be reached for is **could not verify** in the coverage statement, with the blocked host named, never "verified" from memory.

## Ranking findings

Rank by `(impact × breadth) ÷ effort`, where `effort` is the tier read as an ordinal (`haiku` = 1, `sonnet` = 2, `opus` = 3), plus 2 for a `plan`. A decision section doesn't change effort. Report impact, breadth, tier and `plan` as separate fields. Put a short **summary table** above the findings (finding → tier, `plan`, open decision, plus that survey's other columns).

Where findings touch the same code, add a one-line **sequencing note** saying which order avoids rebasing the same file twice, and record it as a native blocked-by edge on the later finding (`conventions`, **Order**). Open findings that can start now:

```bash
gh api repos/<owner/repo>/issues/<parent>/sub_issues --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0) | .number'
```

## Report structure

The parent issue's body has four parts, in this order. A survey's skill names its verdict and adds only what is its own to each part.

1. **Verdict** (~5 sentences): the plain-language headline. Name the worst one or two areas and the single biggest theme; the findings are the evidence.
2. **Coverage statement:** what you examined closely, what you only sampled and what you skipped, each skip with its reason; each gate's result, if the survey runs them; how the overlay's environment limits shaped the run; and anything you suspect but did not investigate, flagged **unverified**. A suspicion without the evidence the survey asks of a finding (a reproduction, a measurement, a probe) goes here as unverified, not into the findings.
3. **Category verdicts** (below).
4. **Findings**, the survey's top N, under the summary table.

## Finding fields

`Title`, `Breadth`, `Tier`, `Evidence`, `Problem`, `Fix` and `Task context` are the shared fields (`../conventions/batch-findings.md`). Each survey adds its own: its `Category` tags, its `Impact` scale, and what "fails silently" looks like in its domain, since that sets the tier. An architecture change spanning several PRs is `plan`, a product decision only the maintainer can make is a `## Decision needed`, and neither raises the tier.

Re-rank after writing the Task context, since the tier feeds the ranking. Carry rank as its own column in the parent's summary table; a finding's identity is its issue number.

**Prefer systemic and structural findings over isolated, line-level ones.** A pattern across 10 files beats one misused function. Cite real code, no generic observations.

## Category verdicts

Every report has one line per category, with exactly one verdict:

- **clean**: the plan for this category was fully executed and nothing worth reporting turned up;
- **findings: #N, #M**: pointing at the findings;
- **partially assessed**: say what part of the plan was skipped and why;
- **below the cut**: the category turned up something real that lost its slot to the cap. Record it after the findings in one short paragraph, marked sub-threshold, with its evidence and impact, and don't file it.

A category may only be called **clean** if its plan actually ran, never as a default for one that ran out of budget or whose finding didn't survive the ranking.

## Don't pad the findings list

Every survey caps its findings at a stated top-N. Include everything that makes the cut, however low its score. Do not pad the list to reach N: a short report grounded in evidence beats a long one built on speculation. One or two **below the cut** verdicts mean the cap is working; more mean the cap is wrong for this run, so say so in the verdict.

## Reporting

Search, file and close per `../conventions/batch-findings.md`. What a survey adds:

- **One parent issue per run**, in the surveyed repo, titled with the survey, its scope and the date, labelled `survey` plus the survey-type label, the survey's frontmatter `label` (`health`, not `survey-health`; on a repo's first run, create these and `survey-finding` with `gh api -X POST repos/<owner/repo>/labels`: the chooser finds runs by them). Its body carries the **Why this survey** line, the coverage statement, the category verdicts and the summary table, with each row linking its finding's sub-issue rather than restating it.
- **One sub-issue per finding**, attached to the parent (the repo's `survey-finding` issue template, if it has one, is the skeleton). Label each with the survey's `Category` tag(s), `survey-finding`, the survey-type label, a tier label, and `plan` where it applies, plus a `## Decision needed` section when it hinges on a decision only the maintainer can make, all per the `conventions` skill. Never `ready-for-agent`: that is the maintainer's go-ahead (`conventions`, **Approval**).
- **Search first** among the repo's open parents with the survey-type label and their sub-issues.
- A fix that adds a cache, memo or incremental-update path ships a test that its output deep-equals a full recompute. The fixer re-runs the finding's acceptance check before it closes.

**Suggest improvements to the survey itself, as a diff on its skill file.** A real run is evidence about where a survey is unclear, stale or wrong: an ambiguous instruction, an unmeasurable budget item, a category boundary that didn't hold, a scoring rule that produced a counterintuitive order. After the run, edit the survey's `SKILL.md` (a plugin survey's lives in the workshop's own repo) as its own commit, separate from filing the run and from any product fix, on the branch the session is already working on. Open its PR labelled `automerge` (see `conventions`) and note in the parent issue, in one line, that the survey file was updated and why. Keep it to process learnings; findings are issues.

**Bias that diff toward shrinking.** A run's evidence naturally produces an addition, and nothing pushes back, so survey files only grow. Before adding, check whether something should be cut or merged instead: a caveat now enforced by a lint rule, CI check or test (cut it, or shrink it to the line naming what enforces it); two passages making the same point (keep the more precise); a worked example the rule no longer needs at full length. A real new failure mode still earns its bullet, but a survey file that only ever grows is itself a finding about the survey.
