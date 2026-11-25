# PR Providers (GitHub, GitLab, none) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 생성 화면 열기를 Bitbucket 전용에서 GitHub·GitLab·"PR 없음"까지 확장하고, 설정 이름을 `junction.pullRequest.servers`로 일반화한다.

**Architecture:** `src/pr/bitbucket.ts`를 서비스 중립 모듈 `src/pr/providers.ts`로 바꾼다 (순수 함수: 원격 파싱, 서버 찾기/추측, 종류별 PR 주소, 메뉴 표시 판단). `src/flows/prFlow.ts`의 첫 사용 흐름을 "종류 선택 → (none이 아니면) 주소 입력"으로 바꾸고, vscode 계층의 설정·컨텍스트 키·커맨드 이름을 바꾼다.

**Tech Stack:** 기존과 동일 (TypeScript, VS Code API ^1.90, vitest, @vscode/test-cli).

**Spec:** `docs/superpowers/specs/2026-11-25-pr-providers-design.md` (선행: `docs/superpowers/specs/2026-11-25-branch-sidebar-design.md` 5.7)

## Global Constraints

- `src/pr`, `src/flows`는 `vscode`를 import하지 않는다.
- 설정 키 `junction.pullRequest.servers` (기본 `[]`), 항목 `{ gitHost: string; webUrl?: string; type: 'bitbucket-cloud' | 'bitbucket-datacenter' | 'github' | 'gitlab' | 'none' }`. 이전 키 `junction.bitbucket.servers`는 완전히 제거 (호환 없음).
- 커맨드 `junction.pullRequest.changeWebUrl`, 컨텍스트 키 `junction.hasPullRequest`. 이전 이름은 제거.
- 주소는 설정에서만 관리; 설정 일치 시 확인 없이 열기; 저장은 Global; 조회는 workspaceFolder → workspace → global 합침 후 첫 일치 (v0.1 규칙 유지).
- 메뉴 이름은 모든 서비스에서 "Create Pull Request".
- flows 메시지는 인라인 `{ key: 'English', args }`; 새 문구는 `l10n/bundle.l10n.ko.json`에 추가 (l10n 테스트가 강제).
- `npm run lint`(typecheck 포함), `npm run test:unit`, `npm run test:ext` 모두 통과.

## Review Focus

1. **GitLab 하위 그룹과 컨텍스트 경로** (`https://gitlab.company.com/gitlab/group/sub/project.git` + webUrl `https://gitlab.company.com/gitlab`): 경로 `group/sub/project`. → Task 1 테스트.
2. **`/`·`#`·한글이 든 브랜치 이름**이 GitHub compare 경로와 GitLab 쿼리에서 올바로 인코딩. → Task 1 테스트.
3. **`none` 서버**: 메뉴 숨김, 커맨드 팔레트/다른 경로로 실행돼도 안내 후 종료(브라우저 열지 않음). → Task 1, Task 2 테스트.
4. **공개 호스트**(github.com 등)는 설정 없이 확인 창·저장 없이 바로 열림, "주소가 틀렸나요?" 알림 없음. → Task 2 테스트.
5. **워크스페이스 설정에 `none`, 사용자 설정에 같은 호스트의 다른 값**: 워크스페이스 값이 이긴다 (첫 일치). → Task 1 테스트.

---

## File Structure

```
src/pr/providers.ts          (bitbucket.ts 대체) 타입, parseRemote, findServer, guessPublic, guessDataCenter, buildPrUrl, prAvailable, serversFromScopes
src/flows/prFlow.ts          첫 사용 흐름 변경
src/vscode/prContext.ts      (bitbucketContext.ts 대체) junction.hasPullRequest
src/vscode/settings.ts       pullRequestServers, saveServer, openServersSettings
src/commands/register.ts, src/extension.ts, package.json, package.nls*.json, l10n/bundle.l10n.ko.json, README.md, CHANGELOG.md
test/unit/providers.test.ts  (bitbucket.test.ts 대체)
test/integration/prFlow.test.ts
```

---

### Task 1: 서비스 중립 PR 주소 모듈

