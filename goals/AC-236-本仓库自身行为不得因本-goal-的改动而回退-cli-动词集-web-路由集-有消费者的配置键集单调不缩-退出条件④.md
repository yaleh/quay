---
id: AC-236
title: 本仓库自身行为不得因本 GOAL 的改动而回退——CLI 动词集 / web 路由集 / 有消费者的配置键集单调不缩（退出条件④）
status: draft
kind: criterion
goal: GOAL-015
criterion: test -f plugin/scripts/host-repo-surface-ratchet.ts && node
  --no-warnings --experimental-strip-types
  plugin/scripts/host-repo-surface-ratchet.ts --root . --json && bash
  plugin/scripts/checker-mutation-check.sh --list --json | python3 -c 'import
  json,sys; m=json.load(sys.stdin);
  ok=any(c.get("name")=="host-repo-surface-ratchet" and c.get("covered") for c
  in m.get("checkers",[])); print("registered:",ok); sys.exit(0 if ok else 1)'
expect: >-
  三个断言缺一不可：


  ① 棘轮检查器 plugin/scripts/host-repo-surface-ratchet.ts 存在，且在本仓库跑 exit
  0——即**基线三集合逐一是当前三集合的子集**（新增允许，删除/改名不允许）。三集合按位置机械枚举：
     - **CLI 动词集** = 从 packages/quay/bin/quay.ts --help 的真实输出里抽行首「两空格 + quay + 动词」；⛔ 不读源码字面量——**它同时证明该入口本身还跑得起来**（这正是退出条件④要守的东西，见下）。
     - **web 路由集** = packages/quay/src/serve-handlers.ts 与 serve.ts 里 url.pathname === "…" 的位置命中（硬规则②：按位置，不按关键词）。
     - **有消费者的配置键集** = config-key-consumer-check.ts --json 里 state=="has-consumer" 的 key。
  ② 它出现在 checker-mutation-check.sh --list --json 的清单里且 covered: true——**能取假**，⛔
  恒绿的检查器是假保证（硬规则 3b，同 AC-235 第②条）。

  ③ 三态可区分：基线文件缺失 ⇒ exit 1（任务没做完，红）；被枚举的源文件读不到 / 入口 spawn 失败 ⇒ exit 3 并打印
  NOT-EVALUATED，⛔ 不与合格同形（硬规则 3b）。


  **为什么这条不是空转（它守的是一个具体且已迫近的风险）**：退出条件④守的正是 **AC-233 的修法**。AC-233
  要求「交付包不含形如入口却在安装位置下无法运行的文件」，其最直接的修法就是把 packages/quay/bin/quay.js 与 quay.ts 从
  files 里摘掉或删除——**而 CLAUDE.md 的 Commands 段逐字把 node --experimental-strip-types
  packages/quay/bin/quay.ts serve 记为本仓库跑 web UI 的正本入口**，且 quay.js 是本仓库文档记的 CLI
  入口。⇒ 一个只顾交付面的修法会**当场打断本仓库自己的开发入口**，而全量 suite 未必拦得住（删文件不产生失败断言）。本条把它变成一个会红的量。


  **立条当轮已取的真实读数（硬规则 4c，从仓库根干跑，两个方向都验过）**：

  - 判据形态干跑：exit 1（检查器尚不存在，可评估且红）。

  - 三集合当前基数：cli_verbs=19 / web_routes=25 / config_keys_with_consumer=5。

  - 正方向：捕获基线后跑 ⇒ exit 0，打印 19/19、25/25、5/5。

  - 负方向：往基线注入一条现已不存在的路由 /goals ⇒ exit 1，逐字打印 FAIL: host-repo surface shrank:
  {"web_routes": ["/goals"]}。（/goals 是真实先例——本 GOAL body 里记着我把单数路由 /goal 误测成
  /goals 得 404 那次。）

  - 验完已删除临时基线文件，未污染仓库。


  **边界（照实说明，不冒充更强的保证）**：本条覆盖的是**表层集合的单调性 + 入口可运行性**，⛔
  不证明既有路由的渲染内容逐字不变——那由本仓库自身测试套件在每次 fan-in 时把关，本条不重复它、也不冒充它。
origin: >-
  GOAL-015 的机器判据之一，补退出条件④「本仓库自身行为逐字不变」——立条前该退出条件**没有任何 AC
  覆盖**（AC-233→①、AC-234→②、AC-235→③，④ 空缺），而 goal-driver 的充分性判据
  semanticSufficiencyVerdict 当轮逐字给出 sufficiency=insufficient（在域 AC 3 条）；由于
  goalAchieved 要求 sufficiency==="covered"，该空缺让 GOAL-015 **结构上不可达成**。⇒ 本条补上它。


  判据类别沿用 GOAL-015 的纪律：只引用不会自行回退的量——代码状态、机械枚举计数；⛔ 不含进程存活与远程主机当前可达性。


  ⚠️ 本条自身的可证伪性提示（留给后来者的对照）：若某次改动只是**新增**动词/路由/配置键，本条应保持 exit
  0；只有**删除或改名**才转红。若发现它对新增也报红，那是检查器写反了方向，不是本仓库回退。
---
