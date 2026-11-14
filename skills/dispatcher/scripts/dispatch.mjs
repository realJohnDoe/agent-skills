#!/usr/bin/env node
// The daily dispatcher's plan over every configured repo: which issues to start,
// which PRs need a follow-up session or get merged, and the one shared digest.
// See ../SKILL.md.
// Usage: node dispatch.mjs [--apply] [--followups-only] [--max-sessions N]
//   [--max-followups N] [--today YYYY-MM-DD] [--repos o/r,...] [--config file]
//   [--checkouts dir]
// Without --apply it is a dry run: it prints the plan and writes nothing.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyBlockers } from "./bodyBlockers.mjs";
import {
  AUTOMERGE,
  FOLLOWUP,
  AGENT,
  claimState,
  isDigest,
  linkedIssues,
  marked,
  prVerdict,
  skipReason,
  AWAITING_TRIAGE,
  DECISION,
  openQuestion,
  READY,
  tierOf,
} from "./decide.mjs";
import {
  FOOTER,
  PAUSE_LABEL,
  all,
  api,
  arg,
  flag,
  loadConfig,
  main,
  names,
  post,
  preflight,
} from "./lib.mjs";

const APPLY = flag("--apply");
const FOLLOWUPS_ONLY = flag("--followups-only"); // drain: merge and follow up, start nothing new
const MAX_SESSIONS = Number(arg("--max-sessions", 4)); // across all repos
const MAX_FOLLOWUPS = Number(arg("--max-followups", 2)); // per PR
const STALE_DAYS = 2; // a claim or follow-up with nothing to show after this is stuck
// The digest is published on the first run of these days.
const DIGEST_WEEKDAYS = [2, 5]; // Tue, Fri (UTC getDay)
const DIGEST_DAYS = 2.5; // minimum window, so a second run that day doesn't publish again
const TODAY = new Date(arg("--today", new Date().toISOString().slice(0, 10)));
// When this run's digest window ends; a new digest's window starts here.
const NOW = arg("--today") ? TODAY.toISOString() : new Date().toISOString();
const DIGEST_PREFIX = "Workshop digest";
const DISPATCH = "<!-- workshop-dispatch -->";
const RELAYED = "<!-- workshop-relayed -->"; // digest replies up to here are copied to their issues
// Created in each repo on first contact if missing.
const LABELS = {
  haiku: "c5def5",
  sonnet: "0075ca",
  opus: "5319e7",
  "opus-plan": "d4c5f9",
  deferred: "cccccc",
  [READY]: "0e8a16",
  [AUTOMERGE]: "0e8a16",
};
const days = (iso) => (TODAY - new Date(iso)) / 864e5;
const byRepo = (a, b) => a.repo.localeCompare(b.repo);
const oldestFirst = (a, b) => a.created.localeCompare(b.created) || byRepo(a, b);
const newestFirst = (a, b) => b.created.localeCompare(a.created) || byRepo(a, b);

