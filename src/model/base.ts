import { BaseBranch, BranchRef } from '../git/types';

const AUTO_CANDIDATES = ['develop', 'main', 'master'];

export function resolveBaseBranch(configured: string, branches: BranchRef[]): BaseBranch | undefined {
  const wanted = configured.trim();
  const candidates = wanted ? [wanted] : AUTO_CANDIDATES;
  for (const name of candidates) {
    const local = branches.find((b) => b.kind === 'local' && b.name === name);
    const remotes = branches.filter((b) => b.kind === 'remote' && b.shortName === name);
    if (!local && remotes.length === 0) {
      continue;
    }
    const remote = remotes.find((b) => b.remote === 'origin') ?? remotes[0];
    const remoteRef = remote?.name;
    return { name, compareRef: remoteRef ?? name, local: local?.name, remoteRef };
  }
  return undefined;
}
