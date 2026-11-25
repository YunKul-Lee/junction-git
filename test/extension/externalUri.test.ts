import * as assert from 'assert';
import * as vscode from 'vscode';

suite('toExternalUri', () => {
  const urls = [
    'https://git.acme.com/projects/PROJ/repos/web/pull-requests?create&sourceBranch=refs%2Fheads%2Ffeature%2Fx&targetBranch=refs%2Fheads%2Fdevelop',
    'https://bitbucket.org/acme/web/pull-requests/new?source=feature%2F%ED%95%9C&dest=develop',
  ];
  const toExternalUri = async (url: string): Promise<vscode.Uri> => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'junction')!;
    const api = (await ext.activate()) as { toExternalUri(u: string): vscode.Uri };
    return api.toExternalUri(url);
  };
  for (const url of urls) {
    test(`round-trips ${url}`, async () => {
      // eslint-disable-next-line no-console
      console.log(`plain Uri.parse -> ${vscode.Uri.parse(url).toString()}`);
      assert.strictEqual((await toExternalUri(url)).toString(), url);
    });
  }
});
