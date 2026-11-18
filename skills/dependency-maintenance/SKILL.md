---
name: dependency-maintenance
description: Run the dependency maintenance pass over one repository or several, in any language. Finds the dependency decisions Dependabot can't make (major upgrades, held-back pins, replacements, removals, gaps in Dependabot's own coverage), files one issue per decision in the repo it belongs to, and publishes a report linking them. Use when the `timetable` skill starts it, when asked to run or edit the dependency maintenance pass, or to find which dependencies to bump or replace.
---

# Dependency maintenance

Dependabot already proposes every available version and can auto-merge the non-major ones. This pass covers only the decisions it leaves to a person: whether to take a major, whether a pin still has a reason, whether a dependency should be swapped out or dropped, and whether Dependabot can see everything it should. **Never file a finding that Dependabot already has open as a PR**, and never bump a patch or minor yourself.

**Scope:** the repos the user names. If they name none, use the current repo. Use every repo attached to the session if they asked for "all", or if the working directory isn't a repo but holds several. With several repos, a dependency they share gets one decision, applied in each repo that has it.

**Previous runs:** each run's parent is a `Dependency maintenance <date>` issue in realJohnDoe/agent-skills, filed per the `conventions` skill's **Filing a batch of findings** (`../conventions/SKILL.md`), which this pass follows for searching, fields, tiers and closing. The newest parent, open or closed, is the last run. The open sub-issues of every open parent are decisions already made: re-check their facts and update an issue only when a fact has changed.

**Start** by closing the finished parents in realJohnDoe/agent-skills, per **Closing** there. They carry the `dependencies` label, or, filed before it, are found by title.

## 1. Read each repo's own rules first

Before you judge a single version, read in each repo:

- `CLAUDE.md`/`AGENTS.md`, `CONTRIBUTING.md`, and anything they point to about dependencies. These hold pins, the reasons for them, and the check that tells you whether each reason still holds. A repo may also say its dependencies follow an upstream project (a fork or template). In that case, judge only what the repo owns.
- Every manifest and lockfile, with any comments in them about overrides, resolutions, constraints or accepted advisories. Also `.github/dependabot.yml`, whose `ignore` entries are standing decisions too.
- The CI workflows, so you know which checks gate an upgrade.
- The repo's issue labels and any rule about them. Issues you file follow that repo's scheme, not this skill's.

Rules written in a repo override this skill for that repo.

## 2. Measure against the registry, not memory

What you remember as "the latest version" is out of date by definition. Find each ecosystem by its lockfile, then run its reports in every workspace or module root it has:

| Lockfile | Outdated | Advisories |
|---|---|---|
| `pnpm-lock.yaml` | `pnpm outdated -r` | `pnpm audit --audit-level moderate` |
| `package-lock.json` | `npm outdated --all` | `npm audit --audit-level=moderate` |
| `yarn.lock` | `yarn outdated` (v1) / `yarn upgrade-interactive` (berry, read only) | `yarn npm audit` |
| `uv.lock` | `uv tree --outdated` | `uvx pip-audit` |
| `poetry.lock` | `poetry show --outdated` | `uvx pip-audit` |
| `requirements*.txt` | `pip list --outdated` in its venv | `uvx pip-audit -r <file>` |
| `Cargo.lock` | `cargo outdated` (or `cargo update --dry-run`) | `cargo audit` |
| `go.sum` | `go list -m -u all` | `govulncheck ./...` |
| `Gemfile.lock` | `bundle outdated` | `bundle audit` |

Any other ecosystem: use its own outdated and audit commands. If a tool is missing and won't install, say so in the report, and check the direct dependencies' latest versions on the registry instead. Install with the repo's frozen-lockfile command first. For each direct dependency, also read the registry's deprecation flag, latest release date, repository link and, for plugins, the peer or compatible-version range.

Also collect:

