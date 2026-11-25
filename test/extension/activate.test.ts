import * as assert from 'assert';
import * as vscode from 'vscode';

suite('activation', () => {
  test('extension activates and registers branches view', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'junction')!;
    await ext.activate();
    assert.ok(ext.isActive);
    await vscode.commands.executeCommand('junction.branches.focus'); // throws if view missing
  });
});
