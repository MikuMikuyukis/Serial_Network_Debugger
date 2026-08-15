import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemanticVersion(value) {
  const match = typeof value === "string" ? semanticVersionPattern.exec(value) : null;
  if (!match) throw new Error(`Invalid semantic version: ${String(value)}`);
  return {
    value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function validateVersionSet(versions) {
  const entries = Object.entries(versions);
  if (entries.length === 0) throw new Error("No repository versions were provided");
  const expected = parseSemanticVersion(entries[0][1]).value;
  for (const [name, value] of entries) {
    parseSemanticVersion(value);
    if (value !== expected) {
      throw new Error(`Version mismatch: ${name} is ${value}, expected ${expected}`);
    }
  }
  return expected;
}

export function validateVersionTransition(currentValue, previousValue) {
  const current = parseSemanticVersion(currentValue);
  if (!previousValue) return;
  const previous = parseSemanticVersion(previousValue);
  if (current.major !== previous.major || current.minor !== previous.minor) return;
  if (current.patch !== previous.patch + 1) {
    throw new Error(
      `Patch version must increment exactly once within V${current.major}.${current.minor}.x: `
      + `V${previous.value} -> V${current.value}`,
    );
  }
}

export function readRepositoryVersions(root = repositoryRoot) {
  const rootPackage = readJson(resolve(root, "package.json"));
  const frontendPackage = readJson(resolve(root, "frontend/package.json"));
  const serverPackage = readJson(resolve(root, "server/package.json"));
  const packageLock = readJson(resolve(root, "package-lock.json"));
  return {
    "package.json": rootPackage.version,
    "frontend/package.json": frontendPackage.version,
    "server/package.json": serverPackage.version,
    "package-lock.json": packageLock.version,
    "package-lock.json packages root": packageLock.packages?.[""]?.version,
    "package-lock.json packages frontend": packageLock.packages?.frontend?.version,
    "package-lock.json packages server": packageLock.packages?.server?.version,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const current = validateVersionSet(readRepositoryVersions());
    validateVersionTransition(current, process.argv[2]?.trim() || null);
    process.stdout.write(`Version policy OK: V${current}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
