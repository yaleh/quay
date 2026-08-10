---
id: gap-runtime-state-files-not-gitignored
title: .gitignore 用逐文件名匹配 .quay/* 非通配——5 个运行时文件从未被覆盖：4 个未跟踪不忽略（last-pane.txt/suite-cgroup-evidence.txt/suite-chain-heartbeat.json/suite-health-last-run.json 每次 restart-readiness-check 报脏树误导）+ closure-pass-last-run.json 已跟踪且被修改（运行时状态不该进 git）；按现有 `**/.quay/session-liveness.*.json` 同形态补齐
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`.gitignore` 对 `.quay/*` 用逐文件名匹配（非通配），以下 5 个运行时文件从未被任何 pattern 覆盖——其中 4 个是未跟踪且不忽略（每次 `restart-readiness-check.sh` 都因此报「脏树」误导），1 个（`closure-pass-last-run.json`）更严重：它**已跟踪且被修改**，是运行时状态文件被 commit 进了 git。**

### 实证（manager 2026-08-10 解除 .halt 时顺带查到 + outer 复核原始记录）

- **`.gitignore` 逐文件名匹配**（outer 复核）：`.quay/` 下是 `**/.quay/gate-events.jsonl`、`**/.quay/session-liveness.*.json`、`**/.quay/inner-blocked.json` 等**逐文件**行——没有 `**/.quay/*` 通配，新增运行时文件若未逐行补即漏。
- **5 个漏网文件**（`git check-ignore` 实测全 NOT-ignored）：
  - `.quay/last-pane.txt`（未跟踪）
  - `.quay/suite-cgroup-evidence.txt`（未跟踪）
  - `.quay/suite-chain-heartbeat.json`（未跟踪）
  - `.quay/suite-health-last-run.json`（未跟踪）
  - `.quay/closure-pass-last-run.json`（**已跟踪**——committed `c9051056` 2026-08-09 23:09Z「B2 record closure-pass」；且每个 tick 都被 `--record` 改写，git status 恒显示 modified）
- **实现时新发现（inner 2026-08-10）**：**5 个全被跟踪**，不止 closure-pass——fan-in `ae47d845`（2026-08-10 13:13Z「task/gap-semantic-observer-judge-stopped-awaiting @ a111b430」）把另外 4 个运行时文件也 commit 进了 develop（`git show --stat ae47d845` 实测：last-pane.txt +116 / suite-cgroup-evidence.txt +9 / suite-chain-heartbeat.json +1 / suite-health-last-run.json +10 / closure-pass-last-run.json 2±）。任务立案时 manager 在主检出（integration）看到 4 个是「未跟踪」，但 develop 上 fan-in 已把它们跟踪了。⇒ AC3 的 `git rm --cached` 从 1 个扩到 **5 个**（否则这 4 个跟踪文件每 tick 被改写仍显示 ` M`，AC4/Contract 的「status 不含 5 文件名」恒不成立）。
- **后果**：每次 `restart-readiness-check.sh` 的「脏树」检查把未跟踪运行时文件报成 FAIL——`experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` 的 8 项硬阻断里「clean tree」是其一，长时间暂停后复检必误报。manager 用 `.halt` 正文的更具体判据绕开（本次 5 个未跟踪里数个正是 suite-fix subagent 在写），但**判据绕开是一次性的；`.gitignore` 缺口是长期的**。

**为什么重要**：运行时状态文件（heartbeat/健康快照/闭包记账/last-pane）是三层执行核的产物——它们不该出现在 git status 的脏树里（会被 restart-readiness-check 误报、会被 batch-merge 的 clean-tree 断言误伤）。这是「运行时状态与 git 边界不清」的又一次实例（同类：gate-events.jsonl / supervisor-bus-ledger.jsonl 已有忽略行）。

### 选定机制方向（实现归 inner，判定归 outer）

1. **补齐 .gitignore**：按现有 `**/.quay/session-liveness.*.json` 同形态为 5 个文件各加一行（或加一个 `**/.quay/*.json` 通配 + 例外，但优先逐文件以匹配现有风格）。
2. **untrack closure-pass-last-run.json**：`git rm --cached .quay/closure-pass-last-run.json`——它是运行时状态不该在 git；加忽略行后从跟踪移除，保留磁盘文件（B2 仍写它）。
3. **负控制**：.gitignore 补完后 `git status --short` 不再报这 5 个文件；`restart-readiness-check.sh` 的脏树检查不再因它们 FAIL。

**验证锚**：修后 (a) `git check-ignore` 对 5 个文件全命中；(b) `git status --short` 不再列出它们；(c) `closure-pass-last-run.json` 变 untracked（`git rm --cached` 后）+ 磁盘文件仍在（B2 继续写）；(d) restart-readiness-check 的脏树检查只报真实脏文件。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 5 文件 NOT-ignored 实测（git check-ignore 全空）+ closure-pass-last-run.json 已跟踪实证（committed c9051056）+ restart-readiness-check 脏树误报后果（本任务 Proposal 已含；实现时再补 ae47d845 实证——5 个全被跟踪）
- [x] AC2: **.gitignore 补齐**——5 个文件各加忽略行（同 `**/.quay/session-liveness.*.json` 形态），`git check-ignore` 全命中
- [x] AC3: **untrack 运行时状态**——`git rm --cached` 5 个文件（closure-pass + 另外 4 个被 ae47d845 误跟踪的；磁盘文件保留，B2 继续写）
- [x] AC4: **脏树不再误报**——`git status --short` 不再列出 5 文件（commit 后）；restart-readiness-check 脏树检查不再因它们 FAIL
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（`--allow-thin`，新增 gitignore 守卫测试也绿）

## Test-Files

- plugin/test/gitignore.test.mjs（AC2 守卫：git check-ignore 对 5 个运行时文件全命中——防逐文件 .gitignore 再漏新文件；`## Test-Files` 声明让 scoped 选择器把它纳入运行）

