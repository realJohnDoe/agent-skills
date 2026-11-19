// Pins the workshop's two decisions that change what lands on main, as Meridian's
// scripts/workshop-dispatch.ts made them before the move (realJohnDoe/meridian#1434).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isPause, isWorkshopIssue, openQuestion } from "../../_shared/markers.ts";
import {
  afterMerge,
  claimState,
  issueState,
  linkedIssues,
  prVerdict,
  type PrVerdict,
  referencedIssues,
  tierOf,
} from "./decide.ts";
import { WAITING_LABEL } from "./board.ts";

describe("linkedIssues", () => {
  test("closing keywords in any case, each named issue once per mention", () => {
    assert.deepEqual(
      linkedIssues("Fixes #12. Also closes #3, resolved #4; refs #9"),
      [12, 3, 4],
    );
    assert.deepEqual(linkedIssues("FIXED #1 close #2 resolves #5"), [1, 2, 5]);
  });
  test("no body", () => assert.deepEqual(linkedIssues(null), []));
  test("Refs doesn't close", () => assert.deepEqual(linkedIssues("Refs #25. Fixes #3"), [3]));
});

describe("referencedIssues", () => {
  test("Refs links an issue without closing it, alongside the closing keywords", () =>
    assert.deepEqual(referencedIssues("Refs #25. Fixes #3; ref #4, closes #5"), [25, 3, 4, 5]));
  test("only a keyword before the number counts", () =>
    assert.deepEqual(referencedIssues("see #9, prefs #8"), []));
  test("no body", () => assert.deepEqual(referencedIssues(undefined), []));
});

test("tierOf picks the first tier label", () => {
  assert.equal(tierOf(["bug", "sonnet"]), "sonnet");
  assert.equal(tierOf(["opus-plan"]), undefined);
});

test("isPause matches the pause issue's title, whatever follows it", () => {
  assert.ok(isPause("Pause workshop"));
  assert.ok(isPause("pause workshop for the holidays"));
  assert.ok(!isPause("Fix the Pause workshop notice"));
  assert.ok(!isPause("Pause workshops"));
});

test("the workshop's own issues: pause issues, and the retired digest until it is closed", () => {
  assert.ok(isWorkshopIssue("Pause workshop"));
  assert.ok(isWorkshopIssue("Workshop digest (draft) — from 2026-11-10"));
  assert.ok(isWorkshopIssue("Farm digest — 2026-01-02"));
  assert.ok(!isWorkshopIssue("Fix the Workshop digest layout"));
});

const ELSEWHERE = { kind: "elsewhere" };
const NO_TIER = { kind: "notPicked", reason: "no tier label; add `haiku`, `sonnet` or `opus` to queue it" };
const PLAN_STATE = { kind: "notPicked", reason: "`plan`; start a plan session by hand" };

