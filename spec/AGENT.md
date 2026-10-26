# Lore v1 agent instructions

1. Find the tracked `.lore/` folders whose base (the folder that holds
   `.lore/`) contains a changed file, and read every `.lore` file in them.
2. Read each `.loreconfig` from a changed file's folder up to the Lore root:
   the nearest folder whose `.loreconfig` has `root: true`, else the repo root.
3. Select each entry that is not `disabled`, whose `<scope>` globs (relative
   to the base) match a changed file that no `disable` list switches it off
   for, and whose `<when>` holds. Read each selected `<context>` and its `src`.
4. Treat a `<check>` as a hint about where to look, never as a verdict.
5. Report each selected `<rule>` by its id as pass, fail or not applicable,
   with evidence such as a file and line.
6. Never invent rules from prose outside `.lore` files.
