---
id: gap-driver-status-pointer-retired-state
title: driver status 的 pointer 读数把「链接不存在」报成 not-evaluated；Q1 之后缺省是正常态，应为 retired
status: ready
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

- [ ] AC1（新状态）：链接不存在时 `pointer.state === "retired"`，`reason` 说明「链接已退役，缺省是正常态」；⛔ 不再是 `not-evaluated`。贴 `quay driver status --json | jq .pointer` 实跑。
- [ ] AC2（四态仍可区分）：`current` / `behind` / `ahead` / `retired` 互不同形；链接存在但目标无 `plugin.json` 时仍是 `not-evaluated`（**读不懂 ≠ 已退役**）；贴四条实跑（可用 fixture 篡改链接目标）。
- [ ] AC3（验证器同步）：`verify-plugin-channel-assertions.ts` 的 `judgeDriverStatusReadings` 把 `retired` 判成 **PASS**（不是 NOT-EVALUATED），并保留 `behind` ⇒ FAIL；贴改动前后的判定读数（一个 retired fixture + 一个 behind fixture）。
- [ ] AC4（第二实现同步）：`goal-driver.ts` 的健康探针把「链接不存在」报成 `retired`，与「链接存在但读不出」分开；贴该探针在迁移前后两种 fixture 上的输出。
- [ ] AC5（文案）：`driver status` 的人类可读行（`driver-runtime.ts:3959` 的 `pointer=...`）与 `--help` 若提到状态词表，同步加入 `retired`；贴 `--help` 片段。

## DoD

- `PointerReading.state` 的取值词表加 `retired`，并在类型/注释里写明它与 `not-evaluated` 的区别（退役 = 已知且预期；未评估 = 读不懂）。
- `driver-runtime.ts` 与 `goal-driver.ts` 两处读数的语义一致，⛔ 不新增第三份判定。
- 测试：`plugin/test/driver-runtime-loaded-version-drift.test.mjs` 覆盖 AC1/AC2；`plugin/test/` 下覆盖 AC3 的验证器判定。
- 「退役」的日期/版本正本只写一处，⛔ 不在两个文件各写一遍。

## Touches

- `tasks/gap-driver-status-pointer-retired-state.md`（自指）
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/verify-plugin-channel-assertions.ts`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `packages/quay/src/cli/help.ts`