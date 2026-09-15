---
id: GOAL-019
title: 交付自足的 Claude Code plugin 渠道：修掉四个实测缺口 + quay-fleet project scope 纯插件部署验证
status: active
kind: goal
origin: 人 2026-09-15 裁定（对话中三条）：①正常安装和使用 quay 不应使用 QUAY_PLUGIN_ROOT 这个环境变量；②优先遵循
  Claude Code plugin 分发和部署实践，在这一目标实现前不考虑 npm（除非 Claude Code plugin 分发和部署依赖 npm
  机制）；③缺口 B 采用 B2（补 quay goal gate/check/batch CLI 动词、driver 改调 vendored
  bundle）而非 B1（改 in-process 调用）。人并指定本 GOAL 的目标为「交付正确和干净的 Claude Code plugin
  build，并在 quay-fleet project scope 实际部署和验证」。
activatedAt: 2026-09-15T03:59:47.049Z
statusLog:
  - at: 2026-09-15T03:59:47.050Z
    from: draft
    to: active
    actor: manager
    reason: 5 条 AC（AC-260..264）已落盘，激活本 GOAL
---
## 背景（2026-09-15 实测，全部为直接量，非推断）

**人的两条裁定**（本 GOAL 的方向由它们决定）：①正常安装和使用 quay **不应**依赖 `QUAY_PLUGIN_ROOT` 环境变量；
②**优先遵循 Claude Code plugin 分发和部署实践**，在这一目标实现前不考虑 npm（除非 plugin 分发本身依赖 npm 机制）。

### 一、纯 plugin 形态的可达面：比预期好得多，已实测

在 `env -u QUAY_PLUGIN_ROOT -u CLAUDE_PLUGIN_ROOT`、cwd `/tmp`、无 npm 全局安装、PATH 上无 `quay`、
cache 树内无 `node_modules` 的条件下，直接跑已安装的 `~/.claude/plugins/cache/quay/quay/0.7.0`：
`quay.js --help` rc=0（完整动词表）／`config validate` → `Config valid.`／`task list`+`task create`
（Core 经 ABI 到 vendored native provider）成功／**`driver status --kind promotion --json` 返回有效 JSON**
（kernel 解析到 `<cache>/scripts/dist/driver-runtime.js`，无 dev 树）。支撑它的是 `packages/quay/src/plugin-root.ts`
（`KERNEL_RELS:40-43` 同时接受 raw 与 bundled 形态；`resolvePluginRootFrom:107-118` 在 8 层 walk-up 里同时探
`<dir>/plugin/scripts/…` 与 `<dir>/scripts/…`）。⇒ **裁定①已在机制上成立：该变量是测试缝，不是产品路径**
（`driver-runtime.ts:300` 是它唯一的显式读点，生产代码从不往子进程 env 写它；写点全在 `plugin/test/` 里）。

### 二、plugin cache 的拷贝范围：不是"只拷声明的组件"（实测五个版本一致）

`vendor/`(3.5M)、`scripts/`(41M)、`gate-scripts/`、`fixtures/`、`loop/`、`probes/`、`workflows/`、
`sync.sh`、`VERSION`、`invariant-ownership.md`、三个违规清单 `.txt` 全部在 cache 里，**而它们没有一个是
`plugin.json` 声明的组件类型**（0.6.2/0.6.3 连 `test/` 8.4M 都拷了）。⇒ **"东西放进 `plugin/` 子树就会进 cache"成立。**
而 `src` absent 的真因不是 Claude Code 过滤：**`packages/quay/src` 是 `plugin/` 的兄弟目录**，marketplace source
指向 `plugin/` 时它天然在拷贝范围外（`publish-dist-branch.sh:106-107` 说明分支根**就是** plugin，因为
plugin-level marketplace source 不支持 `path` 子目录参数）。

### 三、四个缺口（每条都有当轮实测读数）

- **A｜交付面上 96/96 个 dist 引用是错形**（AC-260）。`build-plugin-dist.mjs:445-459` 的 `rewriteMarkdown`
  把 `plugin/scripts/X.ts` 重写成 `plugin/scripts/dist/X.js`，但**从不引入任何形式的 plugin-root 前缀**
  （该文件内 `CLAUDE_PLUGIN_ROOT` grep 零命中）。对 `dist-plugin` 分支直接测量：**96 个 dist 引用，96 个
  都带 cwd 相对 `plugin/` 前缀，正确形式 0 个**，跨 `loop/` 与 8 个 skill（不止调研估的 89、不止 `skills/`）。
  在消费项目里 plugin 本身就是树根，这些路径全部解析不到。这是 `SPEC-plugin-lifecycle:203-206` 活着的那一半：
  **引擎解析已被 `plugin-root.ts` 修好，skill 文档没修。**
