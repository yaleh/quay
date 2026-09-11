---
id: gap-upgrade-verify-transport-missing-binding-checker
title: AC-238/239 跨主机验证器传输漏带 provider-binding-resolvability-check.ts（且它 import 裸
  `yaml`）——AC-238 记录在真机上结构上写不出，⑦b 前置永不成立
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
goal_ac: AC-239
---
## Finding

**实测（2026-09-11，本机直连 orangevps 的 `ls`/`node` 真实输出；⛔ 非推断）**

`plugin/scripts/develop-deliver-tgz.sh` 把验证器送到远端时**显式枚举** `$SCRIPT_DIR` 的随行文件
（该注释自己写明：枚举而不 tar，「so a new $SCRIPT_DIR dependency is an explicit edit, not a silent
remote failure」）。枚举里**没有** `provider-binding-resolvability-check.ts` —— 而
`verify-deliver-coldstart.sh` 的 `binding_state()` 正是调它：

```
out="$(node --no-warnings --experimental-strip-types \
  "$SCRIPT_DIR/provider-binding-resolvability-check.ts" --root "$r" --json 2>/dev/null)"
...
' 2>/dev/null || echo "unreadable"
```

⇒ 远端该文件不存在 ⇒ node `MODULE_NOT_FOUND` ⇒ `out` 为空 ⇒ python 解析不出 ⇒ **恒 `unreadable`**。

**真机读数（orangevps `$HOME`，上一次 verify-upgrade 运行留下的现场）**：

```
$ ls -1 verify-deliver-coldstart.sh pane-state-classify.ts quay-init-closure-assertion.ts \
        gate-script-base.ts repo-root.ts runner-state-write.ts write-json-atomic.ts
gate-script-base.ts  pane-state-classify.ts  quay-init-closure-assertion.ts  repo-root.ts
runner-state-write.ts  verify-deliver-coldstart.sh  write-json-atomic.ts          # 七个都在

$ ls -1 provider-binding-resolvability-check.ts
ls: cannot access 'provider-binding-resolvability-check.ts': No such file or directory

$ node --no-warnings --experimental-strip-types "$HOME/provider-binding-resolvability-check.ts" ...
Error: Cannot find module '/home/yale/provider-binding-resolvability-check.ts'
```

**第二个、更隐蔽的缺口**：该检查器 `import { parse as parseYaml } from "yaml";` —— 一个**裸 npm 说明符**。
已随行的六个 sibling **一个都没有**（实测逐个 grep `^import`：它们只用 node 内建 + `./` 相对 import，
这正是「枚举即自足」这条设计成立的前提）。且远端 `$HOME/node_modules/` **不存在**（实测
`ls -d $HOME/node_modules/yaml` ⇒ No such file or directory）⇒ **即便把它加进 scp 列表，ESM 也解析不到
`yaml`**（`NODE_PATH` 对 ESM 无效，且远端脚本既不设 cwd 也不设 NODE_PATH——已读
`develop-deliver-tgz.sh` 的 remote_script 逐字确认）。
⇒ 修法要在**两个**方向上都成立，⛔ 只加一行 scp 不够。可用的一个现成事实：安装前缀里**有** yaml
（`<prefix>/lib/node_modules/quay/node_modules/yaml`，实测存在）。

**后果（这是本条为什么是 delivery-critical）**：`verify-deliver-coldstart.sh` 的 AC-238 门逐字含
`[ "$AC238_POST_BINDING" = "path-resolved" ]`。远端恒 `unreadable` ⇒ 该门**结构上不可能通过** ⇒
`AC238_EVALUATED` 恒 0 ⇒ **AC-238 记录在真机上永远写不出** ⇒ 7b（AC-239）的前置
（`AC238_EVALUATED=1` ∧ 同一 root）**永不成立** ⇒ **AC-239 永不进入可评估状态**。
即：这不是「某次运行环境不好」，是**验证器自己产不出自己的读数**。

**为什么没被发现**：`--selfcheck` 在**本仓库**里跑，那里该文件与 `node_modules` 都在 ⇒ `binding_state`
工作正常。⇒ 该判据**只被「实现所在的目录」这个夹具满足**，从没在生产载体（远端传输后的布局）上取过
一次真读数（硬规则 4 推论三：一个只能被 fixture 满足的判据，证明「能产出」，不证明「已产出」）。
且 `e1bdd0292`（develop）加了这条依赖，**没有**同步改上面那份枚举——而枚举的注释恰好承诺了这一点
（硬规则 5b：修的人只盯着被报出来的那一个）。

## Proposal

方向（⛔ 具体落点由执行者按实际形态定）：

1. **把该检查器加入两处 scp 枚举**（`--verify-coldstart` 与 `--verify-upgrade` 用的是同一段枚举，
   确认是否共用再改，⛔ 别只改一处）。
2. **解决裸 `yaml` 说明符**，两条路各有利弊，由执行者按实际取证选：
   (a) 让随行环境可解析——把安装前缀里那份 `yaml` 显式送达（如 `$HOME/node_modules/yaml`），
       与枚举「显式列出每个依赖」的哲学一致；
   (b) 让该检查器不再需要 npm 依赖（改用 `packages/quay` 内已 bundle 的解析），这样「随行 sibling
       必须自足」这条不变式重新成立——⛔ 但那要动另一个文件，且必须同时在**产品面**（不只远端）生效。
3. **加一条能取假的判据**：在远端的真实布局（不是本仓库）上跑一次 `binding_state`，断言取到
   `path-resolved`；并保留一个负控制（把检查器移走 ⇒ 必须变 `unreadable`，⛔ 不是静默 `path-resolved`）。

## Acceptance Criteria

- [ ] AC1 复现：在**远端的真实布局**（`$HOME` 下只有传输过去的文件）上跑 `binding_state`，
      修复前取到 `unreadable`（真实输出贴回）——⛔ 不是在本仓库里跑。
- [ ] AC2 修复后同一现场取到 `path-resolved`（真实输出贴回，含被检查的 `mcp_entry` 原文）。
- [ ] AC3 负控制（能取假）：把该检查器从远端布局里移走 ⇒ 读数必须回到 `unreadable`，
      ⛔ 不得静默变成 `path-resolved`（一个读不懂的判定不得与合格同形）。
- [ ] AC4 传输枚举与它的不变式同源：`grep` 出一份「随行 sibling 的 import 面」清单，
      证明**每一个**随行文件都自足（只用 node 内建 + `./` 相对 import），或把不自足的那个显式
      连它的依赖一起送达。命中数与前 3 条贴回（硬规则 5b 产物）。

## Definition of Done

- [ ] 修在 `develop-deliver-tgz.sh` 的**传输面**（或让检查器自足），⛔ 不是给某个 AC 加豁免。
- [ ] AC2/AC3 的两次读数都来自**同一远端现场**，互为对照（同一判据、唯一差别是检查器在不在）。
- [ ] 若同一段枚举还有其它漏项，一并列出（命中数 + 前 3 条），⛔ 不只修被报出来的这一个。

## Touches

- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/provider-binding-resolvability-check.ts`
- `tasks/gap-upgrade-verify-transport-missing-binding-checker.md`