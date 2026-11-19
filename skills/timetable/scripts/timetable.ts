#!/usr/bin/env node
// Works out what is due on this tick of the `Timetable` routine. Read-only; prints JSON.
// See ../SKILL.md.
// Usage: node timetable.ts --home owner/repo [--now 2026-11-17T05:00Z]
import { all, type GhIssue } from "../../_shared/github.ts";
import { arg, main } from "../../_shared/cli.ts";
import { isPause } from "../../_shared/markers.ts";
import { due } from "./schedule.ts";

main(() => {
  const home = arg("--home");
  if (!home) throw new Error("pass --home owner/repo: the dispatcher's SKILL.md names the home repo");
  const now = new Date(arg("--now") ?? Date.now());
  // Paused while a pause issue is open in the home repo, as the dispatcher's pause.ts reads it.
  const paused = all<GhIssue>(`repos/${home}/issues?state=open&per_page=100`).some((i) => !i.pull_request && isPause(i.title));
  console.log(JSON.stringify({ now: now.toISOString(), paused, ...due(now, paused) }, null, 2));
});
