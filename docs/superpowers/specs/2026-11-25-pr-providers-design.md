# Junction for Git — PR 서비스 확장 설계 (v0.2)

작성일: 2026-11-25
상태: 승인됨
선행 문서: `2026-11-25-branch-sidebar-design.md` (5.7 Bitbucket PR 생성 화면 열기)

## 1. 목적

v0.1의 PR 생성 화면 열기는 Bitbucket 전용이고, 설정 이름도 `junction.bitbucket.servers`다. 마켓 공개를 앞두고 다음을 지원한다.

- GitHub(github.com, GitHub Enterprise)와 GitLab(gitlab.com, 사내 GitLab)의 PR/MR 생성 화면 열기.
- PR 기능이 없는 서버(git만 설치한 사내 서버, Gerrit 등)에서는 PR 메뉴를 숨길 수 있게 한다. v0.1은 알 수 없는 호스트에 모두 메뉴를 보여주고 Bitbucket 주소를 묻는다.

v0.1은 아직 마켓에 게시하지 않았으므로 이전 설정 이름 호환(마이그레이션)은 하지 않는다.

## 2. 목표 / 비목표

### 목표
- 설정 이름을 `junction.pullRequest.servers`로 바꾸고, `type`은 `bitbucket-cloud` | `bitbucket-datacenter` | `github` | `gitlab` | `none` 중 하나로 한다.
- 서비스별 PR 생성 주소를 만든다 (아래 4.2).
- github.com, gitlab.com, bitbucket.org는 설정 없이 바로 연다 (확인 창 없음, 저장 없음).
- 그 외 호스트는 처음 한 번 서버 종류를 고르게 하고 (PR 기능 없음 포함), 종류가 `none`이 아니면 웹 주소를 확인받아 사용자 설정에 저장한다.
- `type: "none"`인 서버의 저장소에서는 PR 메뉴를 숨긴다.

### 비목표
- fork → 원본 저장소 PR (출발/대상 저장소가 다른 경우)
- Azure DevOps, Gitea, Forgejo 등 다른 서비스
- API 연동, IDE 안 PR 생성/리뷰
- GitLab 저장소에서 메뉴 이름을 "Merge Request"로 바꾸기 (모두 "Create Pull Request"로 통일 — 사용자 결정)

## 3. 검토한 방식

| 방식 | 내용 | 판단 |
|---|---|---|
| **1. 서비스 종류별 주소 생성 (선택)** | `type`마다 정해진 주소 규칙으로 생성 | 설정이 단순(종류·주소만), 테스트가 쉬움 |
| 2. 사용자가 주소 템플릿 작성 | GitLens Custom처럼 `${owner}` 등 템플릿을 설정에 적음 | 유연하지만 팀원에게 설명이 필요 — v0.1 설계 때 이미 제외 |

사용자가 1번 방향을 승인했다.

## 4. 설계

### 4.1 설정

```json
"junction.pullRequest.servers": [
  { "gitHost": "git.company.com", "webUrl": "https://bitbucket.company.com", "type": "bitbucket-datacenter" },
  { "gitHost": "github.company.com", "webUrl": "https://github.company.com", "type": "github" },
  { "gitHost": "gitlab.company.com", "webUrl": "https://gitlab.company.com/gitlab", "type": "gitlab" },
  { "gitHost": "git-only.company.com", "type": "none" }
]
```

- `webUrl`은 `type`이 `none`일 때 생략 가능.
- v0.1의 규칙 유지: 설정에서만 관리, 일치 항목이 있으면 확인 없이 열기, 저장은 사용자(Global) 설정, 조회는 폴더 → 작업 공간 → 사용자 순으로 합쳐서 첫 일치.
- 커맨드 `junction.bitbucket.changeWebUrl` → `junction.pullRequest.changeWebUrl`, 컨텍스트 키 `junction.hasBitbucket` → `junction.hasPullRequest`.

### 4.2 PR 생성 주소

저장소 경로 = 원격 주소의 경로 조각들. http(s) 원격이고 경로가 `webUrl`의 경로(예: `/gitlab`)로 시작하면 그 부분을 뺀다.

| 종류 | 주소 |
|---|---|
| `github` | `{web}/{owner}/{repo}/compare/{대상}...{출발}?expand=1` — owner/repo = 마지막 두 조각. 브랜치 이름은 `encodeURIComponent` 후 `%2F`만 `/`로 되돌린다 (GitHub compare 경로가 `/` 포함 브랜치를 그대로 받음) |
| `gitlab` | `{web}/{전체 경로}/-/merge_requests/new?merge_request%5Bsource_branch%5D={출발}&merge_request%5Btarget_branch%5D={대상}` — 전체 경로 = 하위 그룹 포함 모든 조각. 브랜치는 `encodeURIComponent` |
| `bitbucket-cloud`, `bitbucket-datacenter` | v0.1과 동일 |

### 4.3 서버 결정과 첫 사용

1. 설정에서 `gitHost` 일치 항목을 찾는다 → 있으면 그대로 사용 (`none`이면 "PR 기능이 꺼진 서버" 안내 후 종료).
2. 없으면 공개 호스트 추측: `github.com` → github, `gitlab.com` → gitlab, `bitbucket.org` → bitbucket-cloud. 확인 창 없이 열고 저장하지 않는다.
3. 그 외에는 서버 종류 선택 창: Bitbucket Cloud / Bitbucket Data Center / GitHub / GitLab / PR 기능 없음. 기본 선택은 v0.1의 Data Center 추측 규칙(`/scm/` 경로 또는 7999 포트)에 맞으면 Bitbucket Data Center.
   - PR 기능 없음 → `{ gitHost, type: "none" }`을 사용자 설정에 저장하고 종료. 이후 메뉴가 숨겨진다.
   - 그 외 → 웹 주소 입력 (기본값 `https://<host>` 또는 Data Center 추측값, http(s) 검사, 끝 `/` 제거) → 저장 → 진행.
4. "주소가 틀렸나요?" 알림은 설정에 저장된 서버에만 띄운다 (공개 호스트는 띄우지 않음).

### 4.4 메뉴 표시

`junction.hasPullRequest` = 불러온 저장소 중 하나라도 "PR 가능" 원격이 있으면 true. PR 가능 = 원격 주소가 파싱되고, 로컬 경로가 아니며, 설정에서 `none`으로 지정되지 않음. (v0.1의 github.com/gitlab.com 제외 목록은 없앤다.)

## 5. 구현자에게 맡기는 것
- 메시지 문구, 선택 창 순서의 세부, 파일 이름 (`src/pr/bitbucket.ts` → `src/pr/providers.ts` 등).

## 6. 정해지지 않은 것
- 없음.
