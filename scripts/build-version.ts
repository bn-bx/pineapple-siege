import { execFileSync } from "node:child_process";

/** Derive the menu version from the exact commit being built, including CI clones. */
export function buildVersion(root: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  // Counting a shallow checkout would reset production to v1. Fetch history
  // first; fail the build if it is unavailable instead of publishing a wrong label.
  if (git("rev-parse", "--is-shallow-repository") === "true")
    git("fetch", "--unshallow", "--no-tags", "origin");
  const count = git("rev-list", "--count", "HEAD");
  if (!/^[1-9]\d*$/.test(count))
    throw Error("Could not determine the build version");
  return { version: `v${count}`, commit: git("rev-parse", "HEAD") };
}
