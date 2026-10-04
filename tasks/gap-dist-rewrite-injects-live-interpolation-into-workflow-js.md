---
id: gap-dist-rewrite-injects-live-interpolation-into-workflow-js
title: dist 重写器把 ${CLAUDE_PLUGIN_ROOT} 注入 workflow 的 .js 模板串——4/6 已发布 workflow
  在消费工作区 eval 即 ReferenceError
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: v1
---
## Finding

**结论**：`packages/quay/scripts/build-plugin-dist.mjs` 的发布重写器把 `${CLAUDE_PLUGIN_ROOT}` 锚注入 `plugin/workflows/*.js`。而 workflow 脚本运行在 Workflow sandbox 里——那里 `${}` 是 **JS 模板串插值**，且 `CLAUDE_PLUGIN_ROOT` 不在 globalThis 中 ⇒ 消费工作区加载即 `ReferenceError`，0 个 agent 起得来。**修 workflow 源文件无效**，见下。

**复现（本会话实测，非转述）**：取发布产物 `origin/dist-plugin:workflows/manager-tick-core.js`，用该文件自己记录的那组 sandbox global（`manager-tick-core.js:38-42` 的探针 wf_af76a6df-2c3：`log/phase/budget/setTimeout/clearTimeout/agent/parallel/pipeline/workflow/args`）包进 AsyncFunction 执行：

```
>>> ReferenceError: CLAUDE_PLUGIN_ROOT is not defined
>>> at <anonymous>:98:16
```

**根因不在源码**：仓库源码 `plugin/workflows/manager-tick-core.js` 是干净的（`grep -rn CLAUDE_PLUGIN_ROOT plugin/workflows/` = 0 命中）。坏形由重写器**发布时注入**：

- `build-plugin-dist.mjs:54` `CONSUMER_DIRS` 含 `"workflows"`；`rewriteInvokers()`（`:769` 起）遍历 `mdDirs = ["skills","loop","probes","agents","workflows"]` 时显式接受 `.js`（`:789` `if (!f.endsWith(".md") && !f.endsWith(".js")) continue;`）
- `:790-793` 注释逐字写：`rewriteMarkdown's path/node rules are safe on .js`
- 该论证只覆盖「它碰哪些路径」，**完全未覆盖承载体的求值语义**：`.md`/`.sh` 里 `${...}` 由 shell 展开（"安全"成立），`.js` 模板串里由 JS 展开（不成立）。硬规则 4c：判据点名的量必须穿过所有中间层还取得到——中间层换了，同一处安全论证失效。

**这是活的，不是陈旧版本遗留**：用真实的 `rewritePluginPaths()`（`:678`，已 export）跑**今天干净的源码**，产出：

```
96:  #   A0  node --experimental-strip-types ${CLAUDE_PLUGIN_ROOT}/scripts/dist/quay-session.js manager-tick-readings
247: - A0：node --experimental-strip-types ${CLAUDE_PLUGIN_ROOT}/scripts/dist/quay-session.js manager-tick-readings
```

⇒ 下一次 publish 会原样重新注入。cache 里 `0.12.0-dev` 干净只是因为它是 dev-source 安装，**不是发布面**（`origin/dist-plugin` 最后构建 2026-09-20，仍带坏形）。

**爆炸半径（对 6 个已发布 workflow 跑真实重写后逐个数未转义插值）**：

| workflow | 重写后活跃 `${}` | 判定 |
|---|---|---|
| `manager-tick-core.js` | 2（`:96`,`:247`） | **执行确认炸** |
| `pool-quality-judge.js` | 4（`:25`,`:142`,`:176` 反引号内） | **执行确认炸** |
| `fan-in-execute.js` | 21（`:331-334` 在 `:322` 开的反引号内） | 检视确认（stub 控制流未走到） |
| `execute-suite-fix.js` | 3（`:140` 在 `:137` 开的反引号内） | 检视确认（同上） |
| `drain-directives.js` / `run-routines.js` | 0 | 干净 |