describe("issueState", () => {
  const issue = (over = {}) => ({
    title: "Do a thing",
    labels: ["sonnet", "ready-for-agent"],
    assignees: 0,
    subIssues: 0,
    linked: false,
    blockers: [],
    ...over,
  });

  test("dispatchable: tier label, ready-for-agent and nothing in the way", () => {
    assert.deepEqual(issueState(issue()), { kind: "dispatchable" });
  });

  test("afterMerge: its PR merged, so it waits on the maintainer, even assigned", () => {
    const afterMerge = { step: "Switch Pages.", pr: "[x#1](u)" };
    assert.deepEqual(issueState(issue({ assignees: 1, afterMerge })), { kind: "afterMerge", ...afterMerge });
    assert.deepEqual(issueState(issue({ linked: true, afterMerge })), { kind: "elsewhere" });
  });

  describe("shown elsewhere", () => {
    test("a pause issue", () => assert.deepEqual(issueState(issue({ title: "Pause workshop" })), ELSEWHERE));
    test("the retired digest issue", () =>
      assert.deepEqual(issueState(issue({ title: "Workshop digest" })), ELSEWHERE));
    test("has sub-issues", () =>
      assert.deepEqual(issueState(issue({ subIssues: 2 })), ELSEWHERE));
    test("an open PR closes it", () =>
      assert.deepEqual(issueState(issue({ linked: true })), ELSEWHERE));
    test("assigned", () =>
      assert.deepEqual(issueState(issue({ assignees: 1 })), ELSEWHERE));
  });

  describe("waiting on a decision", () => {
    test("an open question without the go-ahead", () =>
      assert.deepEqual(issueState(issue({ labels: ["sonnet"], question: "Which API?" })), { kind: "decision", question: "Which API?" }));
    test("even without a tier label", () =>
      assert.deepEqual(issueState(issue({ labels: [], question: "Which API?" })), { kind: "decision", question: "Which API?" }));
    test("the go-ahead settles it", () =>
      assert.deepEqual(issueState(issue({ question: "Which API?" })), { kind: "dispatchable" }));
    test("blocked: waits for the blocker", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["sonnet"], question: "Which API?", blockers: [3] })),
        { kind: "blocked", blockers: [3] },
      ));
    test("assigned before the decision", () =>
      assert.deepEqual(issueState(issue({ labels: [], assignees: 1, question: "Which API?" })), ELSEWHERE));
  });

  describe("not picked up, with the reason", () => {
    test("no tier label", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["bug"] })),
        NO_TIER,
      ));
    test("plan, with or without a tier", () => {
      assert.deepEqual(issueState(issue({ labels: ["plan"] })), PLAN_STATE);
      assert.deepEqual(issueState(issue({ labels: ["opus", "plan", "ready-for-agent"] })), PLAN_STATE);
    });
    test("retired opus-plan still reads as plan", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["opus-plan"] })),
        PLAN_STATE,
      ));
    test("tier label without ready-for-agent waits for triage", () =>
      assert.deepEqual(issueState(issue({ labels: ["sonnet"] })), { kind: "awaitingTriage" }));
    test("ready-for-agent without a tier label still needs one", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["ready-for-agent"] })),
        NO_TIER,
      ));
    test("blocked, carrying the blockers", () =>
      assert.deepEqual(issueState(issue({ blockers: [4, 7] })), { kind: "blocked", blockers: [4, 7] }));
  });

  describe("order: the first matching reason wins", () => {
    test("a pause issue before everything", () =>
      assert.deepEqual(
        issueState(issue({ title: "Pause workshop", labels: [], blockers: [1] })),
        ELSEWHERE,
      ));
    test("plan beats a tier label", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["sonnet", "plan"] })),
        PLAN_STATE,
      ));
    test("no tier before blocked", () =>
      assert.deepEqual(
        issueState(issue({ labels: [], blockers: [3] })),
        NO_TIER,
      ));
    test("blocked before awaiting triage", () =>
      assert.deepEqual(issueState(issue({ labels: ["sonnet"], blockers: [3] })), { kind: "blocked", blockers: [3] }));
    test("plan before blocked", () =>
      assert.deepEqual(
        issueState(issue({ labels: ["plan"], blockers: [3] })),
        PLAN_STATE,
      ));
  });
});

describe("openQuestion", () => {
  test("the section's first paragraph, on one line", () =>
    assert.equal(
      openQuestion("Intro\n\n## Decision needed\n\nKeep the old\nendpoint?\n\nOptions: a, b\n\n## Notes\nx"),
      "Keep the old endpoint?",
    ));
  test("the section may end the body", () =>
    assert.equal(openQuestion("## Decision needed\nWhich API?"), "Which API?"));
  test("settled by a Decided: line", () => {
    assert.equal(openQuestion("## Decision needed\nWhich API?\n\n**Decided:** the new one"), undefined);
    assert.equal(openQuestion("## Decision needed\nWhich API?\nDecided: the new one"), undefined);
  });
  test("a Decided: line in another section doesn't count", () =>
    assert.equal(openQuestion("## Decision needed\nWhich API?\n## Log\nDecided: x"), "Which API?"));
  test("no section, no body", () => {
    assert.equal(openQuestion("## Decisions so far\nx"), undefined);
    assert.equal(openQuestion(null), undefined);
  });
  test("an empty section still asks", () =>
    assert.equal(openQuestion("## Decision needed\n\n## Next\nx"), "Decision needed"));
  test("long questions are cut", () =>
    assert.equal(openQuestion(`## Decision needed\n${"x".repeat(300)}`)?.length, 200));
});

const whyOf = (v: PrVerdict) => ("why" in v ? v.why : undefined);

