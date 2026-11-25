# Junction for Git — Branch Sidebar v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VS Code 사이드바 트리에서 로컬/원격 브랜치를 보고, 기준 브랜치(develop) 대비 커밋·diff를 확인하고, 브랜치 조작과 Bitbucket PR 생성 화면 열기를 하는 확장 v0.1을 만든다.

**Architecture:** 저장소 목록·상태 이벤트·git 실행 경로는 내장 `vscode.git` API에서 받고, 조회/조작은 git CLI를 `execFile`로 직접 실행한다. `src/git`, `src/model`, `src/pr`, `src/flows`는 `vscode`를 import하지 않는 순수 Node 모듈로 두어 vitest + 실제 임시 git 저장소로 테스트한다. `src/views`, `src/commands`, `src/extension.ts`만 `vscode`에 의존하며 통합 테스트(@vscode/test-cli)로 확인한다.

**Tech Stack:** TypeScript 5, VS Code Extension API (engines `^1.90.0`), esbuild, vitest(단위·git 통합), @vscode/test-cli + @vscode/test-electron + mocha(확장 통합), eslint.

**Spec:** `docs/superpowers/specs/2026-11-25-branch-sidebar-design.md`

## Global Constraints

- 라이선스 MIT. Git Graph(mhutchie) 코드는 보지도 복사하지도 않는다.
- 확장 이름 `junction`, 표시 이름 `Junction for Git`, publisher는 `TODO-publisher` 자리표시자 (게시 전 교체).
- 커맨드·설정 접두어 `junction.`.
- `extensionDependencies: ["vscode.git"]`, `engines.vscode: "^1.90.0"`.
- git 2.30 이상 가정. `%(ahead-behind:)`는 git 2.41+에서만 사용하고 아니면 `rev-list --count` 대체 경로.
- `src/git`, `src/model`, `src/pr`, `src/flows` 안에서는 `import * as vscode` 금지.
- force push는 `--force-with-lease`만. 모든 git 실행은 `execFile`(셸 미사용), 인자 배열로.
- UI 문자열은 `vscode.l10n.t()`로 감싼다 (영어 원문, `l10n/bundle.l10n.ko.json`에 한국어). 순수 모듈은 문자열 키 대신 구조화된 결과를 반환하고 문구는 commands 계층에서 만든다.
- 설정 키와 기본값 (스펙 5.9): `junction.baseBranch` `""`, `junction.branchSort` `"recent"` (`recent`|`name`), `junction.groupByFolder` `true`, `junction.commitLimit` `50`, `junction.bitbucket.servers` `[]`, `junction.confirmMerge` `true`.
- 출력 채널 이름 `Junction`. 실패 시 알림에는 stderr 첫 줄, 출력 채널에는 명령+전체 stderr.

## Review Focus

1. **특수 문자 브랜치 이름** (`feature/한글-#12+fix`, `a/b/c`, 폴더와 같은 이름의 브랜치 `feature`와 `feature/x` 공존): 트리에 둘 다 보이고 PR URL이 올바로 인코딩되어야 한다. → Task 4, Task 5 테스트.
2. **기준 브랜치가 없거나 로컬에만 있음, 원격 이름이 `origin`이 아님**: develop→main→master 순 탐색, 원격 우선, 없으면 `↑n`·merged 표시 없이 트리만 정상 표시. → Task 3 테스트.
3. **detached HEAD / 커밋 없는 새 저장소**: 크래시 없이 빈 트리 또는 브랜치 목록만. → Task 3 테스트.
4. **미커밋 변경 + checkout, 미병합 브랜치 삭제, push 거부**: 확인 없이 데이터를 잃는 경로가 없어야 한다. → Task 7 테스트.
5. **rebase/merge 진행 중 상태**: 상태가 감지되고 계속/중단이 동작해야 한다. → Task 8 테스트.

---

## File Structure

```
package.json, tsconfig.json, esbuild.mjs, vitest.config.ts, .vscode-test.mjs, .eslintrc.json, .vscodeignore, LICENSE, README.md
l10n/bundle.l10n.ko.json          한국어 번역
package.nls.json, package.nls.ko.json   contributes 문자열
media/junction.svg                액티비티 바 아이콘
src/
  extension.ts                    activate: gitApi 연결, 모델·트리·커맨드 등록
  git/
    types.ts                      BranchRef, Commit, FileChange, RepoState, GitError
    gitCli.ts                     createGit(): execFile 래퍼, 버전, 로그 훅
    parse.ts                      git 출력 파서 (순수)
    queries.ts                    조회 함수
    operations.ts                 조작 함수 (확인 없음, git만)
  model/
    base.ts                       기준 브랜치 결정 (순수)
    tree.ts                       폴더 그룹핑, 정렬, 설명 문자열 (순수)
    repoModel.ts                  저장소별 스냅샷 로드 (vscode 비의존)
  pr/
    bitbucket.ts                  원격 URL 파싱, 서버 추측/매칭, PR URL 생성 (순수)
  flows/
    ui.ts                         Ui 인터페이스 (confirm/pick/input/info/error)
    branchFlows.ts                확인 창이 필요한 흐름 (checkout, delete, push, sync, cleanup, merge, rebase)
    prFlow.ts                     PR 열기 흐름
  vscode/
    gitApi.ts                     vscode.git API 래퍼
    vscodeUi.ts                   Ui 구현 (window.* + l10n)
    settings.ts                   설정 읽기/쓰기
  views/
    nodes.ts                      노드 클래스
    branchTree.ts                 TreeDataProvider, 필터, 비교 노드, 상태 노드
  commands/
    register.ts                   모든 커맨드 등록
test/
  helpers/repo.ts                 임시 저장소 생성기 (bare 원격 포함)
  unit/*.test.ts                  vitest
  integration/*.test.ts           vitest + 실제 git
  extension/*.test.ts             @vscode/test-cli (mocha)
```

---

### Task 1: 프로젝트 스캐폴드와 빈 사이드바

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`, `.vscode-test.mjs`, `.eslintrc.json`, `.vscodeignore`, `.gitignore`, `LICENSE`, `media/junction.svg`, `src/extension.ts`, `src/views/branchTree.ts`(빈 provider), `test/extension/activate.test.ts`, `test/unit/smoke.test.ts`

**Interfaces:**
- Produces: 뷰 컨테이너 id `junction`, 뷰 id `junction.branches`; `npm run build` → `dist/extension.js`; 스크립트 `test:unit`(vitest), `test:ext`(vscode-test), `lint`, `build`, `watch`, `package`(vsce).

- [ ] **Step 1:** `package.json` 작성. `main: ./dist/extension.js`, `activationEvents: []` (뷰 기여로 자동), `contributes.viewsContainers.activitybar: [{id:"junction", title:"Junction", icon:"media/junction.svg"}]`, `contributes.views.junction: [{id:"junction.branches", name:"Branches"}]`, `extensionDependencies`, `engines`, `l10n: "./l10n"`, license MIT. devDependencies: `typescript`, `esbuild`, `vitest`, `@types/vscode@1.90.0`, `@types/node@20`, `@vscode/test-cli`, `@vscode/test-electron`, `mocha`, `@types/mocha`, `eslint`, `@typescript-eslint/*`, `@vscode/vsce`.
- [ ] **Step 2:** esbuild: `src/extension.ts` → `dist/extension.js`, `platform: node`, `format: cjs`, `external: ['vscode']`. vitest: `test/unit/**` 와 `test/integration/**` 포함, `test/extension` 제외. `.vscode-test.mjs`: `files: 'out-test/extension/**/*.test.js'`, 테스트는 tsc로 `out-test`에 컴파일.
- [ ] **Step 3:** 실패하는 테스트 작성 — `test/extension/activate.test.ts`:
  ```ts
  test('extension activates and registers branches view', async () => {
    const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'junction')!;
    await ext.activate();
    assert.ok(ext.isActive);
    await vscode.commands.executeCommand('junction.branches.focus'); // throws if view missing
  });
  ```
  `test/unit/smoke.test.ts`: `expect(1 + 1).toBe(2)` (vitest 동작 확인용, Task 2에서 삭제).
