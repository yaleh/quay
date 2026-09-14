---
id: gap-quay-native-task-create-duplicate-id-prepends-frontmatter
title: quay-native task create 对已存在 id 返回 0 并把第二段 frontmatter 前置（静默损坏任务文件 + ABI
  的 status 变成 todo）
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
## Proposal

**缺陷**：`quay-native task create <id> ...` 在 **id 已存在**时**返回 0**，并把一段新的 frontmatter
（含调用方给的 `--title` / `--status`）**前置**到已有的 `tasks/<id>.md` 之上。文件因此出现**两段
frontmatter**，而 ABI（`task view` / `task_list`）读到的是**前面**那一段 ⇒ 一条既有任务的状态被
**静默改写**成调用方传的那个值，同时文件内容被破坏（本仓库自己的任务文件里就能看到这个签名）。

**实测（2026-09-14，ad-arm1 真机，非推断）**：archguard 的任务 `TASK-TSCONFIG-EXTENDS` 当时是
settled `done`（`e997bce1 tasks: 翻 … done（driver 机械 fan-in）`，gate 事件 `payload={"from":"ready","to":"done"}`
actor=`quay-driver`）。一次 `task create TASK-TSCONFIG-EXTENDS --title "AC-257 驱动取证任务" --status todo`
之后：

- 提交 `2247ff8d tasks: TASK-TSCONFIG-EXTENDS task_write by cli:966329` 的 diff **逐字**显示新增了
  `title: AC-257 驱动取证任务` + `status: todo` + `---` 起的一段 frontmatter，**接在原来那段之前**；
- `task view` 随即报 `status: todo`（读到的是前置那一段）；
- 紧接着 promotion-driver 把它 `todo→ready`（`2e5cdf73`），**一条 settled done 的任务由此变成未 done**；
- 该文件此后带两段 frontmatter，直到被人工修复（`b5944654`）。

**为什么比"报个错"更贵**：

1. **静默**——退出码 0、无 stderr、文件看起来"写成功了"；失败形态与"创建成功"同形（硬规则 3b）。
2. **污染面是别人的仓库**——任何用 quay-native 的项目，只要有一次"重复建同 id 任务"，
   它的任务文件就被弄坏，且**没有任何守卫拦**（`task create` 是正常 ABI 动词）。
3. **它使"create 失败 ⇒ 说明已存在"这个惯用写法**（`verify-deliver-coldstart.sh` 的 AC-257 模式
   原实现即如此）**结构上永不成立** ⇒ 调用方的"复用"分支是死代码，而它看起来是活的。
4. 与 `gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy` 同族：
   **重复写一个已存在的对象**时缺少 fail-closed。

**与既有任务的关系（仅追溯，不构成前置声明）**：本任务只承载 `task create` 这一条动词的重复 id 语义；
`task_write` 的 body 是整篇替换（既有纪律）是另一件事，⛔ 不在此合并。

## Plan

1. 定位 `task create` 的提供方实现（`packages/quay-native/src/` 的 store/create 路径 + core CLI 的
   `task-create.ts` 分发），读出它对"已存在 id"的当前判定（预期：没有判定，直接写）。
2. 改成 **fail-closed**：id 已存在 ⇒ 非 0 退出、**零写入**（文件字节不变），报错文案点名该 id 已存在
   （⛔ 不是静默覆盖、⛔ 不是"帮你改成 update"）。
3. 单测两条：① 对已存在 id 跑 create ⇒ 非 0 ∧ 文件 md5 不变；② 对新 id 跑 create ⇒ 0 ∧ 文件出现。
   沿用既有 `makeWorkspace()`（裸 tasks 目录不是合法 workspace）。
4. 复核 AC-257 模式里那条「先 `task view` 再决定建不建」的写法是否仍需要（它是本缺陷的下游回避，
   产品修好后可作为防御保留，但⛔ 不得把它当成产品已修的替代）。

## Touches

- tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md（自身文件：勾 AC + 贴 invoke 证据授权）
- packages/quay/src/cli/task-create.ts（core CLI `task create` 分发：加 ABI 层存在性预检）
- packages/quay-native/src/store.ts（provider 写路径：`write()` 增 opt-in `{ create: true }`，存在即抛 AlreadyExistsError）
- packages/quay-native/bin/quay-native.ts（native CLI `task create` 子命令入口：走 `{ create: true }`，捕获后 exit 1）
- packages/quay-native/test/create-validation.test.mjs（AC3 断言宿主：QN-025 同族用例已在此，本次两个前门各加一组）
- plugin/test-isolation-violations.txt（test-isolation 棘轮清单：修好该文件的 R1/R4 后必须删掉其陈旧条目）

