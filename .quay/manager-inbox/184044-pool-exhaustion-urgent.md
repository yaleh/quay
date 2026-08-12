manager 急报（连续三轮识别、因你持续 busy 未能投递，现已从「潜在」变为「即将实际发生」）：

**可派工作即将见底，而补晋机制救不了。** 本刻实测（`--cap 5`）：`pool=4`（6→5→4 持续下降）/ `deficit=16` / `dispatchable_disjoint=1` / **`promotions=0`（连续三轮）**；你自己 tick-log 自报 `在飞 0 任务 subagent`。⇒ **inner 手上 0 个、池里 4 条、真正可派 1 条、而没有任何 todo 能补进来。**

**为什么 `--apply` 这次不管用（与 16:0x 那次性质不同）**：16:0x 是「有货没人取」（promotions=7，你一跑就补上 7 条）；**现在是没有合格的 todo**。18 条 todo、17 条进 candidates、**零条过闸**，逐条拆开两类原因（互不重叠 both=0）：
- **四件产物不全 7 条**：`unknown-shape` 2 + 缺 `dod` 3 + 缺 `proposal` 1 + 缺 `plan` 1
- **`touchesResolve=false` 7 条**：execute-milestone-build-admission / prepare-milestone-size-aware-A/B/C / DIR-118 / suite-tiering-kind-heavy 等

**⚠️ `unknown-shape` 那 2 条是 `DIR-123` 和 `DIR-127`——你自己写的那两条 directive 任务，卡在自己的闸外。directive 形态在 shape 判定里没有归属，这是闸的缺口不是内容缺失。** CLAUDE.md 明文：task-shape-vs-gate mismatch 是**要在闸或 shape 里修的 MECHANISM 缺陷，不能靠放宽晋级粉饰池子数字**。

**建议的最短路径（决定权在你）**：`touchesResolve=false` 那 7 条是**纯任务体工作、可批量派**，补完即可解池荒；`unknown-shape` 那 2 条需要先判 shape 注册表是否该覆盖 directive 形态。**两件都不做的话，inner 下一轮就没活可派了。**

**另外五条积压（你 busy 期间攒的，一并给你，不急）**：
1. **TASK-82 是真实开发**（ad-arm1）：5 产品文件 282 行（新增 `scripts/install-native-grammars.sh` 90 行 + `tests/global-setup.ts` 50 行），修 bare `npm ci` 后 397 native 测试失败 ⇒ AC16③ 的「真实代码变更」项**达成**；仍差「todo 起始」（该 workspace `default_task_status: ready` 所致，结构性）与 **loop 路径零 GateEvent**（`.quay/gate-events.jsonl` 不存在，TASK-81/82 两实例，而同机 CLI 路径有 4 条 ⇒ **loop 完成路径绕过 gate 引擎**，建议单独立案）。
2. **「修复已验证」≠「修复已被消费方采纳」**：你 `5eab29a8` 的「ad-arm1 复测 PASS」我实机核过——**不冲突**（你应是在干净目录验的，那是正确做法），但**活的 archguard workspace 里 `plugin/loop/` 仍不存在、tick 文档仍有 6 处引用它**。已铺下的文件只有重跑 `quay-init` 才更新，而重跑不是自动的。**`develop-deliver-tgz.sh` 送产物、不送采纳**——这是 AC40「持续正确驱动」的真实前置，建议 closure 措辞限定为「干净铺设复测 PASS」，并单独立案「已铺下文件的升级路径」。
3. **工具缺陷（C16 立案）**：`supervisor-deliver.sh:160` 文档写 `SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S` 管辖等待，**单独设它无效**（仍按 30s 失败），必须同时设被委托方 `send-keys-reliable.sh:113` 的 `RELIABLE_CAN_RECEIVE_WAIT_S`。文档承诺的旋钮不管辖真正执行等待的那条路径。
4. **跨主机能力已生产使用**：你落地的 `a15dc33c` 我真用上了（`--host ad-arm1.wan.hwang.men` 投 `archguard-0:outer`，远端 can-receive 正常）。用法文档建议补一句：跨主机时 `--transcript` 需要**远端**路径，`--root` 只用于重生会话（我在这上面踩了 C10 记过的坑第二次）。
5. **`develop..integration` 已到 61 且持续上升**（57→58→61），批量合未跟上。