- [ ] **Step 4:** `npm install && npm run build && npm run test:ext` → FAIL (extension.ts 없음 또는 activate 미구현).
- [ ] **Step 5:** `src/extension.ts`의 `activate(ctx)`에서 `vscode.window.createTreeView('junction.branches', { treeDataProvider: new BranchTreeProvider() })` 등록, 출력 채널 `Junction` 생성. `BranchTreeProvider`는 빈 배열 반환.
- [ ] **Step 6:** `npm run build && npm run test:unit && npm run test:ext && npm run lint` → 모두 PASS.
- [ ] **Step 7:** Commit `chore: scaffold extension with empty Junction branches view`.

---

### Task 2: git 실행기와 테스트용 저장소 도우미

**Files:**
- Create: `src/git/types.ts`, `src/git/gitCli.ts`, `test/helpers/repo.ts`, `test/integration/gitCli.test.ts`
- Delete: `test/unit/smoke.test.ts`

**Interfaces:**
- Produces (`src/git/types.ts`):
  ```ts
  export class GitError extends Error { constructor(readonly args: string[], readonly exitCode: number | null, readonly stderr: string) }
  export interface Git {
    readonly root: string;
    run(args: string[], opts?: { signal?: AbortSignal; input?: string }): Promise<string>; // stdout, 실패 시 GitError
    version(): Promise<{ major: number; minor: number }>;  // 캐시
  }
  ```
- Produces (`src/git/gitCli.ts`): `createGit(gitPath: string, root: string, log?: (line: string) => void): Git`
- Produces (`test/helpers/repo.ts`):
  ```ts
  export interface TestRepo { dir: string; remoteDir: string; git: Git; sh(...args: string[]): Promise<string>; commit(msg: string, file?: string, content?: string): Promise<string>; cleanup(): Promise<void> }
  export function makeRepo(opts?: { withRemote?: boolean; remoteName?: string; initialBranch?: string }): Promise<TestRepo>
  ```
  `makeRepo`는 `os.tmpdir()` 아래에 bare 원격(기본 이름 `origin`)과 작업 저장소를 만들고, `user.name/email`, `commit.gpgsign=false`를 로컬 설정, 초기 브랜치 기본 `develop`, 첫 커밋 하나를 만들어 원격에 push한다.

- [ ] **Step 1:** 실패 테스트 `test/integration/gitCli.test.ts`:
  - `run returns stdout`: `await repo.git.run(['rev-parse','--abbrev-ref','HEAD'])` → `'develop\n'`
  - `run throws GitError with stderr and exit code`: `run(['checkout','nope'])` rejects, `err instanceof GitError`, `err.exitCode !== 0`, `err.stderr` contains `nope`
  - `version parses`: `major >= 2`
  - `log hook receives command line`: log 배열에 `'git checkout nope'`로 시작하는 줄 포함
  - `abort signal kills process`: 이미 abort된 signal로 run → reject
- [ ] **Step 2:** `npx vitest run test/integration/gitCli.test.ts` → FAIL (모듈 없음).
- [ ] **Step 3:** `createGit` 구현: `child_process.execFile(gitPath, ['-c','core.quotepath=false', ...args], { cwd: root, maxBuffer: 64MB, env: {...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C'} , signal })`. stdout은 utf8. `version()`은 `git --version` 정규식 `/(\d+)\.(\d+)/`.
- [ ] **Step 4:** 테스트 PASS.
- [ ] **Step 5:** Commit `feat(git): add git CLI runner and test repo helper`.

---

### Task 3: 조회 (파서 + 쿼리 + 기준 브랜치)

**Files:**
- Create: `src/git/parse.ts`, `src/git/queries.ts`, `src/model/base.ts`, `test/unit/parse.test.ts`, `test/unit/base.test.ts`, `test/integration/queries.test.ts`
- Modify: `src/git/types.ts`

**Interfaces:**
- Consumes: `Git` (Task 2)
- Produces (`types.ts` 추가):
  ```ts
  export interface BranchRef {
    kind: 'local' | 'remote';
    name: string;          // local: 'feature/x', remote: 'origin/feature/x'
    shortName: string;     // remote에서 원격 접두어 뺀 'feature/x', local은 name과 같음
    remote?: string;       // remote kind만
    hash: string; subject: string; committerTime: number; // unix seconds
    isHead: boolean;
    upstream?: string;     // 'origin/feature/x'
    upstreamGone: boolean;
    ahead: number; behind: number;  // upstream 대비, upstream 없으면 0
  }
  export interface Commit { hash: string; shortHash: string; parents: string[]; author: string; time: number; subject: string }
  export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  export interface FileChange { status: ChangeStatus; path: string; oldPath?: string }
  export interface RepoState { head?: string /*브랜치명, detached면 undefined*/; detached: boolean; dirty: boolean; merging: boolean; rebase?: { step: number; total: number } }
  export interface BaseBranch { name: string /*'develop'*/; compareRef: string /*'origin/develop' 또는 'develop'*/; local?: string; remoteRef?: string }
  ```
- Produces (`parse.ts`): `REF_FORMAT: string`, `parseRefs(out: string): BranchRef[]`, `parseTrack(track: string): { ahead: number; behind: number; gone: boolean }`, `parseLog(out: string): Commit[]`, `LOG_FORMAT: string`, `parseNameStatus(out: string): FileChange[]`, `parseRecentCheckouts(reflogOut: string): string[]`, `parseAheadBehind(out: string): Map<string, number>`
- Produces (`queries.ts`):
  ```ts
  listBranches(git: Git): Promise<BranchRef[]>
  aheadOf(git: Git, baseRef: string, branchNames: string[], opts?: { forceFallback?: boolean }): Promise<Map<string, number>>
  mergedInto(git: Git, baseRef: string): Promise<Set<string>>          // 로컬 브랜치 이름
  recentCheckouts(git: Git, limit?: number): Promise<string[]>         // 최근 checkout 순 브랜치명, 중복 제거, 기본 100
  logRange(git: Git, exclude: string, include: string, page: { skip: number; limit: number }): Promise<Commit[]>
  commitFiles(git: Git, hash: string): Promise<FileChange[]>
  rangeFiles(git: Git, baseRef: string, tip: string): Promise<{ mergeBase: string; files: FileChange[] }>
  repoState(git: Git): Promise<RepoState>
  remoteUrl(git: Git, remote: string): Promise<string | undefined>
  ```
