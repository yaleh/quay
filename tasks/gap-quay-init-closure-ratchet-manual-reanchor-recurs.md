---
id: gap-quay-init-closure-ratchet-manual-reanchor-recurs
title: quay-init 闭包棘轮基线第 8 次被 laydown 内改动撞红，挡住全仓 fan-in——再锚 + 消除手工再锚形态
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（主检出实测，2026-09-06）**：
```
node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root .
⇒ exit=1
FAIL: quay-init laydown footprint GREW past the shrink-only baseline:
     132 files (baseline 132) / 3830101 bytes (baseline 3826955)
```
即 **+3146 字节 / 文件数不变（只越字节轴）**。

**⚠️ 这是全仓级阻塞，不是单任务问题**：该检查在全量 suite 的**静态检查**段，
`full-suite-runner: FINAL state=red reason=static-check` ⇒ **任何任务的 fan-in 跑全量都会红**。
已实测代价：`gap-writestate-torn-read-assertion-load-sensitive-flaky` 的语义兜底 fan-in
连续 3 轮纯 defer、最终 `needs-human`（`FIX_SCOPE_VERDICT.deferRounds=3`），
该任务改动只有一个 `plugin/test/*.mjs` 文件、**结构上不可能推动字节轴**
（`grep 'plugin/test' plugin/scripts/quay-init.sh` **零命中**，且文件数 132=基线未变）。

**归因（已定位到具体文件，不是"某处涨了"）**：
自上次再锚提交 `8df7abeae`（今天，`gap-quay-init-laydown-footprint-grew`，已 done）以来，
`plugin/` 下仅三个文件变动：
```
plugin/probes/meta-driver.md     +50      ← 在 laydown 集合内
plugin/scripts/meta-driver.ts    +314     ← 在 laydown 集合内
plugin/test/meta-driver.test.mjs +195     ← 不在 laydown 集合内
```
⇒ **+3146 字节全部来自 `meta-driver.ts` 与 `probes/meta-driver.md`**；无新增文件，故文件数不变。
（相关：`gap-meta-driver-concurrency-literal-cap-undeclared` 当前 `needs-human`。）

**复发率 = 8（这才是真问题）**：`git log develop -- plugin/scripts/quay-init-closure-ratchet.ts`
已有 **7 次**他任务的 re-anchor 提交（`b7b3b6d07` / `8df7abeae` 今天 +8640 字节、
更早 `40ff0390a` / `b886a030b` / `9d9e54eba` 等），本次是第 8 次同形。
**一个「每有 laydown 内改动就红一次、只能靠人手工再锚」的棘轮，
其阈值依赖一个外生变量（别的任务改了多少字节），符合硬规则 4 推论二**——
`BASELINE_BYTES = 3826955` 是写死的字面量（`quay-init-closure-ratchet.ts:71-72`），
它的"合理性"完全取决于当前 develop 的内容。

## Plan

**两部分，缺一不可——只做①会有第 9 次。**

1. **立即解阻：再锚基线**，把 `BASELINE_FILES` / `BASELINE_BYTES`（`:71-72`）按当前实测值更新，
   **并在提交信息里写明是哪几个 laydown 内文件造成的增长**（本次 = `meta-driver.ts` + `probes/meta-driver.md`，
   +3146 字节）。⛔ 不得只改数字不写归因——前 7 次正是这样做的，所以没人看得出它在复发。
2. **消除手工再锚形态**（择一，实现者定）：
   - **(a) 改为读宿主/读基线提交现算**：把基线从写死字面量改为「相对某个锚定 ref 的 footprint」，
     由脚本现算，laydown 内的正常增长不再要求人手工同步；只在**超出某个相对增幅**时才红。
   - **(b) 把再锚变成机械动作**：给 quay-init 的 laydown 变更加一个自动再锚步骤（改 laydown 集合的
     提交里同时更新基线），使"改了 laydown 却没同步基线"在提交时就被挡，而不是在别人的 fan-in 里才炸。
   - ⛔ **不要简单放宽或删除该棘轮**——它防的是 quay-init 落地面无声膨胀，是真检查。

## Acceptance Criteria

- [ ] `node --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --gate --root .` 在主检出退出 0（立案时取假：exit=1，+3146 字节）
- [ ] 再锚提交的信息里含造成本次增长的**具体文件名**（`meta-driver.ts` / `probes/meta-driver.md`）与字节数——`git log -1` 可核
- [ ] 复发防护落地：构造一个"改了 laydown 内文件但未同步基线"的场景，**在该改动自己的提交/门上就被挡**，而不是在下一个无关任务的 fan-in 上才红（单测断言）
- [ ] 负控制：棘轮仍能抓真实膨胀——人为给 laydown 内文件加一大块内容且不再锚，检查器仍 exit 1（证明没被放宽成恒真）
- [ ] `bash scripts/test.sh --for-task gap-quay-init-closure-ratchet-manual-reanchor-recurs` 退出 0

## Definition of Done

**验收对象是【全仓 fan-in 不再被这条静态检查挡住】且【第 9 次不会发生】，不是【数字改对了】。**
主检出上该 gate 退出 0；且存在一条单测证明"改 laydown 不同步基线"会在**改动方自己的门**上被拦。
**只把基线数字改大而没有②的防护 ⇒ 不算完成**——那是第 8 次重复同一个动作。

## Touches

- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/test/quay-init-closure-ratchet.test.mjs
- tasks/gap-quay-init-closure-ratchet-manual-reanchor-recurs.md
