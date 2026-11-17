# Can pushes to the `workshop-board` branch deploy GitHub Pages?

Research for [#62](https://github.com/realJohnDoe/agent-skills/issues/62), part of the workshop board map [#61](https://github.com/realJohnDoe/agent-skills/issues/61). Checked on 2026-11-17.

**Sources.** The cloud session that did this research could not reach `docs.github.com` (the host is not on its network allowlist). It read the same pages from their Markdown source in [github/docs](https://github.com/github/docs) on `raw.githubusercontent.com` instead. Every claim below links the published `docs.github.com` page. The repo's live settings were read with `gh api`, without changing anything.

## Summary

| # | Question | Answer |
|---|----------|--------|
| 1 | Can a workflow on a non-default branch deploy with `actions/deploy-pages`? | **Yes, if the `github-pages` environment lets that branch deploy.** The maintainer must check *Settings → Environments → github-pages → Deployment branches and tags* and add a `workshop-board` rule, or choose *No restriction*. |
| 2 | Does a push from a cloud Claude Code session trigger `on: push` workflows? | **Yes.** Session pushes are made as the maintainer's account (`realJohnDoe`), not with a workflow's `GITHUB_TOKEN`, and the activity log shows they start workflow runs. |
| 3 | Is the workflow file read from the pushed branch or from the default branch? | **From the pushed commit.** `workshop-board` must carry its own copy of the workflow file. The site source can stay on `main`, and that workflow checks it out with `actions/checkout` and `ref: main`. |
| 4 | Is Pages on for agent-skills today? | **No.** `has_pages` is `false`, the repo has no deployments, and no Pages run has ever happened. A maintainer has to set *Settings → Pages → Source* to **GitHub Actions**. |

## 1. Deploying from a non-default branch

- `actions/deploy-pages` needs `pages: write` and `id-token: write`, and "an `environment` must be established to enforce branch/deployment protection rules. The default environment is `github-pages`." ([Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages#deploying-github-pages-artifacts))
- Nothing in the docs limits deploys to the default branch. The starter workflows are only *written* to deploy on a push to the default branch. GitHub also says: "If your repository does not already include an environment called `github-pages`, the environment will be created automatically. We recommend that you add a deployment protection rule so that only the default branch can deploy to this environment." ([Configuring a publishing source: creating a custom workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#creating-a-custom-github-actions-workflow-to-publish-your-site))
- **Default rules.** The environment docs say that an environment created by a workflow run "will not have any protection rules". The exception is an environment created from implicit page builds (a branch or folder source), which gets "the source branch … added as a protection rule". ([Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments#creating-an-environment))
  - *Caveat, not from the docs:* when you switch the Pages source to **GitHub Actions** in the UI, the `github-pages` environment it creates often already holds a *Selected branches* rule for the default branch. A deploy from any other branch then fails with "Branch … is not allowed to deploy to github-pages due to environment protection rules". The proxy blocked the environments API (`repos/…/environments`), so this research could not read the actual rule. Check it after enabling Pages.
- **Deployment branch options** are *No restriction*, *Protected branches only* and *Selected branches and tags*. A rule is matched against the run's `GITHUB_REF`, and a wildcard does not match `/`. ([Deployments and environments: deployment branches and tags](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags)) For a `push` to `workshop-board`, `GITHUB_REF` is `refs/heads/workshop-board` ([Events that trigger workflows: push](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)), so a branch rule named `workshop-board` matches it.
- **What the maintainer must change.** Repo admins only. GitHub notes that "only repository admins can configure the environment" ([Managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments#creating-an-environment)).
  1. [Settings → Pages](https://github.com/realJohnDoe/agent-skills/settings/pages): set *Build and deployment → Source* to **GitHub Actions** (see question 4).
  2. [Settings → Environments](https://github.com/realJohnDoe/agent-skills/settings/environments) → `github-pages` → *Deployment branches and tags*: keep *Selected branches and tags* and use *Add deployment branch or tag rule* to add a **Branch** rule for `workshop-board`. You can keep `main` too. The other choice is *No restriction*. The steps are in [Managing environments → deployment branches](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments#creating-an-environment).
- Branch rules for deployments are available for all public repositories ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags)). agent-skills is public.

## 2. Do pushes from a cloud Claude Code session trigger `on: push`?

**What the docs say.** "Events triggered by the `GITHUB_TOKEN` will not create a new workflow run", except for `workflow_dispatch`, `repository_dispatch` and (in approval-required state) some `pull_request` types. With a GitHub App installation token or a PAT, the event *does* start workflows. ([Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow); [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)) So the rule only stops pushes made *by a workflow run* with its own token. A cloud session is not a workflow run and does not hold a `GITHUB_TOKEN`.

**What the repo shows.** From `gh api repos/realJohnDoe/agent-skills/activity` and `…/actions/runs`:

| Ref | Activity | Actor | Run that followed |
|-----|----------|-------|-------------------|
| `claude/issue-48` | `push` 9e8924f at 11:32:33Z | realJohnDoe | *Workshop tests* (`pull_request`) on 9e8924f at 11:32:39Z |
| `claude/serene-faraday-h6hu29` | `push` d510842 at 12:36:09Z | realJohnDoe | *Workshop tests* (`pull_request`) on d510842 at 12:36:16Z (PR #60) |
| `main` | `pr_merge` f9deeed at 11:51:42Z | realJohnDoe | *Workshop tests* (`push`) on f9deeed at 11:51:45Z |

- The session's git proxy pushes as the **maintainer's account** (`actor` and `triggering_actor` are `realJohnDoe`), not as `github-actions[bot]`. Those pushes start workflows within seconds. If they used `GITHUB_TOKEN`, the follow-up `pull_request` runs would have been held for approval, or not created at all.
- No `on: push` run on a `claude/*` branch exists to point at, because no workflow in this repo listens for `push` outside `main`. `workshop-tests.yml` has `push: branches: [main]`. The run after a push is the `pull_request` *synchronize* run, which comes from the same push and the same token check. Once a `workshop-board` workflow with `on: push: branches: [workshop-board]` exists, the first dispatcher push confirms it directly.
- **Branch names.** This research was itself pushed from a cloud session to `research/pages-from-branch`, a branch outside `claude/*`. The push went through, so the proxy does not limit sessions to `claude/*` branches.
- The repo comments already rely on this: [`dependabot-automerge.yml`](https://github.com/realJohnDoe/agent-skills/blob/main/.github/workflows/dependabot-automerge.yml) says the workshop merges itself "because a merge made with a workflow's own token starts no `push` workflow". The `main` push runs above came from those merges.

## 3. Which copy of the workflow runs on `push`?

- "GitHub searches the `.github/workflows` directory … for workflow files that are present in the associated commit SHA or Git ref of the event", and "each workflow run will use the version of the workflow that is present in the associated commit SHA or Git ref of the event." ([Workflows: triggering a workflow](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows#triggering-a-workflow)) For `push`, that SHA is the "tip commit pushed to the ref". The `push` trigger also "includes workflows that are not merged into the default branch". ([Events that trigger workflows: push](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push))
- **So `workshop-board` must contain the workflow file itself.** A workflow on `main` with `on: push: branches: [workshop-board]` never fires, because `main`'s copy is not in the pushed commit. The default-branch rule only covers some events, such as `workflow_run`, `schedule` and the UI button for `workflow_dispatch`. It does not cover `push`.
- **The site source does not have to live there.** The workflow on `workshop-board` can check out `main` for the renderer and assets ([`actions/checkout`](https://github.com/actions/checkout#usage) `ref:` input), then read `board.json` from its own commit. A minimal `workshop-board` holds only `board.json` and `.github/workflows/<deploy>.yml`, for example as an orphan branch. Note that its workflow file is then pinned to whatever the dispatcher pushes. If the dispatcher writes the workflow file on every push, it can be updated from `main` together with the data.

## 4. Pages on agent-skills today

- `gh api repos/realJohnDoe/agent-skills --jq .has_pages` returns **`false`** ([REST: get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)).
- `gh api repos/realJohnDoe/agent-skills/deployments` returns an empty list. No `pages-build-deployment` or other Pages run shows up in the repo's 121 workflow runs.
- The session's proxy blocks `repos/…/pages` and `repos/…/environments`, so the build type and the `github-pages` environment could not be read directly. With `has_pages: false`, Pages is off and **no source is set**.
- **To turn it on:** [Settings → Pages](https://github.com/realJohnDoe/agent-skills/settings/pages) → *Build and deployment → Source* → **GitHub Actions** ([Publishing with a custom GitHub Actions workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow)). Then fix the environment's branch rule as in question 1.