⇒ 4/6 已发布 workflow 含活跃插值。**首次报告来自另一个消费工作区的 manager 会话（其 `.quay/config.yml` 钉 quay 0.10.0），它报的是 1 个实例，实际是一族**（硬规则 5b）。

**祖先**：`gap-delivery-laydown-dist-closure-gap`（done——正是它在 `rewriteInvokers` 里加入 `.js` 参与重写，其注释见 `:785-793`）+ `gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths`/AC-260（done——引入 `${CLAUDE_PLUGIN_ROOT}/` 锚）。两者都在各自载体类内自证正确，均未覆盖 `.js` 求值语义。

## Acceptance Criteria

- [x] AC1 复现固化：一条可跑命令，对 `origin/dist-plugin:workflows/manager-tick-core.js`（或重写产物）在仅含 sandbox globals 的上下文里加载，断言 `ReferenceError: CLAUDE_PLUGIN_ROOT is not defined`。当前基线：抛。→ E1（真实发布产物）+ E2（重写产物）；固化形态 = `build-plugin-dist.test.mjs` 的 `AC4`/`AC5` 两用例（同一 `loadWorkflowInSandbox` 仅注入 sandbox globals）。
- [x] AC2 载体感知修法：重写器对 `.js` 载体不得产出会被 JS 求值的 `${}`。任选其一并在证据里说明取舍：① `.js` 内改写为转义形 `\${CLAUDE_PLUGIN_ROOT}`（交给下游 shell 展开）；② 改写为 JS 运行时可解析的表达式。⛔ 不得简单地把 `.js` 排除出重写集——那会退回 `gap-delivery-laydown-dist-closure-gap` 修掉的 referenced-not-landed（raw `.ts` 已被 strip）。→ 取 **②**：`rewriteJs()` 折叠为 `${"$"}{CLAUDE_PLUGIN_ROOT}`（新型 `JS_ROOT_ANCHOR`）。`.js` **仍在重写集内**（`:789` 的扩展名分支保留，改为按扩展名分派规则）。① 被实测否掉：见 E3（`String.raw` 泄漏反斜杠）。
- [x] AC3 守卫（防第 5 个 workflow）：构建/发布路径上一条机械检查——重写后的 `.js` 若含**未转义**的 `${CLAUDE_PLUGIN_ROOT}` 即 fail loud。⛔ 不得用「扫到就算过」的同形谓词（硬规则 3b）。→ `scanJsCarrierAnchors()`（返回 `scanned` 计数 + violations）+ `assertJsCarrierAnchorsInert()`（零载体 = **NOT-EVALUATED** 独立态，拒绝；有违规 = FAILED）。接入点：`--rewrite` 分支（`package.sh:182` 的发布入口）与 `rewriteInvokers()` 末尾；输出见 E4，scoped 门内运行见 E5。
- [x] AC4 能取假（负控制）：把 AC2 的修法还原成当前坏形 ⇒ AC1/AC3 变红；修法在位 ⇒ 绿。把两条实际输出贴进证据。→ E2（坏形 ⇒ `ReferenceError: CLAUDE_PLUGIN_ROOT is not defined`；修法在位 ⇒ `eval OK`）+ E4（坏形 ⇒ 守卫 FAILED；折叠形 ⇒ 0 violations）。落成用例：`AC4 — negative control …`。
- [x] AC5 全量面：6 个 workflow 重写产物逐个在 sandbox globals 下加载，`manager-tick-core` / `pool-quality-judge` / `fan-in-execute` / `execute-suite-fix` 四个均为 0 活跃插值（`drain-directives` / `run-routines` 保持 0）。→ E2 全表：6/6 `eval OK`，活跃插值 0/0/0/0/0/0（折叠数 2/4/22/3/0/0）。
- [x] AC6 不回归：`packages/quay/test/build-plugin-dist.test.mjs` 全绿 + 新增用例覆盖 AC1/AC3；`--for-task` scoped 门绿。→ E5：43/43 pass、EXIT=0；新增 7 条用例（AC1 沙箱加载 / AC2 双模板串+①泄漏 / AC4 负控制 / AC5 六文件全量 / AC3 守卫三态 / AC3 真实根正控制 / AC2 幂等）。