main(() => {
  const { digest: DIGEST, repos } = loadConfig();
  preflight(repos);

  // --- The shared digest's state, read first: its window bounds "merged since".
  const digests = all(`repos/${DIGEST}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && isDigest(i.title))
    .sort((a, b) => a.number - b.number);
  const isDraft = (i) => i.title.includes("(draft)");
  const draft = digests.findLast(isDraft);
  const published = digests.findLast((i) => !isDraft(i));
  const marker = /<!-- digest-(?:date|since): (\S+) -->/;
  const since =
    (draft ?? published)?.body?.match(marker)?.[1] ??
    new Date(TODAY - DIGEST_DAYS * 864e5).toISOString().slice(0, 10);

  const plans = repos.map((r) => planRepo(r, since));
  const pick = (k) => plans.flatMap((p) => p[k]);

  // Follow-ups first: finishing beats starting. Follow-ups go newest PR first and
  // dispatches oldest issue first, as in Meridian, each across every repo
  // whichever repo it is in.
  const followups = pick("followups").sort(newestFirst);
  const dispatches = pick("dispatches").sort(oldestFirst);
  const sessions = [...followups, ...dispatches].slice(0, MAX_SESSIONS);
  const queue = dispatches.slice(Math.max(0, MAX_SESSIONS - followups.length));
  const automerge = pick("automerge");
  const review = pick("review");
  const unstick = pick("unstick");
  const decide = pick("decide");
  const triage = pick("triage");
  const notPicked = pick("notPicked");
  const merged = pick("merged");
  const unblocksOf = new Map(plans.flatMap((p) => [...p.unblocks]));

  // --- Digest ---------------------------------------------------------------
  // One issue per digest cycle, in the digest repo. Its body is rewritten on
  // every run (an edit notifies nobody); publishing it is the ping. Every item
  // names its repo with a full reference, so links resolve from here.
  const line = (x, ask) => {
    const unblocks = ask ? (unblocksOf.get(x.ref) ?? []) : [];
    const why = [x.why, ...(unblocks.length ? [`unblocks ${unblocks.join(", ")}`] : [])]
      .filter(Boolean)
      .join("; ");
    return `- ${ask ? `[ ] **${ask}** ` : ""}[${x.ref}](${x.url}) ${x.title}${why ? ` (${why})` : ""}`;
  };
  const section = (h, xs, ask) =>
    xs.length ? [`## ${h}`, "", ...xs.map((x) => line(x, x.ask ?? ask)), ""] : [];
  const ANSWER =
    "Answer on the issue or PR, or reply here naming the item (e.g. `meridian#12`): the next daily run copies replies onto their issues.";
  const NOTE = `_The draft digest is rewritten by every daily run and published on Tuesdays and Fridays. ${ANSWER}_\n\n`;
  // PRs first: they are finished work, and go stale while they wait.
  const asks = [
    ...section("Review", review, "Review:"),
    ...section("Unstick", unstick, "Unstick:"),
    // Questions first: an answer is real work, a go-ahead is a glance.
    ...section(
      `Waiting on you (answer a question, or reply \`ready\` naming items to add \`${READY}\`)`,
      [...decide.map((x) => ({ ...x, ask: "Decide:" })), ...triage.map((x) => ({ ...x, ask: "Go ahead?" }))],
    ),
  ];
  // Issues that wait on another issue, a decision or the maintainer's own
  // `deferred` would repeat in every digest, so they are only counted.
  const isWaiting = (x) => /^(blocked by|`deferred`)/.test(x.why);
  const waiting = notPicked.filter(isWaiting);
  const info = [
    ...section("Queue (dispatched next, oldest first)", queue.map((q) => q.item)),
    ...section("Not picked up", notPicked.filter((x) => !isWaiting(x))),
    ...(waiting.length
      ? [
          `<details><summary>${waiting.length} issues waiting on a blocker, a decision or <code>deferred</code></summary>`,
          "",
          ...waiting.map((x) => line(x)),
          "",
          "</details>",
          "",
        ]
      : []),
  ];
  const render = (start, mergedLines, prev) =>
    `<!-- digest-since: ${start} -->\n\n${NOTE}${
      [...asks, ...info].join("\n") || "Nothing is waiting on the maintainer.\n"
    }${prev ? `\nPrevious digest: #${prev}.\n` : ""}${
      mergedLines.length
        ? `\n<details><summary>${mergedLines.length} merged since ${start.slice(0, 10)}</summary>\n\n${mergedLines.join("\n")}\n\n</details>\n`
        : ""
    }`.trim() + FOOTER;
  const body = render(since, merged, published?.number);
  // A quiet cycle (nothing merged, nothing to act on) stays a draft.
  const publish =
    !FOLLOWUPS_ONLY &&
    !!draft &&
    days(since) >= DIGEST_DAYS &&
    DIGEST_WEEKDAYS.includes(new Date(NOW).getUTCDay()) &&
    (merged.length > 0 || asks.length > 0);
  // Maintainer replies on either digest not yet copied onto their issues.
  const replies = [draft, published].filter(Boolean).flatMap((d) => {
    const cs = all(`repos/${DIGEST}/issues/${d.number}/comments?per_page=100`);
    const relayedAt = cs.findLast((c) => marked(c, RELAYED))?.created_at ?? "";
    return cs
      .filter(
        (c) =>
          c.created_at > relayedAt &&
          c.user.type !== "Bot" &&
          !AGENT.test(c.body),
      )
      .map((c) => ({
        digest: d.number,
        url: c.html_url,
        author: c.user.login,
        body: c.body,
      }));
  });
  const digest = {
    repo: DIGEST,
    draft: draft?.number ?? null,
    published: published?.number ?? null,
    publish,
    replies,
    counts: {
      decide: decide.length,
      review: review.length,
      unstick: unstick.length,
      triage: triage.length,
      queue: queue.length,
      notPicked: notPicked.length,
      merged: merged.length,
    },
  };
  const digestLabels = all(`repos/${DIGEST}/labels?per_page=100`).map((l) => l.name);
  const missingLabels = [
    ...plans
      .filter((p) => p.missingLabels.length)
      .map((p) => ({ repo: p.repo, missing: p.missingLabels })),
    ...(digestLabels.includes(PAUSE_LABEL)
      ? []
      : [{ repo: DIGEST, missing: [PAUSE_LABEL] }]),
  ];

  // --- Apply ----------------------------------------------------------------
  if (APPLY) {
    for (const { repo, missing } of missingLabels)
      for (const name of missing)
        post(`repos/${repo}/labels`, {
          name,
          color: name === PAUSE_LABEL ? "fbca04" : LABELS[name],
        });
    // Every `automerge` PR already has finished, green CI, so merge it now,
    // pinned to the head commit that was checked. (GitHub refuses to *enable*
    // auto-merge on a PR that is already mergeable.) A refused merge is
    // logged and retried on the next run, not fatal.
    for (const m of automerge)
      try {
        post(
          `repos/${m.repo}/pulls/${m.pr}/merge`,
          { sha: m.sha, merge_method: "merge" },
          "PUT",
        );
      } catch (e) {
        console.error(`merge ${m.repo}#${m.pr} refused: ${e.stderr ?? e.message}`);
      }
    const me = sessions.length ? api("user").login : null;
    for (const s of sessions) {
      if (s.kind === "dispatch") {
        post(`repos/${s.repo}/issues/${s.issue}/assignees`, { assignees: [me] });
        const auto = s.tier !== "opus";
        post(`repos/${s.repo}/issues/${s.issue}/comments`, {
          body: `${DISPATCH}\nDispatched by the daily workshop run to a ${s.tier} session. Its PR ${auto ? "gets" : "doesn't get"} \`${AUTOMERGE}\`: once green it ${auto ? "is merged by the next daily run" : "waits in the digest for your review"}. Add or remove the label on the PR to change that.${FOOTER}`,
        });
      } else {
        post(`repos/${s.repo}/issues/${s.pr}/comments`, {
          body: `${FOLLOWUP}\nFollow-up session started for:\n${s.prompt
            .split("\n")
            .filter((l) => l.startsWith("- "))
            .join("\n")}${FOOTER}`,
        });
      }
    }
    if (!FOLLOWUPS_ONLY) {
      const newDraft = (start, b) =>
        JSON.parse(
          post(`repos/${DIGEST}/issues`, {
            title: `${DIGEST_PREFIX} (draft) — from ${start.slice(0, 10)}`,
            body: b,
          }),
        ).number;
      const d = draft?.number ?? newDraft(since, body);
      if (draft && draft.body !== body)
        post(`repos/${DIGEST}/issues/${d}`, { body }, "PATCH");
      if (publish) {
        post(
          `repos/${DIGEST}/issues/${d}`,
          // A published digest is no draft: keep only where to answer.
          {
            title: `${DIGEST_PREFIX} — ${NOW.slice(0, 10)}`,
            body: body.replace(NOTE, `_${ANSWER}_\n\n`),
          },
          "PATCH",
        );
        // A title or body edit notifies nobody; this comment is the ping.
        const { decide: x, review: r, unstick: u, merged: m } = digest.counts;
        post(`repos/${DIGEST}/issues/${d}/comments`, {
          body: `Published: ${r} to review, ${u} to unstick, ${x} to decide, ${m} merged.${FOOTER}`,
        });
        if (published) {
          post(`repos/${DIGEST}/issues/${published.number}/comments`, {
            body: `Superseded by #${d}.${FOOTER}`,
          });
          post(
            `repos/${DIGEST}/issues/${published.number}`,
            { state: "closed", state_reason: "completed" },
            "PATCH",
          );
        }
        digest.draft = newDraft(NOW, render(NOW, [], d));
        digest.published = d;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        applied: APPLY,
        repos: repos.map((r) => r.repo),
        missingLabels,
        sessions: sessions.map(({ created, item, ...s }) => s),
        automerge: automerge.map(({ created, ...m }) => m),
        deferred: [...followups, ...dispatches]
          .slice(MAX_SESSIONS)
          .map((s) => `${s.repo}: ${s.title}`),
        digest: { ...digest, body },
      },
      null,
      2,
    ),
  );
});

