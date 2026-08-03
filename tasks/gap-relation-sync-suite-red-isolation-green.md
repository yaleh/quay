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

- [ ] AC1: 该文件失败时输出断言级细节（哪条、expected、actual），用一次人为制造的失败演示
- [ ] AC2: 拿到细节后给出根因，证据是数据不是推测
- [ ] AC3: 配对跑记录：哪些组合复现、哪些不复现，逐个列出
- [ ] AC4: 修复后全量套件 0 失败，且**连跑 2 次一致**（一次可能是运气）
- [ ] AC5: 隔离下仍绿（不得为修套件而破坏隔离行为）
- [ ] AC6: 若根因是固定共享路径，改为 `mkdtemp` 每运行唯一
- [ ] AC7: 任务体记录：这是「隔离绿/套件红」类的第 2 个实例（第 1 个是 M136），
      并给出「这个类还有多少成员未被发现」的判断依据
- [ ] AC8: 测试带 `// @test-group product` 声明

## Definition of Done

- [ ] AC1 的演示输出与 AC3 的配对矩阵贴进任务体
- [ ] `scripts/test.sh` 连续 2 次全绿
- [ ] 明确记录：**一个无法说明自己为何失败的测试，其调查成本由所有后来者承担**——
      M136 花了三轮、本任务的第一步就是先修这一点

## Touches

- packages/quay-native/test/relation-sync.test.mjs
