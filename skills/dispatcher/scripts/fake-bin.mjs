#!/usr/bin/env node
// Stand-ins for `gh` and `git`, so the workshop scripts can be run end to end in
// tests. Installed by fakeBin() as `gh` and `git` on PATH.
//
// gh: reads answers from $FAKE_GH_FIXTURE, a JSON object keyed by the API path
//   without its query string (search: `search/issues?q=<q>`). A path that isn't
//   in it is an error. Every write (-X other than GET, or --input) is appended to
//   $FAKE_GH_LOG as `{method, path, body}`, or fails when FAKE_GH_LOG is unset, so
//   a dry run that writes fails loudly. A write answers `{"number": 900}`.
// git: `remote get-url origin` answers from $FAKE_GIT_REMOTES ({path: url});
//   `push --dry-run` fails for paths listed in $FAKE_GIT_NOPUSH; `rev-parse
//   --show-toplevel` answers the working directory.
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

// A directory holding `gh` and `git` wrappers around this file; put it first on PATH.
export const fakeBin = () => {
  const dir = mkdtempSync(join(tmpdir(), "workshop-fake-bin-"));
  for (const tool of ["gh", "git"]) {
    const file = join(dir, tool);
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${self}" ${tool} "$@"\n`);
    chmodSync(file, 0o755);
  }
  return dir;
};

const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

const gh = (args) => {
  if (args[0] !== "api") fail(`fake gh: only \`gh api\`, got ${args.join(" ")}`);
  // The path is the first argument that is neither a flag nor a flag's value.
  const valued = ["-X", "-f", "--input"];
  const path = args.slice(1).find(
    (a, i, rest) => !a.startsWith("-") && !valued.includes(rest[i - 1]),
  );
  const opt = (name) => {
    const i = args.indexOf(name);
    return i > 0 ? args[i + 1] : undefined;
  };
  const method = opt("-X") ?? (args.includes("--input") ? "POST" : "GET");
  if (method !== "GET") {
    if (!process.env.FAKE_GH_LOG) fail(`fake gh: write in a dry run: ${method} ${path}`);
    const body = readFileSync(0, "utf8");
    appendFileSync(
      process.env.FAKE_GH_LOG,
      `${JSON.stringify({ method, path, body: body ? JSON.parse(body) : null })}\n`,
    );
    process.stdout.write(JSON.stringify({ number: 900 }));
    return;
  }
  const fixture = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
  const q = args.find((a) => a.startsWith("q="));
  const key = q ? `${path}?${q}` : path.split("?")[0];
  if (!(key in fixture)) fail(`fake gh: no fixture for ${key}`);
  const answer = fixture[key];
  process.stdout.write(JSON.stringify(args.includes("--slurp") ? [answer] : answer));
};

const git = (args) => {
  const c = args[0] === "-C" ? args[1] : process.cwd();
  const rest = args[0] === "-C" ? args.slice(2) : args;
  const cmd = rest.join(" ");
  if (cmd === "rev-parse --show-toplevel") return process.stdout.write(`${process.cwd()}\n`);
  if (cmd === "remote get-url origin") {
    const url = JSON.parse(process.env.FAKE_GIT_REMOTES ?? "{}")[c];
    if (!url) fail("error: No such remote 'origin'");
    return process.stdout.write(`${url}\n`);
  }
  if (rest[0] === "push" && rest.includes("--dry-run")) {
    if (JSON.parse(process.env.FAKE_GIT_NOPUSH ?? "[]").includes(c))
      fail("remote: Permission denied.\nfatal: unable to access: The requested URL returned error: 403");
    return;
  }
  fail(`fake git: unexpected ${cmd}`);
};

if (process.argv[1] === self && basename(process.argv[2] ?? "") in { gh: 1, git: 1 }) {
  const [tool, ...args] = process.argv.slice(2);
  (tool === "gh" ? gh : git)(args);
}
