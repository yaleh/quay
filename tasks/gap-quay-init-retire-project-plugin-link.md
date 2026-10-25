---
id: gap-quay-init-retire-project-plugin-link
title: quay init 不再生成 .quay/plugin：符号链接删除、普通文件/目录拒绝并报告，读数三态 retired/absent/refused
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`/quay:init` 维护项目内符号链接 `<project>/.quay/plugin -> <init 运行时插件根>`（`packages/quay/src/init.ts:3192` 的 `refreshProjectPluginLink`，调用点 `:2040`）。它存在的唯一理由是给「Core 不在回路里」的外部消费者指路（`plugin/skills/init/SKILL.md` §The project link）。

这个指路方式有三个结构性问题：

1. 它绑定的是「上次 init 运行时的插件根」，不是会话实际加载的版本；升级后必然漂移，而漂移只能被报告、不能自动修正（多版本会话并存）。
2. 它把版本发现变成两套解析器：会话层按 Claude 插件 scope 决定加载哪个版本，链接按「上次 init 从哪跑」决定指向哪个版本，两者会分叉（`init.ts:3131` 头注释记录的 2026-10-06 实测：链接停在 0.14.0 而会话已加载 0.15.0）。
3. 它让外部消费者依赖一个 quay 自己都不作为输入的路径：`packages/quay/src/core/plugin-root.ts:115-117` 明写 Core 从不读 `.quay/plugin`；`driver status` 只把它当 drift 读数。

用户 2026-10-25 裁定：quay 不再生成 `.quay/plugin`；外部消费者改为按 Claude 插件 scope 解析 CLI（claudecodeui 任务 `gap-quay-entrypoint-resolver-via-claude-plugin-scopes`，另一任务库）。

本任务要落的三件事：

- `quay init` / 升级**不再创建**该链接；
- 迁移：若该路径**是符号链接** ⇒ 删除；若**是普通文件或目录** ⇒ 拒绝并报告，原样不动（闭集不拥有用户在该名字下的内容）；
- 读数三态：`retired`（本次删除了一个链接）/ `absent`（本来就没有）/ `refused`（存在但不是符号链接，未动）。

⚠️ 发布顺序约束：删除链接会让尚未升级解析器的外部消费者读不到 CLI。本任务可以落地并合并到 develop，但**发布**必须晚于 CloudCLI 解析器部署；release notes 必须写明这是 breaking change（`.quay/plugin` 不再生成）。这一条写进 DoD，不阻塞代码落地。

核查过、**不需要改动**的两处（写下来防止实现者顺手改坏）：

- `.gitignore` 模板用 `.quay/*` 已经覆盖该路径（`init.ts:3965` 的 entries），无需新增规则；
- `quay-init-closure-assertion.ts` 的 `walk()` 只记录 `isFile()`（`:140-145`），符号链接本来就被跳过，闭集成员不受影响；如果将来 walk 开始记录符号链接，这里会变成违规，本任务应留一条测试固化「链接不被计入闭集」。

## AC

- [ ] AC1（不再创建）：在临时 workspace 上跑一次真实 init（`--plugin-root` 指向一个有效插件根）后，`<ws>/.quay/plugin` **不存在**；贴 `ls -la` 与 init JSON 报告里的 `pluginLink.state`。
- [ ] AC2（迁移：符号链接被删）：预置一个指向任意目录的 `.quay/plugin` 符号链接，再跑 init/升级 ⇒ 链接被删除，`pluginLink.state === "retired"`；贴前后 `lstat` / `readlink` 读数。
- [ ] AC3（迁移：非符号链接被拒）：预置一个同名**普通目录**（内含一个文件）与一个同名**普通文件**，分别跑 init ⇒ 二者**原样保留**（内容/字节不变），`pluginLink.state === "refused"` 且原因点名路径；贴前后 `sha256`。⛔ 不得删除、不得覆盖。
- [ ] AC4（三态可区分）：`absent` / `retired` / `refused` 三者取值互不同形，且 `refused` 不是 `not-evaluated`；贴三条实跑 JSON。
- [ ] AC5（dry-run 不写）：`--dry-run` 下三种输入都只报告、不落盘（链接/目录/文件均原样），贴实跑输出。
- [ ] AC6（消费面同步）：`plugin/skills/init/SKILL.md` 的「The project link」段删除或改写为「init 不再创建；外部消费者如何定位 CLI 见新契约文档」；README 里三处 `.quay/plugin` 描述（`:368` / `:395` / `:427`）同步。贴 `grep -rn '\.quay/plugin' README.md plugin/skills/` 的前后计数。
- [ ] AC7（交付验证脚本同步）：`plugin/scripts/verify-deliver-coldstart.sh` 两处把 `.quay/plugin` 当 binding 的 fallback（`:1379` 与 `:4672` 附近）必须改为新的解析方式或不依赖链接；贴改动前后该脚本在目标 fixture 上的判定。
- [ ] AC8（发布说明）：release notes / CHANGELOG 写明 breaking change，贴条目文本。

## DoD

- 写入面：`refreshProjectPluginLink` 改为 retire 语义；`InitResult.pluginLink` 的三态类型与全部调用点（`init.ts:2040` / `:2202` 附近、`cli/init.ts` 的报告）同步；⛔ 不保留「创建链接」分支的任何可达路径。
- 测试：`packages/quay/test/init.test.mjs` 覆盖 AC1–AC5（临时 workspace + 真 `.quay/config.yml`），并新增一条断言 `.quay/plugin` 不被计入闭集；文件头按既有约定。
- 文档：`plugin/skills/init/SKILL.md` + README 三处 + 新契约文档（Q3 任务）互相引用；⛔ 不在两处写两份不同的解析规则。
- 发布顺序：合并到 develop 后**不自动发布**；release 必须晚于 CloudCLI 解析器部署，release notes 标明 breaking change。

## Touches

- `tasks/gap-quay-init-retire-project-plugin-link.md`（自指）
- `packages/quay/src/init.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/test/init.test.mjs`
- `plugin/skills/init/SKILL.md`
- `README.md`
- `plugin/scripts/verify-deliver-coldstart.sh`