- Produces (`model/base.ts`): `resolveBaseBranch(configured: string, branches: BranchRef[]): BaseBranch | undefined`

**결정 사항:**
- `REF_FORMAT` 필드 구분자 `%00`, 필드: `%(refname)`, `%(objectname)`, `%(HEAD)`, `%(upstream:short)`, `%(upstream:track)`, `%(committerdate:unix)`, `%(subject)`. 실행: `git for-each-ref --format=<REF_FORMAT> refs/heads refs/remotes`. `refs/remotes/*/HEAD` 심볼릭 ref는 제외. 원격 이름은 `git remote` 목록과 최장 일치로 분리 (원격 이름에 `/`가 있을 수 있음) — `parseRefs`는 `remotes: string[]` 두 번째 인자를 받는다: `parseRefs(out: string, remotes: string[]): BranchRef[]`.
- `parseTrack`: `'[ahead 2, behind 1]'`, `'[ahead 2]'`, `'[behind 1]'`, `'[gone]'`, `''`.
- `aheadOf`: git ≥ 2.41이고 `forceFallback`이 아니면 `git for-each-ref --format='%(refname:short)%00%(ahead-behind:<baseRef>)' refs/heads` 한 번 (출력 `name\0ahead behind`), 아니면 브랜치마다 `git rev-list --count <baseRef>..<branch>`를 동시 8개 제한으로.
- `mergedInto`: `git for-each-ref --merged <baseRef> --format=%(refname:short) refs/heads`.
- `parseRecentCheckouts`: `git reflog show --format=%gs -n 1000 HEAD` 출력 중 `checkout: moving from A to B` 줄의 B를 순서대로, 중복 제거, 40자 hex(detached)는 제외.
- `LOG_FORMAT`: `%H%x00%h%x00%P%x00%an%x00%at%x00%s%x1e` (레코드 구분 `\x1e`). `logRange`는 `git log --format=<LOG_FORMAT> --skip=<skip> -n <limit> <exclude>..<include>`.
- `commitFiles`: `git diff-tree --no-commit-id -r -M --name-status --root -m --first-parent <hash>`. `parseNameStatus`는 `R100\told\tnew` → `{status:'R', oldPath:'old', path:'new'}`, 점수 숫자 제거.
- `rangeFiles`: `git merge-base <baseRef> <tip>` 후 `git diff --name-status -M <mergeBase> <tip>`.
- `repoState`: `git status --porcelain=v2 --branch` (`# branch.head (detached)` 처리, 엔트리 존재 시 dirty — untracked `?` 제외), `git rev-parse --git-path rebase-merge` / `rebase-apply` / `MERGE_HEAD` 존재 여부와 `msgnum`/`end` 파일(rebase-apply는 `next`/`last`).
- `resolveBaseBranch`: 후보 = configured가 비어 있지 않으면 `[configured]`, 아니면 `['develop','main','master']`. 후보 순서대로, 로컬 이름 또는 원격 shortName이 일치하는 첫 후보 선택. `remoteRef`는 그 이름의 원격 브랜치 중 `origin` 우선, 없으면 첫 원격. `compareRef = remoteRef ?? local`. 어느 것도 없으면 `undefined`.

- [ ] **Step 1:** 실패 단위 테스트 `test/unit/parse.test.ts`:
  - `parseRefs` 로컬/원격/HEAD/upstream/track/symbolic HEAD 제외 고정 문자열 입력 → 기대 배열 (`isHead`, `shortName`, 원격 `team/a` 같이 `/` 있는 원격 이름 포함 케이스)
  - `parseTrack` 위 5가지 케이스
  - `parseNameStatus` A/M/D/R100/C75 케이스와 탭 포함 한글 경로 `src/한글 파일.ts`
  - `parseRecentCheckouts`: `['checkout: moving from develop to feature/a','commit: x','checkout: moving from feature/a to develop','checkout: moving from develop to feature/a']` → `['feature/a','develop']`; 40자 hex 대상은 제외
  - `parseLog`: 두 레코드, parents 공백 분리, 첫 커밋 parents `[]`
- [ ] **Step 2:** 실패 단위 테스트 `test/unit/base.test.ts`:
  - develop 로컬+origin → `{name:'develop', compareRef:'origin/develop', local:'develop', remoteRef:'origin/develop'}`
  - develop 없음, main만 원격 `upstream/main` → compareRef `'upstream/main'`, local undefined
  - develop 로컬에만 → compareRef `'develop'`
  - configured `'release'` 존재 → release, 없으면 `undefined` (자동 후보로 넘어가지 않음)
  - 아무 후보 없음 → `undefined`
- [ ] **Step 3:** 실패 통합 테스트 `test/integration/queries.test.ts` (makeRepo 사용):
  - `listBranches` — develop, `feature/a`(push됨, 로컬 커밋 1개 추가 → ahead 1), `feature/gone`(push 후 원격에서 삭제 + fetch --prune → upstreamGone), 한글·`#`·`+` 포함 `feature/한글-#12+fix`, 폴더명과 같은 `feature` 브랜치
  - `aheadOf` — 기본 경로와 `forceFallback: true` 결과가 동일하고 `feature/a`가 기대값
  - `mergedInto` — `--no-ff` merge 후 push한 브랜치가 포함, 미병합 브랜치 미포함
  - `logRange`, `commitFiles`(rename 포함), `rangeFiles`
  - `repoState` — 깨끗함 / 수정 파일(dirty) / untracked만(dirty false) / detached / merge 충돌 중(merging) / rebase 충돌 중(step,total)
  - 빈 저장소(`git init`만): `listBranches` → `[]`, `repoState` 예외 없음
- [ ] **Step 4:** `npx vitest run test/unit test/integration/queries.test.ts` → FAIL.
- [ ] **Step 5:** 위 결정 사항대로 `parse.ts`, `queries.ts`, `base.ts` 구현.
- [ ] **Step 6:** 테스트 PASS.
- [ ] **Step 7:** Commit `feat(git): branch, log, diff and repo state queries`.

---

### Task 4: 트리 모델 (그룹핑·정렬·설명) 과 저장소 스냅샷

**Files:**
- Create: `src/model/tree.ts`, `src/model/repoModel.ts`, `test/unit/tree.test.ts`, `test/integration/repoModel.test.ts`

**Interfaces:**
- Consumes: Task 3 전체
- Produces (`tree.ts`):
  ```ts
  export type TreeEntry = { type: 'folder'; name: string; path: string; children: TreeEntry[] } | { type: 'branch'; label: string; branch: BranchRef };
  export function buildEntries(branches: BranchRef[], opts: { groupByFolder: boolean; sort: 'recent' | 'name'; recent: string[] }): TreeEntry[]
  export interface BranchBadges { aheadOfBase?: number; merged: boolean; isBase: boolean }
  export function describeBranch(b: BranchRef, badges: BranchBadges): string
  ```