## DoD

- [x] 发布面（`dist-plugin` 分支或等价产物）重跑后，`workflows/*.js` 在消费形态下**可加载**——真实落地，不是 fixture：至少 `manager-tick-core.js` 与 `pool-quality-judge.js` 在只含 sandbox globals 的上下文里 eval 通过。→ E2 / E4。**说明（不夸大）**：未重建 `dist-plugin` 孤儿分支（那是 publish 流水线的动作）；等价产物 = 对 `plugin/` 的完整暂存副本跑真实 `--rewrite`（`package.sh:182` 的同一入口、同一输入形态），守卫输出见 E4。
- [x] AC3 守卫已接入一条**会在 CI / scoped 门真实运行**的检查（贴出它跑起来的输出），⛔ 不是只写在注释里。→ E4（发布路径：`js-carrier anchor gate OK — 6 .js carrier(s) inert`）+ E5（scoped 门内两条 AC3 用例 ✔）。
- [x] AC4 负控制证据（还原坏形 ⇒ 红）与修复后证据（⇒ 绿）成对贴出。→ E2（成对：pre-fix 抛 / post-fix OK）+ E4（成对：FAILED / 0 violations）。
- [x] AC1–AC6 全部勾上；本轮改动的 Touches 内文件已提交。

## Evidence

**改动**（仅 Touches 内文件；提交 `96429beb8`，随后 `git merge develop` → `cac27759d`）：

- `packages/quay/scripts/build-plugin-dist.mjs`：新增 `JS_ROOT_ANCHOR = '${"$"}{CLAUDE_PLUGIN_ROOT}'`、`escapeJsCarrier()`、`rewriteJs()`（= `rewriteMarkdown` + 载体折叠）、`scanJsCarrierAnchors()`、`assertJsCarrierAnchorsInert()`；`INVOKER_MD_DIRS`/`INVOKER_SH_DIRS`/`isFixture` 提到模块作用域（守卫与重写器必须读**同一份**目录清单，硬规则 5b）；`ACTIVE_ROOT_ANCHOR_RE = /(?<!\\)\$\{CLAUDE_PLUGIN_ROOT\}/`；`rewriteInvokers()` 按扩展名分派并在末尾自查；`--rewrite` 分支追加严格守卫。
- `packages/quay/test/build-plugin-dist.test.mjs`：新增 7 条用例 + 一个"仅 sandbox globals"加载器（含全形状 Proxy stub，使 6 个 workflow 都能跑到自己的 `return`）。

**AC2 取舍（②，不是①）**：`${"$"}{CLAUDE_PLUGIN_ROOT}` 是 JS 运行时可求值的表达式——`${"$"}` 求值为 `$`，`{CLAUDE_PLUGIN_ROOT}` 保持原样文本 ⇒ **两种模板串（untagged 与 `String.raw`）都产出 `${CLAUDE_PLUGIN_ROOT}`**，与 `.md`/`.sh` 载体发出的字节一致。
⛔ 不取①（`\${CLAUDE_PLUGIN_ROOT}`）的理由是**实测的**：`\$` 在 untagged 模板里被 cook（→ `${…}`），但在 `String.raw` 里原样返回 ⇒ 泄漏一个反斜杠进 shell 文本。`String.raw` 不是假想的——`manager-tick-core.js:85` 的 `READ_CMD` 就是它，所以①**恰好修不好最要紧的那个文件，且是静默的**（文件照样加载，只有交给 shell 的文本是坏的）。该权衡已固化为用例（E3）。
选用形还刻意避开 `${CLAUDE_PLUGIN_ROOT}` 子串，使守卫与一切 `grep` 形读者能用**一条精确谓词**判定"活跃锚有无"，而不必认识一族"可接受拼法"。

### E1 — AC1 基线（真实发布产物，`origin/dist-plugin`，2026-09-20 构建）

```
$ node /tmp/gaplive-ev/ac1-baseline.mjs   # git show origin/dist-plugin:workflows/manager-tick-core.js → AsyncFunction(仅 sandbox globals)
THREW: ReferenceError: CLAUDE_PLUGIN_ROOT is not defined
```

