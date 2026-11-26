import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

// Structural view of BranchTreeProvider (the test project cannot import from src/).
interface BranchTreeProvider {
  getChildren(element?: unknown): Thenable<unknown[] | undefined | null> | unknown[];
  snapshot(root: vscode.Uri): unknown;
}
type AnyNode = vscode.TreeItem & { [k: string]: unknown };

const workspace = process.env.JUNCTION_TEST_WORKSPACE as string;
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(workspace, '..', 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args: string[]): string => execFileSync('git', args, { cwd: workspace, env }).toString().trim();

const label = (n: vscode.TreeItem): string => (typeof n.label === 'string' ? n.label : n.label?.label ?? '');

async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 20000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) {
      return v;
    }
    if (Date.now() - start > ms) {
      throw new Error('timed out');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

suite('branch commands', function () {
  this.timeout(60000);
  let tree: BranchTreeProvider;
  const kids = async (n?: unknown): Promise<AnyNode[]> => ((await tree.getChildren(n)) ?? []) as unknown as AnyNode[];

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'junction')!;
    tree = ((await ext.activate()) as { tree: BranchTreeProvider }).tree;
    await until(() => tree.snapshot(vscode.Uri.file(workspace)));
  });

  suiteTeardown(() => {
    git('switch', 'topic');
  });

  test('junction.checkout switches HEAD and the tree shows the new head', async () => {
    const localSection = async (): Promise<AnyNode> =>
      (await kids()).find((n) => label(n) === 'Local') as AnyNode;
    const folder = (await kids(await localSection())).find((n) => n.contextValue === 'folder')!;
    const search = (await kids(folder)).find((n) => label(n) === 'search')!;
    assert.strictEqual(search.contextValue, 'branch-local');

    await vscode.commands.executeCommand('junction.checkout', search);
    assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD'), 'feature/search');

    await until(async () => {
      const f = (await kids(await localSection())).find((n) => n.contextValue === 'folder');
      const s = f && (await kids(f)).find((n) => label(n) === 'search');
      return s?.contextValue === 'branch-local-head';
    });
  });
});

suite('merge editor', () => {
  test('git.openMergeEditor is available', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.strictEqual(commands.includes('git.openMergeEditor'), true);
  });
});
