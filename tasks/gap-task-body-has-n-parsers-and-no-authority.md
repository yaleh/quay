---
id: gap-task-body-has-n-parsers-and-no-authority
title: "Two ## Touches parsers disagree on the same line, and the one fast mode
  uses for concurrency eligibility is the wrong one"
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

**这个缺陷是从一个即将被丢弃的任务里读出来的。** [[ADR-022]] 裁定放弃经典循环，
其未落地产物随之作废；外层在执行不可逆删除前逐个读了那 5 个只存在于 worktree 的任务，
其中 `DIR-124-F5` 声称 `docs/references/repo-ground-truth.md` §3 第一条是**假的**。

实测后**两边都不对**，而真相比两者都有用。

### §3 第一条说什么

> Parenthetical comments after a backticked path (e.g. `` `.quay/config.yml (this repo's own…)` ``)
> break the exact-path match — the whole line is treated as the path.

### 实测：两个解析器对同一行给出不同结果

输入 `` - `plugin/scripts/foo.ts` (new) ``：

| 解析器 | 结果 | 判定 |
|---|---|---|
| `touches-orthogonality-check.ts` 的 `parseTouches` | `` "plugin/scripts/foo.ts`" `` ← **残留反引号，路径错** | §3 第一条**成立** |
| `task-status-drift-check.ts` 的 `parseTouchEntries` | `"plugin/scripts/foo.ts"` ✓ | §3 第一条**不成立** |

**⇒ §3 第一条既不是真也不是假，它是「取决于哪个解析器」。**
`task-status-drift-check` 的 `stripTouchAnnotation` 是 2026-08-03
[[gap-reverse-drift-check-buries-true-positives-in-noise]] 才加上的；
`touches-orthogonality-check` 没有跟着改。

### 为什么这条要紧

**`touches-orthogonality-check.parseTouches` 正是快速模式每批用来判并发资格的那个**
（`concurrent-batch-scheduler.ts` → `checkTouchesPair`）。

一个 `## Touches` 写成 `` - `foo.ts` (new) `` 的任务，其资格判定会拿到一个**带残留反引号的错路径**。
错路径匹配不到任何文件 ⇒ 展开为空 ⇒ 触发保守分支 `matched nothing (likely a typo) → serialize`。

**这与 [[gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet]] 是同一处的两个成因**：
那个是「新文件展开为空」，这个是「注释未剥离导致路径错、也展开为空」。
两者产生**同一条误导性的理由**——「像是笔误」，而真实原因分别是「文件还没建」与「注释没剥掉」。

### 同族的第二条：`task-schema.ts` 只警告不阻断

`DIR-124-F1`（同一批被丢弃的任务）主张 `task-schema.ts` 应当**拒绝** `## Touches` 之后的
非 `##` 标题内容。今晚的实证比它原本的论据更强：

- 3 个任务文件 frontmatter 缺 `id`，存在 **8–9 天**（最早 2026-07-25 19:39）
- `task-schema-check.ts` 全程在场，只发 **INFO 非阻断**警告
- 直到 web 首页 500 才被发现（[[gap-serve-task-list-dies-on-one-malformed-task]] AC7）

**共同根因：任务体有 N 个解析器/校验器，没有一个是权威，且没有一个会失败。**

## Contract

```
measure  parser_agreement = `node --experimental-strip-types plugin/test/touches-parser-parity.test.mjs` 输出的 pass/fail 字段
measure  schema_exit = `node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/fixture.md` 输出的 exit_code 字段
band     agreement = 全部解析器对同一 fixture 集给出逐条相同的路径集
invariant fixture 集在改前后一致                                  # 变了则一致性不可比
invoke   `node --experimental-strip-types plugin/scripts/task-schema-check.ts <file>`
control  构造 `` - `a.ts` (new) `` 一行 ⇒ 所有解析器必须都得到 `a.ts`，一个都不许留反引号
resume   n/a: 单次判定，无中途产物
```

## Chosen mechanism

**一个共享的解析器，其余全部改为调用它。不新增第三个实现。**

