---
id: gap-batch-merge-authoritative-direction-hardcoded-develop
title: "integration-batch-merge 归边方向硬编码 develop-authoritative，无法表达 per-file 反向归边（2026-08-08 env 冲突实证）"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**integration-batch-merge.sh 的冲突归边方向是硬编码的 develop-authoritative（`resolve_as_ours`），无法表达 per-file 的反向归边（integration-authoritative）——不是配置缺失，是判据缺失。**

**背景**：AC27（6b6e985d）把 integration→develop 合并的触发权交给 tick。`integration-batch-merge.sh --merge`
对共享文件（`*tick-log.md, tasks/*.md, *queue-state*`）用 develop-authoritative 自动消解；真代码冲突 fail-closed。

**实证（2026-08-08 14:1xZ，外层 + manager）**：integration→develop 真 merge 时，
`orchestration/session-liveness.env` 是真代码冲突（不在 shared-file 清单）。冲突两侧：

| 侧 | SESSION_TRANSCRIPTS 值 | 判定 |
|---|---|---|
| develop | `"inner /path"` | **缺陷版**——名字不在目标表（SESSION_TARGETS=quay），transcript 被静默忽略（D1） |
| integration | `"quay /path"` | **修复版**——名字在目标表，monitor-watches-self 的产物 |

**正确归边 = integration-authoritative**（机械判据：名字必须在目标表里）。但工具只支持 develop-authoritative：
`resolve_as_ours`（`checkout --ours`）是唯一消解路径，`--shared-file` 只会把路径加进 develop-优先清单，
**无法表达「这个文件冲突时取 integration 侧」**。

**为什么是判据缺失而非配置缺失**：工具假定「develop 总是对的」——因为两线模型下 develop 是 FORK_BASELINE
（已验证基线）。但**运行时配置文件**（env 等）是任务在 integration 侧改的，develop 侧滞后是常态；当
develop 侧恰好是缺陷版时，develop-authoritative 会把缺陷合回来。**归边方向应由内容判据决定**（如本例：
名字是否在目标表里），不是固定「develop 优先」。

**本次处置（已发生，manager 裁定绕过工具）**：外层手动在临时 worktree 真 merge，对 env 这一个文件取
integration 版（`git show integration:…` 覆盖），其余 develop-authoritative，提交 c7903a43 + CAS 推进。
工具表达不了所以绕过了工具——**但绕过工具不能成为长期状态**（外层手动 merge 违背「不自己 merge」边界，
是 manager 临时授权的一次性操作）。

**修的方向（实现归内层，方向外层/manager 已定）**：

- 候选 A：**支持 per-file 反向归边**——如 `--integration-authoritative <glob>`，冲突时对该路径取
  integration 侧（`checkout --theirs`），其它仍 develop-authoritative。最少改动，直接表达本次实例。
- 候选 B：**归边方向由内容判据决定**——通用化：冲突时对每个文件跑内容判据（如「SESSION_TRANSCRIPTS
  名字是否在目标表」这类机械规则），由规则决定取哪侧。更根本，但需要定义判据框架。
- 候选 C：**shared-file 清单扩展 + 反向开关**——把「任务改的运行时配置」（env、config 等）识别为
  integration-authoritative 类，与 develop-authoritative 的共享文件分开处理。
- 通用约束：**fail-closed 保留**——在工具能表达正确归边之前，真代码冲突仍 fail-closed（不盲合）；
  但 manager 明确「fail-closed 不能成为长期状态」——本任务就是消除「工具表达不了」这个长期缺口。

**实现选择（内层 2026-08-08）**：候选 A + B 合并落地——
`--integration-authoritative <glob>`（候选 A：per-file 反向声明，冲突时对该路径取 integration 侧）
+ `--reverse-edge-criterion <script>`（候选 B：内容判据门——integration 侧满足判据才取 integration 侧，
不满足则 fail-closed，绝不盲选任一侧）。未声明反向归边的文件保持 develop-authoritative 默认；无判据的
真冲突仍 fail-closed。候选 C 未采用（shared 清单与反向归边语义正交，混在一起会弱化「判据决定方向」的
清晰性）。既有 `--shared-file` / `resolve_as_ours` 行为逐字节不变。

**验证锚**：修后，`integration-batch-merge.sh --merge` 对「develop 缺陷版 + integration 修复版」的冲突
文件能按配置取 integration 侧（无需外层手动绕过工具）；且仍对无判据的真冲突 fail-closed。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录本次 env 冲突的归边实证（develop "inner" 缺陷 vs integration "quay"
      修复，名字目标表判据），确认工具无法表达该归边（本任务 Proposal 已含）
- [x] AC2: **per-file 归边能力落地**——batch-merge 支持 integration-authoritative 归边（候选 A 的
      `--integration-authoritative <glob>` + 候选 B 的内容判据门 `--reverse-edge-criterion <script>`：
      指定文件冲突时取 integration 侧，且由内容判据决定方向）。实跑验证 env 案例无需手动绕过工具——
      见下方「实跑证据」：`--merge --integration-authoritative 'orchestration/session-liveness.env'
      --reverse-edge-criterion …` 直接取 integration 侧（develop 缺陷 "inner" 被修复版 "quay" 覆盖），
      `measure integration_ff_merges=0`
- [x] AC3: **默认仍 develop-authoritative**——未指定的文件冲突仍按现状 develop-authoritative（不破坏
      现有共享文件消解）。RE 测试证明同一 merge 内 env 取 integration 侧、`tick-log.md`/`tasks/one.md`
      仍取 develop 侧（混合方向 per-file，非全局翻转）；既有 batch-merge 测试全绿（20/20）
