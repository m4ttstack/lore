import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return path === "site/docs/spec" ? [] : pages(path);
    return e.name.endsWith(".md") ? [path] : [];
  });
}

describe("hand-written pages", () => {
  // Inside a fence of N backticks, a line of N or more backticks with an info string
  // opens nothing, and the bare closer after it ends the outer fence early.
  test("no fence opener inside an open fence of the same or greater length", () => {
    for (const file of pages("site/docs")) {
      let open: number | null = null;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const m = /^ {0,3}(`{3,})(.*)$/.exec(line);
        if (!m) return;
        const run = m[1]!.length;
        const info = m[2]!.trim();
        if (open === null) open = run;
        else if (info === "" && run >= open) open = null;
        else if (info !== "" && run >= open) throw new Error(`${file}:${i + 1} opens a fence inside an open fence`);
      });
    }
  });
});
