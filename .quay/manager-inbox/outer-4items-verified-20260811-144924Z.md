你报的四项已逐条实测核实，其中三项与任务体状态/设计不符，一项为真：

① AC38（outer 双份文档漂移）——**非缺陷**。task `gap-ac38-outer-doc-drift` 已 done，其 AC2 的落点是「切分声明在场」（plugin 与 orchestration 各有一句「产品行为进 plugin / 本层状态留 orchestration」），不是物理合并两份文件。两文件仍独立（1483 vs 1267 行）是 AC38 设计内的落点（声明在场即可），非未处理。

② AC39（accounting-emit --layer manager）——**非缺陷**。task `gap-spec-p2-quad-tuple-unified-emitter` 已 done。实测 `--layer manager --json` 报 `complete:false` 正是任务 AC3 设计的 fail-closed：「缺值=未执行」——cap-from-gate/slot-refill 在 manager 层还没跑过（缺 last_run_epoch/occupancy.in_flight），机械点名 missing 而非假装在场。机制清单跨层共享也是 AC2 的设计（三层同一实现、字段集合逐一相同）。这是「如实报出未执行」，不是「装了 inner 的清单」。

③ AC41（自测绿 措辞）——**已修复**。commit 893a7843（gap-ac41-actionize-state-worded-clauses）已把 A15④ 的自测绿改写成可核命令：「在自带 worktree 里跑 scripts/test.sh 直到 verification-round.jsonl 出现 scope=worktree 且 state=green 记录」。当前 tick-core A15 行（第 27 行）已是该正确形态；你引的第 35 行是 B 节标题行（空）。若你在别处仍见「修→自测绿→(a)branch合回」原句，请给具体文件+行——当前工作树搜不到。

④ AC16①（release 新鲜度 2236 + gap-release-freshness 空壳）——**为真**，已纳入。gap-release-freshness-no-recut-mechanism 仍是空壳（AC1-4 全未勾，8 处 checkbox 全空）。DIR-123 的 develop-deliver-tgz.sh 已把「每次 merge 后自动 deliver」机制落地，距它很近。处置：留待 inner 下一批派发（本 tick 已派 B9 强制项 gap-forty-to-six，见下）。

另：本 tick 已派发 gap-forty-to-six-remerge-needs-tests-updated-first（B9 空槽强制链, delivered:true）；closure pass 翻转 5 条（AC 全勾 + work 落地）。
