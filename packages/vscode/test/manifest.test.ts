import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("manifest", () => {
  test("manifest contributes the lore language and grammar", () => {
    expect(manifest).toMatchObject({ name: "lore-vscode", publisher: "lore", private: true, license: "MIT", main: "./dist/extension.js" });
    const lore = manifest.contributes.languages.find((language: { id: string }) => language.id === "lore");
    expect(lore).toMatchObject({ extensions: [".lore"], configuration: "./language-configuration.json" });
    const yaml = manifest.contributes.languages.find((language: { id: string }) => language.id === "yaml");
    expect(yaml).toMatchObject({ filenames: [".loreconfig"] });
    expect(manifest.contributes.grammars).toContainEqual({
      language: "lore",
      scopeName: "source.lore",
      path: "./syntaxes/lore.tmLanguage.json",
      embeddedLanguages: {
        "meta.embedded.block.yaml": "yaml",
        "source.yaml": "yaml",
        "meta.embedded.block.markdown": "markdown",
        "text.html.markdown": "markdown",
      },
    });
    expect(manifest.contributes.configuration.properties["lore.externalFolders"]).toMatchObject({ type: "array", items: { type: "string" } });
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe("limited");
    expect(manifest.repository).toEqual({ type: "git", url: "https://github.com/m4ttstack/lore" });
  });

  test("manifest activates early in a workspace holding Lore files, and after startup everywhere else", () => {
    // **/*.lore also covers .lore/*.lore and Lore files kept beside the code they govern. A governed repository whose
    // Lore lives only in external folders has no Lore file, so onStartupFinished lets activate read lore.externalFolders.
    expect(manifest.activationEvents).toEqual([
      "workspaceContains:**/*.lore",
      "workspaceContains:**/.loreconfig",
      "onStartupFinished",
    ]);
  });

  test("package script produces a .vsix containing the server and grammar", () => {
    execFileSync("bun", ["run", "package"], { cwd: root, stdio: "pipe" });
    const listing = execFileSync("unzip", ["-Z1", `${root}/dist/lore-vscode.vsix`], { encoding: "utf8" }).split("\n");
    expect(listing).toEqual(expect.arrayContaining([
      "extension/package.json",
      "extension/dist/extension.js",
      "extension/dist/server.js",
      "extension/syntaxes/lore.tmLanguage.json",
      "extension/language-configuration.json",
      "extension/readme.md",
      "extension/LICENSE.txt",
    ]));
    expect(listing.some((entry) => entry.includes("node_modules/"))).toBe(false);
    expect(listing.some((entry) => entry.startsWith("extension/test/"))).toBe(false);
  }, 120_000);
});
