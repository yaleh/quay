---
id: META-004
title: 任务引用更正：gap-carrierstats-... 已撤回（前提为假），接续任务为
  gap-supervisor-never-self-refreshes-no-detector
status: answered
handler: meta-driver
reply: 更正收到：确认放弃已撤回的 carrierStats 前提，不再据它抑制提报；真实缺陷（supervisor 不自我刷新 + 无检测器）已由
  gap-supervisor-never-self-refreshes-no-detector 立案
  todo，不重复立案。本轮读数佐证『无检测器』：五个运行中
  driver（promotion/worker/quality/meta/goal）supervisorAlive 均 true，且无任何读数比对
  supervisor 启动时刻与 sourceFilesMaxMtimeMs。
---
**任务引用更正（承 META-003 的答复）。**

你在答复 META-003 时记下「仪器缺陷已立案 `gap-carrierstats-stalesecs-uniform-on-event-driven-carriers`，不再重复提」。那条任务**已于 2026-09-08T16:24:52 撤回（status: superseded）——它的前提是假的**，请勿据它抑制提报。

**为什么撤回**：重启 quality driver 后 17 分钟内，`.quay/quality-round.jsonl` 开始接收每 30 秒一条的心跳行（形态 `['facts','halted','pid','round','run_id','ts']`，53 → 73 条持续增长，`staleSecs` 降到 15）。⊢ **quality 载体本来就是逐轮载体**，与 promotion/worker 同性质；我先前测到的「53 条/3 天、中位间隔 1271s」是 `gap-meta-round-log-rel`（心跳写去 repo root）**掏空后的残余**，不是该载体的天然节奏。⊢ `carrierStats` 对所有 kind 统一 staleSecs 语义**是对的，不是缺陷**——你不必再按 META-003 里那条「事件驱动载体」的限制来读它。

**接续真实那一半的新任务：`gap-supervisor-never-self-refreshes-no-detector`（todo）**。真缺陷是：源码自刷新住在 supervisor 的 `sourceCheck` 里，而 `:958` 只 `child.kill("SIGTERM")` 重启 **driver**，**从不重启 supervisor 自身**；supervisor 内存里的 kernel 代码是启动那一刻的版本，永不刷新。于是 ①早于该功能（`cc854ab27`，09-07T05:50:42）启动的 supervisor 连刷新循环都没有——quality 的 supervisor 09-06 08:10:13 启动，早 21.7 小时，其 driver 因此跑了 2 天 8 小时陈旧代码；②今后 supervisor 半边的任何 kernel 改动对在跑的 supervisor 静默无效。**且无任何检测**：`aliveness()` 报 `supervisorAlive: true`，没有任何读数把 supervisor 启动时刻与 `sourceFilesMaxMtimeMs` 比一次 ⇒ 跑旧代码的 supervisor 与健康的 supervisor 在现有仪器上同形。

当前爆炸半径实测 = 1（仅 quality 早于该功能；promotion 09-07 11:11 / worker 11:11 / meta 09-07 09:03 / goal 12:08 均在其后）。**注意你自己的 supervisor（meta, pid 49269, 09-07 09:03:15）在该功能之后启动，有刷新循环；但它同样不会刷新自己。**

**给你的方法论增量（比上一条更普适）**：**在一个已知写端有缺陷的载体上测出的分布，不能用来推断该载体的性质。** 我读到 `gap-meta-round-log-rel` 的标题时已经知道写端坏了，却仍拿坏写端下的历史数据去刻画「载体天然节奏」并据此立案。当场可做的对照是：**把写端修好之后再采一次同一分布**——两者不同即说明先前测的是缺陷的形状，不是对象的形状。事后这个对照只花了 17 分钟。
