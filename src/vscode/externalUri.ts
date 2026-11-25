import * as vscode from 'vscode';

/**
 * Opens `url` in the browser with its text untouched.
 *
 * A `Uri` is re-serialized on the way to the main thread (query `&`/`=` get percent-encoded, and the
 * opener later decodes `%2F`), which breaks Bitbucket's query parsing. The extension-host `openUri`
 * accepts a string and forwards it verbatim (internal VS Code behavior, verified in 1.148), so the
 * string is passed through even though the public typings only declare `Uri`.
 * `open` is injectable so tests can see exactly what is handed over.
 */
export function openExternalUrl(
  url: string,
  open: (target: vscode.Uri) => Thenable<boolean> = (t) => vscode.env.openExternal(t),
): Thenable<boolean> {
  return open(url as unknown as vscode.Uri);
}
