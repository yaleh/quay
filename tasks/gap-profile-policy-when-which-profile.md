---
id: gap-profile-policy-when-which-profile
title: profile policy（L2：何时用哪个 profile——主备回退 + 加载一致性校验 + 继承去重）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  depends_on:
    - gap-ac154-claude-code-profile-extraction
---
**type:** execution

## Proposal

人裁定「配置和选择【何时和如何】使用这些 profile」——L2 policy 今日零对应（无任何机件）。至少覆盖 §14 三种【已发生】失败（⛔ 它们的用途是给 L2 定形态，不是立案理由——L2 是人已裁定要做的）：
① **主备回退**：`07fb3be7` glm-5.3 不可用只能人工回退；
② **加载时一致性校验**：AC142 `bare:true`+`claude-fjdac` 13/13 全败，今天没有任何校验知道 launcher 是什么；
③ **继承去重**：三个 worker role 逐字重复。

⛔ **别做成「配置项自由组合」**——那会长成第二个 `bare` 那种两级歧义旋钮（其中一级还是 inert 的）。

⛔ **blocker（归人裁定，未决）**：`packages/quay`（产品）vs `plugin/scripts`（编排）归属。「包裹会话的 quay」若是产品主张，L1/L2/L3 应逐步进 `packages/quay`；若只是本仓库开发循环需要，留编排层也自洽。差别 = quay 发布后别人能不能用这套会话管理。⛔ 不默认取一个值。

## Plan

policy 表达「语义 kind → profile 选择规则」（主备回退 + 加载校验 + 继承去重）。⚠️ **保留 `""` = 取消继承语义**（`quay-launch.sh:98` `with_entries(select(.value != ""))`，manager 靠它取消 917k 三件套；`"0"` 是有效值要保留）——丢了会让 manager 静默继承 917k。

## Acceptance Criteria

- [ ] AC1（能取假，主备回退）：主 profile 不可用时按 policy 自动回退到备 profile（不人工干预）；（⛔ 主不可用仍只能人工回退 ⇒ 假）。
- [ ] AC2（能取假，加载校验）：加载时校验 profile/launcher 一致性，bare 与 auth 不匹配在启动时被拒（非 13/13 全败后才知道）；（⛔ 加载时仍无校验 ⇒ 假）。
- [ ] AC3（能取假，继承去重）：多 role 共享配置不逐字重复（继承/引用 + `""` 取消继承）；（⛔ 三 role 仍逐字重复 ⇒ 假）。

## Definition of Done

policy 落地覆盖三种已发生失败；AC1-3 全勾；`""` = 取消继承语义保留；未长成第二个 bare 两级旋钮。

## Touches

- .quay/profiles.yml（policy 承载，或并入 config.yml）(new)
- plugin/scripts/profile-policy.ts（新：policy 解析，语义 kind → profile）(new)
- plugin/test/profile-policy.test.mjs（对应测试）(new)
- tasks/gap-profile-policy-when-which-profile.md（自身）