- Produces (`repoModel.ts`):
  ```ts
  export interface RepoSnapshot { root: string; branches: BranchRef[]; remotes: string[]; base?: BaseBranch; aheadOfBase: Map<string, number>; merged: Set<string>; recent: string[]; state: RepoState }
  export function loadSnapshot(git: Git, cfg: { baseBranch: string }, signal?: AbortSignal): Promise<RepoSnapshot>
  ```

**결정 사항:**
- 그룹핑: `shortName`을 `/`로 나눠 마지막 조각이 label. 폴더와 같은 이름의 브랜치(`feature`, `feature/x`)는 같은 레벨에 폴더 `feature/`와 브랜치 `feature` 둘 다 둔다. 폴더 먼저, 그 다음 브랜치.
- 정렬 `recent`: `recent` 배열 인덱스 오름차순, 없는 건 그 뒤에 `committerTime` 내림차순. 원격 브랜치에는 `recent`를 쓰지 않고 `committerTime` 내림차순. `name`: 로케일 무관 `localeCompare(undefined, {numeric: true})`. 폴더는 내부 브랜치 중 가장 앞선 순위로 정렬.
- 정렬과 그룹핑 대상은 같은 kind 안에서만 (로컬/원격별로 호출, 원격은 원격별로 호출).
- `describeBranch` 규칙 (구분자 두 칸 공백):
  - merged(isBase 아님) → `'✓ merged'` (다른 배지 생략)
  - `aheadOfBase > 0` → `'↑{n}'`
  - `ahead > 0` → `'⇡{n}'`, `behind > 0` → `'⇣{n}'`
  - `upstreamGone` → `'(remote deleted)'` (l10n은 views 계층에서; 여기서는 고정 영어 토큰)
  - isBase는 `↑`·merged 없이 `⇡/⇣`만
- `loadSnapshot`: `git remote`, `listBranches`, `repoState`, `recentCheckouts`를 병렬 → `resolveBaseBranch` → base 있으면 `aheadOf`(로컬 브랜치만), `mergedInto` 병렬. HEAD 브랜치와 base 로컬 브랜치는 merged 집합에서 제거.

- [ ] **Step 1:** 실패 단위 테스트 `tree.test.ts`:
  - `feature/a`, `feature/b/c`, `feature`, `develop` → 루트: folder `feature`(children: folder `b`(c), branch `a`), branch `feature`, branch `develop` (recent 순서 적용 확인)
  - `groupByFolder:false` → 평면 목록, label = shortName
  - `sort:'name'` → `feature/2` < `feature/10`
  - `describeBranch` 7개 조합: merged / ↑7 / ↑2⇡1 / 기준 ⇣5 / gone / 아무것도 없음 `''` / merged+gone → `'✓ merged'`
- [ ] **Step 2:** 실패 통합 테스트 `repoModel.test.ts`: Task 3 시나리오 저장소에서 `loadSnapshot` → base.compareRef `'origin/develop'`, merged에 병합 브랜치 포함·HEAD 제외, aheadOfBase 값, 기준 없는 저장소(`initialBranch:'trunk'`)에서 base undefined·aheadOfBase 빈 Map·merged 빈 Set.
  - 성능: 로컬 300개 브랜치(`git branch` 루프 생성) 저장소에서 `loadSnapshot` < 1000ms (`performance.now()`; CI 머신 편차 위해 2000ms로 assertion, 1000ms 초과 시 console.warn).
- [ ] **Step 3:** FAIL 확인 → 구현 → PASS 확인.
- [ ] **Step 4:** Commit `feat(model): branch tree entries, badges and repo snapshot`.

---

### Task 5: Bitbucket PR URL

**Files:**
- Create: `src/pr/bitbucket.ts`, `test/unit/bitbucket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BitbucketServer { gitHost: string; webUrl: string; type: 'cloud' | 'datacenter' }
  export interface ParsedRemote { host: string; segments: string[] /*경로 조각, .git 제거*/ }
  export function parseRemote(url: string): ParsedRemote | undefined        // scp형, ssh://, https://user@ 지원
  export function findServer(remoteUrl: string, configured: BitbucketServer[]): BitbucketServer | undefined  // gitHost 대소문자 무시 일치
  export function guessServer(remoteUrl: string): BitbucketServer | undefined
  export function buildPrUrl(server: BitbucketServer, remoteUrl: string, source: string, target: string): string | undefined
  ```

**결정 사항:**
- `guessServer`: host `bitbucket.org` → `{type:'cloud', webUrl:'https://bitbucket.org'}`. 경로에 `scm` 조각이 있거나 ssh 포트 7999이면 datacenter, `webUrl = https://<host>` + `scm` 앞 조각들(컨텍스트 경로). 그 외 → `undefined`.
- 저장소 식별: 경로의 마지막 두 조각 `[owner, repo]` (`scm`·컨텍스트 경로는 그 앞). 
- Cloud: `${webUrl}/${owner}/${repo}/pull-requests/new?source=${enc(src)}&dest=${enc(dst)}`
- DC 프로젝트: `${webUrl}/projects/${owner.toUpperCase()}/repos/${repo}/pull-requests?create&sourceBranch=${enc('refs/heads/'+src)}&targetBranch=${enc('refs/heads/'+dst)}`
- DC 개인(`owner`가 `~`로 시작): `${webUrl}/users/${owner.slice(1)}/repos/${repo}/pull-requests?create&...`
- `enc` = `encodeURIComponent`. webUrl 끝 `/` 제거.

- [ ] **Step 1:** 실패 테스트 (표 기반 `it.each`):
  - `git@bitbucket.org:acme/web.git`, `https://jdoe@bitbucket.org/acme/web.git` → cloud, PR URL `https://bitbucket.org/acme/web/pull-requests/new?source=feature%2Fx&dest=develop`
  - `ssh://git@git.acme.com:7999/PROJ/web.git` → `https://git.acme.com/projects/PROJ/repos/web/pull-requests?create&sourceBranch=refs%2Fheads%2Ffeature%2Fx&targetBranch=refs%2Fheads%2Fdevelop`
  - `https://git.acme.com/scm/proj/web.git` → 프로젝트 키 `PROJ`
  - `https://git.acme.com/bitbucket/scm/proj/web.git` → webUrl `https://git.acme.com/bitbucket`
  - `ssh://git@git.acme.com:7999/~jdoe/web.git` → `/users/jdoe/repos/web/...`
  - `git@github.com:a/b.git` → guessServer `undefined`
  - SSH 별칭 `git@work:PROJ/web.git` + configured `[{gitHost:'work', webUrl:'https://bitbucket.acme.com/', type:'datacenter'}]` → findServer 일치, URL `https://bitbucket.acme.com/projects/PROJ/...`
  - 브랜치 `feature/한글-#12+fix` → `encodeURIComponent` 결과 포함
