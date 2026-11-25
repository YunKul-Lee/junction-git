# Junction for Git

A branch sidebar for Git in VS Code. Browse local and remote branches, switch between them, see what is merged, and open pull requests, all from the Activity Bar.

<!-- Screenshot: branch sidebar (docs/images/sidebar.png) -->

## Features

- **Branch tree** with Local and Remote groups, folders by name prefix (`feature/...`), and badges for ahead/behind, merged, and "remote deleted".
- **Switch branches** from the tree or with **Junction: Checkout Branch…** in the Command Palette (local branches by recency, then remote branches by commit time).
- **Create, rename, delete, push, pull** branches from the context menu, with confirmation before anything destructive. Dirty working trees offer to stash.
- **Merge and rebase** into the current branch, with Continue / Abort buttons and a hand-off to the Source Control conflict view.
- **Compare** any branch with the current one and browse per-file diffs, or expand a branch to see its commits.
- **Clean up merged branches** in one step, and **sync the base branch** without leaving your current branch.
- **Create Pull Request** for Bitbucket Cloud and Bitbucket Data Center. The page opens in the browser with source and target branches filled in.
- Multi-root workspaces: each repository gets its own section.
- English and Korean UI.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `junction.baseBranch` | `""` | Base branch that others are compared against. Empty detects `develop`, `main` or `master`. |
| `junction.branchSort` | `"recent"` | Sort order in the tree: `recent` or `name`. |
| `junction.groupByFolder` | `true` | Group branches into folders by name prefix. |
| `junction.commitLimit` | `50` | Commits shown under a branch before "Load more". |
| `junction.bitbucket.servers` | `[]` | Bitbucket servers used to build pull request URLs. |
| `junction.confirmMerge` | `true` | Ask before merging or rebasing. |

## Bitbucket servers

Junction builds the pull request address from your remote URL. For Bitbucket Cloud (`bitbucket.org`) nothing needs configuring. For a self-hosted server, list it in `junction.bitbucket.servers`. Each entry has a `gitHost` (the host in your remote URL, or an SSH alias from `~/.ssh/config`), the `webUrl` of the web UI, and the `type` (`cloud` or `datacenter`).

```jsonc
{
  "junction.bitbucket.servers": [
    // HTTPS remote: https://git.example.com/scm/proj/repo.git
    { "gitHost": "git.example.com", "webUrl": "https://git.example.com", "type": "datacenter" },
    // SSH alias: git@work-bb:proj/repo.git, where work-bb is a Host in ~/.ssh/config
    { "gitHost": "work-bb", "webUrl": "https://bitbucket.example.com", "type": "datacenter" }
  ]
}
```

To share the mapping with your team, commit it to `.vscode/settings.json` in the repository. Workspace settings override user settings.

How the PR page opens:

- If a matching entry exists in settings, the pull request page opens with no prompt.
- Otherwise Junction guesses the web address from the remote, asks you to confirm it once, and saves it to your **user** settings.
- Wrong address? Use **Junction: Change Bitbucket Web Address** to edit the list.

## Known limitations

- Pull requests are created in the browser. Junction opens a prefilled page and does not call the Bitbucket API or ask for credentials.
- Squash merges are not detected as merged, because the original commits are not ancestors of the base branch. Such branches keep their normal badge. Likewise a branch with no commits of its own (its tip is on the base branch's main line, e.g. just created or fast-forward merged) is not shown as merged.
- Junction runs git non-interactively, so git never prompts for a password. HTTPS remotes need a credential helper and SSH keys need a running agent (or no passphrase) for fetch, pull and push to work.
- Git runs with `LC_ALL=C`, so git's own messages shown in errors and in the Junction output channel are in English.
- The PR link relies on VS Code passing the URL string through unchanged when opening it externally. If a proxy or custom link handler rewrites URLs, the prefilled branches may be lost.

## Manual QA

- [ ] On a real company Bitbucket repository (Cloud and/or Data Center), click **Create Pull Request** and confirm the opened page has the source and target branches prefilled.
- [ ] In a repository with 300+ branches, the sidebar loads, filters and refreshes without noticeable lag.
- [ ] In a multi-root workspace, each repository shows its own section and commands act on the right one.
- [ ] With `"locale": "ko"` (Configure Display Language), the sidebar, notifications, Command Palette titles and settings descriptions appear in Korean.

## 한국어

Junction for Git은 VS Code 활동 표시줄에서 로컬/원격 브랜치를 보고, 전환하고, 병합 여부를 확인하고, PR을 여는 브랜치 사이드바입니다. 명령 팔레트의 **Junction: 브랜치 체크아웃…** 으로 빠르게 브랜치를 전환할 수 있습니다. 표시 언어를 한국어로 설정하면 UI가 한국어로 표시됩니다. PR은 브라우저에서 생성되며, squash 병합은 병합됨으로 표시되지 않습니다.

## License

MIT
