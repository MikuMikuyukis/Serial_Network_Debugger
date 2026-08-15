import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSemanticVersion,
  readRepositoryVersions,
  validateVersionSet,
} from "./check-version-policy.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function bumpPatchVersion(root = repositoryRoot) {
  const current = parseSemanticVersion(validateVersionSet(readRepositoryVersions(root)));
  const next = `${current.major}.${current.minor}.${current.patch + 1}`;
  const paths = {
    root: resolve(root, "package.json"),
    frontend: resolve(root, "frontend/package.json"),
    server: resolve(root, "server/package.json"),
    lock: resolve(root, "package-lock.json"),
  };
  const rootPackage = readJson(paths.root);
  const frontendPackage = readJson(paths.frontend);
  const serverPackage = readJson(paths.server);
  const packageLock = readJson(paths.lock);

  rootPackage.version = next;
  frontendPackage.version = next;
  serverPackage.version = next;
  packageLock.version = next;
  packageLock.packages[""].version = next;
  packageLock.packages.frontend.version = next;
  packageLock.packages.server.version = next;

  writeJson(paths.root, rootPackage);
  writeJson(paths.frontend, frontendPackage);
  writeJson(paths.server, serverPackage);
  writeJson(paths.lock, packageLock);
  return next;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const next = bumpPatchVersion();
    process.stdout.write(`Version updated to V${next}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
