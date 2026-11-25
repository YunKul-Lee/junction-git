import * as vscode from 'vscode';
import { remoteUrl } from '../git/queries';
import { prAvailable } from '../pr/providers';
import { BranchTreeProvider } from '../views/branchTree';
import { readSettings } from './settings';

/** Sets `junction.hasPullRequest`: true when any loaded repo has a remote host whose pull requests are not
 * turned off (`type: "none"`) in settings; the first-use prompt asks what kind of server an unknown host is. */
export async function updateHasPullRequestContext(tree: BranchTreeProvider): Promise<void> {
  let has = false;
  try {
    for (const { repo, snap } of tree.loadedRepos()) {
      const servers = readSettings(repo.root).pullRequestServers;
      for (const remote of snap.remotes) {
        const url = await remoteUrl(repo.git, remote);
        if (url && prAvailable(url, servers)) {
          has = true;
          break;
        }
      }
      if (has) {
        break;
      }
    }
  } catch {
    has = false;
  }
  await vscode.commands.executeCommand('setContext', 'junction.hasPullRequest', has);
}
