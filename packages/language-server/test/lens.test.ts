import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { URI } from "vscode-uri";
import { diagnose } from "../src/diagnostics";
import { couldApply, OPEN_ENTRY } from "../src/lens";

const ROOT = "/work/shop";
const RULES = "/work/rules";

function rule(id: string, scope: string | null = null): string {
  const own = scope === null ? "" : `  <scope>\n  files: ["${scope}"]\n  </scope>\n`;
  return `<rule id="${id}" category="functional_correctness">\n${own}Text.\n</rule>\n`;
}

function uri(path: string): string {
  return URI.file(path).toString();
}

function shown(lenses: ReturnType<typeof couldApply>): string {
  return lenses.map((lens) => lens.command!.title).join(", ");
}

describe("could apply lens", () => {
  test("lens lists covering rules for a source file", () => {
    const checkout = `<!-- checkout -->\n\n${rule("price-from-quote", "src/**")}\n${rule("docs-linked", "docs/**")}\n<context id="checkout-notes">\nRead this.\n</context>\n`;
    const input = { repo: [{ path: ".lore/checkout.lore", content: checkout }, { path: "src/app.ts", content: "x" }], given: [], remotes: [] };
    const lenses = couldApply(diagnose(input), ROOT, "src/app.ts");
    expect(shown(lenses)).toBe("Lore: could apply: price-from-quote, checkout-notes");
    const file = uri(join(ROOT, ".lore/checkout.lore"));
    expect(lenses).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        command: { title: "Lore: could apply: price-from-quote", command: OPEN_ENTRY, arguments: [file, 2] },
      },
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        command: { title: "checkout-notes", command: OPEN_ENTRY, arguments: [file, 16] },
      },
    ]);
    expect(shown(couldApply(diagnose(input), ROOT, "docs/guide.md"))).toBe("Lore: could apply: docs-linked, checkout-notes");
  });

  test("a lens that cannot open its entry has a command with an empty id", () => {
    const input = { repo: [{ path: ".lore/a.lore", content: rule("a") }], given: [], remotes: [] };
    expect(couldApply(diagnose(input), ROOT, "src/app.ts", false)).toEqual([{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      command: { title: "Lore: could apply: a", command: "" },
    }]);
  });

  test("a file no entry covers, or a repository with no rules, gets no lens", () => {
    const covered = { repo: [{ path: ".lore/a.lore", content: rule("a", "src/**") }], given: [], remotes: [] };
    expect(couldApply(diagnose(covered), ROOT, "README.md")).toEqual([]);
    expect(couldApply(diagnose({ repo: [{ path: "src/app.ts", content: "x" }], given: [], remotes: [] }), ROOT, "src/app.ts")).toEqual([]);
  });

  test("lens includes rules from an external folder matched by repo", () => {
    const input = {
      repo: [{ path: ".lore/own.lore", content: rule("own-rule") }],
      given: [{
        folder: "shop",
        repository: RULES,
        files: [
          { path: "shop/.loreconfig", content: "lore: 1\nrepo: github.com/acme/shop\n" },
          { path: "shop/.lore/pricing.lore", content: `<defaults>\nseverity: blocking\n</defaults>\n\n${rule("external-rule", "src/**")}` },
          { path: "pay/.loreconfig", content: "lore: 1\nrepo: github.com/acme/payments\n" },
          { path: "pay/.lore/pay.lore", content: rule("pay-rule") },
        ],
      }],
      remotes: ["git@github.com:acme/shop.git"],
    };
    const lenses = couldApply(diagnose(input), ROOT, "src/app.ts");
    expect(shown(lenses)).toBe("Lore: could apply: own-rule, external-rule");
    expect(lenses[1]!.command!.arguments).toEqual([uri(join(RULES, "shop/.lore/pricing.lore")), 4]);
  });

  test("lens omits a rule disabled for that path", () => {
    const input = {
      repo: [
        { path: ".lore/a.lore", content: `${rule("a")}\n${rule("b")}\n<rule id="c" disabled>\nText.\n</rule>\n` },
        { path: "src/legacy/.loreconfig", content: "lore: 1\ndisable: [a]\n" },
      ],
      given: [],
      remotes: [],
    };
    const { model } = diagnose(input);
    expect(model.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(shown(couldApply(diagnose(input), ROOT, "src/legacy/old.ts"))).toBe("Lore: could apply: b");
    expect(shown(couldApply(diagnose(input), ROOT, "src/new.ts"))).toBe("Lore: could apply: a, b");
  });
});
