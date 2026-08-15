import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bumpPatchVersion } from "../../scripts/bump-patch-version.mjs";
import {
  validateVersionSet,
  validateVersionTransition,
} from "../../scripts/check-version-policy.mjs";

describe("release version policy", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("接受完全同步的仓库版本", () => {
    expect(validateVersionSet({ root: "0.1.0", frontend: "0.1.0", server: "0.1.0" })).toBe("0.1.0");
  });

  it("拒绝未同步或格式无效的版本", () => {
    expect(() => validateVersionSet({ root: "0.1.0", server: "0.1.1" })).toThrow("Version mismatch");
    expect(() => validateVersionSet({ root: "V0.1.0" })).toThrow("Invalid semantic version");
  });

  it("同一大版本和小版本只允许补丁号增加一", () => {
    expect(() => validateVersionTransition("0.1.1", "0.1.0")).not.toThrow();
    expect(() => validateVersionTransition("0.1.0", "0.1.0")).toThrow("increment exactly once");
    expect(() => validateVersionTransition("0.1.3", "0.1.1")).toThrow("increment exactly once");
    expect(() => validateVersionTransition("0.1.1", "0.1.2")).toThrow("increment exactly once");
  });

  it("允许用户控制的大版本或小版本发生变化", () => {
    expect(() => validateVersionTransition("0.2.0", "0.1.9")).not.toThrow();
    expect(() => validateVersionTransition("1.0.0", "0.9.9")).not.toThrow();
  });

  it("补丁版本命令同步更新所有包元数据", () => {
    const root = mkdtempSync(join(tmpdir(), "snd-version-policy-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "frontend"));
    mkdirSync(join(root, "server"));
    writeJson(join(root, "package.json"), { version: "0.1.0" });
    writeJson(join(root, "frontend/package.json"), { version: "0.1.0" });
    writeJson(join(root, "server/package.json"), { version: "0.1.0" });
    writeJson(join(root, "package-lock.json"), {
      version: "0.1.0",
      packages: {
        "": { version: "0.1.0" },
        frontend: { version: "0.1.0" },
        server: { version: "0.1.0" },
      },
    });

    expect(bumpPatchVersion(root)).toBe("0.1.1");
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version).toBe("0.1.1");
    expect(JSON.parse(readFileSync(join(root, "frontend/package.json"), "utf8")).version).toBe("0.1.1");
    expect(JSON.parse(readFileSync(join(root, "server/package.json"), "utf8")).version).toBe("0.1.1");
    expect(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))).toMatchObject({
      version: "0.1.1",
      packages: {
        "": { version: "0.1.1" },
        frontend: { version: "0.1.1" },
        server: { version: "0.1.1" },
      },
    });
  });
});

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
