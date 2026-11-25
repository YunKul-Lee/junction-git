# Junction for Git — 브랜치 사이드바 설계 (v0.1)

작성일: 2026-11-25
상태: 승인 대기

## 1. 목적과 배경

회사 비공개 저장소에서 무료로 쓸 수 있는, IntelliJ VCS 수준의 브랜치 조작을 VS Code에 제공한다.

- 기본 Source Control Graph는 조작이 약하고, Git Graph는 2021년 이후 업데이트가 없으며, GitLens는 비공개 저장소에서 핵심 기능이 유료(Pro)다.
- 첫 버전은 **브랜치 조작**에 집중한다.

### 대상 사용 흐름 (회사 실제 흐름)

1. develop에서 작업 브랜치(`feature/...` 등)를 딴다.
2. 작업 후 push한다.
3. **Bitbucket 웹**에서 PR을 만들어 develop에 merge한다. merge 방식은 **merge commit**이다.
4. merge 후 로컬 develop을 최신화하고, merge된 로컬 브랜치를 정리한다.

이 흐름에서 가장 잦은 일은 "브랜치 목록을 둘러보며 develop과 얼마나 다른지, 이미 합쳐졌는지 확인하기"다.

## 2. 목표 / 비목표 / 실패 조건

### 목표
- 늘 떠 있는 사이드바 트리에서 로컬/원격 브랜치를 한눈에 보고 조작한다.
- 각 브랜치가 기준 브랜치(develop)에 없는 커밋 목록을 트리에서 바로 보고, 커밋 → 파일 → diff로 들어간다.
- merge된 브랜치를 정확히 표시하고 한 번에 정리한다.
- 버튼 하나로 Bitbucket PR 생성 화면을 브라우저에서 연다.
- 위험 조작에는 확인 창을 띄운다.

### 비목표 (v0.1에서 하지 않음)
- IDE 안에서 PR 생성/목록/리뷰 (Bitbucket API 연동, 로그인)
- 커밋 그래프 뷰, 커밋 작성/스테이징 UI (기본 Source Control 사용)
- 자체 diff·merge·blame 화면 (VS Code 기본 기능 사용)
- GitHub/GitLab PR 링크 (구조만 확장 가능하게)

### 실패 조건 (기능이 돌아가도 실패로 본다)
- 트리 상태가 Source Control 화면이나 실제 git 상태와 어긋난다.
- 큰 저장소(브랜치 수백 개)에서 트리를 여는 데 수 초 이상 걸리거나 VS Code가 버벅인다.
- 확인 없이 커밋이나 브랜치를 잃을 수 있는 조작이 실행된다.
- 사용자의 git 설정/인증(SSH, credential helper)과 다르게 동작한다.

## 3. 제약

- 라이선스 MIT. Git Graph(mhutchie) 코드는 보지도 복사하지도 않는다. 참고 가능: GitLG(phil294/GitLG), GitHub Pull Requests 확장(MIT).
- 확장 ID `<게시자명>.junction`, 커맨드 접두어 `junction.*`, 설정 접두어 `junction.*`.
- TypeScript, VS Code Extension API. `extensionDependencies: ["vscode.git"]`.
- git 2.30 이상을 가정한다 (최신 기능은 있으면 쓰고 없으면 대체 경로).

## 4. 검토한 방식 (Approaches)

| 방식 | 내용 | 장단점 |
|---|---|---|
| 1. 내장 Git API만 | `vscode.git` 확장 API만 사용 | 저장소 탐지·상태 이벤트·인증은 공짜. 하지만 범위 로그, 일괄 ahead/behind, `--merged`, 원격 브랜치 삭제 등이 없거나 약함 |
| 2. git CLI만 | 모든 것을 직접 `git` 실행 | 기능 제약 없음. 저장소 탐지·변경 감지·멀티 루트를 직접 구현해야 하고 Source Control과 상태가 어긋날 위험 |
| **3. 혼합 (선택)** | 저장소 목록·상태 이벤트·git 경로는 내장 API, 조회/조작은 git CLI | 핵심 기능(비교, merge 판정)을 제대로 하면서 상태 동기화는 내장 API에 맡김 |

