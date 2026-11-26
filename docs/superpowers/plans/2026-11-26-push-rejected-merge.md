# Merge on Rejected Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a push is rejected, let the user merge the remote branch in and push again, and help them resolve conflicts with a conflict-file list that opens VS Code's Merge Editor.

**Architecture:** Pure flows in `src/flows` (no `vscode` import) do the git work through `Ui` plus two injected pieces: a per-repo `PendingPushStore` (remembers "push after this merge") and `openMergeEditor(file)`. A pure `nextNotice` function decides what to tell the user when repo state changes; a thin `src/vscode/conflictWatcher.ts` feeds it from repository change events. `register.ts` wires everything.

**Tech Stack:** TypeScript, VS Code API 1.88, git CLI, vitest (unit + integration against temp repos), @vscode/test-cli (stable + 1.88).

**Spec:** `docs/superpowers/specs/2026-11-26-push-rejected-merge-design.md`

## Global Constraints

- `engines.vscode` stays `^1.88.0`; `@types/vscode` stays 1.88.0. Merge Editor is opened with the built-in command `git.openMergeEditor` (exists in 1.88), falling back to `vscode.open`.
- `src/git`, `src/model`, `src/flows` never import `vscode`.
- Every user message is an inline `{ key: 'English text', args }` literal (or `l10n.t('...')`) and has a Korean entry in `l10n/bundle.l10n.ko.json`; `test/unit/l10n.test.ts` enforces this.
- Merge, not rebase, on rejected push. No auto-stash. Force push stays available and always goes through the existing lease confirm (`--force-with-lease=<ref>:<tip>`).
- Branch names travel as their own argv entries; file lists from git use `-z`.
- Version becomes 0.3.0 (package.json, CHANGELOG, manifest test).

## Review Focus

1. **Upstream with a different remote name** (`branch.x.merge = refs/heads/other`): the merge must use `<remote>/other` from `pushTarget`, never `<remote>/<local name>`. → Task 2 test `merges the configured upstream, not the local name`.
2. **Paths with spaces or non-ASCII** in conflicted files and in the leftover-marker check. → Task 1 tests use `dir with space/파일.txt`.
3. **Modify/delete conflicts** with "accept all": the side that deleted the file wins by `git rm`. → Task 1 test `checkoutSide deletes when the chosen side removed the file`.
4. **Stale marker after a branch switch**: a pending push for `feature/a` must never push while HEAD is `feature/b`. → Task 2 test `resume clears the marker when HEAD is another branch`.
5. **Double prompt from our own completion**: when Junction itself finishes the merge, the watcher must not also ask "push now?". Rule: the flow clears the marker *before* it concludes the merge (capturing `tip` first). → Task 2 test `finishMergeFlow clears the marker before continuing`.

---

### Task 1: Git operations for conflicts

**Files:**
- Modify: `src/git/operations.ts` (append)
- Test: `test/integration/conflictOps.test.ts` (new)

**Interfaces:**
- Produces:
  - `conflictedFiles(git: Git): Promise<string[]>` — `git diff --name-only --diff-filter=U -z`, sorted.
  - `checkoutSide(git: Git, file: string, side: 'ours' | 'theirs'): Promise<'kept' | 'deleted'>` — `git checkout --<side> -- <file>` then `git add -- <file>`; if checkout fails because that side has no version, `git rm -q -- <file>` and return `'deleted'`.
  - `leftoverMarkers(git: Git, from: string, to: string): Promise<string[]>` — files whose added lines in `git -c core.quotePath=false diff --no-color --no-ext-diff -U0 <from> <to>` match `/^\+(<{7}|={7}|>{7})( |$)/`; file name from the preceding `+++ b/` line. (Not `diff --check`: `GitError` carries no stdout and `--check` also reports whitespace.)

