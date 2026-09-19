---
id: gap-ac157-catalog-carrier-moved-criterion-stale
title: AC157 判据仍红——catalog 重构把枚举承载者迁到 capability-catalog.ts，判据仍点名 thin wrapper .sh
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-157
---
## Proposal

**问题（本轮逐字实测，2026-09-19）**：`goals/AC-157-archive-mechanism-exclusion-wiring.md` 的判据现为 **fail**。逐字跑判据 ⇒ exit 1，报错 `AC-157 fail: plugin/scripts/capability-catalog.sh has no non-comment line referencing archive/`。

逐面读数（`grep -vE '^[[:space:]]*(#|//|\*)' "$f" | grep -c 'archive/'`）：

| 排除面 | 非注释 `archive/` 命中 |
|---|---|
| `plugin/scripts/capability-catalog.sh` | **0** ❌ |
| `plugin/scripts/runtime-usage-inventory.ts` | 1 ✅ |
| `scripts/test.sh` | 1 ✅ |
| `plugin/scripts/laydown-set-check.sh` | 1 ✅ |
| `scripts/version-consistency-check.ts` | 1 ✅ |

`head -1 archive/INDEX.tsv | awk -F'\t' '{print NF}'` ⇒ **7** ✅。⇒ 唯一取假的是第一面。

**成因：承载者搬迁，不是机制坏了。** commit `c47e1ae9e`（2026-09-19 10:33，任务 `gap-arch-catalog-declarations-leave-bash`，done）把 `capability-catalog.sh` 抽成 **43 行 thin wrapper**（只剩注释 + 三条 fail-closed 前置 + `exec`），枚举逻辑迁到 `plugin/scripts/capability-catalog.ts`。archive 排除跟着迁走，在 `.ts:194` 重新表达为 **basename** 形态 `const SKIPPED_SEGMENTS = new Set(["checker-mutation-cases", "archive"]);` ⇒ 全文无 `archive/` 字面；`.sh` 里连 `archive` 字样都没有（`grep -n archive plugin/scripts/capability-catalog.sh` ⇒ 空）。

**保证本身仍然成立**：`SKIPPED_SEGMENTS.has(e.name)` 按目录 basename 判，任意深度的 `archive` 目录仍被跳过，与原 `find … -not -path '*/archive/*'` 功能等价。坏的是**判据点名的承载者**——它点名一个已不再承载该角色的文件。

**为什么上一轮的修复没顶住**：`gap-ac157-exclusion-wiring-criterion-divergence`（done 2026-09-07）修的是**当时**分歧的两面（`runtime-usage-inventory.ts` / `scripts/test.sh`），其 DoD 明确要求真排除而非塞关键词——它顶了 12 天。但它顶不住**承载者搬迁**：判据绑在**文件路径**上，任何把枚举逻辑搬走的合法重构都会重新把它变假，与上一轮修得多好无关。

<!-- dedup-ref -->
同类已被记录：memory `carrier-role-must-move-when-data-leaves-code`（写于 2026-09-19 10:59，比 `c47e1ae9e` 晚 26 分钟）记了另外三个按名排除 `capability-catalog.sh` 的 checker 需跟着搬（`rhythm-consumer-check.ts` / `registry-bare-filename-scan.ts` / `outer-retirement-precondition-check.ts`）。AC-157 的判据是该类**第四个实例，而那次扫漏了它**——该 memory 的 "How to apply" 写的是 `grep -rn '<basename>' plugin/scripts`，范围**结构上看不到 `goals/AC-157-*.md`**。（硬规则 5b：修完一个实例后，在同一载体里 grep 该原则的其它适用点。）

**两个修法的取舍**：

- ✗ **往 thin wrapper 里塞一行字面 `archive/`**：拒绝。`.sh` 已不参与枚举，塞进去的字符串**结构上不可能取假**（硬规则 4：一个结构上不可能取假的量，不是测量），且上一轮任务的 DoD 本来就禁止「塞一行无功能的 `archive/` 字符串来糊判据」。
- ✓ **把判据移到真正承载该角色的文件上**（仓库自身原则：按性质陈述、点名新承载者），并让该承载者的**活代码**以字面 `archive/` 表达这条排除。

