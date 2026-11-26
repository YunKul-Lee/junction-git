import { defineConfig } from '@vscode/test-cli';
import * as path from 'node:path';
import { FIXTURE_BASE, makeFixture } from './test/extension/makeFixture.mjs';

// The tests open this temp git repo (with a bare origin) as their workspace.
const workspaceFolder = makeFixture();

const base = {
  files: 'out-test/extension/**/*.test.js',
  workspaceFolder,
  launchArgs: ['--disable-workspace-trust'],
  // Our only dependency is the built-in vscode.git; older VS Code CLIs fail trying to install it from the Marketplace.
  skipExtensionDependencies: true,
  // The extension host (and every git it runs) must not read the developer's global or system git config;
  // makeFixture writes this empty file.
  env: {
    JUNCTION_TEST_WORKSPACE: workspaceFolder,
    GIT_CONFIG_GLOBAL: path.join(FIXTURE_BASE, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  },
};

export default defineConfig([
  // `npm run test:ext`: the latest stable VS Code.
  { ...base, label: 'stable', version: 'stable' },
  // `npm run test:ext:min`: the minimum version in package.json `engines.vscode`.
  { ...base, label: 'min', version: '1.88.0' },
]);
