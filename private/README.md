# private

Development material that is not public. It lives here as one encrypted archive, `dev.tar.age`.

```sh
bun scripts/private.ts unlock   # decrypt dev.tar.age into private/dev/
bun scripts/private.ts lock     # encrypt private/dev/ back into dev.tar.age
```

`unlock` refuses to write into a non-empty `private/dev/`; pass `--force` to overwrite it.

`private/dev/` is ignored by git, so only the archive is committed. Run `lock` and commit `dev.tar.age` after changing anything under `private/dev/`.
