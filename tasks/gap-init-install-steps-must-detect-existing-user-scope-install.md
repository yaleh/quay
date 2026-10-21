---
id: gap-init-install-steps-must-detect-existing-user-scope-install
title: quay:init 打印的安装步骤未先查 installed_plugins.json 里 quay@quay 是否已有 user scope
  条目——agent 按打印步骤又装一份 project scope，钉死版本不随 user 升级
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

根因（诊断）：init 本身不执行安装——printInstallSteps()（packages/quay/src/init.ts:4016）只【打印】步骤，plugin/skills/init/SKILL.md 步骤 3 说「Follow the printed install steps. Run them」，真正执行安装的是按打印步骤行动的 agent。打印步骤把 `claude plugin install quay@quay --scope <user|project|local>` 三者并列呈现为等价选择，且没有先读 installed_plugins.json 检查 quay@quay 是否已有 user scope 条目。现场证据（plantuml-js 2026-10-21）：user scope 已有 0.19.0，init 后 agent 又按步骤执行 `--scope project`，project 条目钉死 0.20.0，不随 user 升级。

## Plan

1. 读 init.ts 的 printInstallSteps()（约 :4016）与 SKILL.md 步骤 3，确认打印/引导逻辑与 installed_plugins.json 的实际路径和 v2 格式（plugins["quay@quay"] 是数组，每项带 scope/version）。
2. 在打印安装步骤前，读 installed_plugins.json：若 quay@quay 已有 scope=user 条目，则打印改为「已有 user scope 安装（版本 X），无需再装；如需项目级覆盖请显式 --scope project，它会钉版本、不随 user 升级」——不再并列建议 project/local。
3. 仅在调用方显式要求 project scope 时才提示它，且必须附「钉版本、不随 user 升级」警告。
4. 加回归测试：mock installed_plugins.json 含 user scope 条目 → init 打印不含 `--scope project` / `--scope local` 建议；不含条目 → 仍并列建议三者（原行为）。

## Acceptance Criteria

- [ ] printInstallSteps 的输出在「quay@quay 已有 user scope 条目」时，不再并列建议 project/local，而是提示「已有 user scope 安装（版本 X）」；且 project 选项仅在显式要求时出现并带钉版本警告。
- [ ] 回归测试覆盖两种输入（user scope 已存在 / 不存在），断言打印内容按上条区分，且可 grep 核对。

## Definition of Done

- 两条 AC 全绿；改动经 scripts/test.sh 相关泳道通过，合并进 develop。
- 只改 quay 代码/文档（init.ts + SKILL.md + 测试），不改任何外部工作区的 installed 条目。

## Touches

- tasks/gap-init-install-steps-must-detect-existing-user-scope-install.md
- packages/quay/src/init.ts
- plugin/skills/init/SKILL.md