- **B｜goal/meta driver 用进程边界去调一个 cache 里不存在的文件**（AC-262）。`meta-driver.ts:182-196` 的
  `goalStoreArgv()` 构造的是**子进程 argv**（`node --experimental-strip-types <goal-store.ts> …`），driver 把
  goal-store **当 CLI spawn**，用 8 个子命令（`list`/`gate`/`write`/`check --staleness`/`--achieved-failing`/
  `--stale-pass`/`--stale-pass --sweep`/`batch`）。⚠️ 五个非测试调用点**没有一个用 `await import`**——
  这个依赖是**纯进程边界产物**，不是代码依赖。决定性证据：cache 里的 `scripts/dist/goal-driver.js`
  **已经把 goal-store 库完整内联**（`coreSrcAliasPlugin`，`build-plugin-dist.mjs:358-376`），却还留着
  `path.join(…,"packages","quay","src",…)` ×4 去 spawn 一个不存在的文件；而 `goal-store.ts:3042-3043`
  的 `main()` 守卫在 bundle 里故意为 false，所以 bundle 自带的 CLI dispatch 不可达。
  **缺的不是代码，是调用方式。** 人 2026-09-15 裁定采用 **B2**：补 `quay goal gate/check/batch` CLI 动词、
  driver 改调 vendored bundle（⛔ 不采用 B1 的 in-process 改法——那会把一个进程边界换成对 Core 内部导出的
  新耦合面）。当前基线（经 vendored bundle 实测）：三个子命令**都 rc=1 且 stderr 含 `unknown goal subcommand`**。
- **C｜`plugin/bin/` 已经在 PATH 里，但目录不存在**（AC-261）。`SPEC-plugin-lifecycle:41`/`:307` 自己的 T4
  实测就记了这一点（"PATH 中已存在 `<plugin-root>/bin`（该目录尚不存在也照样在）⇒ 建目录即可让 CLI 免 npm 全局安装"），
  本会话 PATH 复核确认含 `/home/yale/work/quay/plugin/bin` 而该目录不存在。官方文档亦确认 plugin 根的 `bin/`
  会自动进 Bash tool 的 PATH。⇒ **免 npm 的 CLI 是"已设计、已验证可用、就是没建"。**
- **D｜主发布渠道没有自包含闸**（AC-263）。`--verify-closure` 只校验 **npm tarball**（`package.sh:193-206`）；
  marketplace 渠道走 `publish-dist-branch.sh`，**无任何等价断言**（当轮 grep：该脚本内 closure 零命中）。
  而 `SPEC-plugin-lifecycle:139` 恰恰把 marketplace 声明为**主发布渠道** ⇒ 有闸的是次渠道，主渠道裸奔。

### 四、为什么这个缺陷从台账上看不见（本 GOAL 判据设计的直接依据）

`goals/AC-203-*.md` 状态 achieved，断言"无插件第三方项目里 driver 存活"，但判据是
`driver_alive=1 ∧ carrier_records>0`——**两个代理量**，在 `goal-ring state=failed` 时照样绿。
`goal-driver.ts:2179` 的注释自己就写着这个形态："四个 driver 进程 alive=1、载体在写，而 goal-ring state=failed"。
⇒ 硬规则 4b 的教科书形态。**故本 GOAL 的 AC-262 与 AC-264 都不接受自报字段：AC-262 读生产载体
`.quay/goal-round.jsonl` 且窗口锚在"实现落地提交时刻之后"（由 `git log` 当场派生，⛔ 不写死 sha——
写死会随 develop 前进静默过期成永久 NOT-EVALUATED）；AC-264 除了读载体记录，还自己去核
quay-fleet 的 `.claude/settings.json` 与 `.quay/config.yml` 两个文件系统直接量。**

## 本 GOAL 的命题

让 **Claude Code plugin（marketplace）渠道**成为 quay 真正自足的交付面——修掉上述四个缺口，
使 `plugin/` 子树内的产物在一个消费项目里独立可用，**不依赖 npm 全局安装、不依赖 `QUAY_PLUGIN_ROOT`、
不依赖 quay 开发检出**——并在 `/home/yale/work/quay-fleet` 上以 **project scope** 完成真实部署与验证。

## 退出条件

**散文版**：`dist-plugin` 交付面上不再有任何在消费项目里解析不到的 dist 路径；`quay` 命令能在纯 plugin
形态下经 `plugin/bin` shim 免 npm 使用；goal/meta driver 不再引用 Core 源码树、且其 `goal-ring` 在纯 plugin
形态的生产载体里真的不是 failed；主发布渠道有一个能取假、且被 mutation case 钉住的自包含闸；
最后 quay-fleet 以 project scope 装上这个交付面，由它自己的 driver 把一条真实任务从 `todo` 驱到 `done`
并留下非记账代码提交，且"不经 npm、不设 `QUAY_PLUGIN_ROOT`"这两件事由**文件系统直接量**而非自报字段确认。
机器判据在 AC-260..AC-264。

## 范围（AC-260..AC-264）

- **AC-260**：缺口 A——`dist-plugin` 交付面上带 cwd 相对 `plugin/` 前缀的 dist 引用数 = 0（当前 96/96 是错形），
  且总引用数 ≥1（零计数的配对，防"扫不到"伪装成"修好了"）。
