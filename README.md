# Junction for Git

A branch sidebar for Git in VS Code. Browse local and remote branches, switch between them, see what is merged, and open pull requests, all from the Activity Bar.

<!-- Screenshot: branch sidebar (docs/images/sidebar.png) -->

## Features

- **Branch tree** with Local and Remote groups, folders by name prefix (`feature/...`), and badges for ahead/behind, merged, and "remote deleted".
- **Switch branches** from the tree or with **Junction: Checkout Branch…** in the Command Palette (local branches by recency, then remote branches by commit time).
- **Create, rename, delete, push, pull** branches from the context menu, with confirmation before anything destructive. Dirty working trees offer to stash.
- **Merge and rebase** into the current branch, with Continue / Abort buttons and a hand-off to the Source Control conflict view.
- **Merge on a rejected push**: when a push is rejected because the remote has new commits, the first choice is **Merge and Push**. It merges the remote branch into yours and pushes. Force push (with lease) is still offered, but you have to choose it in that dialog.
- **Conflict list**: when a merge or rebase stops on conflicts, **Open Conflicts** shows the conflicted files in one list. Pick a file to open it in the Merge Editor, or resolve all of them with your side or the other side. Junction tells you how many files are left and, when none are, offers to finish the merge (and push, if it started from a rejected push).
- **Compare** any branch with the current one and browse per-file diffs, or expand a branch to see its commits.
- **Clean up merged branches** in one step, and **sync the base branch** without leaving your current branch.
- **Create Pull Request** for GitHub, GitLab, Bitbucket Cloud and Bitbucket Data Center, including self-hosted GitHub Enterprise and GitLab. The page opens in the browser with source and target branches filled in.
- Multi-root workspaces: each repository gets its own section.
- English and Korean UI.

## Requirements

