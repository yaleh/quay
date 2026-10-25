---
id: gap-driver-status-pointer-retired-state
title: driver status 的 pointer 读数把「链接不存在」报成 not-evaluated；Q1 之后缺省是正常态，应为 retired
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay driver status` 的 `pointer` 读数（`plugin/scripts/driver-runtime.ts:3502` 的 `pointerReading`）当前把「`.quay/plugin` 链接缺失」报成 `not-evaluated`，理由字符串是 `no .quay/plugin symlink in <root>`（`:3515`）。这是为「链接本该存在」的世界写的。

Q1（`gap-quay-init-retire-project-plugin-link`）之后链接成为退役状态：不存在是正常态，不是「无法评估」。若保持现状，每一台已迁移的项目在 `driver status` 里都会显示一个 NOT-EVALUATED，而 `plugin/scripts/verify-plugin-channel-assertions.ts:471-473` 会把 `not-evaluated` 判成 NOT-EVALUATED（不是 PASS）——迁移完成后反而永久降级。

同一读数还有**第二个实现**：`plugin/scripts/goal-driver.ts:4465-4475` 的健康探针用 `initStatePresent=false` 表示链接缺失，同样把「已退役」与「缺失」混为一谈（硬规则 5b：修一处 ≠ 只修一处）。

## AC

- [x] AC1（新状态）：链接不存在时 `pointer.state === "retired"`，`reason` 说明「链接已退役，缺省是正常态」；⛔ 不再是 `not-evaluated`。贴 `quay driver status --json | jq .pointer` 实跑。
  证据（worktree 内实跑 `node --experimental-strip-types plugin/scripts/driver-runtime.ts status --kind worker --root <无链接临时根> --json`，`QUAY_PLUGIN_ROOT` 指向 0.15.0 fixture）：
  `{"state":"retired","core_version":"0.15.0","core_root":"/tmp/ptr-retired-ev-sFAAf3/core","link_target":null,"link_version":null,"reason":"the .quay/plugin symlink is retired — its absence is the normal state (quay init no longer creates it; human ruling 2026-10-25)"}`
  同一 fixture 上 develop(改前) 的 `pointerReading` = `not-evaluated`，改后 = `retired`；reason 文案里点名「已退役、缺省是正常态」。

- [x] AC2（四态仍可区分）：`current` / `behind` / `ahead` / `retired` 互不同形；链接存在但目标无 `plugin.json` 时仍是 `not-evaluated`（**读不懂 ≠ 已退役**）；贴四条实跑（可用 fixture 篡改链接目标）。
  证据（同一 Core=0.15.0，四个 fixture 实跑 `.pointer.state`）：
  `current`（链接→0.15.0）、`behind`（链接→0.14.0）、`ahead`（链接→0.16.0）、`retired`（无链接）；
  读不懂的两条仍是 `not-evaluated`：链接→无 plugin.json 的目录（reason=`the .quay/plugin target … carries no plugin.json version`）、`.quay/plugin` 是**普通文件**（reason=`the .quay/plugin path exists but is not a symlink — it is user content, not a (retired) pointer …`）。
  测试 `AC2-pointer⑤` 用同一组 fixture 断言五态取值互不相同（`["current","behind","ahead","retired","not-evaluated"]`）。

- [x] AC3（验证器同步）：`verify-plugin-channel-assertions.ts` 的 `judgeDriverStatusReadings` 把 `retired` 判成 **PASS**（不是 NOT-EVALUATED），并保留 `behind` ⇒ FAIL；贴改动前后的判定读数（一个 retired fixture + 一个 behind fixture）。
  证据（`judgeDriverStatusReadings` 逐态，before=develop / after=worktree）：
  `retired ⇒ before=PASS, after=PASS`；`behind ⇒ before=FAIL, after=FAIL`；`not-evaluated ⇒ before=NOT-EVALUATED, after=NOT-EVALUATED`；`current/ahead ⇒ PASS`。
  **接缝前后对照（本任务真正修的降级）**：改前 kernel 的读数喂改前验证器 ⇒ `pointer=not-evaluated ⇒ NOT-EVALUATED`；改后 ⇒ `pointer=retired ⇒ PASS`。
  硬规则 5b（同载体第二处）：`judgePointer`（`project-pointer`）同步——absent ⇒ PASS(retired)、非符号链接/悬空 ⇒ NOT-EVALUATED、异版本 ⇒ FAIL；新增 `readProjectPointer` 把 present/isSymlink/real 三个事实分开。实跑：`retired ⇒ PASS`、`behind ⇒ FAIL`、`notSymlink ⇒ NOT-EVALUATED`。
  测试：`plugin/test/verify-plugin-channel-assertions.test.mjs` 的 ③b（缺省⇒PASS/retired）、③c（非符号链接⇒NOT-EVALUATED）、AC3 两条（逐态 + judgePointer）。

- [x] AC4（第二实现同步）：`goal-driver.ts` 的健康探针把「链接不存在」报成 `retired`，与「链接存在但读不出」分开；贴该探针在迁移前后两种 fixture 上的输出。
  证据（直接执行 `HEALTH_PROBE_SCRIPT` 真载荷，before=develop / after=worktree；`probeVersion` 1→2）：
  `pre-migration（链接在、plugin.json 可读）：before {initStatePresent:true, version:0.15.0} / after {initStateMode:"present", initStatePresent:true, version:0.15.0}`
  `post-migration（链接不存在）：before {initStatePresent:false, version:null} / after {initStateMode:"retired", initStatePresent:false, version:null}`
  `unreadable（链接在、目标无 plugin.json）：before {initStatePresent:true, version:null} / after {initStateMode:"unreadable", initStatePresent:true, version:null}`
  判定面：`retired` 只留在 `pluginVersion.initStateMode` 上，⛔ 不再让 verdict 降级（实测 `unhealthy [not-driving]`，cause=null）；`unreadable` ⇒ `not-evaluated (cause=plugin-link-unreadable)`（原 `plugin-link-missing` 成因退役）。
  测试：`plugin/test/goal-driver-s05.test.mjs`（AC3 成因列表改用 `plugin-link-unreadable`；AC4 断言 retired 不降级、unreadable 才 not-evaluated）。

- [x] AC5（文案）：`driver status` 的人类可读行（`driver-runtime.ts:3959` 的 `pointer=...`）与 `--help` 若提到状态词表，同步加入 `retired`；贴 `--help` 片段。
  证据（人类可读行，retired fixture 实跑）：`… · pointer=retired:core=0.15.0 (the .quay/plugin symlink is retired — its absence is the normal state …)`；behind fixture 仍为 `pointer=behind:link=0.14.0:core=0.15.0`。
  `quay driver --help`（`packages/quay/src/cli/help.ts`）status 段新增：
  `drift readings: loaded_version / path_quay_version / pointer. … state vocabulary is current | behind | ahead | retired | not-evaluated:` 其中 `retired  the link is ABSENT — retired (quay init no longer creates it), so absence is the NORMAL state, ⛔ not an error and ⛔ not "unable to evaluate"`。

## DoD

- `PointerReading.state` 的取值词表加 `retired`，并在类型/注释里写明它与 `not-evaluated` 的区别（退役 = 已知且预期；未评估 = 读不懂）。
  落点：`driver-runtime.ts` 的 `PointerReadingState` + `PointerReading` 头注释（`LoadedVersionState` 本体不变，只有 pointer 读数有这个第五态）。
- `driver-runtime.ts` 与 `goal-driver.ts` 两处读数的语义一致，⛔ 不新增第三份判定。
  两处都按 lstat 分「不存在 / 在但读不懂」；goal-driver 的探针是发往目标机执行的自包含载荷（⛔ 不能 import Core），故只能同形而非同一实现——注释里交叉引用。
- 测试：`plugin/test/driver-runtime-loaded-version-drift.test.mjs` 覆盖 AC1/AC2；`plugin/test/` 下覆盖 AC3 的验证器判定。
  已覆盖；另在 `plugin/test/goal-driver-s05.test.mjs` 覆盖 AC4。
- 「退役」的日期/版本正本只写一处，⛔ 不在两个文件各写一遍。
  正本 = `driver-runtime.ts` 的 `PointerReadingState` 注释（含 2026-10-25 与写侧任务指针）；`goal-driver.ts` / `verify-plugin-channel-assertions.ts` / `help.ts` 只引用它，不重复日期。

## Touches

- `tasks/gap-driver-status-pointer-retired-state.md`（自指）
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `plugin/test/verify-plugin-channel-assertions.test.mjs`
- `plugin/test/goal-driver-s05.test.mjs`
- `packages/quay/src/cli/help.ts`

## ADR-007 dark axis

该轴仍暗,理由:本任务只改编号状态词表与判定分支（新增一个取值 + lstat 分支），未新增或删除模块依赖边、未改变包聚合结构，L_D/L_G 读数不因本改动变化。
