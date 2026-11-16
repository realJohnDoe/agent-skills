---
name: surveys
description: Shared conventions for every survey skill (`survey-*`, the plugin's and a repo's own), and the chooser that picks which survey runs next in which workshop repo. Use when the scheduled survey run fires, before running or editing any survey, or to see which survey is due.
---

# Surveys

A survey reviews one repo for one kind of problem and files what it finds as issues there. Each `survey-*` skill states only what is specific to it (its categories, its findings cap, its targets) and points here for the rest. The plugin ships `survey-retro`. A repo can add its own in `.claude/skills/survey-*/`; one with the same name as a plugin survey replaces it for that repo. A survey run produces no file: it is a parent issue with its findings as sub-issues (see **Reporting**).

## Starting the next survey

The scheduled survey run follows these steps. Each run surveys one repo, with one survey.

1. **Close finished parents.** In each attached repo, every open issue labelled `survey` whose sub-issues are all closed gets a comment linking its findings (`#n` each), then is closed as completed:

   ```bash
   gh api --paginate "repos/<owner/repo>/issues?labels=survey&state=open&per_page=100" \
     --jq '.[] | select(.pull_request|not) | select(.sub_issues_summary.total>0 and .sub_issues_summary.total==.sub_issues_summary.completed) | .number'
   ```
2. **Choose.** Run `node <this skill's directory>/scripts/survey-next.ts` (see **Choosing the next survey**). If `top` is `null`, stop: post nothing, open nothing.
3. **Run it.** Run the skill at `top.skill` on `top.repo`, in a worktree of that repo's checkout. The parent issue's body opens with a **Why this survey** line: `top`'s `lastRun`, `since`, `days`, `activity` and `score`, and that it ranked first of the pairs the chooser scored.

## Choosing the next survey

`scripts/survey-next.ts` scores every (survey, repo) pair over the repos attached to the session, found as the dispatcher finds them (`--checkouts`, `--repos`; see the `dispatcher` skill's **Configuring**). It is read-only apart from un-shallowing a shallow clone, and prints JSON: every pair with its inputs, highest score first, and `top`.

`score = days since that survey last ran on that repo × activity in its scope since then`

- **Last run:** the newest issue in that repo labelled `survey` plus the survey's `label` (or, filed before the `survey` label, one with that `label` and sub-issues). A repo that has none counts from its first commit, so a repo never surveyed ranks high.
- **Activity:** set by the survey's `scope` frontmatter. `sessions` (retro) counts the PRs opened since that name an agent session (`survey-retro/scripts/retro-candidates.ts`). Anything else is git pathspecs, and counts the first-parent commits (merged PRs) touching them.
- **Skipped** (`skip` says why), each per repo: the pair while that repo has an open parent for that survey with a finding the workshop can still work on (open, not `deferred`, no undecided `## Decision needed`), and every pair of a repo with 3 or more open `survey-finding` issues.
- **`top`** is the highest-scoring pair not skipped, or `null` when every such score is 0.

A survey skill declares `label` (its survey-type label) and `scope` in its frontmatter; one without both stops the chooser.

`scripts/survey-next.test.ts` pins the scoring and both gates, running the chooser over two real git clones against the dispatcher's fake `gh`. Change it first when you change either.

## Per-repo overlay

A repo may describe itself to the surveys in `docs/agents/survey.md`. Every heading is optional, and a missing file or heading means its default. The skills name the headings they read:

- `## Gates`: the commands a session must pass before pushing (lint, typecheck, tests, build). Default: what the repo's CI workflows, build scripts and `CLAUDE.md` say.
- `## Environment limits`: what a survey session can't do there (a backend it can't reach, types to generate before lint means anything, fixtures to use instead of writing a generator). Record them in the coverage statement up front rather than discovering them mid-pass. Default: none known.

Nothing in this plugin names a repo, its paths or its issues: those belong in the overlay or the repo's own survey skills.

## Running a survey

