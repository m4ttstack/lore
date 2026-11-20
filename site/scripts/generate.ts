import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dir, "..", "docs", "spec");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.md"), "---\ntitle: Specification\n---\n\n# Specification\n\nPlaceholder.\n");