## 执行证据（inner 2026-08-10）

```
# 修前复现（任务体记录 + worktree 实测）
git check-ignore .quay/last-pane.txt .quay/suite-cgroup-evidence.txt .quay/suite-chain-heartbeat.json .quay/suite-health-last-run.json .quay/closure-pass-last-run.json 2>/dev/null | wc -l
# → 0（全 NOT-ignored）
git ls-files .quay/last-pane.txt .quay/suite-cgroup-evidence.txt .quay/suite-chain-heartbeat.json .quay/suite-health-last-run.json .quay/closure-pass-last-run.json
# → 5 个全列出（develop 上 ae47d845 fan-in 把 4 个运行时文件也 commit 了，不止 closure-pass）

# 修后：gitignore 5 行 + git rm --cached 5 个
git check-ignore .quay/last-pane.txt .quay/suite-cgroup-evidence.txt .quay/suite-chain-heartbeat.json .quay/suite-health-last-run.json .quay/closure-pass-last-run.json 2>/dev/null | wc -l
# → 5（全命中）
git ls-files .quay/closure-pass-last-run.json
# → 空（untracked）
git ls-files --error-unmatch .quay/closure-pass-last-run.json 2>/dev/null; echo $?
# → 1（untracked，Contract invariant closure_pass_not_tracked 成立）
ls .quay/closure-pass-last-run.json .quay/last-pane.txt .quay/suite-cgroup-evidence.txt .quay/suite-chain-heartbeat.json .quay/suite-health-last-run.json
# → 5 个磁盘文件仍在（B2 继续写）

# Contract invoke（commit 后 git status --short 不含 5 文件名）
git status --short | grep -E "last-pane|suite-cgroup|suite-chain-heartbeat|suite-health-last-run|closure-pass-last-run"
# → （空）

# 新增守卫测试
node --no-warnings --experimental-strip-types --test plugin/test/gitignore.test.mjs
# → pass 1 / fail 0（AC2 — all 5 runtime-state files are gitignored）
```

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：`git check-ignore` 5 文件全命中 + `git status --short` 干净 + closure-pass 磁盘仍在（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- .gitignore（AC2：5 文件逐行补齐，同现有 `**/.quay/session-liveness.*.json` 形态）
- .quay/closure-pass-last-run.json（AC3：`git rm --cached`，磁盘保留）
- experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh（AC4：脏树检查——确认修复后不再因运行时文件 FAIL；不改检查本身，除非有缺口）
- tasks/gap-runtime-state-files-not-gitignored.md（自身：勾 AC + 贴证据）

## Contract

measure   runtime_files_ignored = `git check-ignore .quay/last-pane.txt .quay/suite-cgroup-evidence.txt .quay/suite-chain-heartbeat.json .quay/suite-health-last-run.json .quay/closure-pass-last-run.json 2>/dev/null | wc -l` 的 stdout 数字
band      runtime_files_ignored = 5（全命中）
invariant closure_pass_not_tracked = 1（`git ls-files --error-unmatch .quay/closure-pass-last-run.json` 非 0 退出——untracked）
invariant runtime_files_not_in_status = 1（`git status --short` 不含这 5 个文件名）
invoke    `git status --short | grep -E "last-pane|suite-cgroup|suite-chain-heartbeat|suite-health-last-run|closure-pass-last-run"`（贴输出：应为空）
control   check-ignore 全命中；status 干净；closure-pass 磁盘仍在但 untracked
resume    .gitignore 补齐 / untrack / 负控制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 解除 .halt 时顺带查到（restart-readiness-check 因 5 个未跟踪运行时文件报脏树 FAIL）——outer 复核 .gitignore 逐文件名匹配 + git check-ignore 全空 + closure-pass-last-run.json 已跟踪（c9051056）实证。立案：按现有 pattern 形态补齐 + untrack 运行时状态。实现归 inner
