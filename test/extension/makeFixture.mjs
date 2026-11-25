// Creates the git fixture the extension tests open as their workspace.
// Usage: node test/extension/makeFixture.mjs   (prints nothing; path is FIXTURE_DIR below)
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_BASE = path.join(root, '.vscode-test', 'fixture');
export const FIXTURE_WORK = path.join(FIXTURE_BASE, 'work');

export function makeFixture() {
  fs.rmSync(FIXTURE_BASE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_WORK, { recursive: true });
  const remote = path.join(FIXTURE_BASE, 'remote.git');
  fs.mkdirSync(remote);
  const emptyConfig = path.join(FIXTURE_BASE, 'gitconfig');
  fs.writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString();
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(FIXTURE_WORK, file)), { recursive: true });
    fs.writeFileSync(path.join(FIXTURE_WORK, file), content);
  };
  const commit = (msg, file, content) => {
    write(file, content);
    sh(FIXTURE_WORK, 'add', '--', file);
    sh(FIXTURE_WORK, 'commit', '-m', msg);
  };

  sh(remote, 'init', '--bare', '--initial-branch=develop');
  sh(FIXTURE_WORK, 'init', '--initial-branch=develop');
  sh(FIXTURE_WORK, 'config', 'user.name', 'Test User');
  sh(FIXTURE_WORK, 'config', 'user.email', 'test@example.com');
  sh(FIXTURE_WORK, 'config', 'commit.gpgsign', 'false');
  sh(FIXTURE_WORK, 'remote', 'add', 'origin', remote);
  commit('initial', 'README.md', 'initial\n');
  sh(FIXTURE_WORK, 'push', '-u', 'origin', 'develop');

  sh(FIXTURE_WORK, 'checkout', '-b', 'feature/search');
  commit('add search', 'src/search.txt', 'search\n');
  commit('update readme', 'README.md', 'initial\nsearch docs\n');

  sh(FIXTURE_WORK, 'checkout', '-b', 'topic', 'develop');
  return FIXTURE_WORK;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeFixture();
}