**선택: 3번** (사용자 결정). 이유: 핵심인 커밋 비교·ahead/behind·merge 판정은 CLI로만 제대로 되고, 상태 어긋남(실패 조건 1번)은 내장 API 이벤트로 막는다.

UI는 VS Code 기본 **TreeView**를 쓴다 (사용자 결정: 늘 떠 있는 사이드바 트리). 웹뷰는 쓰지 않는다.

## 5. 설계

### 5.1 구조

```
src/
  extension.ts          활성화, 의존성 연결
  git/
    gitApi.ts           vscode.git API 래퍼: 저장소 목록, onDidChange, git 실행 파일 경로
    gitCli.ts           git 실행 (child_process.execFile, cwd=저장소 루트), 취소/타임아웃, 출력 채널 로그
    queries.ts          브랜치 목록, ahead/behind, merged, 범위 로그, 변경 파일 — 파싱 포함
    operations.ts       checkout, branch, merge, rebase, rename, delete, push, pull, fetch
  model/
    branchModel.ts      저장소별 브랜치 상태 캐시 + 갱신 스케줄링
  views/
    branchTree.ts       TreeDataProvider
    nodes.ts            노드 타입
  pr/
    bitbucketUrl.ts     원격 URL → Bitbucket 웹 주소 추측, PR 생성 URL 생성 (순수 함수)
  commands/             커맨드 등록, 확인 창
```

파싱과 URL 생성은 VS Code에 의존하지 않는 순수 함수로 두어 단위 테스트한다.

### 5.2 화면 위치

- 액티비티 바에 **Junction** 컨테이너를 따로 두고, 그 안에 **Branches** 뷰를 둔다. *(내 결정: 나중에 로그/그래프 뷰를 같은 컨테이너에 추가하기 위함. 사용자가 원하면 Source Control 컨테이너 안으로 옮기는 건 `package.json` 한 줄 변경)*
- 뷰 제목줄 버튼: 필터(🔍), 동기화(⟳ fetch+develop 최신화), 새로고침, merge된 브랜치 정리, 더보기(…) 메뉴.

### 5.3 트리 구조

```
JUNCTION: BRANCHES                         🔍 ⟳ 🧹
▾ my-repo                                    (저장소가 2개 이상일 때만 표시)
  ▾ 로컬
     ● feature/login        ↑2  ⇡1           현재 브랜치(굵게/아이콘), ↑=develop에 없는 커밋 수, ⇡=push 안 된 커밋 수
       develop              ⇣5               기준 브랜치: 원격 대비 뒤처진 수만 표시
     ▾ feature/
         payment            ✓ merged
         search             ↑7
  ▾ 원격: origin
     ▸ feature/
       develop
```

- `/`가 들어간 이름은 폴더로 묶는다 (설정으로 끌 수 있음).
- **로컬 정렬:** 최근 checkout 순 (`git reflog` HEAD의 `checkout: moving from X to Y` 기록에서 추출, 없으면 마지막 커밋 시간). **원격 정렬:** 마지막 커밋 시간. 설정으로 이름순 선택 가능. *(내 결정)*
- 설명(description) 표시 규칙 *(내 결정)*:
  - `↑n`: 기준 브랜치(`origin/develop` 우선, 없으면 로컬 develop)에 없는 커밋 수.
  - `⇡n` / `⇣n`: 추적 중인 원격 브랜치 대비 push 안 된 / 받지 않은 커밋 수. 0이면 생략.
  - `✓ merged`: 기준 브랜치에 이미 들어간 브랜치. merge commit 방식이므로 `git branch --merged <기준>`으로 판정한다.
  - 추적 브랜치가 원격에서 지워진 경우 `(원격 삭제됨)`을 흐리게 표시.
