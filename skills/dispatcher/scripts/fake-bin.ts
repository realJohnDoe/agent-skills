#!/usr/bin/env node
// Stand-ins for `gh` and `git`, so the workshop scripts can be run end to end in
// tests. Installed by fakeBin() as `gh` and `git` on PATH.
//
// gh: reads answers from $FAKE_GH_FIXTURE, a JSON object keyed by the API path
//   without its query string, except `?state=closed` (search: `search/issues?q=<q>`), or by
//   the whole path when the fixture has that key. A path that isn't in it is an error.
//   Every write (-X other than GET, or --input) is appended to $FAKE_GH_LOG as
//   `{method, path, body}`, or fails when FAKE_GH_LOG is unset, so a dry run that
//   writes fails loudly. A write answers `{"number": 900}`.
//   A merge (PUT .../pulls/N/merge) also moves PR N to the fixture's closed list, closes
//   the issues it closes and adds it to the merged-PR search, so the dispatcher's wait settles at once.
// git: `remote get-url origin` answers from $FAKE_GIT_REMOTES ({path: url});
//   `push --dry-run` fails for paths listed in $FAKE_GIT_NOPUSH; `rev-parse
//   --show-toplevel` answers the working directory. The board push's commands
//   (fetch, rev-parse FETCH_HEAD, hash-object, mktree, commit-tree, push) answer
//   made-up ids and are appended to $FAKE_GIT_LOG as `{args, input}` when it is set.
//   `show FETCH_HEAD:board.json` answers $FAKE_GIT_BOARD, and fails when it is unset.
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

// A directory holding `gh` and `git` wrappers (or just `tools`) around this file; put it
// first on PATH.
export const fakeBin = (tools = ["gh", "git"]) => {
  const dir = mkdtempSync(join(tmpdir(), "workshop-fake-bin-"));
  for (const tool of tools) {
    const file = join(dir, tool);
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${self}" ${tool} "$@"\n`);
    chmodSync(file, 0o755);
  }
  return dir;
};

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

const gh = (args: string[]) => {
  if (args[0] !== "api") fail(`fake gh: only \`gh api\`, got ${args.join(" ")}`);
  // The path is the first argument that is neither a flag nor a flag's value.
  const valued = ["-X", "-f", "--input"];
  const path =
    args.slice(1).find((a, i, rest) => !a.startsWith("-") && !valued.includes(rest[i - 1])) ??
    fail("fake gh: no path");
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i > 0 ? args[i + 1] : undefined;
  };
  const method = opt("-X") ?? (args.includes("--input") ? "POST" : "GET");
  if (method !== "GET") {
    const log = process.env.FAKE_GH_LOG;
    if (!log) fail(`fake gh: write in a dry run: ${method} ${path}`);
    const body = readFileSync(0, "utf8");
    appendFileSync(
      log,
      `${JSON.stringify({ method, path, body: body ? JSON.parse(body) : null })}\n`,
    );
    // A merge moves the PR from the open list to the closed one, as GitHub does.
    const merge = path.match(/^(repos\/[^/]+\/[^/]+)\/pulls\/(\d+)\/merge$/);
    if (merge) {
      const file = process.env.FAKE_GH_FIXTURE!;
      const f = JSON.parse(readFileSync(file, "utf8"));
      const [, r, n] = merge;
      const pr = f[`${r}/pulls`].find((p: { number: number }) => p.number === +n);
      f[`${r}/pulls`] = f[`${r}/pulls`].filter((p: unknown) => p !== pr);
      f[`${r}/pulls?state=closed`] = [{ ...pr, merged_at: "2026-11-13T00:00:00Z" }, ...(f[`${r}/pulls?state=closed`] ?? [])];
      // GitHub then closes the issues the PR closes and lists it in search.
      for (const [, k] of (pr.body ?? "").matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?) #(\d+)/gi))
        if (f[`${r}/issues/${k}`]) {
          f[`${r}/issues/${k}`].state = "closed";
          f[`${r}/issues`] = f[`${r}/issues`].filter((i: { number: number }) => i.number !== +k);
        }
      for (const k of Object.keys(f))
        if (k.startsWith(`search/issues?q=repo:${r.slice(6)} is:pr is:merged`)) f[k].items.push(pr);
      writeFileSync(file, JSON.stringify(f));
    }
    process.stdout.write(JSON.stringify({ number: 900 }));
    return;
  }
  const fixture = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURE!, "utf8"));
  const q = args.find((a) => a.startsWith("q="));
  const key = q ? `${path}?${q}` : path in fixture ? path : path.split("?")[0] + (path.includes("state=closed") ? "?state=closed" : "");
  if (!(key in fixture)) fail(`fake gh: no fixture for ${key}`);
  const answer = fixture[key];
  process.stdout.write(JSON.stringify(args.includes("--slurp") ? [answer] : answer));
};

const git = (args: string[]) => {
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
  if (cmd === "show FETCH_HEAD:board.json") {
    if (!process.env.FAKE_GIT_BOARD) fail("fatal: path 'board.json' does not exist");
    return process.stdout.write(process.env.FAKE_GIT_BOARD);
  }
  const board = ["fetch", "rev-parse", "hash-object", "mktree", "commit-tree", "push"];
  if (board.includes(rest.find((a) => board.includes(a)) ?? "")) {
    const input = rest.includes("--stdin") || rest.includes("mktree") ? readFileSync(0, "utf8") : undefined;
    if (process.env.FAKE_GIT_LOG) appendFileSync(process.env.FAKE_GIT_LOG, `${JSON.stringify({ args: rest, input })}\n`);
    if (rest.includes("commit-tree")) return process.stdout.write("commit0001\n");
    if (rest.includes("rev-parse")) return process.stdout.write("tip0001\n");
    if (rest.includes("hash-object") || rest.includes("mktree")) return process.stdout.write("obj0001\n");
    return;
  }
  fail(`fake git: unexpected ${cmd}`);
};

if (process.argv[1] === self && basename(process.argv[2] ?? "") in { gh: 1, git: 1 }) {
  const [tool, ...args] = process.argv.slice(2);
  (tool === "gh" ? gh : git)(args);
}