**Files:**
- Create: `src/pr/providers.ts`, `test/unit/providers.test.ts`
- Delete: `src/pr/bitbucket.ts`, `test/unit/bitbucket.test.ts` (기존 테스트 케이스는 새 파일로 옮기고 type 이름만 바꾼다)
- Modify: import하는 모든 파일 (`src/flows/prFlow.ts`, `src/vscode/settings.ts`, `src/vscode/bitbucketContext.ts`) — 이 태스크에서는 import 경로·타입 이름만 맞춰 빌드가 깨지지 않게 한다 (동작 변경은 Task 2).

**Interfaces:**
- Produces:
  ```ts
  export type ServerType = 'bitbucket-cloud' | 'bitbucket-datacenter' | 'github' | 'gitlab' | 'none';
  export interface PrServer { gitHost: string; webUrl?: string; type: ServerType }
  export interface ParsedRemote { host: string; segments: string[]; port?: number; scheme?: 'http' | 'https' | 'ssh' | 'scp' }
  export function parseRemote(url: string): ParsedRemote | undefined
  export function findServer(remoteUrl: string, configured: PrServer[]): PrServer | undefined
  export function guessPublic(remoteUrl: string): PrServer | undefined      // github.com / gitlab.com / bitbucket.org only
  export function guessDataCenter(remoteUrl: string): PrServer | undefined  // v0.1 guessServer 규칙의 datacenter 부분
  export function buildPrUrl(server: PrServer, remoteUrl: string, source: string, target: string): string | undefined
  export function prAvailable(remoteUrl: string, configured: PrServer[]): boolean
  export function serversFromScopes(inspected: { workspaceFolderValue?: PrServer[]; workspaceValue?: PrServer[]; globalValue?: PrServer[] } | undefined): PrServer[]
  ```

**결정 사항:**
- `parseRemote`는 v0.1 동작 유지 + `scheme` 필드 추가 (`ssh://` → `ssh`, scp형 → `scp`).
- `guessPublic`: `github.com` → `{type:'github', webUrl:'https://github.com'}`, `gitlab.com` → `{type:'gitlab', webUrl:'https://gitlab.com'}`, `bitbucket.org` → `{type:'bitbucket-cloud', webUrl:'https://bitbucket.org'}`; 그 외 `undefined`.
- `guessDataCenter`: v0.1 `guessServer`의 datacenter 규칙 그대로 (`scm` 조각 또는 포트 7999 → `type:'bitbucket-datacenter'`, webUrl = `https://<host>` + `scm` 앞 조각).
- 저장소 경로 `repoPath(server, parsed)`: `parsed.scheme`가 http/https이고 `server.webUrl`의 경로 조각들이 `parsed.segments`의 앞부분과 같으면 그 조각을 뺀다.
- `buildPrUrl`:
  - `none` 또는 `webUrl` 없음 → `undefined`.
  - `github`: 경로 조각 2개 미만이면 `undefined`; owner/repo = 마지막 두 조각; `${base}/${owner}/${repo}/compare/${gh(target)}...${gh(source)}?expand=1`, `gh(s) = encodeURIComponent(s).replace(/%2F/g, '/')`.
  - `gitlab`: 경로 조각 2개 미만이면 `undefined`; `${base}/${path.join('/')}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(source)}&merge_request%5Btarget_branch%5D=${enc(target)}`.
  - `bitbucket-cloud` / `bitbucket-datacenter`: v0.1 `cloud` / `datacenter` 규칙과 같은 결과.
- `prAvailable`: 설정 일치 항목이 있으면 `type !== 'none'`; 없으면 `parseRemote` 성공 && `host.length >= 2` (로컬·Windows 경로 제외).