- 툴팁: 마지막 커밋 메시지·작성자·시간, 추적 브랜치, ahead/behind 상세.
- 원격 브랜치 노드는 원격별로 나눈다. 로컬에 같은 이름이 이미 있는 원격 브랜치도 그대로 보여준다.

### 5.4 비교 (브랜치 펼치기)

```
▾ feature/search            ↑7
   ◇ develop 대비 전체 변경 (12 files)     ← 펼치면 파일 목록, 클릭 → merge-base ↔ 브랜치 끝 diff
   ▾ a1b2c3  검색 API 연결       2시간 전
       src/api/search.ts      M            ← 클릭 → 부모 커밋 ↔ 이 커밋 diff
       src/ui/SearchBox.tsx   A
   ▸ d4e5f6  검색창 UI
   … 더 보기 (50개 이후)
```

- 커밋 목록: `git log <기준>..<브랜치>`, 최신순, 기본 50개 + "더 보기".
- 변경 파일: `git diff-tree --no-commit-id -r --name-status -M <커밋>` (첫 커밋/merge 커밋 처리 포함: merge 커밋은 첫 번째 부모 기준).
- 전체 변경: `git merge-base <기준> <브랜치>` 후 `git diff --name-status -M <base> <브랜치>`.
- diff 열기: `vscode.diff`에 내장 Git API의 `toGitUri(uri, ref)`로 만든 URI 두 개. 추가/삭제 파일은 한쪽을 빈 문서로.
- 커밋 우클릭: 해시 복사, 메시지 복사. *(cherry-pick 등은 v0.1 범위 밖)*
- 기준 브랜치가 아닌 다른 브랜치와 비교: 브랜치 우클릭 **"현재 브랜치와 비교"** → 트리 최상단에 임시 비교 노드 `비교: feature/search ↔ feature/login` 생성. 그 아래 "한쪽에만 있는 커밋"을 양쪽 그룹으로 표시 (`git log A..B`, `B..A`), 닫기 버튼으로 제거.
- 기준 브랜치 자체를 펼치면 원격 대비 받지 않은 커밋(`develop..origin/develop`)을 보여준다.

### 5.5 조작 (브랜치 우클릭 메뉴)

| 조작 | 동작 | 확인 창 |
|---|---|---|
| Checkout | 로컬: `git switch`. 원격: 같은 이름 로컬이 없으면 `git switch --track`, 있으면 그 로컬로 전환 | 미커밋 변경이 있으면: **Stash 후 전환 / 그대로 시도 / 취소** |
| 여기서 새 브랜치 | 이름 입력 → `git switch -c <이름> <선택 브랜치>`. 기준 브랜치 선택 시 원격 기준(`origin/develop`)에서 따는 걸 기본값으로 | — |
| 현재 브랜치에 merge | `git merge <선택>` | 실행 전 요약 확인 |
| 현재 브랜치를 이 브랜치 위로 rebase | `git rebase <선택>` | 실행 전 확인 (현재 브랜치가 이미 push된 경우 "나중에 force push 필요" 경고) |
| 현재 브랜치와 비교 | 5.4 참조 | — |
| 이름 변경 | `git branch -m`. 추적 원격이 있으면 원격 이름은 바꾸지 않는다고 안내 | — |
| 삭제 (로컬) | `git branch -d`; 실패(미병합)하면 | **미병합 커밋 n개가 사라짐** → `-D` 확인 |
| 삭제 (원격) | `git push <원격> --delete <브랜치>` | 항상 확인 |
| Push | 추적 없으면 `git push -u <원격> <브랜치>`. 거부(non-fast-forward)되면 force 제안 | force는 **`--force-with-lease`만**, 항상 확인 |
| Pull | 현재 브랜치: `git pull` (사용자 git 설정 따름). 다른 브랜치: fast-forward 가능하면 `git fetch <원격> <원격브랜치>:<로컬>` | — |
| Fetch | `git fetch --all --prune` | — |
| PR 만들기 | 5.7 참조 | push 안 된 경우 push 여부 |
| PR 만들기 (대상 선택…) | 대상 브랜치 QuickPick 후 동일 | 동일 |

