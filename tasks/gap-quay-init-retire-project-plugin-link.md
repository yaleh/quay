---
id: gap-quay-init-retire-project-plugin-link
title: quay init 不再生成 .quay/plugin：符号链接删除、普通文件/目录拒绝并报告，读数三态 retired/absent/refused
status: ready
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

- [x] AC1（不再创建）：在临时 workspace 上跑一次真实 init（`--plugin-root` 指向一个有效插件根）后，`<ws>/.quay/plugin` **不存在**；贴 `ls -la` 与 init JSON 报告里的 `pluginLink.state`。
- [x] AC2（迁移：符号链接被删）：预置一个指向任意目录的 `.quay/plugin` 符号链接，再跑 init/升级 ⇒ 链接被删除，`pluginLink.state === "retired"`；贴前后 `lstat` / `readlink` 读数。
- [x] AC3（迁移：非符号链接被拒）：预置一个同名**普通目录**（内含一个文件）与一个同名**普通文件**，分别跑 init ⇒ 二者**原样保留**（内容/字节不变），`pluginLink.state === "refused"` 且原因点名路径；贴前后 `sha256`。⛔ 不得删除、不得覆盖。
- [x] AC4（三态可区分）：`absent` / `retired` / `refused` 三者取值互不同形，且 `refused` 不是 `not-evaluated`；贴三条实跑 JSON。
- [x] AC5（dry-run 不写）：`--dry-run` 下三种输入都只报告、不落盘（链接/目录/文件均原样），贴实跑输出。
- [x] AC6（消费面同步）：`plugin/skills/init/SKILL.md` 的「The project link」段删除或改写为「init 不再创建；外部消费者如何定位 CLI 见新契约文档」；README 里三处 `.quay/plugin` 描述（`:368` / `:395` / `:427`）同步。贴 `grep -rn '\.quay/plugin' README.md plugin/skills/` 的前后计数。
- [x] AC7（交付验证脚本同步）：`plugin/scripts/verify-deliver-coldstart.sh` 两处把 `.quay/plugin` 当 binding 的 fallback（`:1379` 与 `:4672` 附近）必须改为新的解析方式或不依赖链接；贴改动前后该脚本在目标 fixture 上的判定。
- [x] AC8（发布说明）：release notes / CHANGELOG 写明 breaking change，贴条目文本。

## DoD

- 写入面：`refreshProjectPluginLink` 改为 retire 语义；`InitResult.pluginLink` 的三态类型与全部调用点（`init.ts:2040` / `:2202` 附近、`cli/init.ts` 的报告）同步；⛔ 不保留「创建链接」分支的任何可达路径。
- 测试：`packages/quay/test/init.test.mjs` 覆盖 AC1–AC5（临时 workspace + 真 `.quay/config.yml`），并新增一条断言 `.quay/plugin` 不被计入闭集；文件头按既有约定。
- 文档：`plugin/skills/init/SKILL.md` + README 三处 + 新契约文档（Q3 任务）互相引用；⛔ 不在两处写两份不同的解析规则。
- 发布顺序：合并到 develop 后**不自动发布**；release 必须晚于 CloudCLI 解析器部署，release notes 标明 breaking change。

## Evidence

全部读数取自**任务工作树**的真实 CLI（`node packages/quay/dist/quay.js init …`，`--plugin-root <worktree>/plugin`），不是夹具注入。

**AC1 — 不再创建**（`/var/tmp/ac-retire-evidence/ac1`）
```
$ ls -la <ws>/.quay
-rw-rw-r-- 1 yale yale 12681 … config.yml
-rw-rw-r-- 1 yale yale  3282 … profiles.yml          ← 没有 plugin 条目
$ lstat .quay/plugin  ⇒ ENOENT (absent — as required)
pluginLink = {"state":"absent","path":"…/ac1/.quay/plugin"}
```

**AC2 — 符号链接被删**
```
BEFORE: lstat.isSymbolicLink=true  readlink=/var/tmp/ac-retire-evidence/old-plugin-tree
AFTER : ENOENT — deleted
pluginLink = {"state":"retired","path":"…/ac2/.quay/plugin","target":"/var/tmp/ac-retire-evidence/old-plugin-tree"}
```

