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

- [x] AC1（文档）：新增 `docs/references/external-consumer-cli-location.md`，README 的安装/消费段链接到它；内容覆盖：① scope 记录（`installed_plugins.json` 的 scope/installPath/version/installedAt + 设置里的 `enabledPlugins`，后者只负责启用已安装插件）；② 版本目录随 `installPath` 变化，`${CLAUDE_PLUGIN_ROOT}` 只在插件执行上下文有值；③ `<plugin-root>/bin` 只在 Claude Code 的 **Bash 工具** PATH 上，外部进程不继承；④ `.orphaned_at` 清理语义；⑤ 推荐解析算法。贴文件路径与 README 链接行。
- [x] AC2（可执行验证）：文档里的解析算法有可运行片段或参考实现，在至少两种真实布局上实跑：user-scope 安装、project-scope 安装。贴两次实跑输出（解析出的 plugin root + 版本）。
- [x] AC3（.orphaned_at 分两侧，标记侧已实测、删除侧复核）：标记侧已实测——`claude --version` = 2.1.310（2026-10-25），0.14.0–0.20.0 缓存目录的 `.orphaned_at` 毫秒时间戳已记录（见 Finding）；删除侧已于 2026-10-26 03:46 按 Finding 的方法复核（读数见 Evidence §AC3：0.15/0.16/0.17 已消失、父目录 mtime 01:17:33、同窗口另一 marketplace 也被清扫；0.14.0 因 `.in_use` 有活进程而存活）。⛔ 官方文档的 14 天仍标为「与读数一致但未验证的政策」；⛔ 未把整条标成「未评估」——两侧都有读数。
- [x] AC4（负控制）：scope 记录缺失/损坏/`installPath` 不存在时，解析必须报 `not-evaluated` / `absent` 的独立取值，⛔ 不得回退到 PATH 上的任意 `quay`（那会把「项目钉的版本」静默换成「任意版本」）。贴三条实跑。
- [x] AC5（与 Q1 一致）：文档明确写「`quay init` 自某版本起不再创建 `.quay/plugin`；旧指引链接会被删除」，并链接 Q1 任务的发布说明。

## DoD

- [x] 单一正本：`docs/references/external-consumer-cli-location.md` 是唯一契约正文；`plugin/skills/init/SKILL.md` / README / `plugin/bin/quay` 头注释只**链接**它，⛔ 不再各写一份解析规则。
- [x] 参考实现落在 `plugin/scripts/resolve-quay-cli.ts`，并在 `plugin/scripts/capability-catalog-declarations.json` 登记（新脚本必须声明，否则 catalog 入口闸红）。
- [x] 文档中每条事实要么带实测日期 + Claude Code 版本，要么显式标「未验证」。

## Evidence

实现提交：`9c03ede3f`（task 分支 `task/gap-external-consumer-cli-location-contract-doc`）。测量环境：Claude Code `2.1.310`，`claude --version` 于 2026-10-26 03:46 复核仍为 2.1.310。

### AC1 — 文件与链接行（实测 2026-10-26）

- 契约正文：`docs/references/external-consumer-cli-location.md`（432 行）。五节对应五个要求：§2 scope 记录（含 `enabledPlugins` 只负责启用）、§3 版本目录 + `${CLAUDE_PLUGIN_ROOT}`、§1.2 `<plugin-root>/bin` 只在 Bash 工具 PATH、§4 `.orphaned_at` 两侧、§5 推荐解析算法（含可运行片段）。
- README 安装段链接：`README.md:196-202`，正文行 `install record instead: **[how an external consumer locates the CLI][cli-location]**` + 引用定义 `README.md:202: [cli-location]: docs/references/external-consumer-cli-location.md`（升级段另有一处 `README.md:375`）。
- 只链接不复述：`plugin/skills/init/SKILL.md:199-210`（链接 + 一条运行参考实现的命令）、`plugin/bin/quay:22-33`（头注释链接）、`CHANGELOG.md:10`（既有链接，原本指向尚不存在的文件，本任务把它变成有效链接）。

### AC2 — 两种真实布局实跑（2026-10-26，2.1.310）

A) user-scope 布局（该项目无 project/local 记录 ⇒ 落回 user 层）：

```
$ node --experimental-strip-types plugin/scripts/resolve-quay-cli.ts --project /data/home/yale/work/quay
state:    resolved
tier:     user (scope user)
plugin:   quay@quay 0.22.0
root:     /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0
cli:      /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/bin/quay
bundle:   /data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/vendor/quay/dist/quay.js
exit=0
```

B) project-scope 布局（`quay-fleet` 的 project 记录钉 0.19.0，而 user 记录是 0.22.0 ⇒ 分层规则必须取 project 层）：

```
$ node --experimental-strip-types plugin/scripts/resolve-quay-cli.ts --project /data/home/yale/work/quay-fleet
state:    resolved
tier:     project (scope project)
plugin:   quay@quay 0.19.0
root:     /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0
cli:      /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/bin/quay
bundle:   /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/vendor/quay/dist/quay.js
exit=0
```