- [ ] **Step 1: 실패 테스트 작성** — `test/unit/providers.test.ts`:
  - v0.1 bitbucket 테스트 전부 (type 이름만 `bitbucket-cloud`/`bitbucket-datacenter`)
  - github.com: `git@github.com:acme/web.git`, `feature/한글#1` → `https://github.com/acme/web/compare/develop...feature/%ED%95%9C%EA%B8%80%231?expand=1`
  - GitHub Enterprise configured `{gitHost:'github.acme.com', webUrl:'https://github.acme.com', type:'github'}`, `https://github.acme.com/acme/web.git` → `https://github.acme.com/acme/web/compare/develop...feature/x?expand=1`
  - gitlab.com 하위 그룹: `git@gitlab.com:acme/team/sub/web.git` → `https://gitlab.com/acme/team/sub/web/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx&merge_request%5Btarget_branch%5D=develop`
  - 사내 GitLab 컨텍스트 경로: server webUrl `https://gitlab.acme.com/gitlab`, remote `https://gitlab.acme.com/gitlab/acme/web.git` → `https://gitlab.acme.com/gitlab/acme/web/-/merge_requests/new?...`; 같은 서버의 ssh remote `git@gitlab.acme.com:acme/web.git` → 같은 주소
  - `none` → `buildPrUrl` undefined, `prAvailable` false
  - `prAvailable`: github.com true, 알 수 없는 호스트 true, `file:///x`·`C:\\x` false, 설정 none false
  - `guessPublic`: 세 호스트 + 그 외 undefined; `guessDataCenter`: `/scm/` https, 7999 ssh, 그 외 undefined
  - `serversFromScopes` + `findServer`: workspace `[{gitHost:'h', type:'none'}]`, global `[{gitHost:'h', webUrl:'https://h', type:'github'}]` → `findServer` 결과 type `none`
- [ ] **Step 2:** `npx vitest run test/unit/providers.test.ts` → FAIL (모듈 없음).
- [ ] **Step 3:** `src/pr/providers.ts` 구현, `bitbucket.ts`·`bitbucket.test.ts` 삭제, import 정리 (prFlow는 `guessServer` 대신 `guessPublic ?? guessDataCenter`를 임시로 사용해 기존 동작 유지).
- [ ] **Step 4:** `npm run lint && npm run test:unit` PASS.
- [ ] **Step 5:** Commit `refactor(pr): provider-neutral PR URL module with GitHub and GitLab`.

---

### Task 2: 첫 사용 흐름, 설정·컨텍스트·커맨드 이름 변경

**Files:**
- Modify: `src/flows/prFlow.ts`, `src/vscode/settings.ts`, `src/vscode/bitbucketContext.ts` → rename `src/vscode/prContext.ts`, `src/commands/register.ts`, `src/extension.ts`, `package.json`, `test/integration/prFlow.test.ts`

**Interfaces:**
- Consumes: Task 1 전체
- Produces: `PrEnv.servers(): PrServer[]`, `PrEnv.saveServer(s: PrServer)`; `readSettings().pullRequestServers: PrServer[]`; `updateHasPullRequestContext(tree)`.

**결정 사항 (spec 4.3, 4.4):**
- 서버 결정 순서: `findServer(url, env.servers())` → 없으면 `guessPublic(url)` (확인·저장 없이 사용) → 없으면 종류 선택.
- 설정 일치 항목이 `none`이면 info `{ key: 'Pull requests are turned off for {0}.', args: [host] }` + 버튼 `Open Settings`, 결과 `'cancelled'`, 브라우저 열지 않음.
- 종류 선택 `ui.pick` 제목 `{ key: 'What kind of server is {0}?', args: [host] }`, 항목 순서: Bitbucket Data Center, Bitbucket Cloud, GitHub, GitLab, `No pull requests on this server` (label은 l10n 키로 처리 — 고정 서비스 이름 4개는 번역하지 않고 마지막 항목만 l10n). `guessDataCenter`가 맞으면 Bitbucket Data Center를 첫 항목으로 (이미 첫 항목), 아니면 같은 순서.
- `none` 선택 → `saveServer({ gitHost: host, type: 'none' })`, info `{ key: 'Pull requests are turned off for {0}. You can change this in settings.', args: [host] }`, `'cancelled'`.
- 그 외 → 주소 입력 `{ key: 'Web address for {0}', args: [host] }`, 기본값 = `guessDataCenter(url)?.webUrl` (종류가 bitbucket-datacenter일 때) 또는 `https://<host>`, 기존 검사/끝 `/` 제거 유지 → `saveServer` → 진행.
- 기존 키 `'Bitbucket web URL for {0}'`, `'Bitbucket server type'`은 제거 (번역 파일에서도).
- "Wrong address?" 알림: 설정에서 찾았거나 이번에 저장한 서버일 때만 (공개 호스트 추측이면 띄우지 않음).
- 설정 키 rename: `package.json` contributes.configuration `junction.pullRequest.servers` (items schema의 `type` enum 5개, `webUrl` 선택), description `%junction.config.pullRequestServers%`; settings.ts는 `pullRequest.servers`로 inspect/update.
- 컨텍스트: `src/vscode/prContext.ts`의 `updateHasPullRequestContext`가 `prAvailable` 사용, `setContext('junction.hasPullRequest', …)`; package.json 메뉴 `when`과 extension.ts의 `affectsConfiguration('junction.pullRequest.servers')` 수정.
- 커맨드 rename `junction.pullRequest.changeWebUrl` (title `%…%` 키도 rename), 설정 화면은 `junction.pullRequest.servers`로 연다.