- **Survey first, write second.** State your plan before you start (scan plan, trace plan, threat plan, or Phase 0, whichever the survey calls for), complete it, and only then write the report. For each category say what you'll look for *beyond* the listed examples: the bullets are illustrations, not your search space. Do not draft the verdict early and select findings to confirm it.
- **Evaluate the code on its merits.** Treat claims in `CLAUDE.md`, `AGENTS.md` files, READMEs and code comments ("this exception is deliberate", "this is debounced", "a refactor is planned") as hypotheses to verify, not settled exceptions. A documented rationale that no longer holds is itself a finding, and so is an invariant asserted in a doc but neither enforced nor tested. That includes the repo's claims about its own history.
- **Verify capability claims by inspection, not memory.** Check the *installed* version of a plugin or library (its actual rule set, exports, component inventory or API) against what the config enables; never infer it from a version number, and never let "latest" come from training data instead of a registry query. Where cheap, verify by dry-run: run the tool with the candidate config and report the real count and distribution. Clean up temp files and instrumentation afterwards; leave the working tree clean.
- **The category ranking is a tiebreaker, not a filter.** A serious finding in any category outranks a minor finding in a higher-priority one. Never omit a high-impact issue because its category ranks lower.
- **Un-shallow the clone before you read any git history.** A session's checkout is often a shallow clone, and `git log` then answers silently from a truncated graph: the boundary looks exactly like the start of the project. Check with `git rev-parse --is-shallow-repository`, fix with `git fetch --unshallow`, and record the history's true span next to any tally you report.
- **Read the merged-PR history for defect classes, not just for churn.** Commits tell you what changed; PR titles tell you what was *wrong*, which is the question a survey is asking. Sample the last ~200 and tally what was being fixed. A class the repo keeps paying for that no category names is a finding *about the survey*: fix it with a diff on the survey file (see the last section).
- **Run what you need.** A survey that requires a measurement, a screenshot or the dev server says so, and that pass is the ask, whatever a repo's rule about not driving the dev server unprompted says.

## Recommended model tiers

Every finding is tagged with a **Recommended model**: the cheapest tier capable of doing the fix well, **Haiku 4.5** / **Sonnet 5** / **Opus 5** / **Opus 5 in plan mode, for a plan spanning multiple PRs** (or the current equivalent tier, if these names have moved on).

Judge by how much of the fix is load-bearing judgement versus mechanical edit, and by **how the fix fails**. A wrong-but-plausible change that breaks the build, a type-check or a test is far safer to hand down-tier than one that fails silently; each survey names what "fails silently" looks like in its own domain. Reserve plan mode + multi-PR for findings that need an architecture change **or** a product decision only the user should make.

**Always state the specific hazard that sets the tier**: the trap that would void the fix, the invariant that fails quietly, the interacting call site that's easy to miss. If naming that hazard would let a lower tier do the job, say so (e.g. "Sonnet 5 if the cache key is specified in the task; else Opus 5").

## Write findings down to Sonnet 5 where you honestly can

The tier is a property of the finding *as written*. Most Opus-tier ratings are really "Opus, because the report withheld what the fixer would need". So give every finding a **Task context** block carrying the specifics that let the named tier work without re-deriving them, and rate the tier against the finding *with* that block. What belongs there:

- **Exact locations.** File plus line or line range for every site to change, and the call sites to update. Verify the numbers before writing them down; a confidently wrong line number is worse than none.
- **The enumerated work.** If the fix is "add the missing N things", list all N with their values. If it is a move, say what moves and what stays.
- **Measured numbers** the fixer would otherwise re-derive (coverage percentages, a dry-run's error count and distribution, a benchmark baseline), and when to re-measure rather than trust them.
- **The trap, located.** Not "watch out for the animation" but "`Foo.tsx:57` branches on this prop being `undefined`". A hazard with a file and line is context; without one it is a warning.
- **The precedent.** If the repo has already solved this shape, name the file and the commit.
- **The seam, verified in both directions.** For any extraction, state what the moved code depends on *and* what still depends on it, and say you checked.

**Do not fake the downgrade.** A finding that needs a judgement call (a shared mutable singleton with no obvious owner, a product decision, an abstraction whose shape the code doesn't determine) stays at Opus 5: say so and why the context doesn't help. Where a finding splits cleanly, split it: rate the specified half down and leave the decision half where it belongs.

Re-rank after writing the blocks, since the tier feeds the ranking. Carry rank as its own column in the parent's summary table; a finding's identity is its issue number.

## Ranking findings

Rank by `(impact × breadth) ÷ effort`, where `effort` is the tier read as an ordinal (Haiku 4.5 = 1, Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode/multi-PR = 5), but report impact, breadth and recommended model as separate fields. Put a short **summary table** above the findings (finding → recommended model, plus that survey's other columns).

The tier rates **the fix**, not confirming it: re-running a build, a test suite, a measurement or a repro is scripted and suits the cheapest tier. Where findings touch the same code, add a one-line **sequencing note** saying which order avoids rebasing the same file twice, and record it as a native blocked-by edge on the later finding (`conventions`, **Order**). Open findings that can start now:

```bash
gh api repos/<owner/repo>/issues/<parent>/sub_issues --jq '.[] | select(.state=="open" and .issue_dependencies_summary.blocked_by==0) | .number'
```

## Finding fields

Six fields are the same in every survey. Each survey adds its own (its `Category` tags, its `Impact` scale, and whatever its domain needs).

- **Title**: short label.
- **Breadth**: the number of **files** affected, from an actual search (grep/glob) you can name; write "est." if you estimated. Where the exposure is a *condition* ("every entry, whenever two tabs are open"), say that instead, still naming the search, including a grep with **zero** hits where absence is the point.
- **Recommended model**: per **Recommended model tiers**, rated with the Task context block present.
- **Evidence**: at least one file path plus a short **verbatim quote** from it, grep-safe: quote a span on one line, or say so and give the line range. For toolchain findings a config quote plus a dry-run result is evidence.
- **Problem**: one sentence: what is wrong and why it matters.
- **Fix**: one sentence: the concrete change. Where the survey measures something, also say how the measurement should read afterwards.

**Prefer systemic and structural findings over isolated, line-level ones.** A pattern across 10 files beats one misused function. Cite real code, no generic observations.

## Category verdicts

Every report has one line per category, with exactly one verdict:

- **clean**: the plan for this category was fully executed and nothing worth reporting turned up;
- **findings: #N, #M**: pointing at the findings;
- **partially assessed**: say what part of the plan was skipped and why.

A category may only be called **clean** if its plan actually ran, never as a default for one that ran out of budget.

## Don't pad the findings list

Every survey caps its findings at a stated top-N. Include everything that makes the cut, however low its score. Do not pad the list to reach N: a short report grounded in evidence beats a long one built on speculation.

## Reporting

- **One parent issue per run**, in the surveyed repo, titled with the survey, its scope and the date, labelled `survey` plus the survey-type label. Its body carries the **Why this survey** line, the coverage statement, the category verdicts and the summary table, with each row linking its finding's sub-issue rather than restating it. It stays open until every finding is resolved.
- **One sub-issue per finding**, attached to the parent, with the fields above (the repo's `survey-finding` issue template, if it has one, is the skeleton). Label each with the survey's `Category` tag(s), `survey-finding`, the survey-type label, and a tier label, plus a `## Decision needed` section when it hinges on a decision only the maintainer can make, both per the `conventions` skill.
- **A finding whose fix belongs in the workshop's shared files** (the dispatcher's prompts, `conventions`, these survey skills) is filed in the workshop's own repo, the digest repo the `dispatcher` skill names, and attached to the parent as a sub-issue there too.
- **Search first.** Search the repo's open parents (and their sub-issues) for the survey-type label: a re-run mostly re-derives findings already open, and those get a comment with the new evidence rather than a second issue. Then read the newest *closed* parent's "deliberately not filed" section, which an open-issue search can't see.
- A fix that adds a cache, memo or incremental-update path ships a test that its output deep-equals a full recompute. The fixer re-runs the finding's acceptance check before it closes.
- A finding closes when a PR saying `Fixes #N` merges. Dropping one is a close as `not planned` with a comment saying why; deferring one is the `deferred` label plus a comment. Step 1 of **Starting the next survey** closes the parent once every finding is resolved.

**Suggest improvements to the survey itself, as a diff on its skill file.** A real run is evidence about where a survey is unclear, stale or wrong: an ambiguous instruction, an unmeasurable budget item, a category boundary that didn't hold, a scoring rule that produced a counterintuitive order. After the run, edit the survey's `SKILL.md` (a plugin survey's lives in the workshop's own repo) as its own commit, separate from filing the run and from any product fix, on the branch the session is already working on. Open its PR labelled `automerge` (see `conventions`) and note in the parent issue, in one line, that the survey file was updated and why. Keep it to process learnings; findings are issues.

**Bias that diff toward shrinking.** A run's evidence naturally produces an addition, and nothing pushes back, so survey files only grow. Before adding, check whether something should be cut or merged instead: a caveat now enforced by a lint rule, CI check or test (cut it, or shrink it to the line naming what enforces it); two passages making the same point (keep the more precise); a worked example the rule no longer needs at full length. A real new failure mode still earns its bullet, but a survey file that only ever grows is itself a finding about the survey.