- [ ] **Step 2:** FAIL → 구현 → PASS.
- [ ] **Step 3:** Commit `feat(pr): bitbucket remote parsing and PR URL builder`.

---

### Task 6: 브랜치 트리 뷰 (vscode.git 연결, 노드, 비교, diff, 필터)

**Files:**
- Create: `src/vscode/gitApi.ts`, `src/vscode/settings.ts`, `src/views/nodes.ts`, `src/views/branchTree.ts`(교체), `test/extension/tree.test.ts`, `test/extension/fixtures.ts`
- Modify: `src/extension.ts`, `package.json`(뷰 제목 버튼·설정 contributes)

**Interfaces:**
- Consumes: `createGit`, `loadSnapshot`, `buildEntries`, `describeBranch`, `logRange`, `commitFiles`, `rangeFiles` (Tasks 2–4)
- Produces:
  ```ts
  // gitApi.ts
  export interface RepoHandle { root: vscode.Uri; git: Git; onDidChange: vscode.Event<void>; toGitUri(uri: vscode.Uri, ref: string): vscode.Uri }
  export function connectGitApi(log: (l: string) => void): Promise<{ repos(): RepoHandle[]; onDidChangeRepos: vscode.Event<void> }>
  // settings.ts
  export function readSettings(scope?: vscode.Uri): { baseBranch: string; branchSort: 'recent'|'name'; groupByFolder: boolean; commitLimit: number; confirmMerge: boolean; bitbucketServers: BitbucketServer[] }
  // nodes.ts — 모든 노드 클래스는 vscode.TreeItem 상속, contextValue 고정:
  //   RepoNode 'repo', SectionNode 'section-local' | 'section-remote', FolderNode 'folder',
  //   BranchNode 'branch-local' | 'branch-local-head' | 'branch-local-merged' | 'branch-remote',
  //   RangeChangesNode 'range-changes', CommitNode 'commit', FileNode 'file', MoreNode 'more',
  //   CompareNode 'compare', CompareSideNode 'compare-side', StatusNode 'status-rebase' | 'status-merge'
  // branchTree.ts
  export class BranchTreeProvider implements vscode.TreeDataProvider<Node> {
    refresh(root?: vscode.Uri): void;              // 300ms 디바운스, 진행 중 로드 abort
    setFilter(text: string | undefined): void;
    showCompare(root: vscode.Uri, a: string, b: string): void;
    clearCompare(): void;
    snapshot(root: vscode.Uri): RepoSnapshot | undefined;
  }
  ```
  커맨드 id (이 태스크에서 등록): `junction.refresh`, `junction.filter`, `junction.clearFilter`, `junction.openFileDiff`(내부), `junction.loadMore`(내부), `junction.compareWithCurrent`, `junction.closeCompare`, `junction.copyCommitHash`, `junction.copyCommitMessage`.

**결정 사항:**
- `connectGitApi`: `vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`; `api.git.path`로 `createGit`. 저장소 추가/제거 이벤트 → `onDidChangeRepos`. 각 `repository.state.onDidChange` → `onDidChange`. 창 포커스 복귀(`window.onDidChangeWindowState` focused true) 시 전체 refresh.
- 루트 레벨: 저장소 1개면 바로 `로컬`/`원격: <remote>` 섹션, 2개 이상이면 `RepoNode`(label = 폴더명) 아래에. 상태 노드(rebase/merge 진행 중)는 해당 레벨 최상단, 비교 노드는 그 다음.
- 원격 섹션은 원격마다 하나 (`Remote: origin`). 로컬 섹션과 첫 원격 섹션은 기본 펼침.
- 현재 브랜치: `iconPath = new ThemeIcon('circle-filled')`, 나머지 `git-branch`, merged `check`. description = `describeBranch` 결과에서 `(remote deleted)`를 `l10n.t('(remote deleted)')`로 치환.
- BranchNode 툴팁 MarkdownString: 마지막 커밋 제목, 상대 시간, upstream, ahead/behind.
- BranchNode 자식: base가 있고 브랜치가 base가 아니면 `RangeChangesNode`(label `l10n.t('All changes vs {0}')`, 접힌 상태; 펼칠 때 `rangeFiles`로 FileNode 목록 로드 — 파일 수는 표시하지 않음) + `logRange(compareRef, branch)` 커밋들 + 남으면 `MoreNode`. 기준 브랜치 로컬 노드 자식: `logRange(local, remoteRef)`(받지 않은 커밋). 원격 BranchNode도 동일하게 base 대비.
- CommitNode: label `${shortHash}  ${subject}`, description 상대 시간, 자식 `commitFiles`. FileNode 클릭 → `junction.openFileDiff` 인자 `{root, left: ref|undefined, right: ref|undefined, path, oldPath}`: 커밋 파일은 left=`${hash}^`(parents 없으면 undefined → 빈 문서), right=hash; 범위 파일은 left=mergeBase, right=브랜치 tip. 삭제 파일은 right undefined. ref가 undefined인 쪽은 `junction-empty:` 스킴(빈 문자열을 돌려주는 TextDocumentContentProvider, 경로는 원본 파일 경로 유지)으로 연다. 제목 `${basename} (${left7} ↔ ${right7})`.
- FileNode: `resourceUri`로 파일 아이콘, description은 상태 문자 + 상위 경로.
- MoreNode 클릭 → 해당 부모의 skip += commitLimit, 그 부모만 refresh.
- 비교 노드: `compareWithCurrent(branch)` → `CompareNode` label `l10n.t('Compare: {0} ↔ {1}')`, 자식 `CompareSideNode` 2개 (`l10n.t('Only in {0}')`) 각각 `logRange`. 인라인 닫기 버튼 `junction.closeCompare`. 현재 브랜치가 detached면 HEAD 사용.
- 필터: `junction.filter` → InputBox(현재 값 채움) → 대소문자 무시 `shortName.includes`. 필터 중 폴더는 일치 자식이 있을 때만, 모든 폴더 펼침 상태로. `TreeView.message = l10n.t('Filter: "{0}"')`, 제목 버튼 `junction.clearFilter` 는 `when: junction.filterActive` 컨텍스트 키.
- 뷰 제목 버튼 (`view/title`, `navigation` 그룹): filter, sync(Task 7), cleanupMerged(Task 7), refresh.
- 로드 실패(GitError) → 해당 저장소 자리에 오류 노드 `l10n.t('Failed to load branches: {0}')` + 출력 채널.