- [ ] **Step 1: Write the failing tests** (use `makeRepo`; build a merge conflict like `conflicting()` in `test/integration/mergeRebase.test.ts`)
  - `conflictedFiles lists unmerged paths` → after a conflicting merge touching `README.md` and `dir with space/파일.txt`: `toEqual(['README.md', 'dir with space/파일.txt'])`; with no merge: `toEqual([])`.
  - `checkoutSide ours keeps HEAD's content and stages it` → file content equals develop's, `conflictedFiles` no longer contains it.
  - `checkoutSide theirs takes the merged branch's content`.
  - `checkoutSide deletes when the chosen side removed the file` → topic deletes `a.txt`, develop modifies it; `checkoutSide(git,'a.txt','theirs')` returns `'deleted'`, file absent, not in `conflictedFiles`.
  - `leftoverMarkers finds committed markers` → commit a file containing `<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic\n` in `dir with space/파일.txt`; `leftoverMarkers(git, before, 'HEAD')` → `['dir with space/파일.txt']`.
  - `leftoverMarkers ignores trailing whitespace and seven-char text mid-line` → `'a  \n'` and `'x <<<<<<< y\n'` → `[]`.

- [ ] **Step 2: Run** `npx vitest run test/integration/conflictOps.test.ts` → FAIL (functions not exported).
- [ ] **Step 3: Implement** the three functions in `src/git/operations.ts`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(git): conflicted files, side checkout and leftover marker check`

---

### Task 2: Push flow with merge, pending push, finish and resume

**Files:**
- Create: `src/flows/pendingPush.ts`, `src/flows/pushFlows.ts`
- Modify: `src/flows/branchFlows.ts` (move `pushFlow` out; keep `export { pushFlow } from './pushFlows'`; move `isNonFastForward`/`remoteOf` to an export the new file can import, or duplicate `isNonFastForward` there), `src/flows/prFlow.ts`
- Test: `test/integration/pushMerge.test.ts` (new); update `test/integration/branchFlows.test.ts` push tests; update `test/integration/prFlow.test.ts` ctx

**Interfaces:**
- Consumes: Task 1 `leftoverMarkers`; existing `continueFlow`, `MergeResult` (`src/flows/mergeFlows.ts`), `isAncestor` (`src/git/queries.ts`), `ops.switchBranch/merge/pushTarget/fetchRemote/remoteTip/countNotIn/push`.
- Produces:
  ```ts
  // src/flows/pendingPush.ts
  export interface PendingPush { branch: string; tip: string }
  export interface PendingPushStore { get(): PendingPush | undefined; set(p: PendingPush): void; clear(): void }
  export function memoryPendingStore(initial?: PendingPush): PendingPushStore;
  // src/flows/pushFlows.ts
  export interface PushCtx extends FlowCtx { pending: PendingPushStore }
  export function pushFlow(c: PushCtx, b: BranchRef): Promise<MergeResult>;
  export function finishMergeFlow(c: PushCtx, opts: { push: boolean }): Promise<MergeResult>;
  export function resumePendingPushFlow(c: PushCtx): Promise<FlowResult>;
  ```
  `createPrFlow`'s ctx becomes `PushCtx & { env: PrEnv }` and its return type `Promise<MergeResult>`; when the inner push returns `'conflicts'` it returns `'conflicts'`.

**Behavior (from spec 4.1, 4.2, 4.4):**
- Rejected push: fetch, `tip`, `lost = countNotIn(tip, b.name)` as today.
  - `lost === 0`: today's single force-with-lease confirm, unchanged.
  - `lost > 0`: modal `ui.confirm({ key: 'Push was rejected.' }, [mergeAction, { key: 'Force Push (with lease)' }], { modal: true, detail: { key: '{0} has {1} commits that are not in your branch.', args: [remoteShort, lost] } })`, `mergeAction` = `{ key: 'Merge and Push' }` if `b.isHead` else `{ key: 'Checkout and Merge' }`. Index 1 → today's force confirm (second modal, with discard detail). Undefined → `'cancelled'`.
- Merge path, in order: in-progress check (`'A rebase or merge is in progress.'`) → `snap.state.dirty` → `'Commit or stash your changes first.'` (before any switch) → if `!b.isHead` `ops.switchBranch` → `ops.merge(git, remoteShort)` where `remoteShort = \`${remote}/${dest minus refs/heads/}\``.
  - Conflicts (`repoState` merging) → `pending.set({ branch: b.name, tip })`, return `'conflicts'`.
  - Clean → `pushAfterMerge`.
