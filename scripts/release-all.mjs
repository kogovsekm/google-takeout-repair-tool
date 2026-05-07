#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, "release");
const packageJsonPath = path.join(rootDir, "package.json");
const packageLockPath = path.join(rootDir, "package-lock.json");
const shaSumsPath = path.join(releaseDir, "SHA256SUMS.txt");

const targetVersion = process.argv[2];

const isSemver = (value) => {
  return /^\d+\.\d+\.\d+$/.test(value);
};

const runCommand = async (command, args) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`,
        ),
      );
    });
  });
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJson = async (filePath, jsonValue) => {
  await fs.writeFile(
    filePath,
    `${JSON.stringify(jsonValue, null, 2)}\n`,
    "utf8",
  );
};

const updateVersions = async (version) => {
  const packageJson = await readJson(packageJsonPath);
  packageJson.version = version;
  await writeJson(packageJsonPath, packageJson);

  const packageLock = await readJson(packageLockPath);
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = version;
  }
  await writeJson(packageLockPath, packageLock);
};

const sha256ForFile = async (filePath) => {
  const hash = createHash("sha256");
  const stream = (await import("node:fs")).createReadStream(filePath);
  await pipeline(stream, hash);
  return hash.digest("hex");
};

const collectReleaseArtifacts = async () => {
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      return (
        name.endsWith(".dmg") ||
        name.endsWith(".AppImage") ||
        (name.endsWith(".exe") && name.includes("Setup"))
      );
    })
    .sort((a, b) => a.localeCompare(b));

  return fileNames;
};

const writeChecksums = async () => {
  const artifacts = await collectReleaseArtifacts();
  if (artifacts.length === 0) {
    throw new Error("No release artifacts were found to checksum.");
  }

  const lines = [];
  for (const artifact of artifacts) {
    const artifactPath = path.join(releaseDir, artifact);
    const digest = await sha256ForFile(artifactPath);
    lines.push(`${digest}  release/${artifact}`);
  }

  await fs.writeFile(shaSumsPath, `${lines.join("\n")}\n`, "utf8");
};

const main = async () => {
  if (!targetVersion || !isSemver(targetVersion)) {
    throw new Error(
      "Usage: npm run release:all -- <x.y.z> (example: npm run release:all -- 1.0.1)",
    );
  }

  console.log(`Preparing release ${targetVersion}`);
  await updateVersions(targetVersion);

  console.log("Cleaning release output directory");
  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(releaseDir, { recursive: true });

  console.log("Building renderer and Electron bundles");
  await runCommand("npm", ["run", "build"]);

  console.log("Building installers for macOS, Windows, and Linux");
  await runCommand("npx", [
    "electron-builder",
    "--mac",
    "dmg",
    "--win",
    "nsis",
    "--linux",
    "AppImage",
    "--x64",
    "--arm64",
  ]);

  console.log("Generating SHA256SUMS.txt");
  await writeChecksums();

  console.log(`Release ${targetVersion} completed.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