- [ ] **Step 1:** `test/extension/fixtures.ts`: 테스트 실행 전 `test/helpers/repo.ts`로 저장소를 만들고 그 폴더를 워크스페이스로 여는 `.vscode-test.mjs` 설정 (`workspaceFolder`를 사전 스크립트로 생성된 경로로). 확장 테스트에서 provider 인스턴스 접근은 `activate()`가 반환하는 `{ tree: BranchTreeProvider }` API로.
- [ ] **Step 2:** 실패 테스트 `test/extension/tree.test.ts`:
  - 루트 children 라벨 `['Local', 'Remote: origin']` (영어 로케일)
  - Local 아래 현재 브랜치 BranchNode `contextValue === 'branch-local-head'`, `feature/` 폴더 존재
  - `feature/search`(develop 대비 2커밋) 자식: 첫째 `RangeChangesNode`, 다음 CommitNode 2개
  - CommitNode 자식 FileNode의 `command.command === 'junction.openFileDiff'`
  - `openFileDiff` 실행 후 `window.tabGroups.activeTabGroup.activeTab.input instanceof TabInputTextDiff`
  - `setFilter('sea')` 후 Local 아래 `feature/` → `search`만
  - 작업 폴더에서 `git checkout -b x` 실행 후 1초 내 트리에 `x` 등장 (onDidChange 동작)
  - `showCompare` 후 루트 첫 노드 contextValue `'compare'`
- [ ] **Step 3:** `npm run build && npm run test:ext` → FAIL.
- [ ] **Step 4:** 구현.
- [ ] **Step 5:** PASS 확인 + `npm run test:unit` 회귀 없음.
- [ ] **Step 6:** Commit `feat(view): branch tree with commits, diffs, filter and compare`.

---

### Task 7: 브랜치 조작 흐름 (checkout·생성·이름 변경·삭제·push·pull·fetch·동기화·정리)

**Files:**
- Create: `src/git/operations.ts`, `src/flows/ui.ts`, `src/flows/branchFlows.ts`, `src/vscode/vscodeUi.ts`, `src/commands/register.ts`, `test/helpers/fakeUi.ts`, `test/integration/branchFlows.test.ts`
- Modify: `src/extension.ts`, `package.json`(커맨드·메뉴)

**Interfaces:**
- Consumes: `Git`, queries, `RepoSnapshot`
- Produces (`ui.ts`):
  ```ts
  export type Msg = { key: string; args?: (string | number)[] };   // key = 영어 원문 (l10n.t 키로 그대로 사용)
  export interface Ui {
    confirm(msg: Msg, actions: Msg[], opts?: { modal?: boolean; detail?: Msg }): Promise<number | undefined>; // 선택 인덱스, 취소 undefined
    input(prompt: Msg, opts?: { value?: string; validate?: (v: string) => Msg | undefined }): Promise<string | undefined>;
    pickMany<T>(items: { label: string; picked: boolean; value: T }[], title: Msg): Promise<T[] | undefined>;
    pick<T>(items: { label: string; description?: string; value: T }[], title: Msg): Promise<T | undefined>;
    info(msg: Msg): void; error(msg: Msg, err?: unknown): void;
    progress<T>(title: Msg, fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
  }
  ```
- Produces (`operations.ts`), 모두 `(git: Git, ...) => Promise<void>` 이고 실패 시 `GitError`:
  `switchBranch(name)`, `switchTrack(remoteBranch, localName)`, `createBranch(name, startPoint)`, `renameBranch(old, new)`, `deleteLocal(name, force: boolean)`, `deleteRemote(remote, shortName)`, `push(branch, opts:{ setUpstreamTo?: string; forceWithLease?: boolean })`, `pull()`, `fastForward(remote, remoteBranch, local)` (= `git fetch <remote> <remoteBranch>:<local>`), `mergeFfOnly(ref)`, `fetchAll()` (= `git fetch --all --prune`), `stash(message)`, `stashPop()`.
- Produces (`branchFlows.ts`), 모두 `(ctx: { git: Git; ui: Ui; snap: RepoSnapshot }, ...) => Promise<FlowResult>` with `type FlowResult = 'done' | 'cancelled' | 'failed'`:
  `checkoutFlow(ref: BranchRef)`, `newBranchFlow(from: BranchRef)`, `renameFlow(b: BranchRef)`, `deleteLocalFlow(b: BranchRef)`, `deleteRemoteFlow(b: BranchRef)`, `pushFlow(b: BranchRef)`, `pullFlow(b: BranchRef)`, `syncFlow()`, `cleanupMergedFlow()`
- 커맨드 id: `junction.checkout`, `junction.newBranch`, `junction.rename`, `junction.delete`, `junction.deleteRemote`, `junction.push`, `junction.pull`, `junction.fetch`, `junction.sync`, `junction.cleanupMerged`, `junction.copyBranchName`.

**결정 사항 (흐름 규칙, 스펙 5.5):**
- `checkoutFlow`: 로컬 → `switchBranch`. 원격 → 같은 shortName 로컬 있으면 그 로컬로 switch, 없으면 `switchTrack`. `snap.state.dirty`면 먼저 confirm(`'You have uncommitted changes.'`, [`'Stash and Switch'`, `'Switch Anyway'`]) — 취소면 `'cancelled'`. Stash 선택 시 `stash('junction: auto-stash before switching to <name>')` 후 전환, 전환 후 자동 pop 하지 않고 info `'Changes were stashed. Use "Stash Pop" in Source Control to restore them.'`. "Switch Anyway" 실패 시 git stderr를 error로.
- `newBranchFlow`: input 기본값 없음, validate: `git check-ref-format --branch` 실패 또는 이미 존재 → 메시지. 시작점: 기준 브랜치 로컬 노드에서 호출되고 `snap.base.remoteRef` 있으면 remoteRef, 그 외 `ref.name`. 생성 후 바로 switch (`git switch -c`). dirty여도 확인 없음 (변경은 따라감).
- `renameFlow`: input value=현재 이름. upstream 있으면 완료 후 info `'Remote branch was not renamed.'`.
- `deleteLocalFlow`: HEAD 브랜치면 error `'Cannot delete the current branch.'`. `deleteLocal(force=false)`; GitError stderr에 `not fully merged` 포함 시 `logRange(git, compareRef ?? upstream ?? 'HEAD', name)` 개수 n으로 modal confirm(`'Branch {0} has {1} unmerged commits that will be lost.'`, [`'Delete Anyway'`]) → `force=true`.
- `deleteRemoteFlow`: 항상 modal confirm(`'Delete remote branch {0}? This affects everyone.'`, [`'Delete'`]).
- `pushFlow`: upstream 없으면 `push({setUpstreamTo: base.remoteRef의 remote ?? remotes[0]})`. GitError stderr에 `non-fast-forward` 또는 `[rejected]` → modal confirm(`'Push was rejected. Force push with lease?'`, [`'Force Push (with lease)'`]) → `push({forceWithLease:true})`. 원격 없음 → error `'No remote configured.'`.
- `pullFlow`: HEAD면 `pull()`; 아니면 upstream 있으면 `fastForward`, 실패(non-ff) 시 info `'{0} cannot be fast-forwarded.'`.
- `syncFlow`: `fetchAll()` → base에 local과 remoteRef 둘 다 있으면: local이 HEAD면 `mergeFfOnly(remoteRef)`, 아니면 `fastForward`. ff 불가 → info, 결과는 `'done'`.
- `cleanupMergedFlow`: 후보 = `snap.merged` (HEAD·base 이미 제외). 비면 info `'No merged branches to clean up.'`. pickMany(모두 picked) → 선택마다 `deleteLocal(force=false)`, 개별 실패는 모아서 error 한 번. 원격 삭제 없음.
- 모든 흐름 시작 시 `snap.state.rebase || snap.state.merging`이면 (checkout/sync/cleanup 한정) error `'A rebase or merge is in progress.'` 후 `'failed'`.
- `register.ts`: 노드에서 `RepoHandle`·스냅샷을 찾고, `ui.progress`로 감싸 실행, 끝나면 `tree.refresh(root)`.
- 메뉴(`view/item/context`): contextValue 정규식으로 노출 (`branch-local.*`: checkout(HEAD 제외), newBranch, rename, delete, push, pull, compareWithCurrent(HEAD 제외), merge/rebase(Task 8), createPr(Task 9), copyBranchName; `branch-remote`: checkout, newBranch, deleteRemote, compareWithCurrent, copyBranchName). 인라인: 로컬 브랜치 hover에 checkout 아이콘.