两个解析结果都被**实际执行**（解析出来不等于能用）：`…/0.22.0/bin/quay --version` → `0.22.0`；`…/0.19.0/bin/quay --version` → `0.19.0`，与各自 `.claude-plugin/plugin.json` 的 `version` 一致。

同一台机器上 `quay` 在 PATH 上是 **0.23.0-dev**（`/data/home/yale/work/quay/plugin/bin/quay`），与 project 钉的 0.22.0 不同 build —— 这就是「不许回退 PATH」的直接依据（记在文档 §1.1）。

### AC3 — `.orphaned_at` 两侧

标记侧（2026-10-25 记录，2026-10-26 复读仍一致）：`0.10.0`=1792934659273、`0.11.0`=1792938386978、`0.14.0`=1791739026393、`0.20.0`=1792594358408、`builtin`=1792935788815；`0.19.0` / `0.22.0` 无标记。内容是毫秒时间戳。

删除侧复核（2026-10-26 03:46，2.1.310）：

- 0.15.0 / 0.16.0 / 0.17.0（标记时刻 2026-10-12 01:17:06 / 01:17:06 / 01:12:35）**已不存在**；目录列表现在只剩 `0.10.0 0.11.0 0.14.0 0.19.0 0.20.0 0.22.0 builtin`。
- 父目录 `~/.claude/plugins/cache/quay/quay` 的 mtime = **2026-10-26 01:17:33**（落在 Finding 预测的 01:12–01:17 窗口内）；同一 01:10–01:25 窗口内 `~/.claude/plugins/cache` 与 `…/claude-plugins-official/frontend-design` 也变了 ⇒ 是全机清扫，不是单个插件的行为。
- 独立佐证 0.17.0 确实存在过：仍有 18 个活进程 argv 里带 `…/cache/quay/quay/0.17.0`（目录已删、进程继续跑）。
- **0.14.0 过了 14 天（标记 2026-10-12 01:17:06，读取时已 14 天 2.5 小时）仍存活**：它的 `.in_use/` 里有两个 `{"pid":…,"procStart":…}` 标记，两个 pid 都活着（`claude` 会话），`.in_use` mtime 正是 01:17:33。同样地 `archguard/0.1.35`（标记 2026-10-03，23 天）等过期孤儿目录也都有活 `.in_use` 标记。
- ⇒ 文档写的是：**事件**已观测、**执行者**是推断；「14 天」只写「与读数一致、但仍属官方文档政策未验证」；`.in_use` 延后删除标注为强相关假设而非规则（文档 §4.2/§4.3/§8）。

### AC4 — 三条负控制（2026-10-26）

fake `quay` 置于 PATH 首位（`PATH=<tmp>/fakebin:$PATH`，该脚本只打印 `FAKE-QUAY-FROM-PATH`）；三次都**没有**执行它。

① 记录缺失 → `not-evaluated` / exit 3：

```
state:    not-evaluated
reason:   no Claude Code plugin install record at <tmp>/home-missing/.claude/plugins/installed_plugins.json — nothing to read
```

② 记录损坏（截断 JSON） → `not-evaluated` / exit 3：

```
state:    not-evaluated
reason:   the plugin install record at <tmp>/home-corrupt/.claude/plugins/installed_plugins.json is not valid JSON (Expected double-quoted property name in JSON at position 46 (line 1 column 47))
```

③ `installPath` 不存在 → `absent` / exit 2：

```
state:    absent
reason:   the winning quay@quay entry (scope user, version 9.9.9) names <tmp>/cache/quay/quay/9.9.9, but that directory does not exist — the record is stale (…). ⛔ Not falling back to `quay` on PATH.
```

三种原因、两种状态，互不同形；参考实现里**没有任何 PATH 查找**。

### AC5 — 与 Q1 一致

文档 §7 明写「**Since v0.23.0, `quay init` no longer creates `<project>/.quay/plugin`**」、旧 symlink 由下一次 init 删除（`pluginLink.state: retired`）、普通文件/目录被拒绝并保持字节不变（`refused`），并链接发布说明 `CHANGELOG.md` 顶部「Unreleased — ⚠️ BREAKING」段（同时注明撰写时 v0.23.0 尚未发布）与任务 `gap-quay-init-retire-project-plugin-link`。

### 门

`bash scripts/test.sh --for-task gap-external-consumer-cli-location-contract-doc --allow-thin` → **exit 0**（静态检查全绿；selector 选 0 个测试文件，thin 允许，全量 suite 归 fan-in）。
`bash plugin/scripts/capability-catalog.sh` → `summary: 401 scripts | 401 declared | 0 unclassified`，新脚本已声明（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六表齐全）。

## Dark axis (ADR-007)

该轴仍暗,理由:本任务交付的是一份文档契约加一个只依赖 node 内建的叶子脚本（无 packages/** 入边、不改产品依赖结构），L_D/L_G 在本任务上没有可记的新读数

## Touches

- `tasks/gap-external-consumer-cli-location-contract-doc.md`（自指）
- `docs/references/external-consumer-cli-location.md`（新）
- `README.md`
- `plugin/skills/init/SKILL.md`
- `plugin/bin/quay`
- `plugin/scripts/resolve-quay-cli.ts`（新）
- `plugin/scripts/capability-catalog-declarations.json`
