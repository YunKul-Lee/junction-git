import { defineConfig } from '@vscode/test-cli';
import { makeFixture } from './test/extension/makeFixture.mjs';

// The tests open this temp git repo (with a bare origin) as their workspace.
const workspaceFolder = makeFixture();

export default defineConfig({
  files: 'out-test/extension/**/*.test.js',
  workspaceFolder,
  launchArgs: ['--disable-workspace-trust'],
  env: { JUNCTION_TEST_WORKSPACE: workspaceFolder },
});