**AC3 — 普通目录 / 普通文件被拒且逐字节不变**
```
DIR  sha256 before=12f92e884475429ccfb3bccae085e32acfa19b025784a1c116d86b2e19c30a52
DIR  sha256 after =12f92e884475429ccfb3bccae085e32acfa19b025784a1c116d86b2e19c30a52   still-a-directory=true
DIR  pluginLink={"state":"refused","path":"…/ac3dir/.quay/plugin","reason":"… exists and is not a symlink (directory)"}
FILE sha256 before=427d2569af75e2b333963b3b358d2af1bbb5ea2f0c40640138700efb4a497c33
FILE sha256 after =427d2569af75e2b333963b3b358d2af1bbb5ea2f0c40640138700efb4a497c33   still-a-file=true
FILE pluginLink={"state":"refused","path":"…/ac3file/.quay/plugin","reason":"… exists and is not a symlink (regular file)"}
```

**AC4 — 三态互不同形**
```
absent : {"state":"absent","path":"…/ac1/.quay/plugin"}
retired: {"state":"retired","path":"…/ac2/.quay/plugin","target":"…/old-plugin-tree"}
refused: {"state":"refused","path":"…/ac3dir/.quay/plugin","reason":"… exists and is not a symlink (directory)"}
distinct values = 3 | refused === not-evaluated ? false
```
（另外两个辅助态与三态不同形：`would-retire`（dry-run 见到链接）、`delete-failed` / `unreadable`（失败面）；`not-run` 仍表示「这一步没被走到」。）

**AC5 — `--dry-run` 只报告不落盘**
```
dry-run/link : state=would-retire  still-a-symlink=true
dry-run/dir  : state=refused       content-intact=x
dry-run/file : state=refused       content-intact=y
```

**AC6 — 消费面同步**（`grep -rn '\.quay/plugin' README.md plugin/skills/`）
```
BEFORE (develop): README.md=3 行 / plugin/skills/init/SKILL.md=4 行  ⇒ 合计 7
AFTER  (worktree): README.md=3 行 / plugin/skills/init/SKILL.md=4 行  ⇒ 合计 7（内容全部改写为 retire 语义）
```
三处 README 描述改为：升级时不创建并删除旧链接（`:368`）、checker 的 pointer 读数改为「缺失 ⇒ NOT-EVALUATED，陈旧 ⇒ FAIL」（`:399`）、`--upgrade-from` 演练断言链接被**删除**（`:430`）。SKILL.md 的「The project link」节改写为「RETIRED（2026-10-25）」+ 四态表，并指向 Q3 契约文档 `docs/references/external-consumer-cli-location.md`（该文档由 `gap-external-consumer-cli-location-contract-doc` 落，尚无正本 ⇒ 本任务只链接，不在此处另写一份解析规则）。

**AC7 — 交付验证脚本的两处 fallback**
把 `verify-deliver-coldstart.sh` 的两个产品函数**逐字抽出**，在同一 fixture 上跑新旧两版（fixture：新形态 config = native 无 `path`/`mcp_entry`；交付插件根 = `<proot>/vendor/quay-native/dist/quay-native.js` 真实文件）：
```
fixture 无链接（retire 之后的常态）
BEFORE (develop) — binding_state=[no-mcp-entry]        config_native_mcp_entry=[]
AFTER  (task)    — binding_state=[path-resolved]       config_native_mcp_entry=[<worktree>/plugin/vendor/quay-native/dist/quay-native.js]
负控制（插件根里没有 vendored bundle）⇒ AFTER 仍为 [no-mcp-entry]（不是「任何路径都算」）
旧链接被指到诱饵树时：BEFORE 读到 decoy 的 bundle；AFTER 忽略链接、仍读交付插件根。
```
即：改前协议升级后的项目读不出自己的 runtime（AC-238 的 `runtime_replaced` 必然 0），改后按**交付插件根**解析；AC238 ③ 仍拿它比对 delivered bundle 的 sha，所以「陈旧/缺失」照样 fail-closed。

**AC8 — CHANGELOG（breaking change 条目）**
```
## Unreleased — ⚠️ BREAKING: `quay init` no longer creates `<project>/.quay/plugin`
**Breaking change.** … An existing **symlink** left by an older version is DELETED by the next init;
a **regular file or directory** at that name is the user's content — it is refused and left
byte-identical. External consumers … must resolve it from the **Claude Code plugin scope records** …
**Release ordering (blocking for the publish, not for the merge).** ⛔ Do not publish this change
until the CloudCLI-side resolver (claudecodeui task `gap-quay-entrypoint-resolver-via-claude-plugin-scopes`)
is deployed.
```

**门/检查读数**
- `bash scripts/test.sh --for-task gap-quay-init-retire-project-plugin-link --allow-thin` ⇒ **279/279 pass, exit 0**（含 `packages/quay/test/init.test.mjs` 的 AC1–AC5 + 闭集断言、`plugin/test/quay-init-stable-plugin-link.test.mjs` 端到端 5/5、`plugin/test/verify-plugin-channel-assertions.test.mjs` 33/33、`driver-runtime-loaded-version-drift` 的 AC3c 静态扫描）。
- `anti-drift-touches-check.ts` ⇒ `ANTI-DRIFT OK … all within declared Touches`。
- `npx tsc --noEmit` ⇒ exit 0。

