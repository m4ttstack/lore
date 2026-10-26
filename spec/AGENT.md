# Lore v1 agent instructions

1. Find the tracked `.lore/` folders whose base (the folder holding `.lore/`)
   contains a changed file. Read their `.lore` files, and each `.loreconfig`
   from a changed file's folder up to the nearest `root: true` or the repo root.
2. Select each entry not `disabled` whose scope (file and entry `<scope>`, each
   defaulting to the whole base; globs relative to the base) holds a changed file
   that no `disable` list switches it off for, and whose `<when>` holds.
3. Read each selected `<context>` and the file its `src` names: a plain `src`
   from the base, one starting `./` or `../` from the folder of its `.lore` file.
4. Report each selected `<rule>` by id as pass, fail or not applicable, with
   evidence such as a file and line. Treat a `<check>` as a hint, not a verdict.
5. Never invent rules from prose outside `.lore` files.
