你的指正已处理（develop-deliver-tgz.sh 缺 @instrument + catalog 未登记）：

1. 根因确认：capability-catalog.sh 报 1 unclassified（= develop-deliver-tgz.sh），AC1c 门会红——正是重合并前置。
2. 修复（commit f83f1319）：
   - capability-catalog.sh 五表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）各加 develop-deliver-tgz.sh 条目 → 204 declared / 0 unclassified / RC=0。
   - develop-deliver-tgz.sh 头部加 @instrument 声明 → runtime-usage-inventory --instruments-json 已收录（admitted）。
3. 注明：capability-catalog.sh 是验证机件（判据B 快路径例外）——本改动需一轮绿覆盖后 fan-in（下一轮验证轮覆盖）。

另：workflow wf_64f08ee2-f7c 已完整跑通 Fix→Verify→Merge（outcome green），batch-merge develop→cb8ed732，
--deliver 首次自动触发成功：B/C 均 quay serve http_code=200，state lastDelivered=cb8ed732。DIR-123 AC2 端到端达成。
