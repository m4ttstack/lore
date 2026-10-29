import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function packageDir(input) {
  const marker = "node_modules/";
  const at = input.lastIndexOf(marker);
  if (at === -1) return null;
  const parts = input.slice(at + marker.length).split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return input.slice(0, at + marker.length) + name;
}

function noticeOf(dir) {
  const { name, version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((entry) => /^(licen[sc]e|copying)(\..*)?$/i.test(entry));
  if (file === undefined) throw new Error(`${name} is bundled but ships no license file`);
  const text = readFileSync(join(dir, file), "utf8").trim().replaceAll("*/", "* /");
  return `${name}@${version} (${license})\n\n${text}`;
}

const result = await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  absWorkingDir: root,
  metafile: true,
  write: false,
  outfile: join(root, "dist/lore.js"),
  legalComments: "none",
});

const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const dir = packageDir(input);
  if (dir !== null && existsSync(join(root, dir))) dirs.add(join(root, dir));
}

const own = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const ownNotice = `${own.name}@${own.version} (${own.license})\n\n${readFileSync(join(root, "LICENSE"), "utf8").trim().replaceAll("*/", "* /")}`;
const notices = [ownNotice, ...[...dirs].sort().map(noticeOf)];
const footer = `\n/*! Licenses of the code bundled in this file\n\n${notices.join("\n\n---\n\n")}\n*/\n`;

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/lore.js"), result.outputFiles[0].text + footer);
