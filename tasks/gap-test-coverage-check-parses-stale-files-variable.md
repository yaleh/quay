---
id: gap-test-coverage-check-parses-stale-files-variable
status: done
labels: []
parent: null
children: []
extra: {}
---

**type:** execution

## Proposal

`scripts/test-coverage-check.ts`（M174/DIR-110 交付物，被 `.github/workflows/ci.yml:34-35` 接线：
`node --experimental-strip-types scripts/test-coverage-check.ts --selftest` 和 `... test-coverage-check.ts`；
`adr/ADR-019` 的 enforcement 也引用它）解析 `scripts/test.sh` 的 `files=(...)` 行来取得 canonical glob：

```ts
// scripts/test-coverage-check.ts:63-68
/** Parse the space-separated glob patterns out of `scripts/test.sh`'s `files=(...)` line. */
function parseCanonicalGlobs(repoRoot: string): string[] {
  ...
  const m = src.match(/files=\(([^)]*)\)/);
  if (!m) return [];
  ...
```

但 `scripts/test.sh` 早已把该变量改名为 `glob=`（layer-grouping，第 125 行）：

```bash
local glob=(packages/*/test/*.test.mjs plugin/test/*.test.mjs experiments/quay-perpetual-stream/test/*.test.mjs)
```

**正则 `files=\(([^)]*)\)` 匹配不到 `glob=(...)` → `parseCanonicalGlobs` 返回空数组。** 该检查的
「canonical glob 单一来源（ADR-004）」前提被静默破坏。

### 证据

1. **引用**：`.github/workflows/ci.yml:34-35`（`--selftest` + 常规模式）、`adr/ADR-019` enforcement、
   `scripts/test-coverage-check.ts` 头注释（第 9 行「PARSED from scripts/test.sh's own files=(...) line」）。
   **它不是孤儿脚本**——有 CI 接线，但解析器失效。
2. **解析 vs 现状不匹配**：正则 `/files=\(([^)]*)\)/` 对 `local glob=(...)` 无匹配。
3. **影响**：`--selftest` 或常规模式可能误判「无文件可达」（空 glob → 所有 product/plugin-tier 测试
   都「不可达」→ 误报红），或 selftest 红。外层/policy 子代理观察其 selftest 红，但最初误判为「孤儿脚本」。
   **真实缺陷是解析器与 test.sh 结构漂移**（ADR-004 单一来源原则的具体失效）。

## Chosen mechanism

1. **修解析器**：`parseCanonicalGlobs` 同时匹配 `files=(...)` 与 `glob=(...)`（或改为从 test.sh 的函数
   提取 glob 行，避免硬编码变量名）。
2. **自检**：`--selftest` 必须验证「解析出的 glob 非空」——空 glob 是解析失败信号，应 fail-loud
   而非静默返回空数组。
3. **接回 CI 验证**：修复后 CI 的 `test-coverage-check.ts` 步骤应绿。

## Acceptance Criteria

- [x] AC1: `parseCanonicalGlobs` 能解析当前 test.sh 的 `glob=(...)` 行（且仍兼容旧 `files=`）
      —— 实现在 `scripts/test-coverage-check.ts`：先匹配当前 `local glob=(...)`（3 个 pattern 全解析出），
      无 `glob=` 时回退旧 `files=(...)`；解析后再做非空过滤，保证运行时 `local files=() f`（空捕获）
      不会被误当成 glob（REFUTE round-1 修正：空白-only 内容如 `glob=( )` 也 fail-loud）。
- [x] AC2: 解析出非空 glob（空 = fail-loud，不是静默成功）——无 glob 行 / `glob=()` / 空白-only / 空捕获
      一律 **throw**，CLI 捕获后 stderr 打印原因、exit 2；selftest 与单测都验证了 fail-loud 路径
      （含 `glob=( )`、`glob=(\n)`、`local glob=( ) f` 等 6 种坏形态）。
- [x] AC3: `node --experimental-strip-types scripts/test-coverage-check.ts --selftest` 绿
      —— `test-coverage-check --selftest: 10 passed, 0 failed`（见 DoD 实测）。
- [x] AC4: `node --experimental-strip-types scripts/test-coverage-check.ts` 常规模式绿（不再误报全文件不可达）
      —— `canonical=181 discovered=123, PASS: 0 orphan(s)`（见 DoD 实测）。
- [x] AC5: 与 `scripts/test.sh` 默认 glob 的实际文件集一致（ADR-004 单一来源保持）
      —— selftest + 单测都做了 realpath-dedup 后的集合比对：canonical set == `scripts/test.sh --list-files`（168 个）。
- [x] AC6: 测试带 `// @test-group engine` 声明——产出 `plugin/test/test-coverage-check.test.mjs`，第 1 行即声明。

## Definition of Done

- [x] AC3/AC4 的实测输出贴进任务体（见下方「实测输出」）
- [x] 明确记录：**解析器与它声称的单一来源漂移，会让检查静默失效**——ADR-004 的执行机制本身
      需要自检（空 glob fail-loud）（见下方「Resolution」）
- [x] 记录这次最初被误判为「孤儿脚本」的经过：实际有 CI 接线，是解析失效（见下方「Resolution」）

## Resolution

