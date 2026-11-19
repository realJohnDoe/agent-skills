// Pins the pause state machine: which state the pause issues in the home repo put the
// workshop in. A wrong answer fails silently (it dispatches while the maintainer thinks
// the workshop is paused, or resumes twice), so every row of SKILL.md's Pausing table is
// here, plus the odd cases. dispatch.test.ts runs pause.ts end to end on top of it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type PauseIssue, pauseState, RESUMED, SNAPSHOT } from "./lib.ts";

type Comment = { body: string; created_at: string; html_url?: string };
const pause = (number: number, state: "open" | "closed", closed_at?: string): PauseIssue => ({
  number,
  state,
  title: "Pause workshop",
  body: "",
  html_url: `https://github.com/o/h/issues/${number}`,
  created_at: "2026-11-01T00:00:00Z",
  labels: [],
  assignees: [],
  comments: 0,
  ...(closed_at && { closed_at }),
});
const snapshot = (at: string): Comment => ({ body: `${SNAPSHOT}\nWorkshop paused.`, created_at: at, html_url: `snap-${at}` });
const resumed = (at: string): Comment => ({ body: `${RESUMED}\n\nWorkshop resumed.`, created_at: at });
const other = (at: string): Comment => ({ body: "Pausing for the holidays.", created_at: at });
const state = (...pauses: { issue: PauseIssue; comments: Comment[] }[]) => pauseState(pauses);

describe("the pause state", () => {
  test("no pause issue: normal", () => assert.deepEqual(pauseState([]), { state: "normal" }));

  test("an open pause issue with no snapshot: drain, on that issue", () => {
    const p = state({ issue: pause(5, "open"), comments: [other("2026-11-02T00:00:00Z")] });
    assert.equal(p.state, "drain");
    assert.equal(p.issue?.number, 5);
  });

  test("an open pause issue with a snapshot: paused, with that snapshot", () => {
    const p = state({ issue: pause(5, "open"), comments: [snapshot("2026-11-02T00:00:00Z")] });
    assert.equal(p.state, "paused");
    assert.equal(p.snap?.html_url, "snap-2026-11-02T00:00:00Z");
  });

  test("closed, with a snapshot and no later resumed comment: resume, on that issue", () => {
    const p = state({ issue: pause(5, "closed", "2026-11-03T00:00:00Z"), comments: [snapshot("2026-11-02T00:00:00Z")] });
    assert.equal(p.state, "resume");
    assert.equal(p.issue?.number, 5);
  });

  test("closed and resumed: normal", () =>
    assert.equal(
      state({ issue: pause(5, "closed", "2026-11-03T00:00:00Z"), comments: [snapshot("2026-11-02T00:00:00Z"), resumed("2026-11-04T00:00:00Z")] }).state,
      "normal",
    ));

  test("closed with no snapshot (paused and resumed before a drain ran): normal", () =>
    assert.equal(state({ issue: pause(5, "closed", "2026-11-03T00:00:00Z"), comments: [] }).state, "normal"));

  test("only the pause issue closed last counts", () => {
    const older = { issue: pause(4, "closed", "2026-11-01T00:00:00Z"), comments: [snapshot("2026-10-30T00:00:00Z")] };
    const newer = { issue: pause(5, "closed", "2026-11-05T00:00:00Z"), comments: [snapshot("2026-11-02T00:00:00Z"), resumed("2026-11-06T00:00:00Z")] };
    assert.equal(state(older, newer).state, "normal");
    assert.equal(state(newer, older).state, "normal", "whatever order they come in");
  });

  describe("two open pause issues: one pause", () => {
    test("no snapshot on either: drain, on the older one", () => {
      const p = state({ issue: pause(7, "open"), comments: [] }, { issue: pause(6, "open"), comments: [] });
      assert.equal(p.state, "drain");
      assert.equal(p.issue?.number, 6);
    });
    test("a snapshot on either: paused, not drained again", () => {
      const p = state({ issue: pause(6, "open"), comments: [] }, { issue: pause(7, "open"), comments: [snapshot("2026-11-02T00:00:00Z")] });
      assert.equal(p.state, "paused");
      assert.equal(p.snap?.created_at, "2026-11-02T00:00:00Z");
    });
    test("an open one wins over a closed one that still has to resume", () =>
      assert.equal(
        state({ issue: pause(5, "closed", "2026-11-03T00:00:00Z"), comments: [snapshot("2026-11-02T00:00:00Z")] }, { issue: pause(6, "open"), comments: [] }).state,
        "drain",
      ));
  });

  describe("a pause issue reopened after a resume", () => {
    const old = [snapshot("2026-11-02T00:00:00Z"), resumed("2026-11-04T00:00:00Z")];
    test("drains again: the old snapshot no longer counts", () =>
      assert.equal(state({ issue: pause(5, "open"), comments: old }).state, "drain"));
    test("paused once the new snapshot is posted", () =>
      assert.equal(state({ issue: pause(5, "open"), comments: [...old, snapshot("2026-11-08T00:00:00Z")] }).state, "paused"));
    test("closed again: resumes once more", () =>
      assert.equal(state({ issue: pause(5, "closed", "2026-11-09T00:00:00Z"), comments: [...old, snapshot("2026-11-08T00:00:00Z")] }).state, "resume"));
  });

  test("markers from before the farm → workshop rename count", () =>
    assert.equal(state({ issue: pause(5, "open"), comments: [{ body: "<!-- farm-snapshot -->", created_at: "2026-11-02T00:00:00Z" }] }).state, "paused"));
});