**第二轮（2026-10-26）— 上一轮 exited-not-landed 的 suite 红逐个复核**
上一轮的 suite 红集比 develop 基线多 3 个文件。逐个复核：只有一个是本任务引入的语义冲突，另外两个是负载假红（同一套件里实测「单跑转绿」⇔ 套件内红，是负载敏感的既有形态，不是本任务的 delta）。

```
plugin/test/develop-deliver-tgz-evidence-transport.test.mjs   ← 真实冲突（develop 后加的测试钉住【退休前】语义）
  该测试逐字抽出 binding_state / config_native_mcp_entry，原断言：`.quay/plugin` 链接 ⇒ path-resolved；
  无链接 ⇒ no-mcp-entry。本任务 AC7 正是把这两个读数的 fallback 从「读链接」改成「读交付插件根」，
  链接不再被任何路径读取 ⇒ develop 的②断言反过来失守（实测 actual='path-resolved' expected='no-mcp-entry'）。
  修法（不是放宽断言，是改钉退休后的语义 + 把「链接不被读」做成可证伪的负控制）：
    ① 显式插件根带 vendored bundle ⇒ path-resolved，且 entry 落在【该根】而不是诱饵链接树；
    ② 项目仍留有指向诱饵树的 .quay/plugin 链接、但插件根里【没有】bundle ⇒ no-mcp-entry + entry 为空
       （任何仍读链接的代码路径都会在这里返回 path-resolved ⇒ 这条断言能红）；
    ③ 裸名 mcp_entry 仍为 bare-path-name（插件根 fallback 不得掩盖既有缺陷）。
  读数：bash scripts/test.sh plugin/test/develop-deliver-tgz-evidence-transport.test.mjs ⇒ 22/22 pass。

packages/quay/test/cli.test.mjs                                ← 负载假红（零 TAP ⇒ 被负载杀死）
  套件内 54s / 零 TAP / 'test failed'；单跑 18.1s ⇒ pass 1/1。单独复跑转绿。

packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
                                                               ← 负载假红（断言窗口只有 10 秒宽）
  断言 /已运行 1m3\ds|已运行 \d+s/ —— 即 elapsed 必须落在 90–99s；套件内该用例耗时 12.9s ⇒ 越窗。
  单跑 3.2s ⇒ 4/4 pass。
```

**ADR-007 暗轴**
- 该轴仍暗,理由:本任务删除的是 Core 从不读取的指引链接（指引删掉、无绑定迁移），不改模块层级与依赖方向，未取 L_D/L_G 读数。

## Touches

- `tasks/gap-quay-init-retire-project-plugin-link.md`（自指）
- `packages/quay/src/init.ts`
- `packages/quay/src/cli/init.ts`
- `packages/quay/test/init.test.mjs`
- `plugin/skills/init/SKILL.md`
- `README.md`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/scripts/quay-init-steps.ts`（`refresh-plugin-link` 步骤 → `retire-plugin-link`；创建链接的可达路径必须一起删掉）
- `plugin/scripts/verify-plugin-channel-assertions.ts`（`--upgrade-from` 演练原来断言「链接改指新版本」，retire 之后必须断言「链接被删除」）
- `plugin/scripts/capability-catalog-declarations.json`（上面那个 checker 的声明口径同步）
- `plugin/test/verify-plugin-channel-assertions.test.mjs`（该 checker 的演练夹具：init 缝从「重指链接」改为「删除链接」）
- `plugin/test/quay-init-stable-plugin-link.test.mjs`（端到端钉住链接的测试：改钉 retire 语义）
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`（AC3c 静态扫描：原来断言 init.ts 是唯一写入者，现在断言**没有**任何源码构造该链接）
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`（develop 后加的 `binding_state`/`config_native_mcp_entry` 测试：原钉住 `.quay/plugin` 链接语义，retire 后改钉「交付插件根」，并把「链接不被读」做成负控制）
- `CHANGELOG.md`（AC8 breaking-change 条目）

## Blocker

**2026-10-25T15:01:14.193Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/develop-deliver-tgz-evidence-transport.test.mjs,packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs,packages/quay/test/cli.test.mjs changed=-]
- run_id：wk-prod-anchor
- 处置：见 Evidence「第二轮（2026-10-26）」——1 个真实冲突已修（并补登 Touches），2 个负载假红经单跑复现证伪。
