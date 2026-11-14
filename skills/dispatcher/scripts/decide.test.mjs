// Pins the workshop's two decisions that change what lands on main, as Meridian's
// scripts/workshop-dispatch.mjs made them before the move (realJohnDoe/meridian#1434).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AWAITING_TRIAGE,
  DECISION,
  claimState,
  isDigest,
  linkedIssues,
  openQuestion,
  prVerdict,
  skipReason,
  tierOf,
} from "./decide.mjs";

describe("linkedIssues", () => {
  test("closing keywords in any case, each named issue once per mention", () => {
    assert.deepEqual(
      linkedIssues("Fixes #12. Also closes #3, resolved #4; refs #9"),
      [12, 3, 4],
    );
    assert.deepEqual(linkedIssues("FIXED #1 close #2 resolves #5"), [1, 2, 5]);
  });
  test("no body", () => assert.deepEqual(linkedIssues(null), []));
});

test("tierOf picks the first tier label", () => {
  assert.equal(tierOf(["bug", "sonnet"]), "sonnet");
  assert.equal(tierOf(["opus-plan"]), undefined);
});

test("isDigest matches workshop and pre-rename farm digests", () => {
  assert.ok(isDigest("Workshop digest (draft) — from 2026-11-10"));
  assert.ok(isDigest("Farm digest — 2026-01-02"));
  assert.ok(!isDigest("Fix the Workshop digest layout"));
});