## AC

- [x] AC1 复现与修复：对一条**已存在**的 id 跑 `task create` ⇒ 退出码非 0，且该文件 **md5 逐字节不变**；贴命令、退出码与前后 md5。
  - **native 前门**：`QUAY_NATIVE_TASKS_DIR=<tmp> node packages/quay-native/bin/quay-native.ts task create EXIST-001 --title recreated --status todo`
    ⇒ **exit=1**；md5 前 `aa9b04f81d912c3dd464ace83e36b460` → 后 `aa9b04f81d912c3dd464ace83e36b460`（**逐字节不变**）；
    stderr = `task create: task "EXIST-001" already exists — refusing to create it (nothing written to disk; use `task edit` / task_write to modify an existing task)`。
  - **Core 前门**（真 workspace）：`node packages/quay/bin/quay.ts task create EXIST-002 --title "recreated by core" --status todo`
    ⇒ **exit=1**；md5 `b212ee68eaa79cadab63fcb647b5bf98` 前后同一。
  - **DoD（真任务文件，非夹具）**：在本 worktree 自己的 `tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md`（`status: ready`）上跑同一命令
    ⇒ **exit=1**；md5 `f465137dd3b49c7cc0fe20d8be2ad9da` 前后同一；`status:` 仍为 `ready`（未被改写）。
  - **负控制（证明断言能取假，不是恒真）**：把三个实现文件 `git checkout HEAD --` 回 pre-fix（**保留新测试**）⇒
    `existing id: CLI process exits non-zero` / `...stderr says it already exists and names the id` /
    `...file is byte-identical (md5 unchanged)` / `...the caller's --title did not reach the file` 与 core 侧同形三条**全部 FAIL**，
    而新 id 的三条仍 PASS。随后恢复实现，18/18 全绿。
  - 注：修复前该缺陷在本机**双向实测复现**（native 路径 exit 0 且标题/状态被覆盖、正文被清空；Core 路径 exit 0 且 `done`→`todo`），
    report 中"两段 frontmatter 前置"的字节形态未在本机复现（本仓库 `tasks/gap-d24e303c-…md` / `tasks/gap-run-static-checks-parallelize-boheidc.md` 里能看到该签名，
    但其上游是"body 里带整段 frontmatter"另一条路径）；本任务按 Plan 只收口**重复 id**语义，那条另计（见文末残差）。
- [x] AC2 正例仍在：对一条**不存在**的 id 跑 `task create` ⇒ 退出码 0，文件出现且 `task view` 读得到；贴读数。
  - native：`task create NEW-001 --title "a brand new task"` ⇒ **exit=0**，`NEW-001.md` 出现；
    `task get NEW-001` ⇒ `NEW-001: a brand new task [todo]`。
  - Core：`task create NEW-002 --title "brand new via core"` ⇒ **exit=0**；`task view NEW-002` ⇒ `NEW-002: brand new via core [todo]`。
  - 回归（`task edit` 逐字未变）：新 id ⇒ 仍建立（`updated UPSERT-001` + 文件出现）；已存在 id ⇒ 仍合并**不拒**（`updated EXIST-001`）。
- [x] AC3 单测：上面两条各一条断言；`scripts/test.sh` 对应泳道绿。
  - `bash scripts/test.sh --for-task gap-quay-native-task-create-duplicate-id-prepends-frontmatter --allow-thin`
    ⇒ **exit 0**，`tests 98 / pass 98 / fail 0`。
  - 断言宿主 `packages/quay-native/test/create-validation.test.mjs`：case 4（native 已存在 id，4 条断言）+ case 6（core 已存在 id，3 条）
    = AC1；case 5（native 新 id，3 条）+ case 7（core 新 id，1 条）= AC2。共 18 条断言全绿。
  - 途中 scoped 门两次 static 红，均已修（**两次都是"判据存在但从未在本文件上执行过"**，见文末残差 B）：
    `checked-in-write-check`（本文件 fixture 落在签入树内）与 `test-isolation-check`（棘轮条目陈旧）。

