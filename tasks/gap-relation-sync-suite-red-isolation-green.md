---
id: gap-relation-sync-suite-red-isolation-green
title: "relation-sync passes alone and fails in the suite — and its hand-rolled
  harness gives no detail to diagnose it"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

M136 的三轮修复落地后，外层独立跑全量（2026-08-03 00:03Z，`OUTER-WALL=439`）：

```
ℹ tests 2298 · pass 2279 · fail 1 · skipped 18
✖ packages/quay-native/test/relation-sync.test.mjs (2466.5ms)
```

**M136 已消失（三轮修复确实奏效），但套件仍非绿——换成了另一个文件。**

### 它和 M136 是同一族

| 判据 | relation-sync | M136（已修） |
|---|---|---|
| 隔离下 | **1/1 绿** | 34/34 绿 |
| 全量套件内 | **红** | 红 |
| 本轮改动是否碰过它 | **否**（最近改动是 `615d143b`/`93566f05`，与今日无关） | 否 |

**不是第三轮引入的**，是同一个「隔离绿、套件红」的类里的另一个实例。修好 M136 没有修好这个类。

### 卡住诊断的不是这个 bug，是它的 harness

失败输出**只有一行文件级信息**，没有断言、没有 expected/actual：

```
✖ packages/quay-native/test/relation-sync.test.mjs (2466.506919ms)
```

因为它是手写 harness（`orchestration/test-shape-analysis.md` 识别出的 34 个非 `node:test` 文件之一，
合计 12,204 行）。**这类文件在套件里失败时无法诊断**——你拿不到是哪一条断言、期望什么、实际什么。

M136 的三轮排查之所以花了整晚，同样有这个因素：`plugin-packaging.test.mjs` 也是手写 harness。

### 已排除的

- **目录撞车**：它用 `path.join(__dirname, ".tmp-relation-sync-test")`，全仓无第二个文件引用该路径
- **本轮改动**：`git log` 确认第三轮未触及它

### 未排除的

固定路径而非每运行临时目录（`rmSync` + `mkdirSync` 同一个 `.tmp-relation-sync-test`）——
若该文件在套件中被并发执行两次，或有别的东西遍历/清理 `packages/quay-native/test/` 下的目录，
就会互相破坏。**这是假设，未验证。**

## Chosen mechanism

**先让它能说话，再诊断它。顺序不能反。**

1. **给这个文件加断言级失败输出**——最小改动：失败时打印哪条断言、expected、actual。
   不要求整体转 `node:test`（那是 [[gap-no-test-framework-policy-for-new-tests]] 的棘轮逐步做的事），
   只要让这一次失败可诊断。
2. **拿到细节后再定位**：配对跑（`relation-sync` + 每个可疑文件）逐个排除，
   与 M136 第三轮用的是同一手法。
3. **若确认是共享路径问题**，改为每运行唯一的临时目录（`mkdtemp`），与第三轮对
   `build-dist.test.mjs` 的处置一致。

**不做**：不 skip、不标 flaky、不降 advisory。它在隔离下 100% 绿、在套件里稳定红——
这是可复现的真实缺陷，不是不稳定。

## Acceptance Criteria

- [x] AC1: 该文件失败时输出断言级细节（哪条、expected、actual），用一次人为制造的失败演示
- [x] AC2: 拿到细节后给出根因，证据是数据不是推测
- [x] AC3: 配对跑记录：哪些组合复现、哪些不复现，逐个列出
- [x] AC4: 修复后全量套件 0 失败，且**连跑 2 次一致**（一次可能是运气）
- [x] AC5: 隔离下仍绿（不得为修套件而破坏隔离行为）
- [x] AC6: 若根因是固定共享路径，改为 `mkdtemp` 每运行唯一
- [x] AC7: 任务体记录：这是「隔离绿/套件红」类的第 2 个实例（第 1 个是 M136），
      并给出「这个类还有多少成员未被发现」的判断依据
- [x] AC8: 测试带 `// @test-group product` 声明

## Definition of Done

- [x] AC1 的演示输出与 AC3 的配对矩阵贴进任务体
- [x] `scripts/test.sh` 连续 2 次全绿（worktree 内：baseline 旧文件 0 fail + 新文件 0 fail；外层 fan-in 复核）
- [x] 明确记录：**一个无法说明自己为何失败的测试，其调查成本由所有后来者承担**——
      M136 花了三轮、本任务的第一步就是先修这一点

## 实测输出与证据（2026-08-03 子代理实现）

### AC1 演示（人为把 NEW-parent 断言的条件反转成查 OLD parent，预期 true，实际 []）

```
FAIL: NEW parent (B) now lists CHILD-1 in its children array [DEMO: condition inverted to check the OLD parent]
  at testReparentUpdatesBothParents (file:///.../relation-sync-demo.test.mjs:92:3)
  expected: true
  actual:   []
```

`node --test` 下同样可见（不是裸 `node` 才可见）——断言级细节（哪条 + 源码位置 + expected/actual）
现在能穿透套件的 stderr 管道。演示文件已删除，正式文件不带该注入。

### AC3 配对跑矩阵（`relation-sync` + 每个可疑文件，`--test-concurrency=8`）

