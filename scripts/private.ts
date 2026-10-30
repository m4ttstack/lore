import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.env.LORE_PRIVATE_ROOT ?? join(import.meta.dir, "..");
const devDir = join(root, "private", "dev");
const archive = join(root, "private", "dev.tar.age");

class Failure extends Error {}

function run(command: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const result = spawnSync(command, args, {
    input: options.input,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") throw new Failure(`${command} is not installed or not on PATH`);
    throw new Failure(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const reason = result.stderr.trim().split("\n")[0] || `exit ${result.status}`;
    throw new Failure(`${command} failed: ${reason}`);
  }
  return result.stdout;
}

function readIdentity(): string {
  const file = process.env.LORE_PRIVATE_IDENTITY_FILE;
  if (file) {
    if (!existsSync(file)) throw new Failure(`identity file not found: ${file}`);
    return readFileSync(file, "utf8");
  }
  const result = spawnSync("security", ["find-generic-password", "-a", "mattstack", "-s", "mattstack-age-key", "-w"], { encoding: "utf8" });
  if (result.error || result.status !== 0 || result.stdout.trim() === "") {
    throw new Failure("keychain item mattstack-age-key (account mattstack) not found");
  }
  return result.stdout.trim() + "\n";
}

function isEmptyDir(path: string): boolean {
  return !existsSync(path) || (statSync(path).isDirectory() && readdirSync(path).length === 0);
}

function withScratch<T>(body: (scratch: string) => T): T {
  const scratch = mkdtempSync(join(tmpdir(), "lore-private-"));
  try {
    return body(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function lock(): void {
  if (isEmptyDir(devDir)) throw new Failure(`nothing to lock: ${devDir} is missing or empty`);
  const recipient = run("age-keygen", ["-y"], { input: readIdentity() }).trim();
  withScratch((scratch) => {
    const tarball = join(scratch, "dev.tar.gz");
    run("tar", ["-czf", tarball, "--exclude", ".DS_Store", "--exclude", "node_modules", "-C", devDir, "."], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const entries = run("tar", ["-tzf", tarball]).split("\n");
    if (!entries.some((entry) => entry !== "" && !entry.endsWith("/"))) {
      throw new Failure(`nothing to lock: ${devDir} holds only excluded entries`);
    }
    const pending = `${archive}.partial`;
    run("age", ["-r", recipient, "-o", pending, tarball]);
    renameSync(pending, archive);
  });
  const kib = (statSync(archive).size / 1024).toFixed(1);
  console.log(`Locked ${devDir} into ${archive} (${kib} KiB).`);
}

function unlock(force: boolean): void {
  if (!existsSync(archive)) throw new Failure(`no archive at ${archive}`);
  if (!isEmptyDir(devDir) && !force) throw new Failure(`${devDir} is not empty; pass --force to overwrite it`);
  const identity = readIdentity();
  withScratch((scratch) => {
    const identityFile = join(scratch, "identity");
    writeFileSync(identityFile, identity, { mode: 0o600 });
    chmodSync(identityFile, 0o600);
    const tarball = join(scratch, "dev.tar.gz");
    run("age", ["-d", "-i", identityFile, "-o", tarball, archive]);
    rmSync(identityFile, { force: true });
    mkdirSync(devDir, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", devDir]);
  });
  console.log(`Unlocked ${archive} into ${devDir}.`);
}

const [command, ...flags] = process.argv.slice(2);
try {
  if (command === "lock") lock();
  else if (command === "unlock") unlock(flags.includes("--force"));
  else throw new Failure("usage: bun scripts/private.ts lock|unlock [--force]");
} catch (error) {
  const reason = error instanceof Failure ? error.message : String(error);
  console.error(`private: ${reason}`);
  process.exit(1);
}