- [ ] **Step 1:** `test/helpers/fakeUi.ts`: 스크립트된 응답 큐(`answers: unknown[]`)와 기록(`calls: {method, msg}[]`)을 가진 `Ui` 구현. 응답이 없으면 `undefined`(취소).
- [ ] **Step 2:** 실패 통합 테스트 `test/integration/branchFlows.test.ts` (각 케이스 makeRepo + loadSnapshot):
  - checkout 깨끗함 → HEAD 변경, confirm 호출 0회
  - checkout dirty + 취소 → `'cancelled'`, HEAD 그대로, 파일 내용 그대로
  - checkout dirty + Stash(0) → HEAD 변경, `git stash list` 1개, 작업 트리 깨끗
  - checkout 원격 `origin/feature/r`(로컬 없음) → 로컬 `feature/r` 생성, upstream `origin/feature/r`
  - checkout 원격인데 같은 이름 로컬 존재 → 새로 만들지 않고 그 로컬로 전환
  - newBranch from develop(remoteRef 있음) → 시작점 = `origin/develop` 해시
  - newBranch 잘못된 이름 `'a..b'` → validate가 메시지 반환
  - deleteLocal 병합됨 → confirm 0회, 삭제됨
  - deleteLocal 미병합 + 취소 → 브랜치 남음, confirm 메시지 args에 커밋 수 1
  - deleteLocal 미병합 + Delete Anyway → 삭제됨
  - deleteLocal HEAD → `'failed'`, error 호출
  - deleteRemote 취소 → 원격에 남음; 확인 → `git ls-remote` 에서 사라짐
  - push upstream 없음 → 원격에 생성, upstream 설정됨
  - push 거부(원격에 다른 커밋 push해둠) + 확인 → 원격이 로컬 해시와 같아짐; 취소 → 원격 그대로
  - sync: 원격 develop이 앞서 있고 HEAD가 feature일 때 → 로컬 develop이 원격 해시로 이동, HEAD 그대로
  - cleanupMerged: 병합 2개·미병합 1개 → pickMany 항목 2개, 확인 후 2개 삭제, 미병합 남음
  - rebase 진행 중 checkout → `'failed'`
- [ ] **Step 3:** FAIL → `operations.ts`, `branchFlows.ts` 구현 → PASS.
- [ ] **Step 4:** `vscodeUi.ts`(Msg → `vscode.l10n.t(key, ...args)`; confirm은 `showWarningMessage(..., {modal})`), `register.ts`, `package.json` 커맨드/메뉴 추가. 확장 테스트 1개 추가 `test/extension/commands.test.ts`: `junction.checkout`을 BranchNode 인자로 실행 → HEAD 변경, 트리 refresh 후 해당 노드 `branch-local-head`.
- [ ] **Step 5:** `npm run build && npm run test:unit && npm run test:ext` PASS.
- [ ] **Step 6:** Commit `feat: branch operations with confirmations and context menus`.

---

### Task 8: merge·rebase와 진행 중 상태

**Files:**
- Modify: `src/git/operations.ts`, `src/flows/branchFlows.ts`, `src/views/branchTree.ts`, `src/commands/register.ts`, `package.json`
- Test: `test/integration/mergeRebase.test.ts`

**Interfaces:**
- Produces (operations): `merge(ref)`, `rebase(onto)`, `rebaseContinue()`, `rebaseAbort()`, `mergeAbort()` — `rebaseContinue`는 env `GIT_EDITOR=true`로 실행.
- Produces (flows): `mergeIntoCurrentFlow(b: BranchRef, opts: { confirm: boolean })`, `rebaseCurrentOntoFlow(b: BranchRef, opts: { confirm: boolean })`, `continueFlow()`, `abortFlow()` → `FlowResult | 'conflicts'`
- 커맨드 id: `junction.mergeIntoCurrent`, `junction.rebaseCurrentOnto`, `junction.continueOperation`, `junction.abortOperation`, `junction.openConflicts`.

**결정 사항:**
- 실행 전 확인(`confirmMerge` 설정 true일 때): `'Merge {0} into {1}?'` / `'Rebase {0} onto {1}?'`. rebase이고 현재 브랜치 upstream이 있고 behind/ahead와 무관하게 원격에 존재하면 detail `'This branch is already pushed. You will need to force push after rebasing.'`.
- dirty면 merge/rebase 모두 error `'Commit or stash your changes first.'` 후 `'failed'` (git 자체 거부 메시지보다 명확하게).
- GitError 후 `repoState`가 merging 또는 rebase이면 결과 `'conflicts'` → commands 계층이 알림 `'Conflicts found.'` + 버튼 [`'Open Conflicts'`, `'Abort'`]. `junction.openConflicts`는 내장 SCM 뷰 포커스(`workbench.view.scm`) 후 첫 충돌 파일(`git diff --name-only --diff-filter=U`)을 연다 — 기본 merge editor가 처리.
- 트리 상태 노드: `state.rebase` → `l10n.t('Rebase in progress ({0}/{1})')`, `state.merging` → `l10n.t('Merge in progress')`, 인라인 버튼 continue(rebase만)/abort, `iconPath = ThemeIcon('warning')`.

- [ ] **Step 1:** 실패 테스트 `mergeRebase.test.ts`:
  - merge 충돌 없음 → `'done'`, HEAD에 merge 반영
  - merge 충돌 → `'conflicts'`, `repoState().merging === true`; `abortFlow()` → merging false, HEAD 원래 해시
  - rebase 충돌 → `'conflicts'`, `rebase` 상태 step/total; 충돌 해결(파일 수정+`git add`) 후 `continueFlow()` → `'done'`, rebase 상태 없음
  - dirty에서 merge → `'failed'`, confirm 0회
  - confirm 취소 → `'cancelled'`, HEAD 그대로
  - push된 브랜치 rebase 확인 창 detail에 force push 경고 key 포함
- [ ] **Step 2:** FAIL → 구현 → PASS. 확장 테스트에 상태 노드 1개 추가: 충돌 상태 저장소에서 루트 첫 노드 contextValue `'status-merge'`.
- [ ] **Step 3:** Commit `feat: merge and rebase with conflict handoff and in-progress status`.

