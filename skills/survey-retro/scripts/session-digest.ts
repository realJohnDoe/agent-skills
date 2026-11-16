#!/usr/bin/env node
// Condenses a saved `list_events` result (kinds user/assistant/result) into one line per
// turn, so a retro reads ~5% of a transcript's bytes. Step 2 of ../SKILL.md.
// Usage: node session-digest.ts <saved-list_events-file> [--width N]
import { readFileSync } from "node:fs";
import { arg } from "../../dispatcher/scripts/lib.ts";

const W = Number(arg("--width", 160));
// The saved file wraps one JSON line in an <other-session> envelope; take the JSON.
const json = readFileSync(process.argv[2], "utf8")
  .split("\n")
  .find((l) => l.trimStart().startsWith("{"))!;
const { data } = JSON.parse(json).ccr;
const cut = (s: unknown) => String(s).replace(/\s+/g, " ").slice(0, W);
const text = (c: any): string =>
  typeof c === "string" ? c : (c ?? []).map((p: any) => p.text ?? p.content ?? "").join(" ");

for (const e of data) {
  const t = e.created_at.slice(11, 19);
  const kind = Object.keys(e).find((k) => k !== "created_at")!;
  const m = e[kind].internal_anthropic_catchall ?? {};
  if (kind === "result") {
    console.log(
      `${t} RESULT turns=${m.num_turns} cost=$${m.total_cost_usd?.toFixed(2)} ${m.subtype} denials=${m.permission_denials?.length ?? 0}`,
    );
    continue;
  }
  const content = m.message?.content;
  if (typeof content === "string") {
    console.log(`${t} USER ${cut(content)}`);
    continue;
  }
  for (const p of content ?? []) {
    if (p.type === "text") console.log(`${t} SAY ${cut(p.text)}`);
    else if (p.type === "tool_use") {
      const i = p.input ?? {};
      console.log(`${t} CALL ${p.name} ${cut(i.command ?? i.file_path ?? i.pattern ?? i.query ?? JSON.stringify(i))}`);
    } else if (p.type === "tool_result") {
      const body = text(p.content);
      console.log(`${t} ${p.is_error ? "ERR" : "OK"} ${body.length}ch ${cut(body).slice(0, 100)}`);
    } else if (kind === "user" && p.type !== "image") console.log(`${t} USER ${cut(p.text ?? "")}`);
  }
}
