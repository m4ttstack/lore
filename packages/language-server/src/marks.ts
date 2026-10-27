import { namesRepo, normalizeRemote, readLoreconfig, type InputFile, type LoreInput } from "@lore/parser";

// A directory a `.loreconfig` with a `repo` key marks: it stands for the root of the repository `repo` names.
export interface Mark { dir: string; repo: string }

const CONFIG_NAME = ".loreconfig";
const LORE_FOLDER = ".lore";
const EXTERNAL = "external:";

export function marksOf(files: readonly InputFile[]): Mark[] {
  return files.flatMap((file) => {
    const segments = file.path.split("/");
    if (segments.at(-1) !== CONFIG_NAME || segments.slice(0, -1).includes(LORE_FOLDER)) return [];
    const repo = readLoreconfig(file.content).config?.repo;
    return repo ? [{ dir: segments.slice(0, -1).join("/"), repo: repo.value }] : [];
  });
}

export function markOver(marks: readonly Mark[], path: string): Mark | undefined {
  return marks
    .filter((mark) => within(path, mark.dir))
    .reduce<Mark | undefined>((deepest, mark) => (deepest === undefined || mark.dir.length > deepest.dir.length ? mark : deepest), undefined);
}

// The repository's files as one given folder, with a remote naming only the mark's repository, so marks for other repositories stay out.
export function rulesInput(repository: string, files: InputFile[], mark: Mark): LoreInput {
  return { repo: [], given: [{ folder: "", files, repository }], remotes: [`https://${mark.repo}`] };
}

// Repository names compare as the parser matches them: normalized like a remote, ignoring ASCII case.
export function repoKey(repo: string): string {
  return normalizeRemote(`https://${repo}`).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function governs(input: LoreInput, repository: string, mark: Mark): boolean {
  return namesRepo(mark.repo, input.remotes)
    && input.given.some((given) => given.repository === repository && within(mark.dir, given.folder.replace(/\/+$/, "")));
}

export function externalName(path: string): string {
  return EXTERNAL + path;
}

function within(path: string, dir: string): boolean {
  return dir === "" || path === dir || path.startsWith(`${dir}/`);
}