## DoD

真实落地 = 在**一个真实的任务文件**上跑一次对已存在 id 的 `task create`，该文件**字节不变**且退出非 0
（⛔ 只有单测不算）；并且新 id 的创建路径逐字未变。

**已达成**（读数见 AC1 第三条 + AC2 回归条）：真任务文件 `tasks/gap-quay-native-task-create-duplicate-id-prepends-frontmatter.md`
上 exit=1 且 md5 `f465137dd3b49c7cc0fe20d8be2ad9da` 前后同一、status 仍 ready；新 id 路径逐字未变（`edit` 的 upsert 语义也实测未变）。

## 实现要点（供审计）

- **判据放写侧、放锁内、放写前**（`store.ts#write`）：`{ create: true }` 时 `readRaw(id) !== null` ⇒ 抛 `AlreadyExistsError`。
  ① **锁内**是因为调用方在锁外预检是 TOCTOU——两个并发 `create` 同 id 都会读到"不存在"；
  ② **写前**是因为先写后回滚能过"退出码"断言但过不了字节断言（AC1 的 md5 才有意义）。
- **Core 前门只能锁外预检**（`client.taskGet`）：它经 Provider ABI 触达 store，而 ABI 的 `task_write` 没有 create-only 形参，
  传未知键会被 provider 的 zod schema 静默剥掉（硬规则 3b 形态）⇒ 彻底闭合需动 ABI，**不在本任务范围**，
  残余交错面如实写在 `task-create.ts` 的注释里；native 侧由 store 锁内那层兜住。

## 残差（如实记录，未并入本任务）

- **A. `verify-deliver-coldstart.sh` 的 AC-207 探针**（`plugin/scripts/verify-deliver-coldstart.sh:1147`）：
  `task_id` 是**字面量** `e2e-verify-207`（:1102），而 `ROOT` 默认持久（:6532 `${HOME}/quay-verify-coldstart/${PROJECT}`，脚本内无 `rm -rf "$ROOT"`）
  ⇒ **第二次对同一 root 跑 `--ac207-e2e` 的行为会变**：改前静默覆盖一条已 settled 的任务（探针"成功"），
  改后 fail-closed（打印 `FAIL: task create failed — AC-207 record NOT written`、`return 1`、不写记录）。
  这是本次改动**唯一**的消费方行为变化；该机件是 opt-in（`--ac207-e2e`）手动探针、不在 loop/CI 里，失败是响的且 fail-closed 而非静默，
  但"重跑同一 root"这条路径需要调用方自己处理"已存在"。**该文件不在 Touches 内 ⇒ 未改**。
- **B. 两条"判据存在但从未执行"的教训**（硬规则 3b 同形，两次都只在本次改动把文件带进 delta 后才现形）：
  `checked-in-write-check` 是 `--changed` 增量模式，本测试文件此前从未进过任何 delta ⇒ 其"fixture 落在签入树内"的违规长期不可见；
  `test-isolation-check` 的棘轮条目同理陈旧。修法是把 fixture 移入 `os.tmpdir()` 并**缩短**棘轮清单（清单只减不增）。
- **C. 另一条路径未收口**：`--body` 传入含完整 frontmatter 的整篇任务文本时，`serialize()` 会写出一份新 frontmatter + 原文（含其 frontmatter）作为正文，
  得到"两段 frontmatter"——与 report 观察到的字节形态一致，但根因是 body 内容而非重复 id。按 Plan 的范围声明**不在此合并**。

## Needs-Human

**执行 2026-09-14T08:03:14.184Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- 成因类：human-adjudication
- **2026-09-14 处置**：本条为历史记录，保留不改写。本轮由 per-task worker 重做：实现落 `b02d7f04c`，
  两道 static 红各自修复落 `b3de5e939` / `a6ce55a8e`，`--for-task` scoped 门 exit 0（98/98）。

## Needs-Human

**执行 2026-09-14T12:28:14.347Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 5
- run_id：wk-prod-1789367589
- session_id：7834ccd7-80bd-4375-8ed1-dc2d4a22c00e
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-quay-native-task-create-duplicate-id-prepends-frontmatter~wk-prod-1789367589~1789387501555-c063a0.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-quay-native-task-create-duplicate-id-prepends-frontmatter-wk-prod-1789367589.log
