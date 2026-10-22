---
id: gap-meta-needs-human-parking-recheck
title: needs-human 停放理由失效后无任何产物上报：判据修好、任务仍停、goal AC 每轮红
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
tasks/gap-semantic-admission-contract-module.md 因 unsatisfiableUnannotatedAc 被机械翻成 needs-human，而该判据已修复（tasks/gap-meta-declaresunsatisfiablebyexecutor done；当前 judgeUnsatisfiableUnannotatedAc 对该任务体返回 clean），可是 needs-human 被明确裁定禁止机械再入队（driver-filters.ts 人裁「本来就不应该有『可机械再入队』的路径」），于是唯一的产物应是一条「停放理由已失效」的上报——它不存在：needs-human-recheck.ts 以零调用者归档，manager-tick-readings 无该面，结果 AC-919 连续 42 轮 fail 而人无从察觉

本轮读数（timeSeries.2.count）= `42`，采于 2026-10-22T15:04:57Z，由 meta-driver 机械采集。
涉及机制关键词：`needs-human-parking-recheck`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs` ⇒ 只读探测器对每个 needs-human 任务复跑其记录里的机械停放判据，只报「该判据今日已 clean 而任务仍停放」的那些（判据仍发火的不报、非机械原因停放的不报、读不懂输入记 not-evaluated 而非 clean），并接到一个每轮真跑的活消费者上；全程不改 status，遵守禁止机械再入队的裁定

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**实现**：新增 `plugin/scripts/needs-human-parking-recheck.ts`（只读探测器，四态：`parking-reason-stale` 上报 / `still-blocked` / `no-registered-judge` / `not-evaluated`）；`plugin/scripts/promotion-driver.ts` 是每轮活消费者（写 `.quay/needs-human-parking-recheck.json` + 轮事件 `needs_human_parking` + 非空 stale 打 stderr）。

**AC 实跑**（worktree，HEAD 含 develop 合并后）：
```
$ node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs
✔ AC1(a/b) — the RECORDED judge is RE-RUN on the CURRENT body: same record, state flips still-blocked → stale
✔ AC1(c) — a NON-mechanical parking reason is not reported (no-registered-judge)
✔ AC1(d) — unreadable input is not-evaluated, NEVER clean (hard rule 3b)
✔ AC1(f) — the detector writes NO status (the parked task stays parked, byte-identical)
✔ AC1(g) — a root without tasks/ is evaluated:false, not an empty all-clear
✔ AC1(e) — promotion-driver is the LIVE consumer: every round carries the reading and persists it   ← 驱动 2 轮，每轮各带一条读数
ℹ tests 7 / pass 7 / fail 0
```
- 「复跑」的取假形态：同一 fixture、**同一段记录理由**，只改任务体 ⇒ 状态从 `still-blocked` 翻成 `parking-reason-stale`（回显记录文本或忽略任务体的实现都产不出这个翻转）。
- 「每轮真跑」的取假形态：`--max-rounds 2` 驱动两轮，断言**每一条** round 事件都带 `needs_human_parking`（只首轮跑的实现会红）。
- 只读：CLI + 完整驱动轮跑完后任务文件逐字节不变、`status:` 仍 `needs-human`。

**真实树上的一次读数**（worktree `--root .`）：
```
needs-human-parking-recheck — 4 needs-human task(s); stale=1; still-blocked=1; no-registered-judge=0; not-evaluated=2
  [PARKING-REASON-STALE] gap-semantic-admission-contract-module  judge=unsatisfiableUnannotatedAc  parked on unsatisfiableUnannotatedAc which is CLEAN on the current body — the parking reason has expired
```
即本任务立项时点名的那个样本，第一次被产品报出来。

**判据能取假（两次注入，`cp` 备份回拷，⛔ 未用 git checkout）**：
- 关掉 `hits.length > 0` 臂 ⇒ `✖ AC1(a/b)`（仍发火的判据被误报成 stale）；
- 关掉 `verdict.evaluated !== true` 臂 ⇒ `✖ AC1(d)`（读不懂被判成 clean）。回拷后 7/7 复绿。

**⛔ 不新建并行机制（DoD 2）**：判据实现仍只有一份——`judgeUnsatisfiableUnannotatedAc` 由 `ready-pool-check.ts` **导出被 import**（`PARKING_JUDGES` 注册表里 `judge:` 直接指向它），词表（`UNSATISFIABLE_AC_*_PHRASES`）未复制；归档的 `needs-human-recheck.ts` **未复活**（它量的是 ageDays + ADR-022 退役 Touches，从不复跑停放判据，复活它回答的是另一个问题）。

**门**：`bash scripts/test.sh --for-task gap-meta-needs-human-parking-recheck --allow-thin` ⇒ exit 0（scoped static checks 全 PASS，25 tests / 0 fail）；`anti-drift-touches-check --merge-target develop` ⇒ `ANTI-DRIFT OK … 5 actual file(s), all within declared Touches`；`capability-catalog --summary` ⇒ `396 scripts | 396 declared | 0 unclassified`。

## ADR-007 dark axis

- L_D: docLines=1 codeLines=636 ratio=0.002（`git diff --numstat develop...HEAD` 逐文件实测，2026-10-22；非 .md 侧含新探测器 308 行 + 新测试 293 行 + promotion-driver 接线 23 行 + 目录声明 12 行）
- L_G：该轴仍暗,理由:本任务的交付面是「复跑既有判据的只读探测器」，重复/再造抽象的读数不是它的对象；唯一与重复有关的主张（判据只有一份）由 import 而非 detect_duplicates 保证，未复算 archguard。

## Touches
- `plugin/scripts/needs-human-parking-recheck.ts`
- `plugin/test/needs-human-parking-recheck.test.mjs`
- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/scripts/capability-catalog-declarations.json`
- `docs/proposals/quay-product-outline.md`
- `tasks/gap-meta-needs-human-parking-recheck.md`