## Plan

1. `plugin/scripts/capability-catalog.ts`：把 archive 排除改写成**含字面 `archive/` 的路径前缀形式**，忠实于原 `find -not -path '*/archive/*'`（对条目的仓库相对路径判 `/(^|\/)archive\//`，目录先追加 `/` 再判）。行为不变：任意深度的 `archive` 目录仍被跳过；`checker-mutation-cases` 那条不动。⛔ 不新增第二份排除实现——同一排除在仓库里只留一处。
2. `goals/AC-157-archive-mechanism-exclusion-wiring.md`：`criterion:` 与 body 的五面清单里，把 `plugin/scripts/capability-catalog.sh` 换成 `plugin/scripts/capability-catalog.ts`。**用机件改，不手搓文件**：`packages/quay/src/cli/goal.ts` 提供 `quay goal write AC-157 --criterion "<全文>"`（`patch.criterion`）。另外四面一个字都不动（它们现在全绿）。
3. `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §12c（:420）与 §12a 的根据句（:402）：加**带日期的更正行**，写明枚举承载者已迁到 `.ts`——否则正本继续点名 thin wrapper，会再制造下一次同款漂移。
4. **补上今天缺失的负控制**：目前没有任何测试断言 catalog 的 archive 排除（`plugin/test/capability-catalog.test.mjs` 全文无 `archive`）——这正是重构能把它搬走而不变红的原因。补一条能红的测试：优先让该排除可被单测直接命中（导出派生函数，或把排除谓词抽成纯函数），测试指向**临时 fixture 目录**（内含 `archive/…`）而不是往真实 `plugin/scripts/` 里放探针；只有在无法干净导出 seam 时才退回「在 `plugin/scripts/archive/<date>-probe/` 放探针 + `try/finally` 清理」的形态。

## AC

- [ ] AC1 判据取真：逐字跑 AC-157 判据 ⇒ exit 0（贴读数；goal-driver 下一轮独立复核并翻 pass）
- [ ] AC2 承载者含字面：`grep -vE '^[[:space:]]*(#|//|\*)' plugin/scripts/capability-catalog.ts | grep -q 'archive/'` ⇒ 真
- [ ] AC3 判据不再点名不承载该角色的文件：`grep -c 'capability-catalog\.sh' goals/AC-157-archive-mechanism-exclusion-wiring.md` ⇒ 0
- [ ] AC4 行为不变：任意深度的 `archive` 目录仍被跳过——新测试证明含 `archive/…` 的 fixture 中的探针不出现在派生脚本集里，且 `bash plugin/scripts/capability-catalog.sh --summary` 的输出与改动前一致（贴两侧读数）
- [ ] AC5 能取假（负控制）：临时把 `.ts` 的 `archive/` 排除改成不匹配形式 ⇒ AC2 与新测试同时红；恢复 ⇒ 绿（贴两段读数）
- [ ] AC6 SPEC §12c/§12a 有带日期的承载者更正行，且该 SPEC 不再以「枚举面」的措辞单点 `capability-catalog.sh`
- [ ] AC7 `node plugin/scripts/task-schema-check.ts tasks/gap-ac157-catalog-carrier-moved-criterion-stale.md` ⇒ exit 0

## DoD

AC-157 在 goal-driver 下一轮由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict），且达成靠的是**承载该角色的文件真排除 `archive/**` + 负控制可红**——⛔ 不是往 thin wrapper 里塞一行无功能字符串，⛔ 也不是把判据改成恒真（AC5 是这条的判据）。若只改 criterion 文本而 `capability-catalog.ts` 仍无字面 `archive/`，或改了却拿不出负控制读数，均不算达成。

## Touches

- plugin/scripts/capability-catalog.ts
- plugin/test/capability-catalog.test.mjs
- goals/AC-157-archive-mechanism-exclusion-wiring.md
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
- tasks/gap-ac157-catalog-carrier-moved-criterion-stale.md