- [x] AC4: **fail-closed 保留**——无归边判据的真代码冲突仍 fail-closed（不盲合）。两个负控制：
      (1) 未声明 `--integration-authoritative` 的 env 冲突 → REAL-MERGE FAIL-CLOSED、ref 未动；
      (2) 声明了但 integration 侧不满足内容判据 → content criterion NOT satisfied → FAIL-CLOSED、
      两侧都不盲选
- [x] AC5: **文档同步**——batch-merge 头注释新增 REVERSE-EDGE 一节并更新 `--merge` 语义
      （develop-authoritative 默认 + 可 per-file 反向 + 内容判据门），usage 增加两个新 flag；不再只声明
      「develop 总是对的」

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实测：对 session-liveness.env 类冲突，`--merge` 直接取 integration 侧（无需外层手动），
      实跑输出贴任务体（见下方「实跑证据（修后）」）
- [x] 既有 integration-batch-merge 测试 + 新增测试全绿（`--for-task` scoped）：`scripts/test.sh
      --for-task gap-batch-merge-authoritative-direction-hardcoded-develop --allow-thin` → EXIT=0，
      `tests 20 · pass 20 · fail 0 · cancelled 0`，scoped 静态检查全 PASS
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**内层 scoped 绿；全量由外层
      verification 门承接**（本次任务只改 batch-merge 工具 + 其测试，scoped 已覆盖）

## Touches

- plugin/scripts/integration-batch-merge.sh（归边逻辑：resolve_as_ours → 支持 per-file 反向）
- plugin/test/integration-batch-merge.test.mjs（新断言 + 既有断言适配）
- plugin/loop/fast-mode-loop-tick.md / orchestrator-loop-tick.md（若提及归边默认）
- tasks/gap-batch-merge-authoritative-direction-hardcoded-develop.md（自身：勾 AC + 贴证据）

## 实跑证据（2026-08-08 14:1xZ — 缺陷实证，外层手动绕过工具）

```bash
# 外层手动绕过工具（manager 裁定）：
#   临时 worktree 真 merge → env 冲突取 integration 版（git show integration:… 覆盖）
#   → tasks/*.md 取 develop → commit c7903a43 + CAS 推进 develop + reconcile
# 工具侧：resolve_as_ours 只支持 develop；--shared-file 只会加进 develop-优先清单。
#   REAL-MERGE FAIL-CLOSED — code conflicts need a human（env 是真冲突，非 shared）
```

## 实跑证据（修后 2026-08-08 — 工具直接表达反向归边，无需绕过）

fixture：`orchestration/session-liveness.env` 双线修改——develop 侧 `SESSION_TRANSCRIPTS="inner /path"`
（名字不在 SESSION_TARGETS 表，缺陷版），integration 侧 `"quay /path"`（名字在表，修复版）；加上共享文件
`tick-log.md`/`tasks/one.md` 双线修改。内容判据：名字必须在目标表（`--reverse-edge-criterion`）。

```bash
$ integration-batch-merge.sh --root <repo> --merge \
    --integration-authoritative 'orchestration/session-liveness.env' \
    --reverse-edge-criterion <name-in-table.sh>
integration-batch-merge: measure unmerged_develop_files=0
integration-batch-merge:   content criterion satisfied for orchestration/session-liveness.env → integration-authoritative
integration-batch-merge: resolving integration-authoritative conflicts (integration side, 1):
integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (2):
integration-batch-merge: OK — develop real-merged to integration (merge commit a637a8d…)
integration-batch-merge: measure integration_ff_merges=0
$ git show develop:orchestration/session-liveness.env | grep SESSION_TRANSCRIPTS
SESSION_TRANSCRIPTS="quay /path"      # ← integration 侧（修复版）胜出；develop 缺陷 "inner" 未合回
$ git show develop:orchestration/tick-log.md
tick dev                              # ← 未指定的共享文件仍 develop-authoritative（AC3）
```

负控制（AC4，未盲选）：
```bash
$ integration-batch-merge.sh --root <repo> --merge          # 未声明反向归边
REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved
  code conflict files: orchestration/session-liveness.env    # env 是真冲突 → fail-closed

$ integration-batch-merge.sh --root <repo> --merge --integration-authoritative 'orchestration/session-liveness.env' \
    --reverse-edge-criterion <name-in-table.sh>              # integration 侧也缺陷（"archguard" 不在表）
  content criterion NOT satisfied for orchestration/session-liveness.env → genuine conflict (FAIL-CLOSED)
REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved   # 判据不过 → 两侧都不盲选
```

## Contract

measure   per_file_reverse_归边_works = `integration-batch-merge.sh --merge --integration-authoritative 'orchestration/session-liveness.env' --dry-run` 对 env 冲突报可消解（integration 侧）
band      per_file_reverse_归边_works = 1（指定文件取 integration 侧，其余 develop；无手动绕过）
invariant default_develop_authoritative = 1（未指定文件仍 develop-authoritative）
invariant fail_closed_preserved = 1（无判据的真冲突仍 fail-closed）
invoke    `bash plugin/scripts/integration-batch-merge.sh --merge --dry-run`（实跑贴回）
control   env 冲突 → 取 integration；tasks/*.md 冲突 → 取 develop；无判据冲突 → fail-closed
resume    归边能力 + 测试 + 文档分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 裁定归边 integration-authoritative + 指明工具缺陷「归你写任务体」；方向已定候选 A/B/C，
实现与测试归内层）
