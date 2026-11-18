// What every workshop script needs to be a command: its arguments, child processes,
// and one clear line on failure.
import { execFileSync } from "node:child_process";

export function arg(name: string): string | undefined;
export function arg(name: string, dflt: string | number): string;
export function arg(name: string, dflt?: string | number) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt === undefined ? undefined : String(dflt);
}
export const flag = (name: string) => process.argv.includes(name);

export const run = (cmd: string, args: string[], input?: string): string =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    input,
    maxBuffer: 1 << 26,
    // Keep stderr out of the log: a failure still throws with it attached,
    // and an expected 422 stays quiet.
    stdio: ["pipe", "pipe", "pipe"],
  });

// Runs main(), turning a thrown error into one clear line and exit code 1.
export const main = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    console.error(`workshop: ${(e as Error).message}`);
    process.exit(1);
  }
};
