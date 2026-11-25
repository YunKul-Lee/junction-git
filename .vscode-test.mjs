import { defineConfig } from '@vscode/test-cli';
import * as path from 'node:path';
import { FIXTURE_BASE, makeFixture } from './test/extension/makeFixture.mjs';

// The tests open this temp git repo (with a bare origin) as their workspace.
const workspaceFolder = makeFixture();

export default defineConfig({
  files: 'out-test/extension/**/*.test.js',
  workspaceFolder,
  launchArgs: ['--disable-workspace-trust'],
  // The extension host (and every git it runs) must not read the developer's global or system git config;
  // makeFixture writes this empty file.
  env: {
    JUNCTION_TEST_WORKSPACE: workspaceFolder,
    GIT_CONFIG_GLOBAL: path.join(FIXTURE_BASE, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  },
});
