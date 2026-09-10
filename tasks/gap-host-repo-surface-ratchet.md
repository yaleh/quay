---
id: gap-host-repo-surface-ratchet
title: 本仓库表层棘轮缺失：CLI 动词集 / web 路由集 /
  有消费者的配置键集只能靠人记得，没有任何机件在「交付面修法删掉本仓库自己的入口」时报红（GOAL-015 退出条件④ / AC-236）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-236
---
## Proposal

**来源**：GOAL-015 退出条件④「本仓库自身行为逐字不变——本 GOAL 的改动不得改变本仓库既有的 CLI/web/配置行为」在 2026-09-10 22:3xZ 之前**没有任何 AC 覆盖**（AC-233→退出条件①、AC-234→②、AC-235→③，④ 空缺）。goal-driver 的 `semanticSufficiencyVerdict` 当轮逐字给出 `sufficiency=insufficient（在域 AC 3 条）`，而 `goalAchievedFromRecords(...) && sufficiency?.verdict === "covered"` 是 `goalAchieved` 的合取式（`goal-driver.ts:353`）⇒ **该空缺让 GOAL-015 结构上不可达成**。已补立 `AC-236`（draft，待 goal-driver 分诊激活），本任务是它的实现。

**这条守的不是抽象原则，是一个已迫近的具体风险**：同 goal 下的 **AC-233** 要求「交付包不含形如入口、却在安装位置下无法运行的文件」，其最直接的修法就是把 `packages/quay/bin/quay.js` 与 `quay.ts` 从 `package.json` 的 `files` 里摘掉、或直接删除。**而 `CLAUDE.md` 的 Commands 段逐字把 `node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>` 记为本仓库跑 web UI 的正本入口**，`quay.js` 亦是本仓库文档记的 CLI 入口。⇒ 一个只顾交付面的修法会**当场打断本仓库自己的开发入口**，而全量套件未必拦得住——**删掉一个文件不产生失败断言**（同硬规则 3b：不报红 ≠ 没问题）。该任务此刻正在 worktree `gap-shipped-entry-files-not-runnable` 里在飞 ⇒ 时间上就是现在。

**现状（实测，位置判定）**：`grep -rn 'host-repo-surface' plugin/ packages/` 零命中；三个表层集合当前无任何机件守着单调性。

## Plan

1. 新增 `plugin/scripts/host-repo-surface-ratchet.ts`：按位置机械枚举三集合，与已提交基线比对，**基线 ⊆ 当前**则 exit 0。
   - **CLI 动词集** = 跑 `packages/quay/bin/quay.ts --help` 的**真实输出**，抽行首「两空格 + `quay ` + 动词」；⛔ 不读源码字面量——**这同时证明该入口本身还跑得起来**，正是退出条件④要守的东西。
   - **web 路由集** = `packages/quay/src/serve-handlers.ts` + `serve.ts` 里 `url.pathname === "…"` 的位置命中（硬规则②）。
   - **有消费者的配置键集** = `config-key-consumer-check.ts --json` 里 `state=="has-consumer"` 的 key（复用既有机件，硬规则①，⛔ 不另起一套枚举）。
2. 基线落 `docs/analysis/goal-015-host-repo-surface.baseline.json`（形态对齐既有先例 `docs/analysis/quay-init-closure-ratchet.baseline.json`），由脚本的 `--capture` 生成，⛔ 不手写。
3. 三态输出（硬规则 3b）：基线文件缺失 ⇒ **exit 1**（任务没做完，红）；被枚举的源文件读不到 / 入口 spawn 失败 ⇒ **exit 3 且打印 `NOT-EVALUATED`**，⛔ 不与合格同形。
4. 接三道注册闸 —— 由机件问出（`select-static-checks-for-touches.ts --touches plugin/scripts/host-repo-surface-ratchet.ts` 逐字列出 `superseded-capability-check` / `mirror-pair-drift-check` / `quay-init-closure-ratchet-stale`）：capability-catalog 声明行、`packages/quay/plugin/scripts/` 镜像副本、laydown 棘轮基线。
5. 接 `runner-static-gate.ts`（`run_checker "host-repo-surface-ratchet" …`，对齐 `:602` 的 `config-key-consumer-check` 写法）+ 建突变用例 `plugin/scripts/checker-mutation-cases/host-repo-surface-ratchet.sh`（`covered` 的判定逐字是 `[ -f "${CASES_DIR}/$1.sh" ]`，`checker-mutation-check.sh:121`）。
6. 加单测钉死双向。

## Acceptance Criteria

- [ ] AC1 机件存在且绿：`node --no-warnings --experimental-strip-types plugin/scripts/host-repo-surface-ratchet.ts --root . --json` exit 0，且输出含三集合的基数；贴命令与输出。
- [ ] AC2 正方向：基线已提交，`git show HEAD:docs/analysis/goal-015-host-repo-surface.baseline.json` 可读且三个键非空；贴三键基数（立案时的真实读数为 cli_verbs=19 / web_routes=25 / config_keys_with_consumer=5，实现时以当轮实测为准，⛔ 不照抄本行）。
- [ ] AC3 负方向（能取假）：往基线注入一个当前已不存在的元素（如路由 `/goals`）⇒ 检查器 exit 1 并逐字打印缩水的元素；验证后还原基线，贴前后命令与输出。
- [ ] AC4 未评估态可区分（硬规则 3b）：把被枚举的源文件之一临时改名 / 令入口 spawn 失败 ⇒ 退出码 3 且 stderr 含 `NOT-EVALUATED`，**与 exit 0 和 exit 1 三者互不同形**；贴三种退出码各一次的实测输出。
- [ ] AC5 新增允许（方向正确性，⛔ 防写反）：在基线之外**新增**一个元素（临时加一条路由或一个动词）⇒ 检查器仍 exit 0；贴命令与输出。
- [ ] AC6 突变覆盖：`bash plugin/scripts/checker-mutation-check.sh --list --json` 中存在 `name=="host-repo-surface-ratchet"` 且 `covered: true`；贴该条 JSON。
- [ ] AC7 三闸齐全：`bash plugin/scripts/capability-catalog.sh --json` 中该脚本 `question` 非 null；`mirror-pair-drift-check` 与 `quay-init-closure-ratchet --check-stale` 各 exit 0；贴三条命令的退出码。
- [ ] AC8 单测：`node --test plugin/test/host-repo-surface-ratchet.test.mjs` exit 0，含 AC3/AC4/AC5 三方向各 ≥1 条断言。
- [ ] AC9 AC-236 判据翻转：`goals/AC-236-*.md` 的 criterion 干跑从 exit 1 → exit 0（贴干跑输出）。

## Definition of Done

AC-236 的 criterion 在本仓库根干跑 exit 0；该棘轮已接进 `runner-static-gate.ts` 并被突变机制覆盖（`covered: true`）；且它对**新增**保持绿、对**删除/改名**转红、对**读不到输入**给出 exit 3 —— 三态实测各取到一次。⛔ 恒绿的检查器不算交付（硬规则 3b）；⛔ 不得把基线写成「当前值」后再断言「等于当前值」（那是硬规则 4 的不可取假量）。

## Touches

- plugin/scripts/host-repo-surface-ratchet.ts (new)
- packages/quay/plugin/scripts/host-repo-surface-ratchet.ts (new)
- plugin/scripts/checker-mutation-cases/host-repo-surface-ratchet.sh (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/test/host-repo-surface-ratchet.test.mjs (new)
- docs/analysis/goal-015-host-repo-surface.baseline.json (new)
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-host-repo-surface-ratchet.md
