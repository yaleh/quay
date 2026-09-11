---
id: gap-upgrade-verify-transport-missing-binding-checker
title: AC-238/239 跨主机验证器传输漏带 provider-binding-resolvability-check.ts（且它 import 裸
  `yaml`）——AC-238 记录在真机上结构上写不出，⑦b 前置永不成立
status: done
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

**对照测量（2026-09-11 补，硬规则 4 推论四：附一个若假说为假则结果会不同的对照）**

把「scp 枚举实际送出的那七个文件」在本地复制成一个目录，用**同一个 `binding_state` 函数**、
对**同一个项目**（`/home/yale/work/quay`，一个绑定肯定正常的项目）跑：

```
$ ls -1 /tmp/ac239-fake-remote        # 逐字就是那次 scp 送出的集合
gate-script-base.ts  pane-state-classify.ts  quay-init-closure-assertion.ts  repo-root.ts
runner-state-write.ts  verify-deliver-coldstart.sh  write-json-atomic.ts

$ SCRIPT_DIR=<本仓库 plugin/scripts>   binding_state /home/yale/work/quay  ⇒  path-resolved   # 检查器在场
$ SCRIPT_DIR=/tmp/ac239-fake-remote     binding_state /home/yale/work/quay  ⇒  unreadable     # 传输后的布局
```

**同一个函数、同一个项目，唯一差别是那个检查器在不在** ⇒ 成因是**传输漏件**，不是被检项目有问题
（⛔ 不是「那个项目绑定坏了」这种更弱的归因）。这也说明：**任何**远端项目（含绑定完全正常的）在这套
传输下都会读到 `unreadable` —— 它是**恒**的，与被测对象无关。

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
   ⚠️ 本条 Finding 里那个「复制成一目录 + 换 SCRIPT_DIR」的**本地**对照已能机械复现该形状，可作为
   该判据的 hermetic 形态（⛔ 但不能替代在真机传输布局上的那一次读数）。

## Acceptance Criteria

- [x] AC1 复现：在**远端的真实布局**（`$HOME` 下只有传输过去的文件）上跑 `binding_state`，
      修复前取到 `unreadable`（真实输出贴回）——⛔ 不是在本仓库里跑。
- [x] AC2 修复后同一现场取到 `path-resolved`（真实输出贴回，含被检查的 `mcp_entry` 原文）。
- [x] AC3 负控制（能取假）：把该检查器从远端布局里移走 ⇒ 读数必须回到 `unreadable`，
      ⛔ 不得静默变成 `path-resolved`（一个读不懂的判定不得与合格同形）。
- [x] AC4 传输枚举与它的不变式同源：`grep` 出一份「随行 sibling 的 import 面」清单，
      证明**每一个**随行文件都自足（只用 node 内建 + `./` 相对 import），或把不自足的那个显式
      连它的依赖一起送达。命中数与前 3 条贴回（硬规则 5b 产物）。

## Definition of Done

- [x] 修在 `develop-deliver-tgz.sh` 的**传输面**（或让检查器自足），⛔ 不是给某个 AC 加豁免。
- [x] AC2/AC3 的两次读数都来自**同一远端现场**，互为对照（同一判据、唯一差别是检查器在不在）。
- [x] 若同一段枚举还有其它漏项，一并列出（命中数 + 前 3 条），⛔ 不只修被报出来的这一个。

## Touches

- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/provider-binding-resolvability-check.ts`
- `plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`
- `tasks/gap-upgrade-verify-transport-missing-binding-checker.md`

## Evidence

### 选路：(a) 显式送达 yaml

Proposal 的 (a)/(b) 二选一，取 **(a) 把依赖显式送达**。理由：(b) 要求把检查器的 YAML 解析换掉——
在一个**验证器**里手写 YAML 子集解析，等于用一个新的正确性风险换掉一个传输风险，而该检查器的全部价值
就是「不判错」；且 (b) 自己承认要动另一个文件并须同时改产品面。⇒
`plugin/scripts/provider-binding-resolvability-check.ts` **本任务未修改**（仍在 Touches 内：它是本
缺陷的被运输对象，改它属于另一条路）。yaml 取 `${SCRIPT_DIR}/../../node_modules/yaml`
（⛔ 不是 `--root` 可覆盖的 `${repo_root}`）：在已安装布局下 `$SCRIPT_DIR/../..` **就是**包根，
那里本来就带嵌套 `node_modules/yaml`，故两种布局都成立。

### 远端读数（全部真机，本机直连；⛔ 无一条来自本仓库内）

站点 = `orangevps:$HOME/ac239-verify-site`，**只装传输过去的那一套**（比 `$HOME` 更严：`$HOME` 有
历史遗留物）。被测项目 = `orangevps:$HOME/quay-verify-upgrade-289a49dc-root`（一个**绑定完全正常**
的升级后项目，mcp_entry 第二条是存在的绝对路径）——正因为它正常，读数变差就只能归因于运输。

```
===== R1 — 传输集（检查器缺席）=====                                  [AC1]
R1-READING=unreadable
Error: Cannot find module '/home/yale/ac239-verify-site/provider-binding-resolvability-check.ts'
被检 mcp_entry（原文）: ["node","/home/yale/quay-verify-upgrade-289a49dc.npm/lib/node_modules/quay/
                        plugin/vendor/quay-native/dist/quay-native.js","mcp"]

===== R2 — 只补检查器、yaml 仍缺（证明「只加一行 scp 不够」）=====
R2-READING=unreadable
Error: Cannot find module 'yaml'   (ERR_MODULE_NOT_FOUND, from .../provider-binding-resolvability-check.ts)

===== R3 — 闭集完整（检查器 + node_modules/yaml）=====                  [AC2]
R3-READING=path-resolved
{"root":".../quay-verify-upgrade-289a49dc-root","providers":[{"id":"native","enabled":true,
 "mcpEntry":["node",".../quay-native/dist/quay-native.js","mcp"],
 "runtimeToken":".../quay-native/dist/quay-native.js","state":"path-resolved","exists":true,
 "runtimeTokenCandidates":1}],"judged":1,"failed":0,"notEvaluated":0,"status":"pass","ok":true}
yaml version shipped = 2.9.0

===== R4 — 同一站点，唯一变量 = 检查器被移走 =====                        [AC3]
R4-READING=unreadable
Error: Cannot find module '/home/yale/ac239-verify-site/provider-binding-resolvability-check.ts'
R4-RESTORED-READING=path-resolved          # 放回 ⇒ 回到 AC2 读数（同现场、单变量对照）

===== R5 — 生产布局 $HOME，经【真实 ship_verify_closure】运输 =====       [AC2]
$HOME/provider-binding-resolvability-check.ts  (15128 bytes)  ✓
$HOME/node_modules/yaml                                        ✓
R5-READING=path-resolved
===== R6 — 同一生产布局，唯一变量 = 检查器被移走 =====                    [AC3]
R6-READING=unreadable
R6-RESTORED-READING=path-resolved
```

### 同一枚举里的**其它**漏项（DoD 第 3 条；命中数 + 前 3 条）

`grep -oE '\$\{?SCRIPT_DIR\}?/[A-Za-z0-9._-]+\.(ts|mjs|js|sh)'` 在
`verify-deliver-coldstart.sh` 上得 **8 处**引用：

- **selfcheck() 之外（必须随行）= 5**：`pane-state-classify.ts`(×1) · `quay-init-closure-assertion.ts`(×1)
  · `provider-binding-resolvability-check.ts`(×1，**本次漏件**) · `runner-state-write.ts`(×2) ·
  `write-json-atomic.ts`(×1)。前 3 条：`pane-state-classify.ts` / `quay-init-closure-assertion.ts` /
  `provider-binding-resolvability-check.ts`。⇒ 除本次那个外**无其它漏项**（其余四个本来就在枚举里）。
- **selfcheck() 之内（本机跑，⛔ 正确地不随行）= 2**：`transcript-delivery-check.ts`(×2)。
  该区分是**机械的**（扫描时删掉 `selfcheck()` 函数体），不是一张可被随手加长的豁免名单。
- **`$SCRIPT_DIR/../../…`（树外引用）= 2**：SPEC（随行）·
  `packages/quay/scripts/register-plugin.mjs`（selfcheck 内，本机）。

**同一传输面的第二个缺口（独立成因、同一症状词，本次一并修）**：两个 verify 模式都**没有**把宿主的
Node ≥20 放到远端 PATH（只有 deliver 模式做了，`export PATH="${node_path}:\$PATH"`）。用传输自己的
探针 `ssh C bash -s` 实测：`PATH` 无 nvm/.local 条目 ⇒ `command -v node` = `/usr/bin/node v18.19.1`，
`node --experimental-strip-types -e …` ⇒ **`bad option`** ⇒ `binding_state()` 在 C 上对**任何**项目
恒 `unreadable`。⇒ 与漏件**同一个症状词、不同成因**，只修漏件不够。

```
===== R7 — host C（ad-arm1），传输 ssh 的 PATH 原样 =====                  [第二个缺口]
PATH-node = /usr/bin/node v18.19.1
R7-READING=unreadable
node: bad option: --experimental-strip-types
===== R8 — 同 host/同站点/同项目，加上修复后传输实际发出的 node floor =====
PATH-node = /home/yale/.local/opt/node-current/bin/node v24.19.0
R8-READING=path-resolved
被检 mcp_entry（原文）: ["node","/home/yale/quay-ac88-project/.quay/runtime/bin/quay-native.js","mcp"]
===== R9 — 同 C 条件（R8），唯一变量 = 检查器被移走 =====                    [AC3 on C]
R9-READING=unreadable
R9-RESTORED-READING=path-resolved
```

修复后传输**实际发出**的 remote_script 头两行（本地按真函数渲染）：

```
B: export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
C: export PATH="$HOME/.local/opt/node-current/bin:$PATH"
```

（`$HOME`/`$PATH` 保持字面，在远端展开——与既有 `ac207_path_export` 同形。）

### 机制（不是「我记得改了两处」）

`transport_flat_files` / `transport_node_modules_deps` = **闭集唯一出处**，两个模式都从它取
（`ship_verify_closure`），故「两处枚举」的结构性成因消失。`--selfcheck-transport-closure`
**机械计算**该闭集：① `selfcheck()` 之外被 verify 脚本调用的每个 `$SCRIPT_DIR` 兄弟必须在集合内
（REF-UNSHIPPED）；② 每个随行 `.ts` 的 import 必须落在 node 内建 / 已随行的 `./` 相对 / 已随行的裸包
三者之一（IMPORT-UNSHIPPED / BARE-UNSHIPPED / MISSING-LOCAL）；`import type` 会被
`--experimental-strip-types` 擦除，故**不算**远端依赖（`runner-state-write.ts` 的
`./full-suite-runner.ts` 就是这个边界——报它即假阳性，而会误报的守卫会被关掉）。

**AC4 的 import 面清单（`--selfcheck-transport-closure` 逐字输出，命中数 7 个随行 `.ts`）**：

```
import-face pane-state-classify.ts -> [node:child_process node:fs node:path node:url]
import-face quay-init-closure-assertion.ts -> [./gate-script-base.ts ./repo-root.ts node:child_process node:fs node:path]
import-face gate-script-base.ts -> [node:fs node:path node:url]
import-face repo-root.ts -> [node:child_process node:fs node:path node:url]
import-face runner-state-write.ts -> [./write-json-atomic.ts node:fs node:path]
import-face write-json-atomic.ts -> [node:crypto node:fs node:path]
import-face provider-binding-resolvability-check.ts -> [./gate-script-base.ts ./repo-root.ts node:fs node:path yaml]
import-face files=7 non-self-sufficient=provider-binding-resolvability-check.ts (bare yaml, shipped under node_modules/)
```

⇒ 7 个中 **6 个自足**（node 内建 + 已随行的 `./`），**1 个**（该检查器）带裸依赖，已**显式连依赖一起
送达**——两条路按 AC4 的措辞任选一条即可，本次走的是后者。

四个负控制 + 一个「读不懂」控制，证明该守卫**能取假**（`--selfcheck-transport-closure` 逐字输出）：

```
positive                      → violations=0                (真集合)
drop-checker                  → violations=1  REF-UNSHIPPED: provider-binding-resolvability-check.ts
drop-yaml                     → violations=1  BARE-UNSHIPPED: … imports bare "yaml"
drop-gate-script-base         → violations=2  IMPORT-UNSHIPPED: quay-init-closure-assertion.ts + 该检查器
synthetic-type-erasure        → violations=1  （值 ./ import 报，import type 不报）
empty-list                    → violations=5  （读不懂的清单**不**与合格同形）
```

接线控制：`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs` 第 ⑥ 例把它接进套件，并**按位置**
断言两个 scp 点都走 `ship_verify_closure`、两个模式的 remote_script 都发 node floor、且随行兄弟在**唯一
一处**登记（重复登记即失败）。红控制实测：把检查器从唯一出处删掉 ⇒ 该例 FAIL；把其中一个模式改回内联
scp ⇒ 该例 FAIL（都随后复原并比对 md5）。
