// Pins the workshop's schedule: the table, the tick a run belongs to, and what is due.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { TABLE, due, tickOf } from "./schedule.ts";

const skills = (now: string, paused = false) => due(new Date(now), paused).run.map((e) => e.skill);

test("every entry names an existing skill and a tier, not a model ID", () => {
  for (const e of TABLE) {
    assert.ok(existsSync(new URL(`../../${e.skill}/SKILL.md`, import.meta.url)), e.skill);
    assert.ok(["haiku", "sonnet", "opus"].includes(e.model), `${e.skill}: ${e.model}`);
  }
});

describe("tickOf", () => {
  test("the cron's hours, and an hour late", () => {
    assert.equal(tickOf(5), "am");
    assert.equal(tickOf(6), "am");
    assert.equal(tickOf(17), "pm");
    assert.equal(tickOf(18), "pm");
  });
  test("an hour that maps to no tick fails, naming the ticks", () => {
    for (const h of [0, 4, 7, 12, 16, 19, 23]) assert.throws(() => tickOf(h), /UTC hour \d+ maps to no tick \(am = 5:00, pm = 17:00\)/);
  });
});

describe("due", () => {
  test("Monday am: the dispatcher and dependency maintenance", () => {
    assert.deepEqual(skills("2026-11-16T05:00Z"), ["dispatcher", "dependency-maintenance"]);
    assert.equal(due(new Date("2026-11-16T05:00Z"), false).run[1].model, "opus");
  });
  test("other mornings: the dispatcher only", () => assert.deepEqual(skills("2026-11-17T05:02Z"), ["dispatcher"]));
  test("Monday, Wednesday and Friday evenings: the survey run", () => {
    for (const d of ["16", "18", "20"]) assert.deepEqual(skills(`2026-11-${d}T17:00Z`), ["surveys"]);
  });
  test("other evenings: nothing", () => {
    for (const d of ["17", "19", "21", "22"]) assert.deepEqual(skills(`2026-11-${d}T17:00Z`), []);
  });
  test("paused: only the dispatcher runs, and the rest are held", () => {
    assert.deepEqual(skills("2026-11-16T05:00Z", true), ["dispatcher"]);
    assert.deepEqual(due(new Date("2026-11-16T05:00Z"), true).held, ["dependency-maintenance"]);
    assert.deepEqual(skills("2026-11-16T17:00Z", true), []);
  });
  test("the day is the UTC day", () => assert.equal(due(new Date("2026-11-15T22:00-07:00"), false).day, "mon"));
});