- `pushAfterMerge(c, b, tip)` (internal): `leftoverMarkers(tip, 'HEAD')` non-empty → `pending.clear()`, `ui.error({ key: 'Conflict markers are left in {0}. Fix them and push again.', args: [files.join(', ')] })`, `'failed'`. Otherwise return `pushFlow(c, b)` (a second rejection shows the dialog again).
- `finishMergeFlow`: read `p = pending.get()`, then `pending.clear()` **before** `continueFlow` (Review Focus 5). If continue ≠ `'done'` return it. If `opts.push && p` → `pushAfterMerge` with the head branch from `snap`.
- `resumePendingPushFlow`: no marker or still merging → `'cancelled'`. `snap.state.head !== p.branch` or `!isAncestor(git, p.tip, 'HEAD')` → clear, `'cancelled'` (silent). Else clear, `ui.confirm({ key: 'The merge is finished. Push {0} now?', args: [p.branch] }, [{ key: 'Push' }])` → push via `pushAfterMerge`; dismiss → `'cancelled'`.

- [ ] **Step 1: Update existing tests** in `branchFlows.test.ts`: every push test gets `pending: memoryPendingStore()` in its ctx; `rejected push + confirm force-pushes with lease` answers `[1, 0]` (choose Force, then confirm); the lease-loses test likewise. `prFlow.test.ts` ctx gets `pending`.
- [ ] **Step 2: Write failing tests** in `pushMerge.test.ts` (reuse the `pushFromOtherClone` helper pattern from `branchFlows.test.ts`):
  - `rejected push + Merge merges the remote and pushes` → answers `[0]`; result `'done'`; remote `feature/p` contains both commits; HEAD is a merge commit with 2 parents; message contains `origin/feature/p`.
  - `merges the configured upstream, not the local name` → local `topic` tracks `origin/other`; remote has an extra commit on `other`; `'done'`, `origin/other` updated.
  - `dirty tree stops before switching` → b is not HEAD, a tracked file modified; result `'failed'`, error key `'Commit or stash your changes first.'`, HEAD unchanged.
  - `non-HEAD branch: Checkout and Merge switches then merges` → action label key `'Checkout and Merge'`; afterwards HEAD is `feature/p`, `'done'`.
  - `conflicting merge returns conflicts and records the pending push` → `'conflicts'`; `pending.get()` equals `{ branch: 'feature/p', tip: <remote sha> }`.
  - `finishMergeFlow clears the marker before continuing and pushes` → after resolving with `checkoutSide` and calling `finishMergeFlow(c, { push: true })` with a store spy recording call order: `clear` precedes the merge commit; result `'done'`; remote updated.
  - `finishMergeFlow push:false only completes the merge` → `'done'`, marker cleared, remote unchanged.
  - `leftover markers block the push` → resolve by staging the file with markers; `finishMergeFlow({push:true})` → `'failed'`, error key `'Conflict markers are left in {0}. Fix them and push again.'`, remote unchanged.
  - `resume pushes after a merge finished outside Junction` → set marker, finish with `git commit --no-edit`, `resumePendingPushFlow` answers `[0]` → `'done'`, remote updated, marker cleared.
  - `resume clears the marker silently after an abort` → `git merge --abort`; `'cancelled'`, no `confirm` calls, marker cleared.
  - `resume clears the marker when HEAD is another branch` → `'cancelled'`, no confirm, no push.
- [ ] **Step 3: Run** `npx vitest run test/integration/pushMerge.test.ts test/integration/branchFlows.test.ts test/integration/prFlow.test.ts` → new tests FAIL.
- [ ] **Step 4: Implement** `pendingPush.ts`, `pushFlows.ts`, the `branchFlows.ts` re-export and the `prFlow.ts` type change. Add Korean entries for the new keys.
- [ ] **Step 5: Run** the same command plus `npm run lint` → PASS.
- [ ] **Step 6: Commit** `feat(push): merge the remote branch when a push is rejected`

---

### Task 3: Conflict list flow

**Files:**
- Create: `src/flows/conflictFlows.ts`
- Test: `test/integration/conflictFlows.test.ts`, `test/unit/conflictSide.test.ts`

