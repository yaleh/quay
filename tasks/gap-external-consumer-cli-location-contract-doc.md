---
id: gap-external-consumer-cli-location-contract-doc
title: 文档化外部消费者如何定位 quay CLI：插件 scope 记录、版本目录、Bash-tool-only PATH、.orphaned_at 清理
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

Q1 删除 `.quay/plugin` 之后，外部进程（不在 Claude 会话里、没有 `${CLAUDE_PLUGIN_ROOT}`、Bash 工具 PATH 也帮不到它）没有任何文档化的办法定位 quay CLI。当前知识散落在：

- `plugin/bin/quay` 的头注释：Claude Code 只把 `<plugin-root>/bin` 前置到 **Bash 工具**的 PATH（2026-09-02 实测，SPEC §3a/§9）；
- `plugin/skills/init/SKILL.md` 的 `plugin update` 配方：用 `claude plugin list --json` 读 scope；
- `packages/quay/src/init.ts` 的 registry tier 规则注释：匹配当前 `projectPath` 的 local/project 记录优先，否则 `user`；
- 各处对 `~/.claude/plugins/installed_plugins.json` 的读取实现。

没有任何一份对外契约把它们串起来。需要一个外部消费者可以直接照做的单一正本。

### 关于 `.orphaned_at` 的 14 天：来源与已实测的一侧

「14 天后由后台清理删除」来自 Claude Code 官方插件文档的读数（update/uninstall 后旧版本目录写入 `.orphaned_at`），**在 quay 仓库内没有任何可复核的读数**，因此它是**待核对来源**，不是已验证的行为。

标记侧已实测（2026-10-25，Claude Code 2.1.310，`claude --version`）：

- 本机 quay 缓存中 0.14.0 / 0.15.0 / 0.16.0 的 `.orphaned_at` 为 1791739026393–1791739026400（2026-10-12 01:17 本地时间），0.17.0 为 1791738755790（01:12），0.20.0 为 1792594358408；
- `.orphaned_at` 的**内容是毫秒时间戳**（不是 ISO 字符串）；
- 按 14 天推算，0.14–0.17 的目录应在 2026-10-26 01:12–01:17 消失。截至 2026-10-25 尚未发生，**删除侧未被观察到**。

实现本任务时必须复核删除侧（观察目录是否在该时刻后消失，记录 Claude Code 版本 + 标记时刻 + 消失时刻）；在拿到该读数前，文档只能写「标记侧已实测、清理策略来自官方文档待核」。

## AC

- [ ] AC1（文档）：新增 `docs/references/external-consumer-cli-location.md`，README 的安装/消费段链接到它；内容覆盖：① scope 记录（`installed_plugins.json` 的 scope/installPath/version/installedAt + 设置里的 `enabledPlugins`，后者只负责启用已安装插件）；② 版本目录随 `installPath` 变化，`${CLAUDE_PLUGIN_ROOT}` 只在插件执行上下文有值；③ `<plugin-root>/bin` 只在 Claude Code 的 **Bash 工具** PATH 上，外部进程不继承；④ `.orphaned_at` 清理语义；⑤ 推荐解析算法。贴文件路径与 README 链接行。
- [ ] AC2（可执行验证）：文档里的解析算法有可运行片段或参考实现，在至少两种真实布局上实跑：user-scope 安装、project-scope 安装。贴两次实跑输出（解析出的 plugin root + 版本）。
- [ ] AC3（.orphaned_at 分两侧，标记侧已实测、删除侧待核）：标记侧已实测——`claude --version` = 2.1.310（2026-10-25），0.14.0–0.20.0 缓存目录的 `.orphaned_at` 毫秒时间戳已记录（见 Finding）；删除侧**未被观察到**——官方文档称的「14 天后后台清理」在 quay 仓库内没有可复核读数，实现时必须按 Finding 给出的观测方法在 2026-10-26 01:12–01:17 之后复核，并记录 Claude Code 版本 + 标记时刻 + 消失时刻。⛔ 不得把官方文档的 14 天写成已验证行为；⛔ 也不得把整条标成「未评估」——标记侧已有实测读数。
- [ ] AC4（负控制）：scope 记录缺失/损坏/`installPath` 不存在时，解析必须报 `not-evaluated` / `absent` 的独立取值，⛔ 不得回退到 PATH 上的任意 `quay`（那会把「项目钉的版本」静默换成「任意版本」）。贴三条实跑。
- [ ] AC5（与 Q1 一致）：文档明确写「`quay init` 自某版本起不再创建 `.quay/plugin`；旧指引链接会被删除」，并链接 Q1 任务的发布说明。

## DoD

- 单一正本：`docs/references/external-consumer-cli-location.md` 是唯一契约正文；`plugin/skills/init/SKILL.md` / README / `plugin/bin/quay` 头注释只**链接**它，⛔ 不再各写一份解析规则。
- 参考实现落在 `plugin/scripts/resolve-quay-cli.ts`，并在 `plugin/scripts/capability-catalog-declarations.json` 登记（新脚本必须声明，否则 catalog 入口闸红）。
- 文档中每条事实要么带实测日期 + Claude Code 版本，要么显式标「未验证」。

## Touches

- `tasks/gap-external-consumer-cli-location-contract-doc.md`（自指）
- `docs/references/external-consumer-cli-location.md`（新）
- `README.md`
- `plugin/skills/init/SKILL.md`
- `plugin/bin/quay`
- `plugin/scripts/resolve-quay-cli.ts`（新）
- `plugin/scripts/capability-catalog-declarations.json`