---
id: gap-init-skill-stale-pointer-to-retired-cold-start
title: quay:init skill 结尾的"下一步"指引仍指向已退役的 /quay:cold-start，而非现役的 /quay:drivers
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`plugin/skills/init/SKILL.md:437` 告诉用户下一步运行 `/quay:cold-start`。但 `plugin/skills/cold-start/SKILL.md:12-19` 带有明确的「⛔ RETIRED」横幅，声明它描述的双会话 tmux/cron 模型已被 worker-driver 模型取代，当前正确流程是 `①install ②session ③/quay:init ④/quay:drivers ⑤/quay:manager`——`/quay:cold-start` 甚至不在这个清单里。init 自己的「下一步」指针在 cold-start 退役时从未被更新，意味着每一个新项目的首次 onboarding 步骤目前都指向一个已死的 skill。

## Acceptance Criteria

- [ ] `plugin/skills/init/SKILL.md` 里「下一步」的文字从 `/quay:cold-start` 改为 `/quay:drivers`
- [ ] 改动后文字与 `plugin/skills/cold-start/SKILL.md` 自己声明的现役流程（`①install ②session ③/quay:init ④/quay:drivers ⑤/quay:manager`）一致
- [ ] grep `plugin/skills/init/SKILL.md` 确认不再出现 `/quay:cold-start` 字面引用

## Definition of Done

全部 AC 勾选；init skill 的下一步指引指向现役流程，不再引导新用户到已退役的 skill。

## Touches

- plugin/skills/init/SKILL.md
- tasks/gap-init-skill-stale-pointer-to-retired-cold-start.md