describe("skipReason", () => {
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
    assert.equal(skipReason(issue()), undefined);
  });

  describe("shown elsewhere (null)", () => {
    test("a digest issue", () =>
      assert.equal(skipReason(issue({ title: "Workshop digest (draft) — from x" })), null));
    test("has sub-issues", () =>
      assert.equal(skipReason(issue({ subIssues: 2 })), null));
    test("an open PR closes it", () =>
      assert.equal(skipReason(issue({ linked: true })), null));
    test("assigned", () =>
      assert.equal(skipReason(issue({ assignees: 1 })), null));
  });

  describe("waiting on a decision", () => {
    test("an open question without the go-ahead", () =>
      assert.equal(skipReason(issue({ labels: ["sonnet"], question: "Which API?" })), DECISION));
    test("even without a tier label", () =>
      assert.equal(skipReason(issue({ labels: [], question: "Which API?" })), DECISION));
    test("the go-ahead settles it", () =>
      assert.equal(skipReason(issue({ question: "Which API?" })), undefined));
    test("blocked: waits for the blocker", () =>
      assert.equal(
        skipReason(issue({ labels: ["sonnet"], question: "Which API?", blockers: [3] })),
        "blocked by #3",
      ));
    test("deferred before the decision", () =>
      assert.equal(
        skipReason(issue({ labels: ["deferred"], question: "Which API?" })),
        "`deferred`; remove the label to queue it",
      ));
    test("assigned before the decision", () =>
      assert.equal(skipReason(issue({ labels: [], assignees: 1, question: "Which API?" })), null));
  });

  describe("not picked up, with the reason", () => {
    test("deferred", () =>
      assert.equal(
        skipReason(issue({ labels: ["sonnet", "deferred"] })),
        "`deferred`; remove the label to queue it",
      ));
    test("no tier label", () =>
      assert.equal(
        skipReason(issue({ labels: ["bug"] })),
        "no tier label; add `haiku`, `sonnet` or `opus` to queue it",
      ));
    test("opus-plan", () =>
      assert.equal(
        skipReason(issue({ labels: ["opus-plan"] })),
        "`opus-plan`; start a plan session by hand",
      ));
    test("tier label without ready-for-agent waits for triage", () =>
      assert.equal(skipReason(issue({ labels: ["sonnet"] })), AWAITING_TRIAGE));
    test("ready-for-agent without a tier label still needs one", () =>
      assert.equal(
        skipReason(issue({ labels: ["ready-for-agent"] })),
        "no tier label; add `haiku`, `sonnet` or `opus` to queue it",
      ));
    test("blocked, named with the given ref", () => {
      assert.equal(skipReason(issue({ blockers: [4, 7] })), "blocked by #4, #7");
      assert.equal(
        skipReason(issue({ blockers: [4] }), { ref: (n) => `o/r#${n}` }),
        "blocked by o/r#4",
      );
    });
  });

  describe("order: the first matching reason wins", () => {
    test("digest before everything", () =>
      assert.equal(
        skipReason(issue({ title: "Workshop digest — x", labels: ["deferred"], blockers: [1] })),
        null,
      ));
    test("linked before deferred", () =>
      assert.equal(skipReason(issue({ linked: true, labels: ["deferred"] })), null));
    test("assigned before deferred", () =>
      assert.equal(skipReason(issue({ assignees: 1, labels: ["deferred"] })), null));
    test("deferred before no tier", () =>
      assert.equal(
        skipReason(issue({ labels: ["deferred"] })),
        "`deferred`; remove the label to queue it",
      ));
    test("opus-plan beats a tier label", () =>
      assert.equal(
        skipReason(issue({ labels: ["sonnet", "opus-plan"] })),
        "`opus-plan`; start a plan session by hand",
      ));
    test("no tier before blocked", () =>
      assert.equal(
        skipReason(issue({ labels: [], blockers: [3] })),
        "no tier label; add `haiku`, `sonnet` or `opus` to queue it",
      ));
    test("blocked before awaiting triage", () =>
      assert.equal(skipReason(issue({ labels: ["sonnet"], blockers: [3] })), "blocked by #3"));
    test("deferred before awaiting triage", () =>
      assert.equal(
        skipReason(issue({ labels: ["sonnet", "deferred"] })),
        "`deferred`; remove the label to queue it",
      ));
    test("opus-plan before blocked", () =>
      assert.equal(
        skipReason(issue({ labels: ["opus-plan"], blockers: [3] })),
        "`opus-plan`; start a plan session by hand",
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
    assert.equal(openQuestion(`## Decision needed\n${"x".repeat(300)}`).length, 200));
});

describe("prVerdict", () => {
  const HEAD = "2026-11-10T12:00:00Z";
  const TODAY = new Date("2026-11-13");
  const green = [{ name: "build", status: "completed", conclusion: "success", html_url: "u/b" }];
  const red = [
    { name: "build", status: "completed", conclusion: "failure", html_url: "u/b" },
    { name: "lint", status: "completed", conclusion: "success", html_url: "u/l" },
  ];
  const human = (at, body = "please rename this") => ({
    created_at: at,
    user: { type: "User" },
    body,
    html_url: `c/${at}`,
  });
  const mark = (at) => ({
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
      assert.equal(prVerdict(pr()).verdict, "review"));
    test("automerge-labelled PR is merged", () =>
      assert.equal(prVerdict(pr({ labels: ["automerge"] })).verdict, "merge"));
    test("automerge-labelled PR already on native auto-merge waits", () =>
      assert.equal(prVerdict(pr({ labels: ["automerge"], autoMerge: true })).verdict, "wait"));
    test("Dependabot with native auto-merge waits for it", () =>
      assert.equal(prVerdict(pr({ dependabot: true, autoMerge: true })).verdict, "wait"));
    test("Dependabot without native auto-merge goes to review", () =>
      assert.equal(prVerdict(pr({ dependabot: true })).verdict, "review"));
    test("Dependabot is never merged by the label", () =>
      assert.equal(
        prVerdict(pr({ dependabot: true, labels: ["automerge"] })).verdict,
        "review",
      ));
    test("unknown mergeability is not a conflict", () =>
      assert.equal(prVerdict(pr({ mergeable: null })).verdict, "review"));
  });

  describe("CI not finished", () => {
    test("running checks: wait", () =>
      assert.equal(
        prVerdict(pr({ runs: [{ name: "b", status: "in_progress", conclusion: null }] })).verdict,
        "wait",
      ));
    test("no checks at all: wait", () =>
      assert.equal(prVerdict(pr({ runs: [] })).verdict, "wait"));
    test("conflict without CI: follow up without waiting", () => {
      const v = prVerdict(pr({ runs: [], mergeable: false }));
      assert.equal(v.verdict, "followup");
      assert.equal(v.conflict, true);
      assert.deepEqual(v.failing, []);
    });
    test("running checks don't count as failing on a conflict", () => {
      const v = prVerdict(
        pr({ runs: [{ name: "b", status: "in_progress", conclusion: "failure" }], mergeable: false }),
      );
      assert.equal(v.verdict, "followup");
      assert.deepEqual(v.failing, []);
    });
  });

  describe("red CI", () => {
    test("failure gets a follow-up naming the failing check", () => {
      const v = prVerdict(pr({ runs: red }));
      assert.equal(v.verdict, "followup");
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
      assert.equal(prVerdict(pr({ runs: red, labels: ["automerge"] })).verdict, "followup"));
  });

  describe("human feedback", () => {
    test("newer than the head commit gets a follow-up", () => {
      const v = prVerdict(pr({ comments: [human("2026-11-11T00:00:00Z")] }));
      assert.equal(v.verdict, "followup");
      assert.equal(v.feedback.length, 1);
    });
    test("older than the head commit is answered already", () =>
      assert.equal(prVerdict(pr({ comments: [human("2026-11-09T00:00:00Z")] })).verdict, "review"));
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
      assert.equal(v.verdict, "followup");
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
      assert.equal(v.verdict, "review");
    });
  });

  describe("follow-up bookkeeping", () => {
    test("a follow-up newer than the head commit is still on it: wait", () =>
      assert.equal(
        prVerdict(pr({ runs: red, comments: [mark("2026-11-12T00:00:00Z")] })).verdict,
        "wait",
      ));
    test("a pending follow-up older than staleDays: unstick", () => {
      const v = prVerdict(pr({ runs: red, comments: [mark("2026-11-10T13:00:00Z")] }));
      assert.equal(v.verdict, "unstick");
      assert.equal(v.why, "CI red after 1 follow-up(s)");
    });
    test("a follow-up older than the head commit was answered: follow up again", () => {
      const v = prVerdict(
        pr({ runs: red, headDate: "2026-11-12T00:00:00Z", comments: [mark("2026-11-11T00:00:00Z")] }),
      );
      assert.equal(v.verdict, "followup");
    });
    test("at the follow-up cap: unstick, saying why", () => {
      const marks = [mark("2026-11-01T00:00:00Z"), mark("2026-11-02T00:00:00Z")];
      assert.equal(
        prVerdict(pr({ runs: red, comments: marks })).why,
        "CI red after 2 follow-up(s)",
      );
      assert.equal(
        prVerdict(pr({ mergeable: false, comments: marks })).why,
        "conflicts with main after 2 follow-up(s)",
      );
      assert.equal(
        prVerdict(pr({ mergeable: false, comments: marks, base: "trunk" })).why,
        "conflicts with trunk after 2 follow-up(s)",
      );
      assert.equal(
        prVerdict(pr({ comments: [...marks, human("2026-11-11T00:00:00Z")] })).why,
        "unanswered review after 2 follow-up(s)",
      );
    });
    test("pre-rename farm markers count", () => {
      const farm = { ...mark("2026-11-01T00:00:00Z"), body: "<!-- farm-followup -->" };
      assert.equal(prVerdict(pr({ runs: red, comments: [farm, farm] })).verdict, "unstick");
    });
    test("a green, quiet PR ignores its follow-up history", () =>
      assert.equal(
        prVerdict(pr({ comments: [mark("2026-11-01T00:00:00Z"), mark("2026-11-02T00:00:00Z")] })).verdict,
        "review",
      ));
  });
});

describe("claimState", () => {
  const TODAY = new Date("2026-11-13");
  test("assigned by hand (no dispatch marker) with a tier: not picked up", () =>
    assert.equal(claimState({ tiered: true, dispatchedAt: null, today: TODAY, staleDays: 2 }), "notPicked"));
  test("assigned by hand without a tier: nothing to say", () =>
    assert.equal(claimState({ tiered: false, dispatchedAt: null, today: TODAY, staleDays: 2 }), null));
  test("dispatched recently: still working", () =>
    assert.equal(
      claimState({ tiered: true, dispatchedAt: "2026-11-12T00:00:00Z", today: TODAY, staleDays: 2 }),
      null,
    ));
  test("dispatched over staleDays ago with no PR: unstick", () =>
    assert.equal(
      claimState({ tiered: true, dispatchedAt: "2026-11-10T00:00:00Z", today: TODAY, staleDays: 2 }),
      "unstick",
    ));
});
