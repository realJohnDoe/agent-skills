---
name: survey-health
description: Run the codebase health survey: code-health findings across architecture, duplication, testing, tooling and more, ranked and filed as sub-issues. Use when the surveys chooser picks it, or when asked to run, repeat or edit the health survey.
label: health
scope: .
---

Load the `surveys` skill before starting: its conventions apply to every run. This file states only what is specific to the health survey.

# Codebase Health Survey

Survey the repo for code health issues across the categories below. List the **top 7 findings**, numbered (the category verdicts reference these numbers), and don't pad the list.

## Repo overlay

Read these headings in the repo's `docs/agents/survey.md` (see the `surveys` skill's **Per-repo overlay**). Each is optional and a missing file or heading means the default.

- `## Health scope`: the pathspecs the survey covers, in the same quoted-word syntax as the `scope` frontmatter, `":!…"` excludes included. The chooser counts merged PRs touching them. Default: the whole repo (`.`).
- `## Health corpora`: where production code and test code are surveyed in separate runs, one bullet per corpus with its paths and what "largest file" and "toolchain" mean for it. A run surveys one corpus, the one the newest earlier health parent did not, and names it in the first line of its coverage statement; the Budget re-points to it. Default: one corpus, the scope.
- `## Health categories`: extra categories, in the same shape as those below (a heading, a scope line, examples), numbered after 10 and given verdicts like any other.

## Process

Scan plan first, evaluate on merits, verify capability claims by inspection (see `surveys`). Version currency comes from a registry query, never from training data. Three rules are specific to this survey:

- **Check the docs against the tooling, in both directions.** A doc saying "nothing enforces X" or "remember to add Y" goes stale as easily as one claiming a guard exists. Verify each against the scripts, lint config and CI; when a guard has since been written, the stale warning is its own finding, because it teaches readers to distrust a check that works. Verify a path before citing it: a check that moved leaves the old name in prose.
- **Attribute a measured anomaly to the environment before the repo.** A uniform per-unit cost across otherwise unrelated units (every e2e test ~14s, say) is the tell: probe with a throwaway script (launch time, local request time, any render-blocking external fetch stalling against the sandbox's egress proxy) before filing a timing, network or resource finding, and say in the coverage statement whether the environment is implicated.
- **Grep config comments for expiry conditions and check whether they have been met.** A pin, cap or disabled rule whose comment says "revisit once X", "until Y lands" or "remove when Z ships" is a decision with a trigger and no owner. Verify each with one registry or issue-tracker query; a condition phrased against `@latest` is met for the repo only once its installed version gets there, so dry-run the removal together with the bump it needs. A met condition is a finding, and so is a comment whose rationale no longer holds or that asserts the opposite of the setting beneath it. For a lint exemption (`ignores`, a rule disabled for one file), dry-run it: plant the forbidden import in each exempt file and in a control file, which shows when one shared list exempts files from unrelated restrictions.

## Budget

- Read closely: the entry points, the most-imported modules (measure, don't guess), the 15 largest non-generated source files, and 2-3 representative files from every feature directory. **Rank "largest" by line count**: byte size reshuffles the list (prose comments and inlined fixtures outrank denser code), and tests and generated files fill the top with material most categories don't apply to. State which files the ranking picked.
- **Read the toolchain, not just the source:** package manifests (scripts and the full dependency list), lint and formatter configs, CI workflows, test config, strictness settings. For each dependency know what it is for and where it is used; this feeds Library Fit.
- **Run the existing quality gates once** (the overlay's `## Gates`, else what CI and the repo's steering files say): build, lint, tests with coverage if configured, any dead-code check, and the dependency audit. Report each gate's result in the coverage statement. A failing gate is itself a finding, usually a high-impact one. Run the audit from inside each workspace (some package managers' audit takes no workspace filter) and at a lower severity threshold than any scheduled audit reports at, since advisories just under it are invisible.
- **Establish which workspace each gate covers, and record it as a matrix.** Gates on one axis (coverage on its own row, separate from tests: they are usually different scripts, and the common shape is a test script that fans out to every workspace beside a coverage script that does not), workspaces on the other, with non-package directories (`scripts/`, `worker/`) as columns too. Don't assume a root script reaches a sub-workspace: check whether the test runner's `include` glob matches it and whether the root typecheck references its tsconfig. A package that CI checks in a separate job but the documented local command skips is a finding invisible to every green gate. For any repo with more than one package this is the cheapest high-yield check here.
- **Check that coverage guards cover what matters.** Where coverage floors are machine-checked, audit the guard rather than redoing it by hand: files with no threshold at all, exclusions outside any size-checked prefix, and whether the guard's own constants still fit the repo.
- **Measure the test suite per file, not only as a wall-clock total, and read the phase breakdown.** A slow file hides in wall-clock time when other workers absorb it, so run the runner's JSON reporter and rank files, then tests within the worst ones; a cluster at a suspiciously round duration means time is slept, not spent. When the runner's `import` phase is several times its `tests` phase, the suite pays for isolation rather than assertions: ask which files need it.
- **Build and look at what shipped.** Run the production build and rank the emitted chunks by size, then grep the largest for markers of the heavy dependencies to see which chunk each landed in. A lazy import or route-level split can be silently defeated by one static import of a barrel elsewhere, invisible because every file involved reads correctly alone. When a suspect import turns up, measure: change it, rebuild, diff the entry chunk's raw and gzip size. Grep the emitted CSS for the utility classes the source uses too: a class with no rule (an ignored config, a misspelt variant) is dead styling that lint and type-check both pass.
- **Sample git history for co-change patterns** (`git log --name-only` over recent commits): the evidence base for co-location findings. Un-shallow first (see `surveys`) and record the history's true span next to the tallies.
- **Identify where development is concentrated**: tally recent commits or merged PRs per directory over a meaningful window (e.g. 60 days). Findings in hot directories are worth more than equivalent ones in dormant corners, since more code keeps landing on top of the problem.
- Skim the full tree and sample what the close reading didn't cover. Don't skip a directory without recording it in the coverage statement.

## Output structure

### 1. Health verdict (~5 sentences)

A plain-language summary. Name the **worst one or two areas** (by directory or subsystem, not individual findings) and the **single biggest structural theme**, weighing overengineering (abstraction, configuration or indirection outpacing the problem) as seriously as underengineering (leakage, duplication, missing boundaries). This is the headline answer; the findings are the evidence.

### 2. Coverage statement

- The corpus (see the overlay), then which directories and files you examined closely, which you only sampled, and which you skipped, each skip with its reason.
- Each quality gate's result, as the **gate × workspace matrix** in a multi-workspace repo: a flat list cannot express "green, but it never looked at this package". Where the overlay lists environment limits, say how they shaped the run.
- Roughly what fraction of the codebase the report is based on, and any area you suspect but did not investigate, flagged "unverified".

### 3. Category verdicts

One line per category, verdicts per `surveys`.

### 4. Findings

`Title`, `Breadth`, `Tier`, `Evidence`, `Problem`, `Fix` and `Task context` are the shared finding fields (`conventions`, **Filing a batch of findings**). This survey adds:

- **Category**: one or more tags from `architecture` `overengineering` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`. Applying a label the repo lacks fails the whole issue create: list them with `gh api --paginate repos/<owner/repo>/labels --jq '.[].name'` (`gh label list` needs GraphQL, which cloud sessions can't reach) and name a missing tag in the body instead.
- **Impact**: 1-10 (10 = catastrophic or systemic; 5 = a DRY violation duplicated across ~4 files, or a missing error state on a primary flow; 1 = trivial or cosmetic).

**Fails silently here** (what sets the tier): a lint rule that passes but no longer catches what it should, a "dead" export actually reached dynamically, a boundary that still resolves but now leaks. A multi-PR architecture change is a `plan`, and a product decision (narrow the type, or restructure the module boundary) is a `## Decision needed`; neither raises the tier. Example hazard note: "`sonnet` if the import boundary to preserve is specified in the task; else `opus`."

"Confirming" a fix means re-running the build, lint or tests, naming the workspace it must run in, since a root command may not cover the package the fix touched.

When the ranking puts a low-impact finding above a high-impact one (a wide, cheap toolchain fix over a narrow correctness bug), say so in one line under the summary table and name which finding a reader sorting by raw impact should look at first. When a real finding falls out of the top 7 purely on effort (usually an architecture finding, the highest-weight category and the most expensive), name it in one line below the findings, so "category 1: clean" never appears when the truth is "its finding didn't survive the divisor".

---

## Categories to scan, ranked by priority

Each category is defined by its heading and scope line. A finding that matches a scope but no bullet may be *more* valuable: it is what the checklist didn't anticipate.

### 1. Architecture & Domain Separation _(highest weight)_

**Scope:** whether responsibilities live in the right modules and the dependency structure is sound. Owns **module-level** concern sprawl; function-level SRP belongs in category 6.

Examples (not exhaustive):

- Domain leakage: logic of one domain (auth, billing, data fetching, UI state) leaking into another layer
- God files or modules: imports (or importers) spanning 3+ otherwise unrelated feature directories
- A concern split across so many files that following one behavior end to end takes 4+
- Missing or misplaced boundaries: no clear API surface between subsystems, features importing each other's internals
- Circular or upward dependencies: lower-level modules importing higher-level ones
- Pierced abstractions: a port or interface that is bypassed in practice (`instanceof` on a concrete implementation, an orchestrator importing one adapter of an interface it otherwise consumes abstractly, an implementation-specific concern such as auth, retries or caching handled outside the interface)

### 2. Simplicity & Overengineering _(highest weight)_

**Scope:** whether complexity is proportional to the problem solved now: unnecessary abstraction, premature generalization, configuration or indirection outpacing real variance. Owns **structural and speculative** overengineering; function-level duplication (too little abstraction) belongs in category 6. Report both where you find them.

Hold every abstraction to "does a second real caller exist today?", not "might this be useful later?". A comment claiming "for future extensibility" is a hypothesis to verify against call sites. An interface, config knob or generic parameter with no second consumer is a finding until proven otherwise.

Examples (not exhaustive):

- An interface, factory, plugin or strategy system, or injection seam with one real implementation
- Speculative generality: flags, extension points, options objects or type parameters where a grep shows zero call sites exercising the variance
- Indirection that doesn't earn its keep: a wrapper, service or hook that only forwards (read the body, not the name)
- Configuration surface disproportionate to variance: count how many options are ever passed a non-default value
- Premature abstraction: a shared utility, hook or base class after one real use, where inlined duplication would be clearer
- A pattern for a scale the project doesn't have (a state-machine library or event bus where a few `if`s read clearer)
- Defensive code for scenarios that cannot occur: validation, fallbacks or try/catch the type system, call graph or upstream validation already rules out
- Layered configurability: a setting that is itself configurable, or an abstraction with its own plugin system over one or two real variants

### 3. Directory & File Layout _(high weight)_

**Scope:** whether the tree's shape matches how the code is used, changed and depended upon.

Examples (not exhaustive):

- Co-location violations: files that always change together (verify in git history) but live far apart, or co-located files with no logical relationship
- Depth mismatch: broadly used or broadly dependent code belongs high in the tree, code with a single consumer beside that consumer; flag modules too shallow for how narrowly they're used or too deep for how widely they're shared
- Inconsistent module conventions: some features with barrel exports and others without, or differing naming without reason
- Layout that fights the framework: route files away from their route, server-only code in `components/`, utilities scattered across feature folders
- Flat directories that should be split, deep ones that should be flattened

### 4. Security

Owned by the `survey-security` survey where the repo has one: not scanned here, and the verdict line points at that survey's latest run. Where it has none, scan briefly for secrets in the repo, unvalidated input at boundaries and dependency advisories.

### 5. Testing & Error Handling

**Scope:** whether failures, in code or in tests, are detected, surfaced and recoverable.

Examples (not exhaustive):

- Core domain logic with no tests, or coverage concentrated on trivial code while the risky paths go untested
- Tests that can't fail meaningfully: over-mocked, snapshot rot, assertions on implementation details, or a subject that is a copy of production. The tell is the import list: a test importing no function from the module named in its header asserts against a stand-in. Grep tests for comments admitting the coupling (`mirrors`, `must match`, `keep in sync`)
- The same behaviour asserted at more than one activation level (a pure function tested directly and through the component that calls it; one path covered by a fake-everything unit test, a partly-faked integration test and a real end-to-end test). Not a fault when the levels assert different things (logic, wiring, real I/O); a fault when the expensive level asserts nothing the cheap one doesn't, usually by taking a callback payload instead of inspecting rendered output. Compare per-test cost from the timing data and check whether the fixtures are identical
- **Tests that fail nondeterministically**, which teach everyone to re-run CI instead of reading it, so rate them above their apparent size. Greps: `setTimeout` or `await new Promise` in a test body (Playwright: `waitForTimeout`), `new Date()` or `Date.now()` with no fake clock, a module-level `let` in a shared helper that no `beforeEach` resets. Zone assumptions are invisible on UTC runners: check the test config pins a non-UTC `TZ`
- Swallowed errors: empty or log-only `catch` blocks, unhandled rejections, errors not surfaced to the user or a recovery path
- No consistent error strategy: each layer inventing its own mix of throw, return-null and silent default

### 6. Code Health & DRY

**Scope:** local quality: duplication, clarity, cohesion and type discipline at function and file level. Owns too little sharing; too much, too soon belongs in category 2.

Examples (not exhaustive):

- Duplicated logic that should be a shared utility or hook, especially across feature boundaries (only past a second real use; see category 2)
- A function or component doing several unrelated jobs (module-level sprawl is category 1)
- Redundant layered guards: the same check on the same value at the call site and inside the callee, or across 3+ layers, with no documented owner of the invariant
- Misleading, ambiguous or inconsistent names across a module boundary
- Dead code: unreachable paths, unused exports or imports at module boundaries
- Type safety: pervasive `any`, missing return types on public API surfaces, unsafe casts

### 7. Toolchain & Developer Feedback Loops

**Scope:** whether tooling catches the mistakes this codebase actually makes, as early and cheaply as possible.

Examples (not exhaustive):

- Installed-but-unused lint capability: compare the plugin's actual rule list against the config, dry-run the candidate preset and report what it flags
- Missing type-aware linting where it would catch real bug classes in async-heavy code: check whether the rules are already enabled, then dry-run the missing ones
- Documented invariants not machine-enforced: an architecture rule in a steering file or doc (layer purity, import direction) that no lint rule or CI check guards; propose the rule
- Missing dead-code and unused-dependency detection when unused exports accumulate; missing coverage measurement when test gaps are a finding
- CI/local drift: checks that run locally but aren't gated in CI, or CI steps with no local equivalent
- Formatter: note presence or absence and whether adopting one fits (authorship model, migration cost); evaluate the trade-off
- Recommend against tools too: fast replacements that can't reproduce existing custom rules, pre-commit hooks that duplicate CI

### 8. Dependencies & Library Fit

**Scope:** code-level library fit: whether custom code should be a dependency and installed libraries are fully exploited. Version currency, major gaps, held-back pins, successors, abandoned packages and dependencies that don't earn their place belong to the `joes-workshop:dependency-maintenance` skill; don't assess them here.

Say explicitly when the status quo is correct. Examples (not exhaustive):

- **Custom code reimplementing an installed library's feature**, including a library capability switched off in config and replaced by weaker custom code: for each installed library know its headline features and check whether the codebase reimplements any
- **Missing library**: a hand-rolled subsystem where a standard, maintained library is clearly better (correctness-critical parsing, protocol handling, a11y-heavy widgets)
- **Deliberate custom code that is right**: when custom beats the obvious library (domain semantics it can't express, an owned file format, abandonment, known defects), state the keep-custom verdict and the reason
- **Unused newer features of installed dependencies**: an idiom the installed major supports that the code predates (ref-as-prop over `forwardRef`, a `lib`/`target` bump that deletes casts or polyfills); flag it when adopting deletes code, and say when it isn't worth the churn

### 9. Styling & UX

**Scope:** consistency of styling with the project's chosen system, and whether the UI communicates state and is usable by everyone.

Examples (not exhaustive):

- An installed UI-kit component bypassed by a custom duplicate
- Raw CSS or inline styles where the styling system would suffice, or utility classes where plain CSS is clearly better
- Missing loading or error states, non-accessible interactive elements (no keyboard navigation, missing ARIA)

### 10. Performance

**Scope:** work done unnecessarily, too often or at the wrong time, at any layer: render, data or bundle.

Examples (not exhaustive):

- Object or array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy loading or code splitting at route or feature boundaries
- N+1 or waterfall data fetching

---

**Scoring guidance:** a structural pattern affecting the whole codebase ("every feature imports `lib/` internals instead of its public API") outscores a single misused hook. Score overengineering by the same standard: an unnecessary abstraction repeated as the default pattern is systemic, and a fix that only deletes code is not automatically cheap, since confirming nothing depends on what's deleted takes judgement. A toolchain finding that would mechanically catch a whole class of issues (a preset flagging 30 real problems, a lint zone enforcing a documented invariant) scores like the class it catches. Skip purely stylistic findings and single isolated call sites: they belong in a lint rule. **Weight by where development is happening**, using the activity tally from the Budget, and note the pull in the finding ("`editor/` has had N commits in 60 days, the highest churn") rather than baking it silently into the rank.
