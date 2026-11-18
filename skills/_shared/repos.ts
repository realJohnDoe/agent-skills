// The repos attached to the session: every GitHub clone directly under the checkouts
// folder, which is `--checkouts`, $WORKSHOP_CHECKOUTS, or the folder holding the clone
// the run started in (the working directory itself when that isn't a clone).
// `--repos a/b,c/d` limits the run to some of them.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, run } from "./cli.ts";

export type Repo = { repo: string; name: string; path: string };

export const attachedRepos = (): { checkouts: string; repos: Repo[] } => {
  const given = arg("--checkouts") ?? process.env.WORKSHOP_CHECKOUTS;
  const checkouts = resolve(given ?? startedIn());
  // The fallback must not land in the installed plugin's skills folder (the usual cause:
  // a `cd` into a skill's folder before running a script), or it would silently find no repos.
  if (!given) {
    const skills = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const rel = relative(skills, checkouts);
    if (rel === "" || !rel.startsWith(".."))
      throw new Error(
        "Run from the session's working directory, not the skill's folder, or pass --checkouts <dir>.",
      );
  }
  const found = readdirSync(checkouts, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(checkouts, d.name, ".git")))
    .map((d): Repo | null => {
      const path = join(checkouts, d.name);
      let url: string;
      try {
        url = run("git", ["-C", path, "remote", "get-url", "origin"]);
      } catch {
        return null;
      }
      const repo = url.trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i)?.[1];
      return repo ? { repo, name: repo.split("/")[1], path } : null;
    })
    .filter((r) => r !== null)
    .sort((a, b) => a.repo.localeCompare(b.repo));
  const only = arg("--repos")?.split(",").map((r) => r.trim().toLowerCase());
  const repos = found.filter((r) => !only || only.includes(r.repo.toLowerCase()));
  const unknown = (only ?? []).filter((o) => !repos.some((r) => r.repo.toLowerCase() === o));
  if (unknown.length)
    throw new Error(
      `--repos names repos not checked out under ${checkouts}: ${unknown.join(", ")}. Attach them to the session.`,
    );
  if (!repos.length)
    throw new Error(`No GitHub clone under ${checkouts}: attach a repo to the session.`);
  return { checkouts, repos };
};

// The folder holding the clone the run started in, or the working directory itself
// when the run didn't start in a clone (a session with several repos may start
// above them).
const startedIn = () => {
  try {
    return dirname(run("git", ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    return process.cwd();
  }
};
