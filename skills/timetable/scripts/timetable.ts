#!/usr/bin/env node
// Works out what is due on this tick of the `Timetable` routine. Read-only; prints JSON.
// See ../SKILL.md.
// Usage: node timetable.ts --digest owner/repo [--now 2026-11-17T05:00Z]
import { all, type GhIssue } from "../../_shared/github.ts";
import { arg, main } from "../../_shared/cli.ts";
import { isDigest, PAUSE_LABEL } from "../../_shared/markers.ts";
import { due } from "./schedule.ts";

main(() => {
  const digest = arg("--digest");
  if (!digest) throw new Error("pass --digest owner/repo: the dispatcher's SKILL.md names the digest repo");
  const now = new Date(arg("--now") ?? Date.now());
  // Paused while an open digest carries the label, as the dispatcher's pause.ts reads it.
  const paused = all<GhIssue>(`repos/${digest}/issues?state=open&labels=${PAUSE_LABEL}&per_page=100`).some(
    (i) => !i.pull_request && isDigest(i.title),
  );
  console.log(JSON.stringify({ now: now.toISOString(), paused, ...due(now, paused) }, null, 2));
});
