---
id: gap-tests-never-clean-up-their-tmpdirs
title: "158,757 test fixture dirs accumulated in tmpfs over 9 days and filled 6.3GB
  of RAM until the inner hit quota errors"
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

2026-08-03 06:0xZ 内层派了三个 subagent 排查「磁盘配额错误」。外层实测根因：

**`/tmp` 是 tmpfs（内存盘，7.9 GB），里面有 166,923 个顶层条目、占 6.3 GB——占的是内存。**

前缀分布（清理前）：

| 前缀 | 个数 |
|---|---|
| `prepare-admission-` | **14,220** |
| `prep-check-` | 9,128 |
| `quay-loop-params-trig-fuzz-` | 4,337 |
| `adr-store-` | 3,590 |
| `document-store-` | 2,868 |
| `quay-qeng2-*` / `quay-doc-cli-*` | 各数百 × 十余种 |

最早的时间戳是 **2026-07-25 18:34**——**积了 9 天**，且仍在产生（清理时最新一条是当分钟的）。

### 契约满足了一半

[[gap-test-isolation-contract-is-unwritten]] 刚立的四条契约里，第一条是
「测试写入的路径必须是**每运行唯一**的（`mkdtemp`），不得是固定路径」。

**这一条是满足的**——正是因为满足，名字才带随机后缀，才会每次新建一个。
**缺的是第二半：建了之后必须删。**

**⇒ 这不是契约被违反，是契约不完整。** 补进那份契约，比新建一套机制便宜。

### 后果不是「磁盘满」而是「内存被吃掉」

tmpfs 占的是 RAM。清理前后的实测：

| | 清理前 | 清理后 |
|---|---|---|
| `/tmp` 已用 | 6,380 MB（80%） | **3,936 MB（50%）** |
| 顶层条目 | 166,923 | **8,665** |
| `free -m` 的 `shared`（tmpfs） | 4,623 MB | **2,823 MB** |
| `MemAvailable` | 5,291 MB | **7,370 MB** |
| swap 已用 | 1,779 MB | **1,142 MB** |

**今晚 swap 从 0 涨到 1.78 GB，主因就是这个**——不是负载，是泄漏。

### 速率与重现时间（外层 2026-08-03 06:43Z 实测活跃期速率，比首测高 4 倍）

**两个口径，差 4 倍，用高的那个**：

| 口径 | 速率 | 填回 166k 需要 |
|---|---|---|
| 9 天均值（158,757 / 9） | 17,600 个/天 | ~9 天 |
| **开发活跃期实测**（清理后 30 分钟新增 1,606 个） | **约 3,200 个/小时 ≈ 77,000/天** | **约 2 天** |

**首测那个 17,600/天是含空闲期的均值，会低估四倍。**
清理后 20 分钟内 `/tmp` 条目从 8,866 涨回 **10,118**——**回填是可观测的，不是推测**。

**⇒ 紧急度比任务体初稿写的高：活跃开发下约 2 天重现，不是 9 天。**

前 5 名前缀与首测一致（`prepare-admission-` 164、`prep-check-` 69、`adr-store-` 36、
`quay-loop-params-trig-fuzz-` 32、`document-store-` 20 / 30 分钟），说明**漏点稳定**，
AC1 的归因表会很快收敛。

## Contract

```
measure  tmp_entries = `ls -1 /tmp | wc -l` 输出的行数字段
measure  tmp_used_mb = `df -m /tmp` 第二行的 Used 字段（MB）
measure  leaked_after_suite = 跑一次全量套件前后 `ls -1 /tmp | wc -l` 的差值字段
band     leaked_after_suite = 0                                   # 一次套件跑完不应净增任何条目
invariant 清理规则永不匹配 `/tmp/claude-*` 与 `/tmp/quay-wt-*`      # 前者是会话数据，后者是在用 worktree
invoke   `bash scripts/test.sh` 前后各跑一次 `ls -1 /tmp | wc -l`
control  故意留一个不清理的 mkdtemp fixture ⇒ leaked_after_suite 必须 > 0
resume   n/a: 单次测量，无中途产物
```

