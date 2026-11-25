import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGit } from '../../src/git/gitCli';
import { Git } from '../../src/git/types';

export interface TestRepo {
  dir: string;
  remoteDir: string;
  git: Git;
  sh(...args: string[]): Promise<string>;
  commit(msg: string, file?: string, content?: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeRepo(
  opts: { withRemote?: boolean; remoteName?: string; initialBranch?: string } = {},
): Promise<TestRepo> {
  const withRemote = opts.withRemote ?? true;
  const remoteName = opts.remoteName ?? 'origin';
  const branch = opts.initialBranch ?? 'develop';

  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'junction-test-'));
  const dir = path.join(base, 'work');
  const remoteDir = path.join(base, 'remote.git');
  const emptyConfig = path.join(base, 'gitconfig');
  await fs.writeFile(emptyConfig, '');
  await fs.mkdir(dir);

  const env: Record<string, string> = {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = createGit('git', dir, undefined, env);
  const sh = (...args: string[]): Promise<string> => git.run(args);

  if (withRemote) {
    await fs.mkdir(remoteDir);
    await createGit('git', remoteDir, undefined, env).run(['init', '--bare', `--initial-branch=${branch}`]);
  }
  await sh('init', `--initial-branch=${branch}`);
  await sh('config', 'user.name', 'Test User');
  await sh('config', 'user.email', 'test@example.com');
  await sh('config', 'commit.gpgsign', 'false');
  if (withRemote) {
    await sh('remote', 'add', remoteName, remoteDir);
  }

  const commit = async (msg: string, file?: string, content?: string): Promise<string> => {
    const name = file ?? `file-${randomUUID()}.txt`;
    const full = path.join(dir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content ?? `${randomUUID()}\n`);
    await sh('add', '--', name);
    await sh('commit', '-m', msg);
    return (await sh('rev-parse', 'HEAD')).trim();
  };

  await commit('initial', 'README.md', 'initial\n');
  if (withRemote) {
    await sh('push', '-u', remoteName, branch);
  }

  return {
    dir,
    remoteDir,
    git,
    sh,
    commit,
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  };
}

