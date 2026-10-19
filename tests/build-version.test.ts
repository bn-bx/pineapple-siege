import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { buildVersion } from "../scripts/build-version";

it("advances with commits and counts full history in shallow deployment clones", () => {
  const root = mkdtempSync(join(tmpdir(), "siege-version-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const commit = () =>
    git(
      "-c",
      "user.name=Version Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Test version",
    );
  try {
    git("init", "--quiet");
    commit();
    const first = buildVersion(root);
    expect(first.version).toBe("v1");
    commit();
    const second = buildVersion(root);
    expect(second.version).toBe("v2");
    expect(second.commit).not.toBe(first.commit);
    const shallow = join(root, "deployment");
    git("clone", "--quiet", "--depth", "1", pathToFileURL(root).href, shallow);
    expect(
      execFileSync("git", ["rev-list", "--count", "HEAD"], {
        cwd: shallow,
        encoding: "utf8",
      }).trim(),
    ).toBe("1");
    expect(buildVersion(shallow)).toEqual(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
