---
id: gap-meta-call-ac-918-goal-911
title: AC-918 的判据结构上不可通过却在域 ⇒ GOAL-911 结构上永远无法达成；如何处置需人裁定
status: ready
labels:
  - meta-human-call
  - meta-driver
parent: null
children: []
extra:
  acceptance: 'node packages/quay/bin/quay.js goal show AC-918 --json 2>/dev/null
    | grep -q "\"status\": \"superseded\"" && node packages/quay/bin/quay.js
    goal show AC-925 --json 2>/dev/null | grep -q "\"status\": \"active\""'
---
## Finding
AC-918（status=active，按 goal-driver.ts:880 `inScopeAcsOf` 计入在域）的判据是扫源码文本的正则 `kind:\s*"([a-z-]+)"…admission:`，而注册表里两个 mechanical kind 是以模块常量登记的（`kind: CONCERN_KIND_IN_SCOPE` / `kind: DESIGN_EVOLUTION_KIND`），所以它每轮恒解析出 0 对、恒 exit 2，读数上永远是一条 fail。它声称覆盖的『取值正确』已由 AC-921（achieved，import 读注册表）覆盖，『按 admission 分派』由 AC-923 承接。这条 AC 应当重写判据、标 superseded、还是保持现状？

**要人裁决的是什么**：AC-918 的判据结构上不可通过却在域 ⇒ GOAL-911 结构上永远无法达成；如何处置需人裁定
**选项与代价**：① 重写 AC-918 的 criterion 为 import 版（照抄 AC-921 的判据），并把 expect 里『Planner 按 admission 分派』一句显式改指 AC-923 —— 成本：改一条 criterion + 一次 goal 写；收益：AC-918 变成可取假、可通过，GOAL-911 可以达成。② 把 AC-918 标 superseded（移出在域），并在 AC-923 的 expect 里显式承接『按 admission 分派』 —— 成本：一次 status 写 + 一次 AC-923 文本改；风险：漏写则那半条断言静默消失。③ 保持现状 —— 成本：GOAL-911 永远无法 achieved，每轮继续产出同一条恒假 fail（已连续 8 轮），后续 meta-driver 轮会把它当成『工作没做完』反复处置。
**为什么机器不能自决**：readings：AC-918 verdict=fail，reason=『CAUSE=instrument-failure: no kind+admission pairs parsed』；timeSeries 的 goal:AC-918:verdict 连续 8 轮不变（crossed=true）。同一对象上更强的判据 AC-921 本轮 verdict=pass、record=achieved，其 origin 已写明该正则只能匹配带引号的字面量、看不见模块常量形式的 kind。故 AC-918 的 fail 不是目标状态读数，是仪器读数。后果是结构性的：goal-driver.ts:903 `goalAchievedFromRecords` 要求全部在域 AC 达成，active 在域 ⇒ 这条不处置，GOAL-911 不可能关闭。⛔ 为什么这不是 autoDrive：上一轮做出 AC-921 时【没有】退役 AC-918，说明『换判据 / 标 superseded』的选择尚未被任何裁定固定（已写下的只是仪器该 import，不是这条 AC 的归属），属于人的方向裁定；且退役会把『Planner 按 admission 分派』半条断言移出在域集合，机械侧不应替人做这个取舍。
**若机器自行选错，什么难以撤销**：若选『退役 AC-918』而承接写漏，『Planner 按 admission 分派』这半条断言会静默移出在域集合；GOAL 一旦达到 achieved 就退出每轮复验（goal-driver 不再复跑它），此后没有任何读数会显示这条断言丢了——AC-921 只验注册表取值，AC-923 只验 C1 拒绝非法 admission 值，两者都不覆盖『按 admission 分派到 mechanical / semantic-judged 两条路径』本身。
**实测依据**：`criteria.AC-918.verdict` = "fail"（meta-driver 机械采集于 2026-10-22T11:24:11Z）

**互相矛盾的既有立场（逐字引用，已机械核对确实存在于对应文件）**：
- `goals/AC-918-注册表每个条目有-admission-字段-mechanical-semantic-judged-取值正确且-plann.md`：「正向：`CONCERN_KIND_REGISTRY` 每个已注册条目都带 `admission` 字段，且 `package-cycle` /」
- `goals/AC-921-ac-918-的准入判据读注册表对象本身-import-不扫源码文本-文本正则看不见与注释同形的常量-kind.md`：「AC-918 的准入判据读注册表对象本身（import），不扫源码文本——文本正则看不见与注释同形的常量 kind」

## Ruling (2026-10-23)

**人裁定：选项 2。** AC-918 标 `superseded`（`supersededBy: [AC-921, AC-923]`，提交 `b9f052838`）；新增 **AC-925** 明确承载「Planner 的 C1 准入按 admission 分派」的机械断言（`active`，criterion=`node --test plugin/test/admission-dispatch.test.mjs`，当前 exit 1，待 Planner 派生实现任务）。GOAL-911 ① 的分派引用已改为 AC-925，④ 已改为 `AC-919、AC-924、AC-925`。

## AC
- [x] 人在上述选项中作出选择，并把选择写进本任务体（或以 DIR 记录该裁定） —— **实测**：选项 2 已写入 `## Ruling (2026-10-23)`。
- [x] 依该选择产生的后续工作已立案或已落地（⛔ 不以「已回答」本身充当完成） —— **实测**：AC-918 status→superseded（`b9f052838`）；AC-925 已建（active）；GOAL-911 ①/④ 已对齐。

## DoD
- [x] 裁定已记录在可被后续读到的正本里，⛔ 不只存在于本任务的对话中 —— **实测**：本任务体 `## Ruling` + AC-918 的 `superseded` 状态 + AC-925 记录。
- [x] 上面两条互相矛盾的立场中，落败的一方已被就地更正或标注，⛔ 不留着继续制造同一次冲突 —— **实测**：AC-918 已 `superseded`（落败立场退出在域）；AC-925 承接分派断言。

## Touches
- `goals/AC-918-注册表每个条目有-admission-字段-mechanical-semantic-judged-取值正确且-plann.md`
- `goals/AC-923-c1-准入闸真正消费-registry-的-admission-字段-非法取值必须按名拒绝-而不是继续走机械判定.md`
- `goals/AC-925-planner-的-c1-准入按-admission-分派-mechanical-走既有-delta-判定-semant.md`
- `goals/GOAL-911-通用化-线索-vs-语义判断-两段准入-注册表加-admission-字段区分-mechanical-semantic.md`
- `tasks/gap-meta-call-ac-918-goal-911.md`

## Evidence

- AC-918：`goal show AC-918` ⇒ `status: superseded`，`supersededBy: [AC-921, AC-923]`（提交 `b9f052838`）。
- AC-925：`goal show AC-925` ⇒ `status: active`，`criterion: node --test plugin/test/admission-dispatch.test.mjs`（提交 `934051165`）。
- GOAL-911：① 引用 AC-925；④ = `AC-919、AC-924、AC-925 均 achieved`。

## Dark Axis

该轴仍暗,理由: 本任务只记录人的裁定并改 goal store 的 AC/退出条件文本，不改生产代码、延迟、并发或资源行为；无 L_D/L_G 轴读数可采。