- VS Code 1.88 or later, with the built-in Git extension enabled.
- Git installed and on your `PATH` (Junction uses the same git as VS Code's Source Control).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `junction.baseBranch` | `""` | Base branch that others are compared against. Empty detects `develop`, `main` or `master`. |
| `junction.branchSort` | `"recent"` | Sort order in the tree: `recent` or `name`. |
| `junction.groupByFolder` | `true` | Group branches into folders by name prefix. |
| `junction.commitLimit` | `50` | Commits shown under a branch before "Load more". |
| `junction.pullRequest.servers` | `[]` | Git servers used to build pull request URLs (see below). |
| `junction.confirmMerge` | `true` | Ask before merging or rebasing. |

## Pull request servers

Junction builds the pull request address from your remote URL. **github.com, gitlab.com and bitbucket.org need no configuration**: the page opens right away.

For a self-hosted server, list it in `junction.pullRequest.servers`. Each entry has a `gitHost` (the host in your remote URL, or an SSH alias from `~/.ssh/config`), the `webUrl` of the web UI, and the `type`: `"bitbucket-cloud"`, `"bitbucket-datacenter"`, `"github"`, `"gitlab"`, or `"none"` for a server without pull requests (plain git over SSH, Gerrit, …). A `"none"` entry needs no `webUrl` and turns pull requests off for that server: if no open repository has a remote with pull requests, the **Create Pull Request** menu is hidden; otherwise running it on such a repository just tells you pull requests are off. If `webUrl` is left out for another type, it defaults to `https://<gitHost>`.

```jsonc
{
  "junction.pullRequest.servers": [
    // Bitbucket Data Center, HTTPS remote: https://git.example.com/scm/proj/repo.git
    { "gitHost": "git.example.com", "webUrl": "https://git.example.com", "type": "bitbucket-datacenter" },
    // SSH alias: git@work-bb:proj/repo.git, where work-bb is a Host in ~/.ssh/config
    { "gitHost": "work-bb", "webUrl": "https://bitbucket.example.com", "type": "bitbucket-datacenter" },
    // GitHub Enterprise
    { "gitHost": "github.example.com", "webUrl": "https://github.example.com", "type": "github" },
    // Self-hosted GitLab under a sub-path; nested groups work
    { "gitHost": "gitlab.example.com", "webUrl": "https://gitlab.example.com/gitlab", "type": "gitlab" },
    // Plain git server: no pull request menu
    { "gitHost": "git-only.example.com", "type": "none" }
  ]
}
```

To share the mapping with your team, commit it to `.vscode/settings.json` in the repository. Workspace entries win over user entries for the same host.

How the PR page opens:

- If a matching entry exists in settings, the pull request page opens with no prompt (or, for `"none"`, Junction tells you pull requests are turned off).
- For github.com, gitlab.com and bitbucket.org, it opens right away; nothing is saved.
- For any other host, Junction asks once what kind of server it is. Pick a type and confirm the web address, or pick **No pull requests on this server**. The answer is saved to your **user** settings.
- Wrong address? Use **Junction: Change Pull Request Web Address** to edit the list.
- The menu is always called **Create Pull Request**, including on GitLab (merge requests).

## Merge on a rejected push

1. Push a branch whose remote has commits you do not have. Junction shows **Push was rejected** with **Merge and Push** first and **Force Push (with lease)** next to it. If the branch is not the one checked out, the button reads **Checkout and Merge**.
2. Junction stops first if the working tree has uncommitted changes (commit or stash them), then runs `git merge <remote>/<branch>` and, if it is clean, pushes.
3. If there are conflicts, a list of the conflicted files opens. Pick a file to resolve it in the Merge Editor and press **Complete Merge**. A notice shows how many files are left, with a button to reopen the list. The list also has **bulk** entries to take your side or the incoming side for every file, and to abort.
4. When all conflicts are resolved, choose **Complete Merge and Push** or **Complete Merge Only**. If you finish the merge yourself (for example a commit in Source Control), Junction offers to push. This also works after restarting VS Code.
5. Before pushing after a merge, Junction checks the merge for leftover conflict markers and does not push if it finds any.

The conflict list is also used by **Open Conflicts** in the conflict notice and on the status node at the top of the tree, for merges and rebases started in Junction or elsewhere. After a rebase it offers **Continue Rebase**; Junction does not offer a push there.

## Known limitations

- Pull requests are created in the browser. Junction opens a prefilled page and does not call the GitHub, GitLab or Bitbucket APIs or ask for credentials.
- Pull requests from a fork to its upstream repository are not supported: the source and target are always branches of the same remote.
- Squash merges are not detected as merged, because the original commits are not ancestors of the base branch. Such branches keep their normal badge. Likewise a branch with no commits of its own (its tip is on the base branch's main line, e.g. just created or fast-forward merged) is not shown as merged.
- Junction runs git non-interactively, so git never prompts for a password. HTTPS remotes need a credential helper and SSH keys need a running agent (or no passphrase) for fetch, pull and push to work.
- Git runs with `LC_ALL=C`, so git's own messages shown in errors and in the Junction output channel are in English.
- Merge and Push never stashes for you: with uncommitted changes it stops and asks you to commit or stash first.
- The conflict list opens files with VS Code's `git.openMergeEditor`; if that fails the file opens in the normal editor.
- The PR link relies on VS Code passing the URL string through unchanged when opening it externally. If a proxy or custom link handler rewrites URLs, the prefilled branches may be lost.

## Manual QA

- [ ] On a real company Bitbucket repository (Cloud and/or Data Center), click **Create Pull Request** and confirm the opened page has the source and target branches prefilled.
- [ ] Do the same on a github.com and a gitlab.com repository (and GitHub Enterprise / self-hosted GitLab if available), including a GitLab project in a nested group.
- [ ] On a plain git server, pick **No pull requests on this server** and confirm the menu disappears.
- [ ] In a repository with 300+ branches, the sidebar loads, filters and refreshes without noticeable lag.
- [ ] In a multi-root workspace, each repository shows its own section and commands act on the right one.
- [ ] Push a branch whose remote has new, non-conflicting commits: choose **Merge and Push** and confirm the merge commit is pushed.
- [ ] Do the same with a conflicting change: pick each file in the list, resolve it in the Merge Editor, press **Complete Merge**, then choose **Complete Merge and Push** and confirm the push.
- [ ] After a conflicting merge, finish it with a commit in Source Control and confirm Junction asks whether to push.
- [ ] Start a conflicting merge, restart VS Code with markers still in a file or the merge finished, and confirm Junction does not push markers and offers a push once the merge is finished.
- [ ] Create a modify/delete conflict (one side deleted the file), pick it in the conflict list, and confirm it opens something usable (Merge Editor or the plain file). Check on VS Code 1.88 and on stable.
- [ ] With `"locale": "ko"` (Configure Display Language), the sidebar, notifications, Command Palette titles and settings descriptions appear in Korean.

## 한국어

Junction for Git은 VS Code 활동 표시줄에서 로컬/원격 브랜치를 보고, 전환하고, 병합 여부를 확인하고, PR을 여는 브랜치 사이드바입니다. 명령 팔레트의 **Junction: 브랜치 체크아웃…** 으로 빠르게 브랜치를 전환할 수 있습니다. 표시 언어를 한국어로 설정하면 UI가 한국어로 표시됩니다. PR은 GitHub, GitLab, Bitbucket(Cloud/Data Center)에서 브라우저로 생성합니다. github.com, gitlab.com, bitbucket.org는 설정 없이 바로 열리고, 사내 서버는 처음 한 번 서버 종류를 고릅니다. PR 기능이 없는 서버는 **이 서버는 PR 기능이 없음**을 고르면 메뉴가 숨겨집니다. squash 병합은 병합됨으로 표시되지 않습니다.

푸시가 거부되면(원격에 내 브랜치에 없는 커밋이 있을 때) **병합 후 푸시**가 첫 번째 선택지로 나타나며, 원격 브랜치를 병합한 뒤 푸시합니다. 강제 푸시(lease 사용)는 같은 창에서 직접 골라야 합니다. 충돌이 나면 충돌한 파일 목록이 열리고, 파일을 고르면 병합 편집기(Merge Editor)로 열립니다. 목록에서 모든 파일을 내 것 또는 원격 것으로 한 번에 해결하거나 중단할 수도 있습니다. 충돌이 모두 해결되면 **병합 완료 후 푸시** 또는 **병합만 완료**를 고를 수 있고, SCM 패널에서 직접 커밋해 병합을 끝내면 푸시할지 묻습니다. 변경 중인 파일이 있으면 자동으로 stash하지 않고 먼저 커밋하거나 stash하라고 안내합니다. 병합 후 푸시하기 전에 남은 충돌 표시를 검사해, 있으면 푸시하지 않습니다.

## License

MIT
