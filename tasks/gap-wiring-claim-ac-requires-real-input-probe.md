---
id: gap-wiring-claim-ac-requires-real-input-probe
title: 「实现了但没接线」族无检查器强制——接线/可达性声明 AC 不要求真实输入探针，且已有 prod-data-audit / wiring-coverage-check 两检查器自身也没接线（≥17 实例/22 天 ≈ 0.77/天）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

「实现了、测试绿了、AC 全勾，但从未在真实调用形态上跑过」这一缺陷族已量化（manager 两窗对照，硬规则⑫取证齐备，非印象）：**≥17 条独立实例 / 22 天（08-03→08-25）≈ 0.77 次/天，08-25 单日 4 条**。实验组 08-25（28 任务/70 AC）零-P 类-AC 任务占 75% vs 对照组 08-10~12（27 任务/137 AC）占 66.7%——差异在小样本噪声量级、早期窗不更好 ⇒ 排除「近期退化」，这是本项目 fast-mode 全程的撰写约定属性（P 生产路径 18% / S 合成桩 51% / D 文档存在性 31%）。

**最刺眼的一点**：为这一族建的检查器**自己也没接线**（我逐条 grep 复核，非采信自述）：
- `plugin/scripts/prod-data-audit.ts`：`grep scripts/test.sh` + `grep ci.yml` 均 0 命中；
- `plugin/scripts/wiring-coverage-check.ts`：在 `checkTask()` kind=gap 分支被调，但 `checkTask` 唯一非测试调用者 `task-schema-check.ts` ⇒ `grep scripts/test.sh` 0 命中，`ready-pool-check.ts` 只 import `parseTask/extractSection/readDependsOn`。
- 负控制：同一 grep 谓词查 `instrument-failure-check`（已知接线）⇒ `scripts/test.sh` 2 命中 ⇒ 谓词没写错，那两个 0 是真没接线。

**现有规则已存在且判据锋利**：CLAUDE.md 硬规则④推论三（08-14）「关掉 fixture seam 后 AC 还能过 ⇒ 它只是回声」——有判据、无检查器强制，纯靠自觉（硬规则⑨「守与不守在记录上无法区分」）。

## Plan

把「接线声明 AC 必须点名真实输入探针」接进**活的闸**（`ready-pool-check.ts` 的 `artifactsComplete` 或 `task-contract-check.ts`），⛔ 不新造独立 audit 脚本——那正是本缺陷族本身。

判据（人指定）：「对任何含【接线/可达性声明】的 AC，要求同一条 AC 点名一个【真实输入探针】」。
- **接线/可达性声明**：复用 `wiring-coverage-check.ts` 已有的声明抽取启发式（反引号标识符 + 接线动词），⛔ 不新写一套解析。
- **真实输入探针**（能取假的直接量）：真实生产载体记录数 / 真实进程 argv 或 `/proc/<pid>/*` / 真实 curl / 真机回放；⛔ 实现者自建 fixture、mkdtemp workspace、字符串直调不算。
- **边界（人提醒必须划）**：「零 P 类 AC」在纯函数/纯解析任务上是合理的（本无生产载体可读）⇒ 判据只对「含接线/可达性声明的 AC」子集生效，⛔ 不是「每条任务都要 P 类 AC」（那会变成恒红形式主义）。触发条件是「AC 含接线声明」，不是「任务含 P 类 AC」。
- **落地前必须证明能回溯命中 ≥1 条历史实例**（硬规则④推论三自己的反例判据），⛔ 恒绿不算。

## Acceptance Criteria

- [x] AC1（能取假，检测+回溯命中）：活的闸对「含接线声明但无真实输入探针」的 AC 报红——用两条历史样本之一干跑命中：`gap-readdepends-on-indented-extra-depends_on`（AC1 写「`readDependsOn` 认到缩进形态、10 条命中任务都能被读到」，验收测试却是 `readDependsOn("depends_on: [a, b]\n")` 字符串直调，10 条真实文件一次没跑）或 `gap-ac146-human-interface-explicit-owner`（AC2 写「`.quay/promotion-outcome.jsonl` 已有 3 条现成样本」，测试却把样本内容抄进 mkdtemp 合成文件，真文件从未读）；（⛔ 两样本都不报红 ⇒ 假；恒绿不算）。
- [x] AC2（能取假，负控制不误伤）：接线声明 AC 点名了真实输入探针（真实生产载体记录数 / 真实 argv / 真机回放）的任务不报红；（⛔ 误伤 ⇒ 假）。
- [x] AC3（能取假，边界）：纯函数/纯解析任务（无接线声明、无生产载体）不报红——判据只对「含接线声明 AC」子集生效，不是「每条任务都要 P 类 AC」；（⛔ 恒红形式主义 ⇒ 假）。
- [x] AC4（能取假，自身接线）：检查器接进活的闸（`artifactsComplete` / `task-contract-check.ts`），`grep scripts/test.sh` + `grep ci.yml`（及 import 图）≥1 命中——负控制：同一谓词查 `instrument-failure-check` ≥1 命中证明谓词没写错；（⛔ 0 命中（再造独立 audit 脚本、未进活闸）⇒ 假）。

