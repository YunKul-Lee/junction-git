# Changelog

## 0.2.0

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