- **동기화 버튼(⟳):** `git fetch --all --prune` → 로컬 기준 브랜치 fast-forward (현재 브랜치면 `git merge --ff-only`, 아니면 `git fetch origin develop:develop`). fast-forward 불가하면 알림만.
- **merge된 브랜치 정리(🧹):** `✓ merged`인 로컬 브랜치를 다중 선택 QuickPick(기본 전체 선택, 현재·기준 브랜치 제외) → `git branch -d`. 원격 브랜치는 건드리지 않는다 (Bitbucket PR merge 시 삭제되는 경우가 많고, 위험도가 다름).
- **merge/rebase 충돌:** 알림으로 알리고 "충돌 파일 열기"(기본 merge editor), "Rebase 계속/중단", "Merge 중단" 버튼 제공. rebase 진행 중에는 트리 상단에 상태 노드 `⚠ Rebase 진행 중 (3/7) — 계속 | 중단` 표시.
- 모든 조작은 `withProgress`로 진행 표시, 실패 시 git stderr 요약을 알림으로 + 전체를 출력 채널 "Junction"에 남긴다.

### 5.6 검색/필터

- 🔍 버튼 → 입력창에 문자열 입력 → 이름에 포함된 브랜치만 보이게 필터 (대소문자 무시). 필터 중에는 뷰 메시지(`TreeView.message`)로 `필터: "pay" — 지우기` 표시.
- TreeView 기본 타이핑 찾기도 그대로 동작.
- 빠른 실행용 커맨드 `junction.checkoutBranch`: 전체 브랜치 QuickPick (최근 순) → checkout. *(내 결정: 사이드바를 열지 않고도 전환할 수 있게)*

### 5.7 Bitbucket PR 생성 화면 열기

원격 URL(기준 브랜치의 원격, 기본 `origin`)에서 웹 주소를 추측한다.

| 원격 URL 형태 | 판정 | PR 생성 URL |
|---|---|---|
| `git@bitbucket.org:<ws>/<repo>.git`, `https://[user@]bitbucket.org/<ws>/<repo>.git` | Cloud | `https://bitbucket.org/<ws>/<repo>/pull-requests/new?source=<src>&dest=<dst>` |
| `ssh://git@<host>[:7999]/<PROJ>/<repo>.git` | Data Center | `https://<host>/projects/<PROJ>/repos/<repo>/pull-requests?create&sourceBranch=refs/heads/<src>&targetBranch=refs/heads/<dst>` |
| `https://<host>[/<ctx>]/scm/<proj>/<repo>.git` | Data Center | `https://<host>[/<ctx>]/projects/<PROJ>/repos/<repo>/pull-requests?create&...` (프로젝트 키는 대문자) |
| `.../~<user>/<repo>.git` (개인 저장소) | Data Center | `.../users/<user>/repos/<repo>/pull-requests?create&...` |

- 브랜치 이름은 URL 인코딩.
- **주소는 설정 `junction.bitbucket.servers`에서만 관리한다** (사용자 결정). 확장 내부 저장소(`globalState` 등)에 주소를 저장하지 않는다.
  - 항목 형식: `{ "gitHost": "git-ssh.company.com", "webUrl": "https://bitbucket.company.com", "type": "datacenter" | "cloud" }`. SSH 별칭·호스트 분리·컨텍스트 경로 대응.
  - 결정 순서: 설정에 해당 `gitHost` 항목이 있으면 사용 → 없으면 자동 추측.
  - **설정에 항목이 있으면 첫 사용이라도 확인 창 없이 바로 PR 화면을 연다** (사용자 결정). 확인 창은 항목이 없을 때만 뜬다.
