---
id: gap-ac168-criterion-sh-incompatible
title: AC-168 判据仍红（exit 2）：criterion 用 bash 进程替换，goal-store gate 经 sh 执行 Syntax error
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-168
---
## Proposal

**立案当轮实测（goal-driver 轮 51–54，读 `.quay/goal-round.jsonl`）**：AC-168 verdict=fail、reason=`acceptance failed (exit 2)`。前序任务 `gap-ac168-quay-init-contract-closed-set`（done，goal_ac: AC-168）已把 SPEC §6 的 `QUAY-INIT-CLOSED-SET:BEGIN/END` 块落上 develop（fan-in ff exit 0，19:46:02Z）——它修的是「缺块 ⇒ allowed 空 ⇒ exit 1」。本任务是**另一个机制**：块落地后判据仍红，失败码从 exit 1 变 exit 2。

**根因（双向对照坐实，非推断）**：`goals/AC-168-quay-init-contract-closed-set.md` 的 `criterion` 用了 bash 专有进程替换 `<(...)`（`comm -23 <(printf '%s\n' "$produced") <(printf '%s\n' "$allowed")`）。goal-store gate 经 `runAcceptance`（`packages/quay/src/gate/acceptance-runner.ts` 的 `spawnSync({shell:true})`）以 `/bin/sh` 执行——本机 `/bin/sh` = dash，不支持 `<(...)` ⇒ `Syntax error: "(" unexpected` ⇒ exit 2。对照：同一 criterion 用 `bash` 跑 exit 0、用 `sh`(dash) 跑 exit 2（已实测贴出两段）。

**修法（不动 runner）**：把 criterion 的进程替换改成 POSIX 兼容写法——`produced`/`allowed` 各落一个临时文件，`comm -23 "$f1" "$f2"` 判定后再 `rm -f`。**不改 `runAcceptance`**：它是所有 gate/criterion 共享的 sh 执行器，改 bash 是更大 blast radius 且无必要（判据本就该 POSIX 可移植——硬规则 4c：判据量须穿过 `sh` 这一中间层）。

**blast radius 实测**：`grep -l '<(' goals/AC-*.md` 全仓仅命中 AC-168 一条（其余 active AC 判据无进程替换）。

## AC

- [x] AC1（criterion 经 sh 逐字 exit 0）：抽 `goals/AC-168-quay-init-contract-closed-set.md` 的 criterion 字段 → 写临时文件 → `sh` 执行 exit 0（贴实跑输出）
- [x] AC2（goal-store gate 判 pass）：`node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-168 --root /home/yale/work/quay` 输出 `"verdict": "pass"`（reason 含 `exit 0`）
- [x] AC3（criterion 不含 `<(`）：`grep -c '<(' goals/AC-168-quay-init-contract-closed-set.md` == 0
- [x] AC4（负控制能取假）：临时把 criterion 改回 `<(...)` 版 → `sh` 执行 exit 2（贴「修复前 exit 2 / 修复后 exit 0」两段输出）
- [x] AC5（schema + 形状）：`node plugin/scripts/task-schema-check.ts tasks/gap-ac168-criterion-sh-incompatible.md` exit 0，且 `node packages/quay/bin/quay.ts task check gap-ac168-criterion-sh-incompatible --json` 的 `missing` == `[]`
- [x] AC6（回归测试绿）：`packages/quay/test/goal-gate.test.mjs` 新增「goal gate 经 sh 执行——bash 进程替换判据 fail(exit 2)、POSIX temp-file comm 判据 pass」合成对照用例；`node --test packages/quay/test/goal-gate.test.mjs` exit 0

## DoD

goal-driver 下一轮 AC-168 verdict 由 fail(exit 2) 转 pass（读 `.quay/goal-round.jsonl` 最新轮 AC-168 的 reason 含 `exit 0`）；criterion 抽取后 `sh` 与 `bash` 双双 exit 0（POSIX 可移植）；负控制（改回 `<(...)`）经 sh exit 2 证明判据能取假。⛔ 只把 `<(...)` 换成恒真写法 / 只改 runner 不动 criterion / 用 bash 跑判据冒充「sh 兼容」⇒ 不算达成。

## Touches

- goals/AC-168-quay-init-contract-closed-set.md
- packages/quay/test/goal-gate.test.mjs
- tasks/gap-ac168-criterion-sh-incompatible.md