- **Open Dependabot PRs** with their age and CI state (author `dependabot[bot]`). A major Dependabot PR open for more than about four weeks, or one with red CI, is a decision that's stuck, and that's a finding.
- **What Dependabot can't see:** library URLs pinned in HTML or templates (CDN links with a version in them), `FROM` images in Dockerfiles, toolchain pins (`.nvmrc`, `.node-version`, `.python-version`, `rust-toolchain.toml`, the `go` directive, `packageManager`, `engines`), and any ecosystem present in the repo that has no entry in `dependabot.yml`.

## 3. Decide

Give each item below its own verdict. Skip anything that is current and fine. Only the decisions go in the report.

1. **Each major gap**: *upgrade now*, *try on a branch* (name the gating risk: a plugin's compatible range, a breaking config format, a minimum toolchain version), or *hold* (name the reason). For a hold that's already written down (a repo note, a dependabot `ignore`), check the fact behind it again, for example the range a plugin declares. Don't just re-read the note. When the reason has gone, say so: lifting the pin is the finding.
2. **Successor**: a dependency superseded by a newer generation, a maintained fork, or something the language or platform now does itself (a standard-library module, a built-in test runner or HTTP client, types the tool generates). Recommend the successor, not just a bump.
3. **Abandoned or deprecated**: deprecated on the registry, the repository is archived, or there's been no release for two years while advisories or open breakage pile up. Name the replacement, or say plainly that there is none and the risk is acceptable.
4. **Doesn't earn its place**: two libraries doing one job, a heavy dependency used for a sliver of its surface (look at its imports), or a declared dependency nothing imports. A dead dependency is removed, not replaced.
5. **Drift across repos** (several repos only): the same dependency or toolchain on different majors, or one repo hand-rolling what another solves with a library. Recommend one direction for all of them.
6. **Dependabot coverage**: no `dependabot.yml`, an ecosystem in the repo with no entry (including `github-actions` and `docker`), no `cooldown`, or auto-merge with no required check to wait for.
7. **Advisories** that the audit reports and Dependabot hasn't fixed (often a transitive dependency with no patched parent). Give the override, constraint or accepted-risk entry and its reason, in the repo's existing style. Before you choose accepted risk, try an override limited to the vulnerable range (for example pnpm's `'minimatch@>=7 <11.0.1': ^11.0.5`) on a scratch install, then run the repo's lint and build. Accept the risk only if that fails, and name what failed. An advisory a repo already accepts gets the same test on every run.

Two things are not findings: a major you'd hold anyway with no reason having changed, and a code-level "this custom code should use the library you already have" (that belongs to a repo's own health survey, if it has one).

## 4. File issues where the fix happens

Write one issue per decision, in the repo that changes, with the fields of **Filing a batch of findings** after searching as it says (search the repo's open issues for the dependency name too). A cross-repo decision gets one issue in each affected repo, and each one links the others.

- **Title:** `deps: <verb> <package> <from> → <to>`, for example `deps: replace moment with date-fns` or `deps: lift typescript <7 pin`.
- **What this pass adds to the fields:** the **Problem** is the verdict from step 3; the **Evidence** is the step 2 command plus its output excerpt, dated; the **Task context** names the gating risk; the **Fix**'s check is the repo's own build and test commands plus the specific check.
- **Labels:** in a repo the workshop dispatches, per `conventions`; otherwise the repo's own scheme from step 1. Either way, plus `dependencies` if the repo has that label. If a label doesn't exist, name the tag in the body instead. Don't create labels.

## 5. Publish the report

Publish one Artifact page per run, titled `Dependency maintenance <YYYY-MM-DD>`, holding:

- One line per repo: verdict, issues filed, open Dependabot PRs, and what couldn't be checked and why.
- Several repos only: a table of each dependency that appears in two or more of them, with its version in each repo and the decision.
- Every issue filed or updated, linked and grouped by repo.

Link the previous run's report at the top.

Then, if the run filed or updated at least one issue, file the run's parent in realJohnDoe/agent-skills, titled like the report and labelled `dependencies`. Its body holds the report link, the previous run's parent, the per-repo table and the cross-repo decisions. Add every issue filed or updated as a sub-issue. A run with no findings files no parent.

End your reply with the report link, the parent if there is one, and the issue count per repo.