- **AC-261**：缺口 C——`plugin/bin/quay` 存在且可执行、随 `dist-plugin` 交付（mode 100755）、并在最小 PATH +
  两个覆盖变量均 unset 下真跑出 semver，且 `command -v quay` 解析到该 shim（负控制：不是 npm-global 那个）。
- **AC-262**：缺口 B2——三个子命令经 vendored bundle 不再回答 `unknown goal subcommand` ∧ goal/meta driver
  代码中指向 `packages/quay/src` 的点 = 0（按位置判定，剥掉行注释）∧ **生产载体 `.quay/goal-round.jsonl` 中
  存在实现落地之后的轮次且其 `goal-ring` 非 failed**。
- **AC-263**：缺口 D——`publish-dist-branch.sh` 有 dist 闭包断言 ∧ 该断言失败会中止发布 ∧ 有 mutation case 钉住它。
- **AC-264**：收口——quay-fleet project scope、marketplace 渠道、真实 `todo→done` + 非记账提交，
  且由 `.claude/settings.json` 的 `enabledPlugins` 与 `.quay/config.yml` 的绑定路径两个直接量交叉确认
  （绑定必须落在 `.claude/plugins/cache/` 下，且**不得**再指向 quay 开发检出）。

## 非目标

- **不改 npm 渠道**——`package.sh` / `register-plugin.mjs` / `--verify-closure` 对 tarball 的校验原样保留；
  本 GOAL 只补 marketplace 渠道缺的那一半，不做二选一。
- **不采用 B1（in-process 改法）**——人 2026-09-15 已裁定 B2；B1 留作被否方案，⛔ 不是遗忘。
- **不动 `QUAY_PLUGIN_ROOT` 的测试缝本身**——它作为 hermetic 测试与操作员覆盖继续存在；本 GOAL 只保证
  **正常安装使用路径不依赖它**。清理"生产环境里误带该变量"（已有两条实证：套件代理断言恒假、
  worker 验证安装产物却跑进 dev 树）属既有 gap 任务，不在本 GOAL 内。
- **不纳入 GOAL-009 的 freshness 轮转**——`plugin/freshness-producers.json` 的 `subject_id_pattern` 是
  `^GOAL-009-AC-\d+$`，本 GOAL 的 AC 结构上不在其 scope 内（AC-214/AC-244 的 NEED 同理）。
  若将来要把 AC-264 纳入定期重验，需另立任务显式扩 scope，⛔ 不靠默认继承。
- **不做跨主机验证**——quay-fleet 在本机，交叉主机覆盖沿用 GOAL-018 已验证的两台机器结论，不重做。
- **过程中发现的新缺陷各自另立 `gap-*` 任务**，本 GOAL 只跟踪这四个缺口 + 一次真实部署。

## 风险

1. **AC-260 的"正确形式"不锁实现路径是刻意的**：判据只要求"不带 cwd 相对 `plugin/` 前缀"，不要求必须写
   `${CLAUDE_PLUGIN_ROOT}`——因为官方文档对"该变量在 SKILL.md 正文中是否可用"**未明确表态**（仅确认 hooks
   与 MCP command 上下文可用）。现有间接证据支持可用（`start-drivers.ts:116` 注释称其 "harness-provided"、
   `skills/init/SKILL.md:41-44` 已在生产依赖它），但实现时若实测不可用，可换任何等价的自解析形式而**无需改判据**。
2. **AC-262 第三支依赖 driver 真跑一轮**：`goals/` 属 `DOC_SURFACES`，goals-only 的改动会让
   `@static-tier change` 检查器整轮跳过（`select-static-checks-for-touches.ts:222-224`），所以建 AC 这一轮
   拿不到静态闸的背书——已用逐条 dry-run 代偿（五条当前全 exit 1 且原因准确，即"判据现在就能取假"的正向证明）。
3. **AC-263 钉的是"有闭包断言"而非某个具体 flag 名**（用 `closure` 不分大小写匹配），降低锁死实现的风险；
   若实现采用完全不含该词的命名，需同步 update 本 AC——这是契约的一部分，不是判据缺陷。
4. **`dist-plugin` 是 force-updated 的孤儿分支**：AC-260/261 读它是刻意的（那才是 marketplace 渠道真正
   被消费的东西），但它只在有人跑 `publish-dist-branch.sh` 后才更新 ⇒ 实现落地后**必须重跑发布**，
   否则两条 AC 读到的是旧交付面。这一步不能省，且它正是"落地后不重启 = 改动不生效"那一族的同形陷阱。
5. **AC-264 的 `npm_global_used=false` 是记录时取证字段**，判据不当场跑 `npm ls -g` 复核（那会把"别人为
   别的目的装过 quay"误判成本 AC 失败）；真正的机制证据是 `.quay/config.yml` 的绑定必须落在
   `.claude/plugins/cache/` 且不指向开发检出——那是持久、可核、且恰好表达"走的是 plugin 渠道"的直接量。