### E2 — AC1/AC5 修复后（对今天干净源码跑真实重写）+ AC4 成对

```
workflow                 pre-fix active  folded   sandbox eval (post-fix)
drain-directives.js      0               0        eval OK (reaches its own return)
execute-suite-fix.js     3               3        eval OK (reaches its own return)
fan-in-execute.js        22              22       eval OK (reaches its own return)
manager-tick-core.js     2               2        eval OK (reaches its own return)
pool-quality-judge.js    4               4        eval OK (reaches its own return)
run-routines.js          0               0        eval OK (reaches its own return)

manager-tick-core.js   pre-fix : ReferenceError: CLAUDE_PLUGIN_ROOT is not defined
manager-tick-core.js   post-fix: eval OK (reaches its own return)
pool-quality-judge.js  pre-fix : ReferenceError: CLAUDE_PLUGIN_ROOT is not defined
pool-quality-judge.js  post-fix: eval OK (reaches its own return)
```

（`fan-in-execute.js` 单元级重写是 22 处 / 21 行，比 Finding 表里的 21 多 1：Finding 数的是用**真实 bundleExists 谓词**构建的发布产物，其中 1 处不是 bundle 条目，单元级 `bundleExists=()=>true` 把它也折叠了。）

### E3 — AC2 负控制：① 的 `String.raw` 泄漏（实测，非推理）

```
$ node --test --test-name-pattern 'both template-literal flavors' packages/quay/test/build-plugin-dist.test.mjs
✔ AC2 — both template-literal flavors evaluate to the PLAIN anchor (a `\${…}` escape would leak a backslash through String.raw)
  untagged   模板 + ① : `run: node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/quay-session.js --root /w`      ← ① 在这里是对的
  String.raw 模板 + ① : `# A0 node \${CLAUDE_PLUGIN_ROOT}/scripts/dist/quay-session.js manager-tick-readings`  ← 反斜杠泄漏，shell 不会展开
  两种模板串 + ②    : 均产出 `${CLAUDE_PLUGIN_ROOT}/…`（本用例断言）
```

### E4 — AC3/AC4 守卫（三态，发布路径 + 负控制）

```
$ node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs --rewrite <staged plugin/>
build-plugin-dist: rewrote 31 staged invokers to reference dist bundles
build-plugin-dist: js-carrier anchor gate OK — 6 .js carrier(s) inert

# 负控制：还原坏形（暂存树里放回 `${CLAUDE_PLUGIN_ROOT}` 并直接调守卫）
js-carrier anchor gate FAILED: 1 active ${CLAUDE_PLUGIN_ROOT} occurrence(s) in 1 scanned .js carrier(s) — a JS engine evaluates these as template substitutions and the Workflow sandbox has no such binding (ReferenceError at load). Rewriters must emit the JS_ROOT_ANCHOR form:
  workflows/x.js:1  const cmd = `node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/y.js`;

# 同一条载体换成折叠形：
assertJsCarrierAnchorsInert -> 1 carrier(s) scanned, 0 violations

