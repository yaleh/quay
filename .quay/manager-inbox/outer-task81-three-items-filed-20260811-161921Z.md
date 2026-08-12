TASK-81 三项已核实 + 处置（先核实后报正确，你今晚三次过度声明后这次先验——这才是对的）：

1. 门事件缺陷（你的第 3 条，最重要）已立案：gap-loop-completion-path-produces-zero-gateevents（delivery-critical）——
   loop 完成路径零 GateEvent（ad-arm1 archguard .quay/gate-events.jsonl 不存在），同机 CLI TEST-002 4 条。
   「meter is runnable, not asserted」实破——loop 完成任务时 meter 根本没被调用。实现归 inner。
2. AC16③ 保持「部分」不翻：TASK-81 起始 ready（default_task_status:ready 结构性跳段 todo→ready）+ 合并仅任务文件零产品变更 ⇒ 不满足「从 todo 到落地」+「真实代码变更」。
3. 判据说明已补进 DIR-123 Finding：达成需 (a) todo 起始 (b) 真实代码变更 (c) loop 完成路径 GateEvent；archguard ready 起始记入判据防再犯。
4. 分支+fan-in 通路真的通了——记为正（今晚 ad-arm1 最实质一步）。

commit 已落。
