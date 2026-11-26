# Changelog

## 0.3.0

- Added: when a push is rejected, **Merge and Push** (first option) merges the remote branch and pushes; **Checkout and Merge** when the branch is not checked out. It stops if the working tree has uncommitted changes.
- Added: conflict file list for merges and rebases, opening each file in the Merge Editor, with bulk "take mine" / "take incoming" and abort; notices for files left and for all conflicts resolved.
- Added: after resolving, **Complete Merge and Push** or **Complete Merge Only**; Junction also offers to push after a merge finished in Source Control or before a VS Code restart, and refuses to push leftover conflict markers.
- Changed: **Open Conflicts** now opens the conflict list instead of the first conflicted file.
- Changed: force push (with lease) after a rejected push now has to be chosen in the rejection dialog; Merge and Push is the first option.

## 0.2.0

- Changed: minimum VS Code version is now 1.88 (was 1.90); extension tests also run on 1.88 (`npm run test:ext:min`).
- Added: Create Pull Request for GitHub (github.com, GitHub Enterprise) and GitLab (gitlab.com, self-hosted, nested groups).
- Added: `"none"` server type to hide the pull request menu on servers without pull requests; offered in the first-use prompt.
- Changed: github.com, gitlab.com and bitbucket.org open without a prompt or a settings entry.
- Changed (breaking, pre-release): setting `junction.bitbucket.servers` is now `junction.pullRequest.servers`, with types `bitbucket-cloud`, `bitbucket-datacenter`, `github`, `gitlab`, `none`; command `junction.bitbucket.changeWebUrl` is now `junction.pullRequest.changeWebUrl`.

## 0.1.0

- Branch sidebar with local and remote branches, folders, ahead/behind and merged badges.
- Checkout, create, rename, delete, push, pull, merge and rebase from the tree.
- Quick checkout command in the Command Palette.
- Branch comparison and per-file diffs.
- Create Pull Request for Bitbucket Cloud and Data Center.
- Korean localization.