- [ ] **Step 1: 실패 테스트** — `test/integration/prFlow.test.ts` 수정·추가 (기존 가짜 URL 패턴 사용):
  - github.com 원격, 설정 없음 → `ui.calls`에 input/pick 없음, `saveServer` 0회, open URL = GitHub compare 주소, info(Wrong address) 없음
  - 알 수 없는 호스트 `git@git.acme.com:PROJ/web.git` → pick 제목 key `'What kind of server is {0}?'`; GitLab 선택 → input 기본값 `https://git.acme.com` → 저장값 `{gitHost:'git.acme.com', webUrl:'https://git.acme.com', type:'gitlab'}` → GitLab MR 주소 open
  - 같은 호스트에서 `none` 선택 → `saveServer({gitHost:'git.acme.com', type:'none'})`, open 0회, `'cancelled'`
  - 설정 `{gitHost:'git.acme.com', type:'none'}` → pick/input 없음, info key `'Pull requests are turned off for {0}.'`, open 0회
  - 기존 Data Center 시나리오(`ssh://git@git.acme.com:7999/PROJ/web.git`) → pick에서 Data Center 선택 → input 기본값 `https://git.acme.com` → 기존 URL
  - pick 취소 → `'cancelled'`, 저장 0회
- [ ] **Step 2:** `npx vitest run test/integration/prFlow.test.ts` → FAIL.
- [ ] **Step 3:** 구현 (prFlow, settings, prContext, register, extension, package.json).
- [ ] **Step 4:** `npm run build && npm run lint && npm run test:unit && npm run test:ext` PASS (l10n 테스트가 새 키 누락으로 실패하면 이 태스크에서 Korean 번역을 함께 추가해도 된다).
- [ ] **Step 5:** Commit `feat(pr): GitHub, GitLab and no-PR servers in the first-use flow`.

---

### Task 3: 번역·문서

**Files:**
- Modify: `l10n/bundle.l10n.ko.json`, `package.nls.json`, `package.nls.ko.json`, `README.md`, `CHANGELOG.md`, `package.json` (version `0.2.0`)

**결정 사항:**
- 한국어: `'What kind of server is {0}?'` → `'{0}은(는) 어떤 서버인가요?'`, `'No pull requests on this server'` → `'이 서버는 PR 기능이 없음'`, `'Web address for {0}'` → `'{0}의 웹 주소'`, `'Pull requests are turned off for {0}.'` → `'{0}에서는 PR 기능을 사용하지 않습니다.'`, `'Pull requests are turned off for {0}. You can change this in settings.'` → `'{0}에서는 PR 기능을 사용하지 않습니다. 설정에서 바꿀 수 있습니다.'`.
- README: 설정 표의 키 변경, `junction.pullRequest.servers` 예시(spec 4.1 그대로), 서비스별 동작 (공개 호스트는 바로 열림 / 사내 서버는 처음 한 번 종류 선택 / `none`이면 메뉴 숨김), Known limitations에 "fork에서 원본으로 보내는 PR은 지원하지 않음", Manual QA에 GitHub·GitLab 클릭 확인 추가. v0.1 문구의 "Bitbucket 전용" 표현 정리.
- CHANGELOG `0.2.0`: Added GitHub/GitLab, `none`; Changed setting `junction.bitbucket.servers` → `junction.pullRequest.servers` (breaking, pre-release).

- [ ] **Step 1:** `npx vitest run test/unit/l10n.test.ts` — Task 2에서 번역을 넣지 않았다면 FAIL 확인.
- [ ] **Step 2:** 번역·nls·README·CHANGELOG·version 수정.
- [ ] **Step 3:** `npm run build && npm run lint && npm run test:unit && npm run test:ext && npx vsce package --no-dependencies` PASS.
- [ ] **Step 4:** Commit `docs: GitHub/GitLab PR support, Korean strings, v0.2.0`.
