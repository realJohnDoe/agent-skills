---
name: dependency-maintenance
description: Run the dependency maintenance pass over every repository attached to the session. Finds the dependency decisions Dependabot can't make (major upgrades, held-back pins, replacements, removals, gaps in Dependabot's own coverage), files one issue per decision in the repo it belongs to, and publishes a report linking them. Use when asked to run, schedule or edit the dependency maintenance pass, or to find which dependencies to bump or replace.
---

# Dependency maintenance

Dependabot already proposes every available version and auto-merges the non-major ones. This pass covers only the decisions it leaves to a person: whether to take a major, whether a pin still has a reason, whether a dependency should be swapped out or dropped, and whether Dependabot can see everything it should. **Never file a finding that Dependabot already has open as a PR**, and never bump a patch or minor yourself.

One run covers every repository attached to the session. That way a dependency shared by several repos (Vite, ESLint, TypeScript, React) gets one decision, applied in each repo that has it.

## 1. Read each repo's own rules first

Before you judge a single version, read in each repo:

- `CLAUDE.md`/`AGENTS.md` and anything they point to about dependencies (for example `docs/agents/dependencies.md`). These hold pins, the reasons for them, and the check that tells you whether each reason still holds.
- `package.json` for every workspace member, `pnpm-workspace.yaml` (overrides, `allowBuilds`, `minimumReleaseAge`, audit ignores and their comments), and `.github/dependabot.yml` (`ignore` entries are standing decisions too).
- The CI workflows, so you know which checks gate an upgrade.
- The repo's issue labels and any rule about them (model tier, type). Issues you file follow that repo's scheme, not this skill's.

Rules written in a repo override this skill for that repo.

## 2. Measure against the registry, not memory

What you remember as "the latest version" is out of date by definition. Run, in each repo:

```bash
pnpm install --frozen-lockfile
pnpm outdated -r --format json                     # every workspace member
pnpm audit --audit-level moderate                  # run from each workspace root
```

Then for each direct dependency, look at the registry:

```bash
npm view <pkg> deprecated time.modified repository.url peerDependencies --json
```

Also collect:

- **Open Dependabot PRs** with their age and CI state (GitHub MCP `list_pull_requests`, author `dependabot[bot]`). A major Dependabot PR open for more than about four weeks, or one with red CI, is a decision that's stuck, and that's a finding.
- **Anything Dependabot can't see:** library URLs pinned in HTML (`grep -rEo 'https://(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/[^"'\'' ]+'`), `FROM` images in Dockerfiles without a `docker` ecosystem entry, toolchains pinned in `.nvmrc`/`.node-version`/`packageManager`/`engines`, and any non-npm lockfile (`uv.lock`, `Cargo.lock`) without its own ecosystem entry.

If a repo has no `package.json`, still do the second bullet.

## 3. Decide

Give each item below its own verdict. Skip anything that is current and fine. Only the decisions go in the report.

1. **Each major gap**: *upgrade now*, *try on a branch* (name the gating risk: a plugin's peer range, a typed-lint matrix, a breaking config format), or *hold* (name the reason). For a hold that's already written down (a repo note, a dependabot `ignore`), check the fact behind it again, for example the peer range a plugin declares. Don't just re-read the note. When the reason has gone, say so: lifting the pin is the finding.
2. **Successor**: a dependency superseded by a newer generation, a maintained fork, or something the platform now does itself (types the tool generates, a plugin folded into the framework, a Node built-in like `fetch`, `node:test` or `util.parseArgs`). Recommend the successor, not just a bump.
3. **Abandoned or deprecated**: `deprecated` is set, the repository is archived, or there's been no release for two years while advisories or open breakage pile up. Name the replacement, or say plainly that there is none and the risk is acceptable.
4. **Doesn't earn its place**: two libraries doing one job, a heavy dependency used for a sliver of its surface (look at its imports with `grep`), or an installed dependency nothing imports. A dead dependency is removed, not replaced.
5. **Missing or mismatched across repos**: the same dependency on different majors in different repos, or one repo hand-rolling what another solves with a library. Recommend one direction for all of them.
6. **Dependabot coverage**: no `dependabot.yml`, an ecosystem with no entry (npm, github-actions, docker, uv, cargo), no auto-merge workflow, a `cooldown` that doesn't match `minimumReleaseAge`, or auto-merge with no required check to wait for.
7. **Advisories** that the audit reports and Dependabot hasn't fixed (often a transitive dependency with no patched parent). Give the override, or the accepted-risk entry and its reason, in the repo's existing style.

Two things are not findings: a major you'd hold anyway with no reason having changed, and a code-level "this custom code should use the library you already have" (that belongs to a repo's own health survey, if it has one).

## 4. File issues where the fix happens

Write one issue per decision, in the repo that changes. A cross-repo decision gets one issue in each affected repo, and each one links the others. Before filing, search the repo's open issues for the dependency name, and update a matching issue instead of opening a duplicate.

- **Title:** `deps: <verb> <package> <from> → <to>`, for example `deps: replace moment with date-fns` or `deps: lift typescript <7 pin`.
- **Body:** the verdict, the evidence from step 2 (command plus output excerpt, with the date), the gating risk, and the done-state as commands (`pnpm run build && pnpm test` green, plus the specific check).
- **Labels:** the repo's own scheme from step 1, plus `dependencies` if the repo has that label. If a label doesn't exist, name the tag in the body instead. Don't create labels.

## 5. Publish the report

Publish one Artifact page per run, titled `Dependency maintenance <YYYY-MM-DD>`, holding:

- One line per repo: verdict, issues filed, open Dependabot PRs, and what couldn't be checked and why.
- The cross-repo table: each dependency that appears in two or more repos, with its version in each repo and the decision.
- Every issue filed or updated, linked and grouped by repo.

If a previous run's report URL is known (from the trigger prompt or the user), link it at the top, so the reports form a chain. End your reply with the report link and the issue count per repo.