describe("afterMerge", () => {
  test("the section's first paragraph, on one line", () =>
    assert.equal(
      afterMerge("Intro\n\n## After merge\n\nSwitch Pages at\nhttps://x/settings/pages.\n\nMore\n\n## Done when\nx"),
      "Switch Pages at https://x/settings/pages.",
    ));
  test("the section may end the body", () => assert.equal(afterMerge("## After merge\nDo it."), "Do it."));
  test("no section, no body", () => {
    assert.equal(afterMerge("## Decision needed\nx"), undefined);
    assert.equal(afterMerge(null), undefined);
  });
  test("a Decided: line doesn't end it", () =>
    assert.equal(afterMerge("## After merge\nDo it.\n\nDecided: x"), "Do it."));
});

describe("prVerdict", () => {
  const HEAD = "2026-11-10T12:00:00Z";
  const TODAY = new Date("2026-11-13");
  const green = [{ name: "build", status: "completed", conclusion: "success", html_url: "u/b" }];
  const red = [
    { name: "build", status: "completed", conclusion: "failure", html_url: "u/b" },
    { name: "lint", status: "completed", conclusion: "success", html_url: "u/l" },
  ];
  const human = (at: string, body = "please rename this") => ({
    created_at: at,
    user: { type: "User" },
    body,
    html_url: `c/${at}`,
  });
  const mark = (at: string) => ({
    created_at: at,
    user: { type: "User" },
    body: "<!-- workshop-followup -->\nFollow-up session started for:\n- x\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_",
    html_url: `m/${at}`,
  });
  const pr = (over = {}) => ({
    dependabot: false,
    labels: [],
    autoMerge: false,
    runs: green,
    mergeable: true,
    headDate: HEAD,
    comments: [],
    reviewComments: [],
    reviews: [],
    today: TODAY,
    maxFollowups: 2,
    staleDays: 2,
    ...over,
  });

  describe("green and quiet", () => {
    test("unlabelled PR goes to review", () =>
      assert.equal(prVerdict(pr()).kind, "review"));
    test("automerge PR on claude/issue-N is merged only if its body references #N", () => {
      const m = (branch: string, body: string) => prVerdict(pr({ labels: ["automerge"], branch, body }));
      assert.equal(m("claude/issue-5", "Fixes #5").kind, "merge");
      assert.equal(m("claude/issue-5", "Refs #5").kind, "merge");
      assert.equal(m("feature", "Fixes #6").kind, "merge");
      const v = m("claude/issue-5", "Fixes #6");
      assert.equal(v.kind, "review");
      assert.match(v.kind === "review" ? (v.why ?? "") : "", /branch is for #5 but the description doesn't reference it/);
    });
    test("automerge PR whose description says a check was not run goes to review with the sentence", () => {
      const m = (body: string, dependabot = false) => prVerdict(pr({ labels: ["automerge"], body, dependabot }));
      const v = m("Fixes #5.\n\nThe accessibility tree check was not run in headless Chromium. Rest is fine.");
      assert.equal(v.kind, "review");
      assert.equal(whyOf(v), "description says a check was not run: The accessibility tree check was not run in headless Chromium.");
      assert.equal(m("Fixes #5. Ran the check in headless Chromium; it passes.").kind, "merge");
      assert.equal(m("Bumps foo. This release was not tested on Windows.", true).kind, "merge");
    });
    test("automerge-labelled PR is merged", () =>
      assert.equal(prVerdict(pr({ labels: ["automerge"] })).kind, "merge"));
    test("automerge-labelled PR already on native auto-merge waits", () =>
      assert.equal(prVerdict(pr({ labels: ["automerge"], autoMerge: true })).kind, "wait"));
    test("Dependabot with native auto-merge waits for it", () =>
      assert.equal(prVerdict(pr({ dependabot: true, autoMerge: true })).kind, "wait"));
    test("Dependabot without native auto-merge goes to review", () =>
      assert.equal(prVerdict(pr({ dependabot: true })).kind, "review"));
    test("Dependabot labelled automerge (by its workflow) is merged", () =>
      assert.equal(prVerdict(pr({ dependabot: true, labels: ["automerge"] })).kind, "merge"));
    test("a PR on native auto-merge waits for it, label or not", () =>
      assert.equal(prVerdict(pr({ autoMerge: true })).kind, "wait"));
    test("unknown mergeability waits instead of going to review or merging", () => {
      assert.deepEqual(
        [prVerdict(pr({ mergeable: null })), prVerdict(pr({ mergeable: null, labels: ["automerge"] }))].map(
          (v) => [v.kind, whyOf(v)],
        ),
        [["wait", "mergeability unknown"], ["wait", "mergeability unknown"]],
      );
    });
    test("unknown mergeability is not a conflict: red CI still gets its follow-up", () => {
      const v = prVerdict(pr({ mergeable: null, runs: red }));
      assert.equal(v.kind, "followup");
      assert.equal(v.conflict, false);
    });
  });

  describe("CI not finished", () => {
    test("running checks: wait", () =>
      assert.equal(
        prVerdict(pr({ runs: [{ name: "b", status: "in_progress", conclusion: null }] })).kind,
        "wait",
      ));
    test("no checks at all: wait", () =>
      assert.equal(prVerdict(pr({ runs: [] })).kind, "wait"));
    test("conflict without CI: follow up without waiting", () => {
      const v = prVerdict(pr({ runs: [], mergeable: false }));
      assert.equal(v.kind, "followup");
      assert.equal(v.conflict, true);
      assert.deepEqual(v.failing, []);
    });
    test("running checks don't count as failing on a conflict", () => {
      const v = prVerdict(
        pr({ runs: [{ name: "b", status: "in_progress", conclusion: "failure" }], mergeable: false }),
      );
      assert.equal(v.kind, "followup");
      assert.deepEqual(v.failing, []);
    });
  });

  describe("red CI", () => {
    test("failure gets a follow-up naming the failing check", () => {
      const v = prVerdict(pr({ runs: red }));
      assert.equal(v.kind, "followup");
      assert.deepEqual(v.failing.map((r) => r.name), ["build"]);
    });
    test("timed_out and startup_failure count; cancelled and neutral don't", () => {
      const runs = ["timed_out", "startup_failure", "cancelled", "neutral", "skipped"].map(
        (conclusion) => ({ name: conclusion, status: "completed", conclusion }),
      );
      assert.deepEqual(
        prVerdict(pr({ runs })).failing.map((r) => r.name),
        ["timed_out", "startup_failure"],
      );
    });
    test("an automerge PR with red CI is not merged", () =>
      assert.equal(prVerdict(pr({ runs: red, labels: ["automerge"] })).kind, "followup"));
  });

  describe("human feedback", () => {
    test("newer than the head commit gets a follow-up", () => {
      const v = prVerdict(pr({ comments: [human("2026-11-11T00:00:00Z")] }));
      assert.equal(v.kind, "followup");
      assert.equal(v.feedback.length, 1);
    });
    test("older than the head commit is answered already", () =>
      assert.equal(prVerdict(pr({ comments: [human("2026-11-09T00:00:00Z")] })).kind, "review"));
    test("review comments and reviews count too", () => {
      const v = prVerdict(
        pr({
          reviewComments: [human("2026-11-11T00:00:00Z")],
          reviews: [
            { submitted_at: "2026-11-11T01:00:00Z", user: { type: "User" }, body: "", state: "CHANGES_REQUESTED" },
            { submitted_at: "2026-11-11T02:00:00Z", user: { type: "User" }, body: "", state: "APPROVED" },
            { submitted_at: "2026-11-11T03:00:00Z", user: { type: "User" }, body: "nit", state: "COMMENTED" },
          ],
        }),
      );
      assert.equal(v.kind, "followup");
      assert.equal(v.feedback.length, 3);
    });
    test("bots and agents (Claude Code footer) are not feedback", () => {
      const v = prVerdict(
        pr({
          comments: [
            { ...human("2026-11-11T00:00:00Z"), user: { type: "Bot" } },
            human("2026-11-11T00:00:00Z", "done\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_"),
          ],
        }),
      );
      assert.equal(v.kind, "review");
    });
  });

  describe("follow-up bookkeeping", () => {
    test("a follow-up newer than the head commit is still on it: wait", () =>
      assert.equal(
        prVerdict(pr({ runs: red, comments: [mark("2026-11-12T00:00:00Z")] })).kind,
        "wait",
      ));
    test("a pending follow-up older than staleDays: unstick", () => {
      const v = prVerdict(pr({ runs: red, comments: [mark("2026-11-10T13:00:00Z")] }));
      assert.equal(v.kind, "unstick");
      assert.equal(whyOf(v), "CI red after 1 follow-up(s)");
    });
    test("a follow-up older than the head commit was answered: follow up again", () => {
      const v = prVerdict(
        pr({ runs: red, headDate: "2026-11-12T00:00:00Z", comments: [mark("2026-11-11T00:00:00Z")] }),
      );
      assert.equal(v.kind, "followup");
    });
    test("at the follow-up cap: unstick, saying why", () => {
      const marks = [mark("2026-11-01T00:00:00Z"), mark("2026-11-02T00:00:00Z")];
      assert.equal(
        whyOf(prVerdict(pr({ runs: red, comments: marks }))),
        "CI red after 2 follow-up(s)",
      );
      assert.equal(
        whyOf(prVerdict(pr({ mergeable: false, comments: marks }))),
        "conflicts with main after 2 follow-up(s)",
      );
      assert.equal(
        whyOf(prVerdict(pr({ mergeable: false, comments: marks, base: "trunk" }))),
        "conflicts with trunk after 2 follow-up(s)",
      );
      assert.equal(
        whyOf(prVerdict(pr({ comments: [...marks, human("2026-11-11T00:00:00Z")] }))),
        "unanswered review after 2 follow-up(s)",
      );
    });
    test("pre-rename farm markers count", () => {
      const farm = { ...mark("2026-11-01T00:00:00Z"), body: "<!-- farm-followup -->" };
      assert.equal(prVerdict(pr({ runs: red, comments: [farm, farm] })).kind, "unstick");
    });
    test("a green, quiet PR ignores its follow-up history", () =>
      assert.equal(
        prVerdict(pr({ comments: [mark("2026-11-01T00:00:00Z"), mark("2026-11-02T00:00:00Z")] })).kind,
        "review",
      ));
  });
});

describe("claimState", () => {
  test("assigned by hand (no dispatch marker) with a tier: not picked up", () =>
    assert.deepEqual(claimState({ tiered: true, dispatchedAt: null }), { kind: "notPicked" }));
  test("assigned by hand without a tier: nothing to say", () =>
    assert.deepEqual(claimState({ tiered: false, dispatchedAt: null }), { kind: "none" }));
  test("dispatched, no PR by the time `finish` reads it (even dispatched today): unstick", () => {
    assert.deepEqual(claimState({ tiered: true, dispatchedAt: "2026-11-13T00:00:00Z" }), { kind: "unstick" });
    assert.deepEqual(claimState({ tiered: true, dispatchedAt: "2026-11-10T00:00:00Z" }), { kind: "unstick" });
  });
});

// `waiting-for-human` is the dispatcher's own output (board.ts, labelSync): reading it
// back would make a run decide on a stale copy of the last run's stage.
describe("the waiting-for-human label changes no decision", () => {
  const facts = [
    { title: "t", labels: ["sonnet", "ready-for-agent"], assignees: 0, subIssues: 0, linked: false, blockers: [] },
    { title: "t", labels: ["sonnet"], assignees: 0, subIssues: 0, linked: false, blockers: [] },
    { title: "t", labels: [], assignees: 0, subIssues: 0, linked: false, blockers: [] },
    { title: "t", labels: ["opus"], assignees: 0, subIssues: 0, linked: false, blockers: [], question: "Which?" },
  ];
  for (const f of facts)
    test(`issueState with labels [${f.labels.join(", ")}]`, () =>
      assert.deepEqual(issueState({ ...f, labels: [...f.labels, WAITING_LABEL] }), issueState(f)));

  const green = [{ name: "build", status: "completed", conclusion: "success", html_url: "u/b" }];
  const base = {
    dependabot: false, autoMerge: false, runs: green, mergeable: true, headDate: "2026-11-10T12:00:00Z",
    comments: [], reviewComments: [], reviews: [], today: new Date("2026-11-13"), maxFollowups: 2, staleDays: 2,
  };
  for (const labels of [[], ["automerge"]])
    test(`prVerdict with labels [${labels.join(", ")}]`, () =>
      assert.deepEqual(prVerdict({ ...base, labels: [...labels, WAITING_LABEL] }), prVerdict({ ...base, labels })));
});