**Interfaces:**
- Consumes: Task 1 `conflictedFiles`, `checkoutSide`; Task 2 `PushCtx`; existing `abortFlow`.
- Produces:
  ```ts
  export interface ConflictCtx extends PushCtx { openMergeEditor(file: string): Promise<void> }
  export function sideFor(choice: 'mine' | 'theirs', op: 'merge' | 'rebase' | 'none'): 'ours' | 'theirs';
  export function conflictListFlow(c: ConflictCtx): Promise<MergeResult>;
  ```

**Behavior (spec 4.3):** no files → `ui.info({ key: 'No conflicted files.' })`, `'done'`. Otherwise one `ui.pick` titled `{ key: '{0} conflicted files. Select one to resolve.', args: [n] }` with: each file (`label` = path, `description` omitted), then `labelMsg` items `'Accept Mine for All'`, `'Accept Theirs for All'`, and `'Abort'` only when a merge/rebase is in progress. File → `openMergeEditor(file)`, `'done'`. Bulk → modal confirm `{ key: 'Use your version for {0} files? Their changes in these files will be lost.' }` / `{ key: 'Use their version for {0} files? Your changes in these files will be lost.' }` with action `{ key: 'Replace' }`, then `checkoutSide(f, sideFor(choice, op))` for each; failure → `'Could not resolve {0}.'`, `'failed'`. Abort → `abortFlow`; if `'done'`, `pending.clear()`.

`sideFor`: merge/none: mine→ours, theirs→theirs. rebase: mine→theirs, theirs→ours.

- [ ] **Step 1: Write failing tests**
  - unit `sideFor maps rebase sides in reverse` → the four rebase/merge combinations above.
  - `picking a file opens it in the merge editor` → `openMergeEditor` spy called with `'README.md'`.
  - `accept theirs for all resolves every file after confirm` → answers `[{kind:'theirs'}, 0]` (use whatever value shape the flow defines); `conflictedFiles` empty; README has topic's content.
  - `accept mine during a rebase keeps my commit's content` → rebase topic onto develop with conflict; `mine` → README equals topic's content.
  - `cancelling the bulk confirm changes nothing` → files still conflicted, `'cancelled'`.
  - `abort clears the pending push` → marker set; pick Abort, confirm → merge gone, `pending.get()` undefined.
  - `no Abort item when nothing is in progress` → only stash-pop conflict case, or simply assert item count when `snap.state` not merging.
- [ ] **Step 2: Run** `npx vitest run test/integration/conflictFlows.test.ts test/unit/conflictSide.test.ts` → FAIL.
- [ ] **Step 3: Implement** `conflictFlows.ts`; Korean entries.
- [ ] **Step 4: Run** → PASS; `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat(conflicts): conflict file list with merge editor and bulk resolve`

---

### Task 4: Watch decision logic

**Files:**
- Create: `src/flows/conflictWatch.ts`
- Test: `test/unit/conflictWatch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WatchState { op: 'merge' | 'rebase' | 'none'; conflicts: number }
  export type Notice =
    | { kind: 'remaining'; count: number }
    | { kind: 'allResolved'; op: 'merge' | 'rebase'; withPush: boolean }
    | { kind: 'mergeEnded' };
  export function nextNotice(prev: WatchState | undefined, cur: WatchState, hasPending: boolean): Notice | undefined;
  ```

**Rules:** (1) `cur.op === 'none' && hasPending && (prev === undefined || prev.op === 'merge')` → `mergeEnded` (covers restart, SCM commit, outside abort; the resume flow sorts them out). (2) `prev && prev.op === cur.op && cur.op !== 'none' && cur.conflicts < prev.conflicts` → `cur.conflicts > 0` ? `remaining` : `allResolved` with `withPush = cur.op === 'merge' && hasPending`. (3) otherwise `undefined` (no notice on first sight of an in-progress merge, none when conflicts rise).