- **처음 한 번:** 설정에 항목이 없으면 추측한 웹 주소를 입력창에 미리 채워 확인/수정받고, 확정값을 **사용자(Global) 설정**의 `junction.bitbucket.servers`에 추가한다 (같은 서버의 다른 저장소에도 재사용). 이후엔 바로 연다.
- 팀 공유: 저장소 `.vscode/settings.json`에 적어 커밋하면 VS Code 설정 우선순위에 따라 사용자 설정보다 우선한다.
- **주소 변경:** 설정 파일을 고친다. 커맨드 `junction.bitbucket.changeWebUrl` ("Junction: Bitbucket 웹 주소 변경")은 settings.json의 해당 항목을 열어주기만 한다.
- PR 화면을 연 직후 알림에 "주소가 틀렸나요? 설정 열기" 버튼을 표시한다 (서버별 처음 3회까지, 표시 횟수만 `globalState`에 기록). *(내 결정)*
- 브랜치가 원격에 없거나 push 안 된 커밋이 있으면 "먼저 push할까요?" → push 후 연다.
- `vscode.env.openExternal`로 연다.
- Bitbucket이 아닌 원격(GitHub 등)은 v0.1에서 메뉴를 숨긴다. 내부 인터페이스(`PrUrlProvider`)는 나중 확장 가능하게.

### 5.8 갱신과 성능

- 내장 Git API의 `repository.state.onDidChange` + 창 포커스 복귀 시 갱신. 300ms 디바운스, 진행 중 갱신은 취소하고 다시.
- 브랜치 목록 한 번에: `git for-each-ref --format=... refs/heads refs/remotes` (이름, 해시, 추적, 추적 ahead/behind `%(upstream:track)`, 커밋 시간, 제목).
- 기준 대비 `↑n`: git 2.41+면 `for-each-ref`의 `%(ahead-behind:<기준>)` 한 번으로, 아니면 `git rev-list --count <기준>..<브랜치>`를 동시 실행 수 제한(예: 8)으로. 로컬 브랜치만 계산, 원격 브랜치는 펼칠 때 계산.
- `--merged`는 한 번 실행해 집합으로 사용.
- 자식 노드(커밋, 파일)는 펼칠 때 지연 로드.
- 목표: 브랜치 300개 저장소에서 첫 표시 1초 이내.

### 5.9 설정

| 키 | 기본값 | 설명 |
|---|---|---|
| `junction.baseBranch` | `""` (자동) | 비어 있으면 develop → main → master 순으로 찾음 |
| `junction.branchSort` | `"recent"` | `recent` / `name` |
| `junction.groupByFolder` | `true` | `/` 기준 폴더 묶기 |
| `junction.commitLimit` | `50` | 한 번에 보여줄 커밋 수 |
| `junction.bitbucket.servers` | `[]` | 5.7 참조 |
| `junction.confirmMerge` | `true` | merge/rebase 실행 전 확인 |

### 5.10 테스트

- **단위:** git 출력 파서, Bitbucket URL 추측/생성 (위 표의 모든 형태 + 별칭·포트·컨텍스트 경로·특수문자 브랜치), 폴더 그룹핑, 정렬.
- **통합:** `@vscode/test-electron` + 임시 git 저장소(로컬 bare 원격 포함)를 스크립트로 만들어 checkout/삭제/merge 판정/push·fetch 시나리오 확인.
- 수동 확인 목록: 회사 Bitbucket 저장소에서 PR 링크가 맞게 열리는지.

## 6. 구현자에게 맡기는 것

- 아이콘 선택, 노드 정렬의 세부 동률 처리, 메시지 문구 다듬기.
- 다국어: v0.1은 UI 문자열을 `vscode.l10n`으로 감싸 **영어 기본 + 한국어** 번들을 제공 (마켓 공개 대비). *(내 결정)*
- 최소 VS Code 버전은 사용하는 API 기준으로 정하되 1.90 이상.
- 번들러(esbuild), 린트, CI 구성.

## 7. 아직 정해지지 않은 것

- 게시자(publisher) 이름 — 마켓 게시 전까지만 필요.