---

### Task 9: Bitbucket PR 열기

**Files:**
- Create: `src/flows/prFlow.ts`, `test/integration/prFlow.test.ts`
- Modify: `src/vscode/settings.ts`, `src/commands/register.ts`, `package.json`

**Interfaces:**
- Consumes: `findServer`, `guessServer`, `buildPrUrl` (Task 5), `pushFlow` (Task 7), `remoteUrl` (Task 3)
- Produces:
  ```ts
  export interface PrEnv {
    servers(): BitbucketServer[];                              // 병합된 설정값 (워크스페이스 우선은 VS Code가 처리)
    saveServer(s: BitbucketServer): Promise<void>;             // 사용자(Global) 설정 배열에 추가/교체(gitHost 기준)
    open(url: string): Promise<void>;
    nagCount(gitHost: string): number; bumpNag(gitHost: string): void; // globalState
  }
  export function createPrFlow(ctx: { git: Git; ui: Ui; snap: RepoSnapshot; env: PrEnv }, b: BranchRef, target?: string): Promise<FlowResult>
  ```
- 커맨드 id: `junction.createPr`, `junction.createPrPickTarget`, `junction.bitbucket.changeWebUrl`.

**결정 사항 (스펙 5.7):**
- 원격: b의 upstream 원격 → base.remoteRef의 원격 → `origin` → 첫 원격.
- 서버 결정: `findServer(url, env.servers())` 있으면 **확인 없이** 사용. 없으면 `guessServer`; 추측 결과를 `ui.input('Bitbucket web URL for {0}', {value: guess?.webUrl ?? 'https://'})`로 확인받음 (취소 → `'cancelled'`). type은 추측값, 추측 실패면 `ui.pick`으로 Cloud/Data Center 선택. 확인값은 `env.saveServer({gitHost: parseRemote(url).host, webUrl, type})`.
- target 기본값 `snap.base.name`; `createPrPickTarget`은 원격 브랜치 shortName 목록 pick.
- push 필요 조건: upstream 없음 또는 upstreamGone 또는 `ahead > 0` → confirm(`'Push {0} before creating the pull request?'`, [`'Push'`]) → 취소면 `'cancelled'`, 확인이면 `pushFlow` (실패면 `'failed'`).
- `buildPrUrl`이 undefined → error `'Could not build a pull request URL for this remote.'`.
- 열고 나서 `nagCount(gitHost) < 3`이면 info `'Wrong address?'` 버튼 [`'Open Settings'`] + `bumpNag`. Open Settings → `vscode.commands.executeCommand('workbench.action.openSettings', 'junction.bitbucket.servers')`.
- `junction.bitbucket.changeWebUrl`: 같은 `openSettings` 호출.
- 메뉴: Bitbucket 원격이 아닐 때 숨기기 위해, 스냅샷 로드 시 `setContext('junction.hasBitbucket', boolean)` (설정 일치 또는 guessServer 성공 저장소가 하나라도 있으면 true) 를 `when` 조건으로.

- [ ] **Step 1:** 실패 테스트 `prFlow.test.ts` (가짜 `PrEnv`; 원격 URL은 `git remote set-url --push`가 아닌 `git config remote.origin.url`을 테스트용 가짜 URL로 바꾸고 `pushurl`은 로컬 bare 경로로 유지):
  - 설정에 서버 있음 + push 완료 브랜치 → `ui.calls`에 input/confirm 없음, `open` URL = 기대 DC URL
  - 설정 없음, `ssh://git@git.acme.com:7999/PROJ/web.git` → input 기본값 `https://git.acme.com`, 확인 후 `saveServer` 인자 `{gitHost:'git.acme.com', webUrl:'https://git.acme.com', type:'datacenter'}`
  - input 취소 → `'cancelled'`, open 0회, saveServer 0회
  - 로컬 커밋 ahead 1 → push confirm, 취소 → open 0회; 확인 → 원격 갱신 후 open
  - target 지정 `'release/1.0'` → URL에 `targetBranch=refs%2Fheads%2Frelease%2F1.0`
  - nag: count 0 → info 호출 + bump; count 3 → info 없음
- [ ] **Step 2:** FAIL → 구현 → PASS. `settings.ts`에 `saveServer` (ConfigurationTarget.Global, `inspect().globalValue` 기준으로 배열 갱신 — 워크스페이스 값은 건드리지 않음).
- [ ] **Step 3:** Commit `feat(pr): open Bitbucket pull request creation page`.

---

### Task 10: 빠른 checkout, 다국어, 문서, 패키징

**Files:**
- Create: `l10n/bundle.l10n.ko.json`, `package.nls.json`, `package.nls.ko.json`, `README.md`, `CHANGELOG.md`, `test/unit/l10n.test.ts`
- Modify: `src/commands/register.ts`, `package.json`

**Interfaces:**
- 커맨드 id: `junction.checkoutBranch` (명령 팔레트, "Junction: Checkout Branch…").

**결정 사항:**
- `junction.checkoutBranch`: 저장소 2개 이상이면 먼저 저장소 pick. 항목 = 로컬(최근 순) → 원격(커밋 시간 순), label 브랜치명, description은 `describeBranch` 결과, 현재 브랜치 제외. 선택 → `checkoutFlow`.
- `package.json`의 커맨드 title·설정 description은 `%key%` 형태로 `package.nls*.json`에.
- 한국어 번역 용어: Branches=브랜치, Local=로컬, Remote=원격, merged=병합됨 (`✓ merged` → `✓ 병합됨`), Checkout=체크아웃, Pull Request=PR.

- [ ] **Step 1:** 실패 테스트 `test/unit/l10n.test.ts`: `src/**/*.ts`에서 `l10n.t('...')` 리터럴과 `branchFlows.ts`/`prFlow.ts`의 `key: '...'` 리터럴을 정규식으로 수집 → 모두 `l10n/bundle.l10n.ko.json` 키에 존재; `package.json`의 `%key%` 전부가 `package.nls.json`과 `package.nls.ko.json`에 존재.
- [ ] **Step 2:** FAIL → 번역 파일 작성, `checkoutBranch` 구현 → PASS.
- [ ] **Step 3:** README: 기능, 스크린샷 자리, 설정 표(Global Constraints의 키·기본값), `junction.bitbucket.servers` 예시(SSH 별칭, 팀 공유용 `.vscode/settings.json`), 알려진 제한(PR은 브라우저에서, squash merge는 merged 표시 안 됨).
- [ ] **Step 4:** `npm run lint && npm run test:unit && npm run test:ext && npx vsce package --no-dependencies` → `.vsix` 생성 성공.
- [ ] **Step 5:** 수동 확인 목록을 README 하단 "Manual QA"에 체크리스트로: 회사 Bitbucket 저장소에서 PR 링크, 브랜치 300개 이상 저장소 체감 속도, 멀티 루트 워크스페이스.
- [ ] **Step 6:** Commit `feat: quick checkout, Korean localization, README and packaging`.