# 零载体：守卫不得被读成「干净」
js-carrier anchor gate NOT-EVALUATED: no .js carrier found under skills/loop/probes/agents/workflows in … — "nothing scanned" must not read as "nothing to fix" (硬规则 3b)
```

### E5 — AC6 `--for-task` scoped 门

```
$ bash scripts/test.sh --for-task gap-dist-rewrite-injects-live-interpolation-into-workflow-js --allow-thin
ℹ tests 43   ℹ pass 43   ℹ fail 0      EXIT=0
✔ AC1 — the PRODUCTION rewrite of the real manager-tick-core.js evaluates end-to-end under the sandbox globals
✔ AC2 — both template-literal flavors evaluate to the PLAIN anchor …
✔ AC4 — negative control: the PRE-FIX rule (rewriteMarkdown on a .js carrier) reproduces `ReferenceError: CLAUDE_PLUGIN_ROOT is not defined`
✔ AC5 — all six shipped workflows fold to ZERO active anchors and evaluate in the sandbox
✔ AC3 — the guard takes FALSE on an active anchor, TRUE on the folded form, and refuses NOT-EVALUATED
✔ AC3 — positive control on the REAL plugin root: the guard reads all six shipped carriers and reports inert
```

scoped-gate cache 已写（`develop` sha `2ee5b3fe4`，为 HEAD 祖先）。

### E6 — fan-in suite 解阻：特征化基线把 `Date.now()` 派生的相对时间也归一化（Touches 追加 2 文件）

前两轮 fan-in 在同一处退出未落地：`step=suite: AssertionError [ERR_ASSERTION]: route snapshot: 1 route(s) changed vs the baseline`，指向 `packages/quay/test/characterization-serve-routes.test.mjs`（本任务 delta 之外，一跳导入亦不相交——delta-relatedness 复算 = UNRELATED；该文件并已 `@load-sensitive` 注册）。

**真因（实测，非推测）**：该基线的 `normalize()` 头注声称把所有 **volatile timestamps** 换成稳定标记，但**漏了相对时间族**——`serve-task.ts:863`（`/task/:param` 的 `last updated:`）与列表页 updated 列 / dashboard 卡片渲染的 `relativeTime(ts)`（`serve-render.ts:760`）= `Date.now() - ts`，产出 `"0s ago"` / `"1s ago"` / `"2m ago"`…。基线里固化的是 **`0s ago`（4 处）**。fan-in 全量 suite（127 路并发）下，fixture 写入 → `/task/:param` 渲染的间隔越过 1 秒 ⇒ 实际渲染 `1s ago` ⇒ 逐字节比对红。

**隔离复现（本工作树）**：单跑该文件 **绿**（捕获 135ms，仍 `0s ago`）；suite 日志里该文件 `__PERFILE__ … passed=false`，失败点逐字 `last updated: 0s ago`(期望) vs `1s ago`(实际) ⇒ 隔离不出现、满负载出现的**负载形**红。（owner 任务 `gap-characterization-baseline-serve-routes-and-concurrent-writes` = done ⇒ 无主红，本任务就地修。）

**修法**：给 `normalize()` 增一条与既有 ISO/epoch 规则同族的相对时间规则 `s.replace(/\b\d+[smhd] ago\b/g, "⟨REL⟩")`，并按 `UPDATE_SNAPSHOT=1` 重生成基线（4 处 `0s ago` → `⟨REL⟩`）。

```
$ git diff --word-diff 基线：仅 4 处 0s ago → ⟨REL⟩，无其它改动（4 insertions / 4 deletions）
-class="col-updated">0s ago              +class="col-updated">⟨REL⟩
-font-size:0.7rem">0s ago</div>           +font-size:0.7rem">⟨REL⟩</div>
-\">0s ago</div>                          +\">⟨REL⟩</div>
-0s ago</p>                               +⟨REL⟩</p>
$ 规则族：0s/1s/59s/2m/3h/10d ago 全部 → ⟨REL⟩（单跑实测）
```

⛔ 不是「把红改绿」的放水：该规则与测试自身的头注 ②（volatile timestamps → 稳定标记）一致，且只折叠时间派生量。**负控制（cp 备份改基线，非 git checkout）**：把基线 `⟨REL⟩` 反改成 `⟨MUTATED⟩` ⇒ `✖ route snapshot … / pass 2 fail 1`；还原 ⇒ `pass 3 fail 0`——断言仍能取假。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs（`rewriteInvokers`/`rewriteMarkdown` 的 `.js` 载体规则 + 守卫）
- packages/quay/test/build-plugin-dist.test.mjs（AC1/AC3/AC4 用例）
- packages/quay/test/characterization-serve-routes.test.mjs（E6：相对时间归一化——解阻 fan-in suite 的无主负载形红）
- packages/quay/test/fixtures/characterization/serve-routes.snapshot.json（E6：基线 4 处 `0s ago` → `⟨REL⟩`）
- tasks/gap-dist-rewrite-injects-live-interpolation-into-workflow-js.md（自身：勾 AC + 贴证据）