1. **抽出单一 `parseTouchEntries`**——用 `task-status-drift-check.ts` 里那个**已经对**的实现
   （它有 `stripTouchAnnotation`，且是今晚踩坑后得到的），放到两边都能依赖的位置。
2. **`touches-orthogonality-check.ts` 改为调用它**，删掉自己那份。
   **这是消灭双源，不是加检查。**
3. **一致性回归测试**：一组 fixture（带 `(new)`、`(refactor …)`、反引号内外注释、
   目录条目、通配），断言**所有**解析器逐条相同。
4. **`task-schema.ts` 的 `## Touches` 后置内容检查改为阻断**（`DIR-124-F1` 的主张），
   但**先报出而不阻断一个窗口**，用违规名单棘轮收敛——存量未知，一次性阻断会逼人敷衍。

**不做**：不改 `checkTouchesPair` 的判定逻辑（它对，被喂了错输入）；
不新增第三个解析器；不在本任务里改 `prepare-admission-check.ts`
（它未导出解析函数，需先确认它是否也有一份自己的实现——那是本任务 AC5）。

## Acceptance Criteria

- [x] AC1: 单一 `parseTouchEntries` 抽出，`touches-orthogonality-check.ts` 改为调用它，
      **删掉自己那份**（用 grep 证明仓库里只剩一处实现）
- [x] AC2: **双向负控制**——`` - `a.ts` (new) `` 在所有解析器下都得到 `a.ts`；
      故意注入一个不剥离注释的解析器 ⇒ 一致性测试必须失败
- [x] AC3: 一致性回归 fixture 覆盖：`(new)`、`(refactor X)`、反引号内注释、反引号外注释、
      目录条目、`*` 通配。每种都断言全部解析器逐条相同
- [x] AC4: 修好后重跑 [[gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet]] 的
      「matched nothing」场景，确认那条误导性理由**只剩「文件尚未创建」一个成因**
- [x] AC5: 查明 `prepare-admission-check.ts` 与 `select-tests-for-touches.ts` 是否各有一份
      内部解析实现（两者都未导出解析函数）；有则一并改为调用共享实现，无则记录
- [x] AC6: `task-schema.ts` 的 `## Touches` 后置内容检查实现为**报出**，违规名单是
      shrink-only 数据文件；**本任务不改为阻断**，阻断是下一个窗口的事
- [x] AC7: **修正 `docs/references/repo-ground-truth.md` §3 第一条**——
      不写「真」也不写「假」，写实测事实：修好前两个解析器结论不同，修好后统一
- [x] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [x] AC2 的双向负控制与 AC3 的 fixture 一致性输出贴进任务体（见下方 ## Evidence (landed)）
- [ ] `scripts/test.sh` 连跑 2 次全绿（本 worktree 未跑全量——CPU 纪律 + sigma 测量窗口；scoped `--for-task` 与受影响测试集已绿，全量在 fan-in 验证）
- [x] 明确记录：**这条缺陷是从一个即将被永久删除的任务里读出来的**。
      「坚决应用新模式」是对的方向，但方向覆盖的是**被放弃模式的产物**，
      不是**碰巧被那个模式记录下来的、关于现行机制的事实**。
      五分钟的阅读换回了一个活缺陷——不可逆操作之前那五分钟应当是默认动作
      （本任务 Proposal 首段即此记录；§3 修正按 AC7 写成实测事实而非真/假）

## Evidence (landed, 2026-08-03)

**共享解析器**：`plugin/scripts/touches-parser.ts` 的 `parseTouchEntries` 是唯一实现
（grep `function parseTouchEntries` → 仅该定义一处；experiments 下是 symlink，无第二份内容）。
全部调用方改为委托：`touches-orthogonality-check.ts`（`parseTouches`，仅保留 trailing-slash→`**`
glob 成形）、`task-status-drift-check.ts`（import + re-export，两镜像 byte-identical）、
`select-tests-for-touches.ts`（`parseBulletList`）、`prepare-admission-check.ts`
（`extractTouchesGlobs`）、`task-schema.ts`（`checkTouches`）。