// Everything one repo contributes to the plan, every item carrying its repo.
function planRepo({ repo, name, path }, since) {
  const ref = (n) => `${repo}#${n}`;
  const base = api(`repos/${repo}`).default_branch;
  const issues = all(`repos/${repo}/issues?state=open&per_page=100`).filter(
    (i) => !i.pull_request,
  );
  const prs = all(`repos/${repo}/pulls?state=open&per_page=100`);
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const linked = new Set(prs.flatMap((p) => linkedIssues(p.body)));
  // Open issues an issue waits on: native blocked-by edges, plus the documented
  // fallback of a blocker named in the body while it is open.
  const blockersOf = new Map(
    issues.map((i) => [
      i.number,
      [
        ...new Set([
          ...(i.issue_dependencies_summary?.blocked_by > 0
            ? all(`repos/${repo}/issues/${i.number}/dependencies/blocked_by?per_page=100`)
                .filter((b) => b.state === "open")
                .map((b) => b.number)
            : []),
          ...bodyBlockers(i.body).filter((n) => byNumber.has(n)),
        ]),
      ],
    ]),
  );
  const item = (x, extra) => ({
    repo,
    ref: ref(x.number),
    url: x.html_url,
    title: x.title,
    ...extra,
  });
  const worktree = (kind, n) => join(tmpdir(), "workshop", `${name}-${kind}-${n}`);
  const out = {
    repo,
    followups: [],
    dispatches: [],
    review: [],
    unstick: [],
    automerge: [],
    notPicked: [],
    triage: [],
    decide: [],
    merged: [],
    unblocks: new Map(),
  };

  // --- PR follow-up ---------------------------------------------------------
  // Ours to follow up: every non-draft PR (draft = keep out of the workshop).
  for (const pr of prs.filter((p) => !p.draft)) {
    const issue = linkedIssues(pr.body)
      .map((n) => byNumber.get(n))
      .find((i) => i && tierOf(names(i)));
    const bot = pr.user.login === "dependabot[bot]";
    // A red bump is undiagnosed and often rooted in a dependency's own change.
    const tier = issue ? tierOf(names(issue)) : bot ? "opus" : "sonnet";
    const head = api(`repos/${repo}/commits/${pr.head.sha}`);
    const runs = api(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).check_runs;
    const mergeable = api(`repos/${repo}/pulls/${pr.number}`).mergeable;
    // CI still running and no conflict: nothing to decide yet, skip the reads below.
    if (mergeable !== false && !(runs.length && runs.every((r) => r.status === "completed")))
      continue;
    const v = prVerdict({
      dependabot: bot,
      labels: names(pr),
      autoMerge: !!pr.auto_merge,
      runs,
      mergeable,
      headDate: head.commit.committer.date,
      comments: all(`repos/${repo}/issues/${pr.number}/comments?per_page=100`),
      reviewComments: all(`repos/${repo}/pulls/${pr.number}/comments?per_page=100`),
      reviews: all(`repos/${repo}/pulls/${pr.number}/reviews?per_page=100`),
      base,
      today: TODAY,
      maxFollowups: MAX_FOLLOWUPS,
      staleDays: STALE_DAYS,
    });
    const it = item(pr, { pr: pr.number, created: pr.created_at });
    if (v.verdict === "review") out.review.push(it);
    if (v.verdict === "merge")
      out.automerge.push({ repo, pr: pr.number, sha: pr.head.sha, title: pr.title, created: pr.created_at });
    if (v.verdict === "unstick") out.unstick.push({ ...it, why: v.why });
    if (v.verdict === "followup") {
      const wt = worktree("pr", pr.number);
      out.followups.push({
        kind: "followup",
        repo,
        pr: pr.number,
        issue: issue?.number,
        tier,
        branch: pr.head.ref,
        checkout: path,
        worktree: wt,
        created: pr.created_at,
        title: `Follow up ${name}#${pr.number}`,
        prompt: [
          `PR ${ref(pr.number)} (${pr.html_url}, branch \`${pr.head.ref}\`) ${issue ? `for ${ref(issue.number)} ` : ""}needs a narrow fix. Work on that branch and push to it; do not open a new PR.`,
          ...setup(path, wt, [
            `git -C ${path} fetch origin ${pr.head.ref}`,
            `git -C ${path} worktree add -B ${pr.head.ref} ${wt} origin/${pr.head.ref}`,
          ]),
          ...(v.conflict
            ? [
                `- Merge conflict with ${base}: merge or rebase \`${base}\` into the branch, resolve the conflicts and push. This is a conflict resolution, not a CI fix; CI runs once it pushes.`,
              ]
            : []),
          ...v.failing.map((r) => `- CI failing: ${r.name}: ${r.html_url}`),
          ...v.feedback.map((c) => `- Unanswered review feedback: ${c.html_url}`),
          `Fix only that. For CI, reproduce the failure first and show the same check passing. Before pushing, run the checks ${repo}'s CLAUDE.md asks for. Reply to each review comment you address.`,
          bot
            ? `This is a Dependabot bump: adapt the code or config to the new versions rather than reverting a bump, and leave the PR description as Dependabot wrote it. If a bump can't be adopted narrowly, say why in a PR comment instead of pushing.`
            : `If the repo has a PR template, the PR description must still meet it.`,
          `Do not subscribe to PR activity: the daily workshop run checks this PR again tomorrow.`,
          `When you're done, remove the worktree: \`git -C ${path} worktree remove ${wt}\`.`,
        ].join("\n"),
      });
    }
  }

  // --- Dispatch -------------------------------------------------------------
  for (const i of issues) {
    const why = skipReason(
      {
        title: i.title,
        labels: names(i),
        assignees: i.assignees.length,
        subIssues: i.sub_issues_summary?.total ?? 0,
        linked: linked.has(i.number),
        blockers: blockersOf.get(i.number),
        question: openQuestion(i.body),
      },
      { ref },
    );
    if (why === DECISION)
      out.decide.push(item(i, { issue: i.number, why: openQuestion(i.body) }));
    else if (why === AWAITING_TRIAGE)
      out.triage.push(item(i, { issue: i.number, why: tierOf(names(i)) }));
    else if (why) out.notPicked.push(item(i, { issue: i.number, why }));
    if (why !== undefined || FOLLOWUPS_ONLY) continue;
    const tier = tierOf(names(i));
    const wt = worktree("issue", i.number);
    const branch = `claude/issue-${i.number}`;
    out.dispatches.push({
      kind: "dispatch",
      repo,
      issue: i.number,
      tier,
      checkout: path,
      worktree: wt,
      created: i.created_at,
      item: item(i, { issue: i.number }),
      title: `${name}#${i.number} ${i.title}`,
      prompt: [
        `Implement ${ref(i.number)} (${i.html_url}), following ${repo}'s CLAUDE.md and the docs it points to.`,
        ...setup(path, wt, [
          `git -C ${path} fetch origin ${base}`,
          `git -C ${path} worktree add -b ${branch} ${wt} origin/${base}`,
        ]),
        `Push the branch \`${branch}\` and open a PR in ${repo} that says \`Fixes #${i.number}\`. If the repo has a PR template, fill it in. Before pushing, run the checks ${repo}'s CLAUDE.md asks for, and give their result in the PR.`,
        tier === "opus"
          ? `Don't label the PR \`${AUTOMERGE}\`: it waits for the maintainer's review.`
          : `Label the PR \`${AUTOMERGE}\`: the daily workshop run merges it once green.`,
        `Do not subscribe to PR activity: the daily workshop run follows up on red CI and review comments.`,
        `When you're done, remove the worktree: \`git -C ${path} worktree remove ${wt}\`.`,
      ].join("\n"),
    });
  }

  // Claimed by a dispatch, still no PR: stuck.
  for (const i of issues.filter((i) => i.assignees.length && !linked.has(i.number))) {
    if (isDigest(i.title) || i.sub_issues_summary?.total > 0) continue;
    const mark = i.comments
      ? all(`repos/${repo}/issues/${i.number}/comments?per_page=100`)
          .filter((c) => marked(c, DISPATCH))
          .at(-1)
      : null;
    const state = claimState({
      tiered: !!tierOf(names(i)),
      dispatchedAt: mark?.created_at ?? null,
      today: TODAY,
      staleDays: STALE_DAYS,
    });
    if (state === "notPicked")
      out.notPicked.push(
        item(i, {
          issue: i.number,
          why: `assigned to ${i.assignees.map((a) => `@${a.login}`).join(", ")}; unassign to queue it`,
        }),
      );
    if (state === "unstick")
      out.unstick.push(
        item(i, {
          issue: i.number,
          why: `dispatched ${mark.created_at.slice(0, 10)}, no PR yet; unassign to re-dispatch`,
        }),
      );
  }

  // What finishing an ask frees: the open issues waiting on it (or, for a PR, on
  // the issues it closes).
  for (const pr of prs)
    out.unblocks.set(ref(pr.number), unblocked(linkedIssues(pr.body)));
  for (const i of issues) out.unblocks.set(ref(i.number), unblocked([i.number]));
  function unblocked(done) {
    return issues
      .filter((i) => done.some((n) => blockersOf.get(i.number).includes(n)))
      .map((i) => ref(i.number));
  }

  // What merged in this digest's window, each with the issue it closed and its labels.
  out.merged = api(
    "search/issues",
    "-X",
    "GET",
    "-f",
    `q=repo:${repo} is:pr is:merged merged:>=${since}`,
    "-f",
    "per_page=100",
  )
    .items.sort((a, b) => a.number - b.number)
    .map((pr) => {
      const closes = linkedIssues(pr.body).map(
        (n) => `${ref(n)} · ${names(api(`repos/${repo}/issues/${n}`)).join(", ")}`,
      );
      return `- [${ref(pr.number)}](${pr.html_url}) ${pr.title}${closes.length ? ` (closes ${closes.join("; ")})` : ""}`;
    });

  const have = all(`repos/${repo}/labels?per_page=100`).map((l) => l.name);
  out.missingLabels = Object.keys(LABELS).filter((l) => !have.includes(l));
  return out;
}

// The lines that put a session in its own worktree of its repo's clone.
function setup(path, wt, commands) {
  return [
    `Work only in your own worktree of that repo's clone, never in ${path} itself or the run's working directory. Create it first:`,
    "```",
    ...commands,
    "```",
    `then do everything from \`${wt}\`.`,
  ];
}