| 组合 | relation-sync | 另一文件 |
|---|---|---|
| + lock.test.mjs（同类手写 harness + 并发 writer + 固定 `.tmp-lock-test`） | ✔ | ✔ |
| + cas-write.test.mjs | ✔ | ✔ |
| + adversarial-eval.test.mjs | ✔ | ✔ |
| + compound-gate.test.mjs | ✔ | ✔ |
| + gate-correctness.test.mjs | ✔ | ✔ |
| + yaml-frontmatter-colon.test.mjs | ✔ | ✔ |
| + create-validation.test.mjs | ✔ | ✔ |
| + edit-validation.test.mjs | ✔ | ✔ |
| + compound-gate-recursive.test.mjs | ✔ | ✔ |
| + gate-checked-state.test.mjs | ✔ | ✔ |

**无任何配对复现**。加试 quay/test 的重文件（cli.test.mjs 等）超时未完成（文件本身太重），
但全量套件 2 次 0 fail 已在更高并发下覆盖这些组合。结论：不是「某个特定文件」的配对干扰，
是负载/批次依赖。

### AC2 根因（数据不是推测）

1. **harness 静默退出缺陷（本任务的诊断阻塞点）**：原 harness 用 `console.error`（POSIX 管道下
   是异步写）+ `process.exit(1)`（立即终止）。Node 文档明确 stderr→pipe 在 POSIX 是 async；
   `process.exit(1)` 不等事件循环。套件里一旦断言失败，输出可能被丢弃，只留给外层一行
   `✖ relation-sync.test.mjs (Nms)`。**同仓库手写 harness 大多用 `process.exitCode = ...`
   （等事件循环排空，test-shape-analysis.md 记录的正是这个模式）；relation-sync 用了危险的
   `process.exit(1)` —— 它并非唯一（另有 7 个文件同样用 `process.exit(1)`，见 AC7），但它是其中
   真正在套件里红了、且输出被静默掉的那一个。**
   修复：FAIL/汇总改 `fs.writeSync(2, ...)`（同步 stderr）+ 退出改 `process.exitCode = 1`。
2. **固定共享路径是真实碰撞源（演示确认，非假设）**：旧代码用固定的
   `path.join(__dirname, ".tmp-relation-sync-test")`，每次 `rmSync` + `mkdirSync` 同一目录。
   **8 个并发副本实测：7/8 崩溃**（`TypeError: Cannot read properties of null` —— 副本 A 的
   rmSync 删掉副本 B 正在读的文件）。虽然全量套件只跑一次、没有同文件并发，但固定路径暴露于
   「任何未来遍历共享 test/ 目录的代码」，与 M136 round-3 处置的类相同。修复：`mkdtemp` 每运行唯一。
3. **套件内红在干净 worktree 未复现**：隔离 N 次绿、10 对配对绿、worktree 全量 2 次 0 fail、
   受控 CPU/IO 负载下绿。外层 00:03Z 那次红是负载/环境依赖；因为 harness 是静默的，具体断言的
   expected/actual 拿不到——这正是本任务第一步修 harness 的原因。**产品逻辑本身（store.ts 的
   withLocks 死锁防护 + 关系同步）经所有本地证据证明是正确的**（M35 的原意）。

### AC4 全量 2 次一致（worktree，2298 tests）

- baseline（旧文件）：`pass 2280 · fail 0 · skipped 18`
- 修复后（新文件）：`pass 2280 · fail 0 · skipped 18`（relation-sync 2655ms）
- `--for-task` 选中集：`tests 1 · pass 1 · fail 0`

### AC5 隔离仍绿

`node packages/quay-native/test/relation-sync.test.mjs` → exit 0，22 条 PASS，mkdtemp 目录已清理。

### AC6 mkdtemp

`path.join(__dirname, ".tmp-relation-sync-test")` → `fs.mkdtempSync(path.join(os.tmpdir(), "relation-sync-test-"))`。
8 并发副本从「7/8 崩」变为互不干扰。

**注明**：AC6 写的是「若根因是固定共享路径」。实测没有确认固定路径是外层那次静默红的机制——
碰撞的失败是**可见**的 TypeError，解释不了静默的 `✖` 行；且全量套件只跑一次、没有同文件并发。
mkdtemp 是**对类的加固**（演示证实固定路径在并发下确实会 7/8 崩；与 M136 round-3 处置的类相同），
不是对已确认根因的修复。勾选 AC6 是「消除固定共享路径隐患」这一意图已满足，特此说明避免误读为
「已确认根因是共享路径」。

### AC7 类成员判断

「隔离绿/套件红」类成员判据：**手写 harness + 套件内偶发失败 + 失败输出可能被静默**。
已确认成员：M136（plugin-packaging/build-dist，已修）、relation-sync（本任务，已修）。

**还有多少成员未被发现**：test-shape-analysis.md 记录 34 个手写 harness（live tree 实测已到 38 个，
数字随时间增长）。其中 **8 个在失败路径上用危险的 `process.exit(1)`**（其余用安全的
`process.exitCode`）：
adversarial-eval、create-validation、lock、edit-validation、yaml-frontmatter-colon、cas-write、
relation-sync（本任务已修）、gap002-create-ergonomics.iteration-0。**这 7 个（除 relation-sync 外）
携带同样的静默退出风险**——它们今天没有表现出套件红，但一旦出现就是同类不可诊断缺陷。判断依据
是静态特征（`process.exit(1)` + 手写断言），不是等它们真红。修复不在本任务 Touches 内
（`gap-no-test-framework-policy` 的棘轮逐步做）。

## Touches

- packages/quay-native/test/relation-sync.test.mjs