**AC3 — fixture 一致性（每个 fixture 全部解析器逐条相同）**：

```
"- `a.ts` (new)"                                        => ["a.ts"]
"- `a.ts` (refactor Verify phase)"                      => ["a.ts"]
"- `code/bar.ts (new)`"                                 => ["code/bar.ts"]
"- `code/foo.ts` (extract from)"                        => ["code/foo.ts"]
"- packages/quay/src/gate/config"                       => ["packages/quay/src/gate/config"]
"- packages/quay/**/*.test.mjs"                         => ["packages/quay/**/*.test.mjs"]
"- code/plain.ts"                                       => ["code/plain.ts"]
"- ./packages/a.js"                                     => ["packages/a.js"]
"- \"packages/b.js\""                                   => ["packages/b.js"]
"- `experiments/.../*run-identity*`"                    => ["experiments/.../*run-identity*"]
```
涉及的解析器：`parseTouchEntries` / `parseBulletList` / `extractTouchesGlobs` /
`parseTouches(...).globs` / `checkTouches({body},"gap").globs` —— 全部一致。

**AC2 — 双向负控制**：
- 正向：`` - `a.ts` (new) `` 在所有解析器下都得到 `["a.ts"]`，无一留反引号。
- 负向：注入复刻旧 `parseTouches` 的不剥离注释解析器（`` - `a.ts` (new) `` → `["a.ts`"]`），
  一致性断言**必须失败**（`assert.throws` 通过）。这是「不剥离注释的解析器」被机械拒绝的证明。

**AC4 — dispatch-eligibility 场景重跑**（gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet）：
- `- `foo.ts` (new)`（foo.ts 已存在）→ 解析为 `["foo.ts"]`（无残留反引号）→
  `checkTouchesPair` 判 **disjoint**，reason 不含 `matched nothing|typo`。
- `- `brand-new.ts` (new)`（文件尚未创建）→ 解析为 `["brand-new.ts"]`（路径干净）→
  `checkTouchesPair` 仍触发 `matched nothing`，但**成因只剩「文件尚未创建」**——注释剥离不再造成误判。

**AC5 — 查明结果**：`prepare-admission-check.ts` 与 `select-tests-for-touches.ts` **各有一份**
内部解析实现（`_extractGlobsFromSection` 与 `parseBulletList`，二者都含残留反引号缺陷），
均已改为调用共享实现（前者更名导出为 `extractTouchesGlobs`）。task-schema.ts 的 `checkTouches`
内联解析同样改为调用共享实现。

**AC6**：`task-schema.ts` 新增 `checkTouchesPostContent`（A11，report-only——永远 `ok:true`、
只进 findings，不改 verdict）。`task-schema-check.ts` 现在把 findings 打印为 INFO。
违规名单 `plugin/touches-post-content-violators.txt`（shrink-only，`# baseline-count: 17`，
实测 2026-08-03 共 17 个任务带 Touches 段内非 bullet 内容）。本任务不阻断。

**验证**：`scripts/test.sh --for-task gap-task-body-has-n-parsers-and-no-authority` 绿
（58 pass / 0 fail / 1 opt-in skip）；受影响测试集 244 pass / 0 fail；`sync-vendor.sh --check` 绿。

## Touches

- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/task-status-drift-check.ts
- plugin/scripts/task-schema-check.ts
- plugin/test/touches-parser-parity.test.mjs
- docs/references/repo-ground-truth.md

## Dispatch review

reviewer: outer
at: 2026-08-03T04:52:00Z
changed: 本任务不是 `DIR-124-F5` 的复活——F5 主张「§3 第一条是假的」，实测表明**它和原文档都不对**，真相是两个解析器结论不同；也不是 `DIR-124-F1` 的复活——F1 的论据是模板卫生，而今晚的实证（3 个缺 `id` 的文件、非阻断 INFO 警告 8 天无人处理）更强。两者被合并为一个根因：**任务体有 N 个解析器/校验器，没有一个权威，没有一个会失败**
