import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

// Structural view of BranchTreeProvider (the test project cannot import from src/).
interface BranchTreeProvider {
  getChildren(element?: unknown): Thenable<unknown[] | undefined | null> | unknown[];
  setFilter(text: string | undefined): void;
  showCompare(root: vscode.Uri, a: string, b: string): void;
  clearCompare(): void;
  snapshot(root: vscode.Uri): unknown;
}

type AnyNode = vscode.TreeItem & { [k: string]: unknown };

const workspace = process.env.JUNCTION_TEST_WORKSPACE as string;
let tree: BranchTreeProvider;

const label = (n: vscode.TreeItem): string => (typeof n.label === 'string' ? n.label : n.label?.label ?? '');
const kids = async (n?: unknown): Promise<AnyNode[]> =>
  ((await tree.getChildren(n)) ?? []) as unknown as AnyNode[];

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

async function local(): Promise<AnyNode> {
  return (await kids()).find((n) => label(n) === 'Local') as AnyNode;
}

suite('branch tree', function () {
  this.timeout(60000);

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'junction')!;
    const api = (await ext.activate()) as { tree: BranchTreeProvider };
    tree = api.tree;
    await until(async () => (await kids()).length > 0);
    await until(() => tree.snapshot(vscode.Uri.file(workspace)));
  });

  teardown(() => {
    tree.setFilter(undefined);
    tree.clearCompare();
  });

  test('root shows Local and Remote: origin', async () => {
    assert.deepStrictEqual((await kids()).map(label), ['Local', 'Remote: origin']);
  });

  test('current branch is head and feature/ folder exists', async () => {
    const children = await kids(await local());
    const head = children.find((n) => n.contextValue === 'branch-local-head');
    assert.strictEqual(label(head!), 'topic');
    const folder = children.find((n) => n.contextValue === 'folder');
    assert.strictEqual(label(folder!), 'feature');
  });

  async function searchNode(): Promise<AnyNode> {
    const folder = (await kids(await local())).find((n) => n.contextValue === 'folder')!;
    return (await kids(folder)).find((n) => label(n) === 'search')!;
  }

  test('feature/search children: range node then 2 commits', async () => {
    const c = await kids(await searchNode());
    assert.strictEqual(c[0].contextValue, 'range-changes');
    assert.deepStrictEqual(
      c.slice(1).map((n) => n.contextValue),
      ['commit', 'commit'],
    );
  });

  test('commit files open a diff', async () => {
    const commits = (await kids(await searchNode())).filter((n) => n.contextValue === 'commit');
    const files = await kids(commits[0]);
    assert.ok(files.length > 0);
    const cmd = files[0].command!;
    assert.strictEqual(cmd.command, 'junction.openFileDiff');
    await vscode.commands.executeCommand(cmd.command, ...(cmd.arguments ?? []));
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff);
  });

  test('range changes list files', async () => {
    const range = (await kids(await searchNode()))[0];
    const files = await kids(range);
    assert.deepStrictEqual(files.map(label).sort(), ['README.md', 'search.txt']);
  });

  test('filter narrows to matching branches', async () => {
    tree.setFilter('sea');
    const children = await kids(await local());
    assert.deepStrictEqual(children.map(label), ['feature']);
    assert.deepStrictEqual((await kids(children[0])).map(label), ['search']);
  });

  test('new branch appears after checkout -b', async () => {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(workspace, '..', 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['checkout', '-b', 'x'], { cwd: workspace, env });
    await until(async () => (await kids(await local())).some((n) => label(n) === 'x'), 1500);
  });

  test('compare node is first at root', async () => {
    tree.showCompare(vscode.Uri.file(workspace), 'develop', 'feature/search');
    const root = await kids();
    assert.strictEqual(root[0].contextValue, 'compare');
    const sides = await kids(root[0]);
    assert.deepStrictEqual(sides.map((n) => n.contextValue), ['compare-side', 'compare-side']);
  });
});