- [ ] **Step 1: Write failing tests**, one `it` per rule plus: `3→2 merge` → remaining 2; `1→0 merge pending` → allResolved withPush true; `1→0 merge no pending` → withPush false; `1→0 rebase pending` → withPush false; `none→none pending, prev undefined` → mergeEnded; `none→none pending, prev none` → undefined; `merge→none no pending` → undefined; `0→2 rebase` → undefined.
- [ ] **Step 2: Run** `npx vitest run test/unit/conflictWatch.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(conflicts): decide conflict notices from repo state changes`

---

### Task 5: VS Code wiring

**Files:**
- Create: `src/vscode/conflictWatcher.ts`, `src/vscode/pendingPushStore.ts`
- Modify: `src/commands/register.ts`, `l10n/bundle.l10n.ko.json`
- Test: `test/extension/commands.test.ts` (add one test)

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `workspacePendingStore(state: vscode.Memento, root: vscode.Uri): PendingPushStore` — key `junction.pendingPush.<root.fsPath>`.
  - `watchConflicts(conn: GitConnection, onNotice: (repo: RepoHandle, n: Notice) => void, hasPending: (repo: RepoHandle) => boolean): vscode.Disposable` — subscribes to every repo's `onDidChange` (re-subscribes on `onDidChangeRepos`), evaluates once per repo at start, debounces 300 ms per repo, never runs two evaluations of one repo at once; state = `repoState` + (`op !== 'none'` ? `conflictedFiles().length` : 0); keeps `prev` per repo; errors go to the output channel only.

**register.ts changes:**
- `runFlow`'s flow ctx adds `pending: workspacePendingStore(ctx.workspaceState, repo.root)` and `openMergeEditor` (`executeCommand('git.openMergeEditor', Uri.joinPath(root, file))`, on throw `vscode.open`).
- `junction.push` uses the new `pushFlow` (same command id).
- On `'conflicts'`: replace `offerConflictHandoff` with `void executeCommand('junction.openConflicts', { repo })`.
- `junction.openConflicts` runs `conflictListFlow` through `runFlow` (title `{ key: 'Loading conflicts…' }`), keeping the existing `workbench.view.scm` reveal.
- `watchConflicts(...)` notices via `ui.info(msg, actions, onPick)`:
  - remaining → `{ key: '{0} conflicted files left.', args: [n] }`, `[{ key: 'Next File' }]` → `junction.openConflicts`.
  - allResolved merge withPush → `{ key: 'All conflicts are resolved.' }`, `[{ key: 'Complete Merge and Push' }, { key: 'Complete Merge Only' }]` → `finishMergeFlow({ push: true | false })`.
  - allResolved merge without push → `[{ key: 'Complete Merge' }]` → `finishMergeFlow({ push: false })`.
  - allResolved rebase → `[{ key: 'Continue Rebase' }]` → `continueFlow`.
  - mergeEnded → `runFlow(repo, { key: 'Pushing…' }, resumePendingPushFlow)`.

- [ ] **Step 1: Write the failing extension test** `git.openMergeEditor is available` → `(await vscode.commands.getCommands(true)).includes('git.openMergeEditor')` is true.
- [ ] **Step 2: Implement** the two new files and the register changes; Korean entries for every new key.
- [ ] **Step 3: Run** `npm run lint && npm run test:unit` → clean, all pass.
- [ ] **Step 4: Run** `npm run test:ext && npm run test:ext:min` → all passing on stable and 1.88.
- [ ] **Step 5: Commit** `feat(conflicts): wire conflict list, merge editor and notices into VS Code`

---

### Task 6: Docs and version

**Files:** `package.json` (version 0.3.0), `CHANGELOG.md` (0.3.0 entry), `README.md` (English + Korean sections: rejected push → Merge and Push; conflict list; Manual QA steps for: clean merge push, conflict → Merge Editor → Complete Merge and Push, SCM commit then push prompt, restart with marker), `test/unit/manifest.test.ts` (expects 0.3.0).

- [ ] **Step 1: Update** `manifest.test.ts` to 0.3.0 → `npx vitest run test/unit/manifest.test.ts` FAIL.
- [ ] **Step 2: Update** the docs and version → PASS.
- [ ] **Step 3: Run** `npm run lint && npm run test:unit && npm run package` → clean, pass, vsix built.
- [ ] **Step 4: Commit** `docs: merge on rejected push and conflict list, v0.3.0`
