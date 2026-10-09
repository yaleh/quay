---
id: gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen
title: launchArgv passes the whole prompt as ONE argv element — meta-driver's
  readings grew past the 128 KiB MAX_ARG_STRLEN, so every semantic round now
  dies on spawn E2BIG
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务修的是 Layer 0 spawn 原语的参数传递方式（argv → stdin），不新增/不改变任何包间依赖边、不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

`gap-meta-driver-snapshot-tracked-changes-reference-error` 的 import 修复把语义半从 `ReferenceError` 推进到**下一个、独立的**阻塞点，实测转移：`09-12 E2BIG` → `09-14 REF` → `10-09T08:52 E2BIG`（即 guard 已修好、生产已跑新代码，现在是另一个更早存在的缺陷）。

**根因（实测，非推断）**：`plugin/scripts/driver-runtime.ts:1783` `launchArgv` 把**整个 prompt 作为单个 argv 元素**（`-p <prompt>`）。Linux 单参数上限 `MAX_ARG_STRLEN = 131072 字节`（本会话二分实测：131071 成功、131072 即 E2BIG；⛔ 与总预算 `ARG_MAX=2097152` 无关）。meta-driver readings JSON 实测最大 **1,281,521 字节**（≈9.8×）⇒ `spawn` 必死。

## Plan (as executed)

1. `launchArgv` 加**可选** `promptViaStdin`：为真时只 push 裸 `-p`（prompt 由调用方经 stdin 写入）；缺省 false ⇒ 既有调用点 argv **逐字不变**。
2. `runAsync` 加**可选** `stdinData`：缺省 `undefined` ⇒ `stdio[0]` 仍是 `"ignore"`（逐字不变）；给了才开 pipe 并 `end()`。
3. 只有 meta probe 那一条路径 `promptViaStdin: true`（`probeArgv` 测试缝存在时不改）——blast radius 收敛到一个调用点。
4. 新增 `plugin/test/launchargv-stdin-prompt.test.mjs`：181,072 字节载荷经 stdin 传输、子进程回报**恰好**该长度；负对照断言同一载荷走 argv 必 `E2BIG`；另钉「缺省不传 stdinData 时子进程立即读到 EOF 而非挂住」。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/meta-driver.ts
- plugin/test/launchargv-stdin-prompt.test.mjs
- tasks/gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen.md

## AC

- [x] 新测试：>131072 字节 prompt 经新路径传输、子进程回报长度一致。**Verified**: 181072 == 181072，exit 0。
- [x] **负对照**：同一载荷走旧 argv 路径必 `E2BIG`。**Verified**: `r.error.code === "E2BIG"`。
- [x] 既有行为不回退。**Verified**: `driver-runtime-s*.test.mjs` 44/44、`meta-driver.test.mjs` 133/133。
- [x] 未传 `stdinData` 的调用点 argv 逐字不变。**Verified**: 既有测试未改断言即全绿；新增的 EOF 用例显式钉住缺省路径。
- [x] 无截断/降级分支。**Verified**: 新增行上 `slice(0,N)|truncat` 零命中。
- [x] **额外直接量核验**：按修复后的 `launchArgv("meta-driver", <1.28 MB prompt>, root, {promptViaStdin:true})` 现场构造 argv——**11 个元素、最大 567 字节**（上限 131072），末元素为裸 `-p`。即该载荷不再可能触发 E2BIG。

## DoD

**⚠️ 诚实结果：代码已修并已在 argv 层面直接量验证，但生产尚未加载它——不得记作「生产已验证」。**

- 直接量：正在跑的 `pid 2521870` **启动于 17:18:57（本地）**，而本修复提交于 **17:24:12**——**该进程比修复早 5 分 15 秒**。它此后（09:22、09:43 UTC）仍报 E2BIG，因为它在跑**修复前的代码**，与修复正确性无关。
- 因此 `.quay/meta-driver-round.jsonl` 尚无 `state:"verified"` 记录，**不是**修复失败的证据，而是**未刷新**的证据。
- ⛔ 本任务**不重启任何 driver**（DoD 自身的约束）。需要的动作是让常驻进程重载（source-refresh 未触发，或需一次显式 restart）——**留给后续/人裁定**，⛔ 不由本任务自行执行。
- 复验方式（刷新后照做即可）：`grep -n 'meta-review' .quay/meta-driver-round.jsonl | tail -1` 应出现 `"state":"verified"` 或**新的**失败原因（不再是 E2BIG）。