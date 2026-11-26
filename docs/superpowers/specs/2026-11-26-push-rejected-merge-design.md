# Junction for Git — push 거부 시 Merge와 충돌 해결 설계 (v0.3)

작성일: 2026-11-26
상태: 승인됨
선행 문서: `2026-11-25-branch-sidebar-design.md` (5.5 브랜치 조작, merge/rebase 충돌)

## 1. 목적

원격 브랜치에 내 로컬에 없는 커밋이 있으면 push가 거부된다 (non-fast-forward). 지금 Junction은 이때 **force push (with lease)만** 제안한다. 같은 브랜치에 동료가 올린 커밋을 지우는 선택지밖에 없다.

IntelliJ처럼 다음을 할 수 있게 한다.

- push가 거부되면 원격 변경을 내 브랜치에 merge하고 다시 push한다.
- merge 중 충돌이 나면 충돌 파일 목록을 보여준다. 파일을 고르면 원격(Incoming)과 로컬(Current)을 나란히 놓고 다른 곳마다 어느 쪽을 받을지 고르는 화면(VS Code 기본 Merge Editor)을 연다.
- 충돌을 다 해결하면 merge를 마치고 push까지 이어서 한다.

회사 방식이 merge 커밋(squash 아님)이므로 rebase가 아니라 merge로 받는다.

## 2. 목표 / 비목표

### 목표
- push 거부 창에 "Merge 후 Push" 버튼 추가 (force push 버튼은 유지).
- 충돌 파일 목록 창 (QuickPick): 파일 선택 → Merge Editor, 남은 파일 다시 표시, 일괄 "모두 내 것으로 / 모두 원격 것으로".
- 충돌 해결 후 merge 완료 → push 제안.
- 기존 "충돌 파일 열기"(merge, rebase, 상태 노드, 충돌 알림)도 새 목록 창을 쓴다.

### 비목표
- 3-way 비교 화면을 직접 만들기 (VS Code Merge Editor를 그대로 씀).
- push 거부 시 "Rebase 후 Push" (사용자 결정: merge 방식만).
- `git pull` 설정(`pull.rebase`)을 따르는 방식.
- 변경 중인 파일 자동 stash.

### 실패로 보는 경우 (반목표)
- 사용자가 모르는 사이에 원격 커밋이 지워지거나, 충돌 표시(`<<<<<<<`)가 남은 채 커밋·push되는 것.
- 버튼 이름("Merge")과 실제 동작이 다른 것.

## 3. 검토한 방식

| 방식 | 내용 | 판단 |
|---|---|---|
| **1. 거부 창에 Merge 버튼 (선택)** | fetch → `git merge <원격>/<브랜치>` → 충돌 없으면 push, 충돌 나면 목록 창 → 해결 후 push | 회사 방식과 맞고 기존 충돌 처리 코드를 다시 씀 |
| 2. 1번 + Rebase 버튼 | IntelliJ처럼 둘 다 | 팀이 merge 방식이라 쓸 일이 거의 없음 |
| 3. `git pull` 후 push | 사용자 git 설정을 따름 | 설정에 따라 rebase가 될 수 있어 버튼 이름과 동작이 어긋남 |

사용자가 1번을 골랐다. 충돌 해결 화면은 IntelliJ 방식(원격·로컬 나란히, 다른 곳마다 선택)을 원했고, VS Code 기본 Merge Editor가 그 역할을 하므로 연결만 한다.

## 4. 설계

### 4.1 push 거부 창

`pushFlow`가 non-fast-forward로 거부되면 지금처럼 원격을 fetch하고 원격 끝 커밋(tip)과 "내 브랜치에 없는 커밋 수"를 구한다. 창은 다음과 같다.

```
Push가 거부되었습니다.
origin/feature/login에 내 브랜치에 없는 커밋이 2개 있습니다.
[Merge 후 Push]   [Force Push (with lease)]   [취소]
```

