import * as assert from 'assert';
import * as vscode from 'vscode';

suite('openExternalUrl', () => {
  const urls = [
    'https://git.acme.com/projects/PROJ/repos/web/pull-requests?create&sourceBranch=refs%2Fheads%2Ffeature%2Fx&targetBranch=refs%2Fheads%2Fdevelop',
    'https://bitbucket.org/acme/web/pull-requests/new?source=feature%2F%ED%95%9C&dest=develop',
  ];
  type Api = { openExternalUrl(u: string, open: (t: vscode.Uri) => Thenable<boolean>): Thenable<boolean> };
  for (const url of urls) {
    test(`hands over the exact string ${url}`, async () => {
      const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'junction')!;
      const api = (await ext.activate()) as Api;
      const seen: unknown[] = [];
      await api.openExternalUrl(url, (t) => {
        seen.push(t);
        return Promise.resolve(true);
      });
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(typeof seen[0], 'string');
      assert.strictEqual(seen[0], url);
    });
  }
});