## Chosen mechanism

**先量出是谁在漏，再修那几个；不要全局加清理钩子。**

1. **归因**：跑一次全量套件，记录前后 `/tmp` 新增条目及其前缀。
   **前缀直接指向创建它的测试**（`prepare-admission-` → `prepare-admission-check` 的测试，
   `quay-doc-cli-*` → 文档 CLI 的测试）。输出一张「前缀 → 测试文件 → 每次跑泄漏数」的表。
2. **修漏得最多的那几个**：按上表的头部处理，用 `try/finally` 或 `t.after()` 删除。
   **不追求一次修完全部**——头部几个就覆盖大半（`prepare-admission-` 一个就占 14,220 / 158,757 ≈ 9%）。
3. **补契约**：在 [[gap-test-isolation-contract-is-unwritten]] 的四条后加第五条——
   **「`mkdtemp` 建的目录必须在同一测试内删除」**，并接进它已有的扫描器
   （静态可判：有 `mkdtemp` 而无对应的 `rm`/`rmSync`/`after` 即报出）。
4. **一次性清理留给运维，不进代码**：外层 2026-08-03 已清一次的命令记进任务体作为参考，
   但**清理脚本不是修复**——`leaked_after_suite = 0` 才是。

**不做**：不加全局 `process.on('exit')` 清理钩子（它在 `process.exit()` 下不执行，
而本仓库已知有 8 个手写 harness 用 `process.exit(1)`——那正是它会漏掉的路径）；
不改 tmpfs 大小；不把 `/tmp` 换成磁盘路径（那只是把内存问题换成 I/O 问题）。

## Acceptance Criteria

- [ ] AC1: 归因表完成——「前缀 → 创建它的测试文件 → 每次全量套件泄漏几个」，
      **依据是套件前后的实测差值，不是猜测**
- [ ] AC2: 修复泄漏量前 5 的测试；每个用 `try/finally` 或 `t.after()`，**不用全局钩子**
- [ ] AC3: **主判据**——修复后跑一次全量套件，`leaked_after_suite` 相比修复前**下降 ≥80%**；
      两次测量的原始数字都贴进任务体
- [ ] AC4: **负控制**——故意在一个 fixture 里去掉清理，断言 `leaked_after_suite > 0`；
      恢复后回到 0。两个方向都要有
- [ ] AC5: 契约补第五条「`mkdtemp` 建的必须删」，并接进 `test-isolation-check.ts` 的静态扫描；
      违规名单是 shrink-only 棘轮
- [ ] AC6: 扫描器**永不匹配** `/tmp/claude-*` 与 `/tmp/quay-wt-*`——用 fixture 断言这两个前缀被排除
- [ ] AC7: 任务体记录外层 2026-08-03 那次一次性清理的命令与结果（158,757 条目 / 2,454 MB），
      **并注明清理脚本不是修复**
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1 的归因表与 AC3 的修复前后对照贴进任务体
- [ ] AC4 的双向负控制输出贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**隔离契约的第一条被满足，才使这个泄漏成为可能**——
      `mkdtemp` 保证了每次新建一个唯一目录，而没有任何一条规则要求删掉它。
      **一条只写了一半的契约，比没有契约更容易让人以为问题已经解决**

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- docs/analysis/test-shape-analysis.md

## Dispatch review

reviewer: outer
at: 2026-08-03T06:15:00Z
changed: 初稿想加一个全局退出钩子；改为「先归因再修头部几个」——理由是本仓库已知有 8 个手写 harness 在失败路径用 `process.exit(1)`，而 `process.on('exit')` 在那条路径下不执行，全局钩子恰好会漏掉最需要它的地方。并把「清理脚本不是修复」写进 AC7，因为外层已经清过一次，容易让人误以为问题已解决——判据是 `leaked_after_suite = 0`，不是 `/tmp` 当下有多空