- 기본(첫) 버튼은 "Merge 후 Push".
- Force Push 버튼은 지금 동작 그대로 (`--force-with-lease=<ref>:<tip>`, 잃는 커밋 수 표시).
- 내 브랜치에 없는 커밋이 0개인 경우(거부됐지만 원격이 이미 내 브랜치에 포함됨)는 거의 없지만, 이때는 지금처럼 Force Push 확인만 띄운다.

### 4.2 Merge 후 Push

1. 진행 중인 merge/rebase가 있으면 멈춘다 (기존 오류 문구).
2. 변경 중인 파일이 있으면 기존 `mergeIntoCurrentFlow`처럼 "먼저 커밋하거나 stash하세요"로 멈춘다. **체크아웃보다 먼저** 검사한다. *(내 결정: 체크아웃해 놓고 merge를 못 하는 헛걸음을 막고, 자동 stash를 하지 않는다는 비목표와 맞춤)*
3. **대상 브랜치가 체크아웃된 브랜치가 아니면** 버튼 이름을 "체크아웃 후 Merge"로 바꾼다. 누르면 `git switch <브랜치>` 후 이어서 진행한다. 변경 파일이 없음을 2에서 확인했으므로 `checkoutFlow`의 stash 질문은 거치지 않는다. 체크아웃이 실패하면 멈춘다.
4. `git merge <원격>/<브랜치>`. 메시지는 git 기본값 (`Merge remote-tracking branch 'origin/feature/login' into feature/login`). 확인 창은 따로 띄우지 않는다. 거부 창에서 버튼을 누른 것이 확인이다.
5. 충돌 없이 끝나면 바로 일반 push (force 아님). 이때 또 거부되면(그새 원격이 또 바뀜) 4.1 창을 다시 띄운다.
6. 충돌이 나면 "push 대기" 표시(4.4)를 남기고 충돌 목록 창(4.3)을 연다.

### 4.3 충돌 파일 목록 창

QuickPick 하나. merge와 rebase 모두 같은 창을 쓴다.

```
충돌 파일 3개: 해결할 파일을 고르세요
  $(warning) src/login.ts            src
  $(warning) src/user.ts             src
  $(warning) README.md
  ─────────────
  $(check-all) 모두 내 것으로 (Current)
  $(cloud-download) 모두 원격 것으로 (Incoming)
  $(close) 중단 (Abort)
```

- 목록 = `git diff --name-only --diff-filter=U -z`.
- 파일 선택 → `git.openMergeEditor` 명령으로 그 파일을 Merge Editor로 연다 (1.88에 있음을 확인함). 명령이 실패하면 일반 편집기로 연다.
- Merge Editor에서 "Complete Merge"를 누르면 VS Code가 파일을 stage한다. 이때 Junction이 저장소 변경 이벤트로 이를 알아채고, 남은 충돌 파일이 있으면 알림 "충돌 파일 N개 남음 — [다음 파일]"을 띄운다. [다음 파일]은 목록 창을 다시 연다.
- 남은 충돌 파일이 0개가 되면 merge 완료 단계(4.4)로 간다.
- **감시 범위** *(내 결정)*: "N개 남음"과 "모든 충돌 해결" 알림은 Junction이 시작했는지와 상관없이 저장소가 merge/rebase 중이면 동작한다 (터미널에서 시작한 merge도 트리 상단에 상태 노드가 이미 보이므로 같은 도움을 준다). push 제안만 push 대기 표시가 있을 때로 한정한다.
- **일괄 적용:** 확인 창("N개 파일을 모두 원격 것으로 바꿉니다. 이 파일들에서 내 변경은 버려집니다.")을 거친 뒤 각 파일에 `git checkout --ours|--theirs -- <파일>` 후 `git add`. 한쪽에서 삭제된 파일(modify/delete 충돌)은 고른 쪽이 삭제면 `git rm`.
- **ours/theirs 이름:** merge에서는 ours = 내 브랜치(Current), theirs = 원격(Incoming). rebase에서는 뒤바뀐다(ours = 올라탈 대상, theirs = 내 커밋). 화면 문구는 항상 "내 것 / 원격(상대) 것" 기준으로 보여주고, rebase일 때는 내부에서 반대로 매핑한다.

### 4.4 merge 완료와 push

