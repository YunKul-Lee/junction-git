import * as vscode from 'vscode';

/**
 * Converts a URL to a Uri that serializes back to exactly `url`.
 *
 * `Uri.parse(url).toString()` re-encodes the query (`create&a=b` becomes `create%26a%3Db`), which breaks
 * Bitbucket's query parsing, and `openExternal` serializes with `toString()`. The parsed Uri keeps its
 * components (so `openExternal` can still route the scheme) but its serialization is pinned to the input.
 */
export function toExternalUri(url: string): vscode.Uri {
  const uri = vscode.Uri.parse(url, true);
  Object.defineProperty(uri, 'toString', { value: () => url });
  return uri;
}
