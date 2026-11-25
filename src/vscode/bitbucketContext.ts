import * as vscode from 'vscode';
import { remoteUrl } from '../git/queries';
import { prAvailable } from '../pr/providers';
import { BranchTreeProvider } from '../views/branchTree';
import { readSettings } from './settings';

/** Sets `junction.hasBitbucket`: true when any loaded repo has a remote that is configured or may be Bitbucket
 * (any host but the well-known non-Bitbucket ones); the first-use prompt asks for the rest. */
export async function updateHasBitbucketContext(tree: BranchTreeProvider): Promise<void> {
  let has = false;
  try {
    for (const { repo, snap } of tree.loadedRepos()) {
      const servers = readSettings(repo.root).bitbucketServers;
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
  await vscode.commands.executeCommand('setContext', 'junction.hasBitbucket', has);
}