- 남은 충돌이 0개가 되면 알림: "모든 충돌을 해결했습니다. [Merge 완료 후 Push] [Merge만 완료]". push 대기 표시가 없는 merge(트리의 일반 merge)에서는 "[Merge 완료]"만 보인다.
- "Merge 완료" = 기존 `continueFlow` (`git -c core.editor=true merge --continue`). "Merge만 완료"는 push 대기 표시를 지운다 (바로 이어서 push 질문이 또 뜨지 않게).
- **rebase일 때** *(내 결정)*: 마지막 충돌을 해결하면 "모든 충돌을 해결했습니다. [Rebase 계속]"만 띄운다. 계속한 뒤 다음 커밋에서 또 멈추면 4.3 흐름이 반복된다. rebase에는 push 제안을 하지 않는다 (push 거부 경로는 merge만 시작하므로 push 대기 표시가 생기지 않음).
- 사용자가 SCM 패널에서 직접 커밋해 merge를 끝낼 수도 있다. 저장소 상태가 "merge 중"에서 "merge 아님"으로 바뀌고 push 대기 표시가 남아 있으면, "Merge가 끝났습니다. 지금 push할까요? [Push]"를 띄운다.
- **push 대기 표시:** 저장소 경로 + 브랜치 이름 + merge한 원격 tip sha를 `workspaceState`에 저장한다 (VS Code를 다시 열어도 남음). 다음 때 지운다: push 완료, "Merge만 완료", merge 중단(Abort), 브랜치가 바뀜, push 제안에서 취소.
- **VS Code를 다시 열었을 때** *(내 결정)*: 저장소를 불러올 때 표시가 있고 merge 중이 아니면, HEAD가 저장된 tip을 포함하면(`merge-base --is-ancestor`) merge가 끝난 것으로 보고 push를 제안한다. 포함하지 않으면 중단된 것으로 보고 표시를 조용히 지운다. 아직 merge 중이면 그대로 둔다.
- **push 전 안전장치** *(내 결정)*: merge 후 push하는 모든 경로(충돌 없는 merge, 완료 버튼, SCM 직접 커밋, 재시작 후)에서 `git diff --check <tip> HEAD` 출력 중 **"leftover conflict marker" 줄만** 본다 (공백 오류는 무시). 있으면 push하지 않고 파일 이름과 함께 알린다. *(merge --continue는 unmerged 파일이 있으면 git이 막아 주지만, 사용자가 표시를 남긴 채 stage했을 수 있음)*

### 4.5 기존 "충돌 파일 열기"

`junction.openConflicts`(충돌 알림 버튼, 트리 상단 상태 노드)는 지금 첫 충돌 파일을 일반 편집기로 연다. 이를 4.3 목록 창으로 바꾼다.

### 4.6 계층

- 흐름 로직(`src/flows`)은 vscode를 import하지 않는다는 규칙을 지킨다. Merge Editor 열기, push 대기 저장은 `Ui`/환경 인터페이스를 통해 주입한다.
- git 조작은 `src/git/operations.ts`에 추가 (`conflictedFiles`, `checkoutSide`, `diffCheck` 등).

### 4.7 테스트

- 통합(임시 저장소 + bare 원격): 거부 → merge 깨끗 → push 성공 / 거부 → 충돌 → 일괄 theirs → 완료 → push / "Merge만 완료" 후 push 질문 없음 / 체크아웃 안 된 브랜치 / 변경 중 파일이 있으면 체크아웃 전에 멈춤 / modify-delete 충돌 / rebase에서 ours·theirs 매핑 / 충돌 표시가 커밋된 채 push 차단 / 재시작 시 표시 처리(완료·중단).
- 확장 테스트: `git.openMergeEditor` 명령 존재 확인 (stable, 1.88).

## 5. 구현자에게 맡기는 것
- 메시지 문구(영어 원문 + 한국어), 아이콘, 파일·함수 이름.
- 저장소 변경 이벤트에서 충돌 수를 다시 세는 시점과 중복 알림 방지 방식.

## 6. 정해지지 않은 것
- 없음.