**修复**（`scripts/test-coverage-check.ts`）：`parseCanonicalGlobs` 现在同时匹配当前 `local glob=(...)`
（layer-grouping 改名后）与旧 `files=(...)`（AC1），并要求捕获**非空**——无 glob / 空 glob 一律
throw（fail-loud，AC2），CLI 捕获后 exit 2，不再静默返回 `[]`。

**这个缺陷的机制比「孤儿脚本」更微妙**：不只是正则没匹配到 `glob=`。旧正则 `/files=\(([^)]*)\)/`
对 test.sh **匹配到了**——它匹配到了 `run_selected()` 里运行时数组 `local files=() f`（空捕获），
于是 `parseCanonicalGlobs` 返回 `[]`。空 canonical 集 → `discoverProductTierTestFiles` 发现的每一个
product/plugin-tier 测试文件都成了「孤儿」→ CI 的 `test-coverage-check` 步骤误报红（或更糟：对
一个真正空集的 glob 反而绿）。**解析器与它声称的单一来源漂移，会让检查静默失效**——ADR-004 的
执行机制本身需要自检，这就是「空 glob = fail-loud」的由来。

**最初被误判为「孤儿脚本」的经过**：外层/policy 子代理观察到其 selftest 红，一度以为
`test-coverage-check.ts` 是没有接线、被遗忘的脚本。实查 `.github/workflows/ci.yml:34-35` 与
`adr/ADR-019` enforcement 后确认**它有 CI 接线**——真实缺陷是解析器与 test.sh 结构漂移，
不是孤儿。

**产出**：修复 + `plugin/test/test-coverage-check.test.mjs`（AC1/AC2/AC4/AC5 的 RED/GREEN 单测，
`// @test-group engine` 声明）。CI 接线无需改动（`--selftest` + 常规模式的命令面不变）。

## 实测输出

### AC3 selftest（worktree `task/test-coverage-fix`）

```
$ node --experimental-strip-types scripts/test-coverage-check.ts --selftest
test-coverage-check --selftest: 10 passed, 0 failed
```

### AC4 常规模式

```
$ node --experimental-strip-types scripts/test-coverage-check.ts
test-coverage-check — canonical=181 discovered=123
PASS: 0 orphan(s) — every discovered product/plugin-tier test file is reachable by scripts/test.sh
```

（canonical/discovered 各含本任务新加的 `plugin/test/test-coverage-check.test.mjs`，修复前为
canonical=180 discovered=122。）

### AC5 文件集一致性（realpath-dedup 后 == test.sh 自身默认选择）

```
$ bash scripts/test.sh --list-files | wc -l
168
```

`canonicalTestFiles` 展开 3 个 pattern 后 realpath-dedup 得 168 个绝对路径，与
`scripts/test.sh --list-files` 逐项相等（selftest 与单测都断言）。

### 失败路径（空 glob = fail-loud）

```
$ node --experimental-strip-types scripts/test-coverage-check.ts   # scripts/test.sh 无 glob 行
test-coverage-check: cannot parse a non-empty canonical glob from scripts/test.sh (expected a `local glob=(...)` line, or a legacy `files=(...)` line). An unparseable/empty glob is a single-source break (ADR-004) — failing loudly instead of silently reporting zero canonical files.
$ echo $?
2
```

### 单测（AC1/AC2/AC4/AC5）

```
$ scripts/test.sh --for-task gap-test-coverage-check-parses-stale-files-variable
✔ AC1: parses the CURRENT `local glob=(...)` line from scripts/test.sh
✔ AC1: legacy `files=(...)` spelling still parses
✔ AC2: empty/absent glob is a parse FAILURE (throws, never silent [])
✔ AC4: real repo tree has zero orphans (canonical glob non-empty)
✔ AC5: canonical set == scripts/test.sh --list-files (realpath-deduped)
ℹ tests 5 · pass 5 · fail 0
```

## 合并后修复（fan-in 发现，2026-08-03T02:49Z）

**合并后 AC4 在主检出红、在 agent worktree 绿**——本仓「隔离绿/套件红」类的第 3 个实例（前两个：
M136、relation-sync）。根因：`discoverProductTierTestFiles` 用**纯文件系统遍历** repo 找 `test/*.test.mjs`，
而主检出上有 3549 个 gitignored 的陈旧 `**/worktrees/` 测试文件（21 个未回收的已合并 worktree），被当成
真实测试文件 → 全部报成孤儿。agent 的 worktree 里这些 gitignored 文件不存在，所以隔离绿。

**修复（`63afe8f8`）**：发现改为**基于 git 索引**（`git ls-files`）——「真实测试文件」= git 跟踪的文件。
索引在任意检出（主检出 / linked worktree）下**逐字节相同**，所以从根上消除该类：不再有「哪个检出看到不同文件集」。
非 git 的 scratch fixture（selftest/单测）回退到 fs-walk——非 git 目录按构造没有 gitignore 工件，不会误收。
验证：单测 5/5、selftest 10/10、AC4 主检出零孤儿。

**教训**：这次 red 被 scoped 测试抓到（合并后立刻跑单文件），不是全量才暴露——fan-in 的「merge 后先跑
scope 再跑全量」顺序是对的。

## Touches

- scripts/test-coverage-check.ts
- plugin/test/test-coverage-check.test.mjs
- .github/workflows/ci.yml
