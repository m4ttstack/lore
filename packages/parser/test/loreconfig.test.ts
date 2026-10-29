import { describe, expect, test } from "bun:test";
import { namesRepo, normalizeRemote, readLoreconfig } from "../src/loreconfig";

describe("normalizeRemote", () => {
  test("scp-like form drops the user and turns the colon into a slash", () => {
    expect(normalizeRemote("git@github.com:Acme/shop.git")).toBe("github.com/Acme/shop");
  });

  test("a URL drops its scheme", () => {
    expect(normalizeRemote("https://github.com/acme/shop")).toBe("github.com/acme/shop");
  });

  test("a URL drops its user information and keeps its port", () => {
    expect(normalizeRemote("ssh://git@host:2222/a/b.git")).toBe("host:2222/a/b");
  });

  test("trailing slashes go before a trailing .git", () => {
    expect(normalizeRemote("https://github.com/acme/shop.git//")).toBe("github.com/acme/shop");
  });

  test("user information is only what comes before the host's slash", () => {
    expect(normalizeRemote("https://github.com/acme/sh@p")).toBe("github.com/acme/sh@p");
  });
});

describe("namesRepo", () => {
  test("matches any remote, ASCII letters regardless of case", () => {
    expect(namesRepo("github.com/acme/shop", ["https://example.com/x", "git@github.com:Acme/shop.git"])).toBe(true);
  });

  test("a port is kept, so it does not match the portless name", () => {
    expect(namesRepo("github.com/acme/shop", ["ssh://git@github.com:22/acme/shop"])).toBe(false);
  });

  test("no remote matches nothing", () => {
    expect(namesRepo("github.com/acme/shop", [])).toBe(false);
  });

  test("non-ASCII letters compare exactly", () => {
    expect(namesRepo("github.com/acme/é", ["https://github.com/acme/É"])).toBe(false);
  });
});

describe("readLoreconfig", () => {
  const problem = (content: string) => {
    const read = readLoreconfig(content);
    return read.config === null ? read.problem : null;
  };

  test("nesting past the depth limit is a problem at its line", () => {
    expect(problem(`root: true\ndisable: ${"[".repeat(10_000)}${"]".repeat(10_000)}\n`)).toBe(2);
  });

  test("an empty or comment-only file sets nothing", () => {
    for (const content of ["", "# nothing here\n"]) {
      const read = readLoreconfig(content);
      expect(read.config).toEqual({ root: false, repo: null, categories: [], disable: [] });
    }
  });

  test("reads every key", () => {
    const read = readLoreconfig("lore: 1\nroot: true\nrepo: github.com/acme/shop\ncategories: [data_provenance]\ndisable: [a-b]\n");
    expect(read.config).toEqual({
      root: true,
      repo: { value: "github.com/acme/shop", line: 3 },
      categories: ["data_provenance"],
      disable: [expect.objectContaining({ id: "a-b", line: 5 })],
    });
  });

  test("loose is a boolean", () => {
    expect(readLoreconfig("loose: true\n").config?.loose).toBe(true);
    expect(readLoreconfig("loose: false\n").config?.loose).toBe(false);
    expect(problem("repo: github.com/acme/shop\nloose: yes\n")).toBe(2);
  });

  test("a disable item's line is its dash in a block sequence, its first character in a flow sequence", () => {
    const block = readLoreconfig("disable:\n  - a\n  # note\n  -\n    b\n");
    expect(block.config?.disable.map(({ id, line }) => ({ id, line }))).toEqual([
      { id: "a", line: 2 },
      { id: "b", line: 4 },
    ]);
    const flow = readLoreconfig("disable: [a,\n  b]\n");
    expect(flow.config?.disable.map(({ id, line }) => ({ id, line }))).toEqual([
      { id: "a", line: 1 },
      { id: "b", line: 2 },
    ]);
  });

  test("a value the table does not allow is reported at its key", () => {
    expect(problem("categories: [data_provenance]\ndisable: currency-from-settings\n")).toBe(2);
    expect(problem("root: yes\n")).toBe(1);
    expect(problem("lore: 2\n")).toBe(1);
    expect(problem("root: true\nowner: me\n")).toBe(2);
    expect(problem("categories: [Payments]\n")).toBe(1);
    expect(problem("disable: [Not_An_Id]\n")).toBe(1);
  });

  test("the first bad key in file order wins", () => {
    expect(problem("root: true\nlore: 3\nowner: me\n")).toBe(2);
  });

  test("repo must be host/path ending in neither / nor .git", () => {
    expect(problem("repo: github.com/acme/shop.git\n")).toBe(1);
    expect(problem("repo: github.com/acme/shop/\n")).toBe(1);
    expect(problem("repo: GitHub.com/acme/shop\n")).toBe(1);
    expect(problem("repo: github.com\n")).toBe(1);
    expect(problem("repo: host:2222/a/b\n")).toBeNull();
  });

  test("structured block problems are reported at their file line", () => {
    expect(problem("lore: 1\ncategories: [api_contracts]\ncategories: [api_latency]\n")).toBe(3);
    expect(problem("root: true\nx: &a 1\n")).toBe(2);
  });

  test("a document cut short is reported at the line holding the file's last character", () => {
    expect(problem("root: true\ncategories: [checkout_flow\n")).toBe(2);
    expect(problem("root: true\ncategories: [checkout_flow")).toBe(2);
    expect(problem("categories: [checkout_flow\n\n")).toBe(2);
  });

  test("a value that is not a mapping is line 1", () => {
    expect(problem("# lead\n- a\n")).toBe(1);
    expect(problem("just text\n")).toBe(1);
  });

  test("invalid UTF-8 comes first, at its line", () => {
    expect(problem("root: yes\nx: \uD800\n")).toBe(2);
  });

  test("a byte order mark and CRLF line breaks are read as in a Lore file", () => {
    expect(readLoreconfig("﻿root: true\r\ndisable: [a]\r\n").config).toEqual({
      root: true, repo: null, categories: [], disable: [expect.objectContaining({ id: "a", line: 2 })],
    });
  });
});