## Definition of Done

接线声明 AC 需点名真实输入探针的检查接进活闸；AC1-AC4 全勾；回溯命中 ≥1 条历史实例；纯解析任务不误伤。

## Touches

- plugin/scripts/wiring-coverage-check.ts（复用其声明抽取启发式，导出 backtickIdentifiers/WIRING_VERB_RE/EVIDENCE_RE，新增 checkWiringClaimAcProbe + WIRING_REACHABILITY_DECL_RE + REAL_INPUT_PROBE_RE）
- plugin/scripts/task-contract-check.ts（scanTaskText 接线点：新增 check 8 checkWiringClaimAcProbeGated + readWiringClaimAcProbeBaseline + 祖父清单 ceiling-breach）
- plugin/test/task-contract-check.test.mjs（接线声明-无探针 报红 / 真探针-负控制 / 边界 测试）
- docs/analysis/wiring-claim-ac-probe-baseline.md（新增 shrink-only 祖父清单，2 条历史实例）
- tasks/gap-wiring-claim-ac-requires-real-input-probe.md（自身）

## Evidence

**AC1（回溯命中 + 全仓校准）**：`checkWiringClaimAcProbe` 对两条历史样本各报 1 条 `wiring-claim-ac-no-probe`；全仓 405 任务校准，窄判据（反引号 + `N 条` + 读到/读取/样本/现成）恰命中这两条、零误伤：

```
bad1 "…readDependsOn 认到 extra: 缩进下的 depends_on（10 条命中任务都能被读到）…" → 1 finding
bad2 "….quay/promotion-outcome.jsonl 已有 3 条现成样本…" → 1 finding
FULL STORE flagged: 2 tasks
  gap-ac146-human-interface-explicit-owner.md (1)
  gap-readdepends-on-indented-extra-depends-on.md (1)
```

**AC2（负控制）**：真实探针 AC 不报红（`…实读主检出 store…恰 2 条…`、`用生产 verification-round.jsonl 的 #599…回放` → 0 finding）。

**AC3（边界）**：纯函数/纯解析 AC（`parseFoo 对缩进输入返回…`、`6 条旧路径模式零命中（grep）`）→ 0 finding。

**AC4（自身接线）**：`checkWiringClaimAcProbe` 由 `task-contract-check.ts` import 并接入 `scanTaskText`（check 8，contract 段外、与 check 6/7 同构）；`task-contract-check` 已由 `runner-static-gate.ts` 的 `run_static_checks` 以 `--no-block` 调用（`run_checker "task-contract-check" …`），`runner-static-gate.ts` 由 `scripts/test.sh` source。负控制：`grep -c instrument-failure-check scripts/test.sh` = 2（谓词有效）；本检查经 import 图 `scripts/test.sh → runner-static-gate.ts → task-contract-check.ts → wiring-coverage-check.ts` 可达。

**祖父清单**：`docs/analysis/wiring-claim-ac-probe-baseline.md`（baseline-count: 2）列出两条历史实例为 shrink-only 祖父债务；加清单后 `task-contract-check --json` 的 `wiring-claim-ac-no-probe` 违规 = 0（祖父生效）、`wiringClaimAcProbeCeilingBreach` = false。

**测试**：`node --test --experimental-strip-types plugin/test/task-contract-check.test.mjs` → tests 61 / pass 60 / fail 0 / skipped 1（skip = real-store smoke，需 `QUAY_TEST_REAL_STORE=1`）；新增 8 条 check 8 测试全绿。`npx tsc --noEmit -p tsconfig.json` → exit 0。
