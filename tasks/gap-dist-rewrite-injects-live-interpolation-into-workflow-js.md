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

- [ ] AC1 复现固化：一条可跑命令，对 `origin/dist-plugin:workflows/manager-tick-core.js`（或重写产物）在仅含 sandbox globals 的上下文里加载，断言 `ReferenceError: CLAUDE_PLUGIN_ROOT is not defined`。当前基线：抛。
- [ ] AC2 载体感知修法：重写器对 `.js` 载体不得产出会被 JS 求值的 `${}`。任选其一并在证据里说明取舍：① `.js` 内改写为转义形 `\${CLAUDE_PLUGIN_ROOT}`（交给下游 shell 展开）；② 改写为 JS 运行时可解析的表达式。⛔ 不得简单地把 `.js` 排除出重写集——那会退回 `gap-delivery-laydown-dist-closure-gap` 修掉的 referenced-not-landed（raw `.ts` 已被 strip）。
- [ ] AC3 守卫（防第 5 个 workflow）：构建/发布路径上一条机械检查——重写后的 `.js` 若含**未转义**的 `${CLAUDE_PLUGIN_ROOT}` 即 fail loud。⛔ 不得用「扫到就算过」的同形谓词（硬规则 3b）。
- [ ] AC4 能取假（负控制）：把 AC2 的修法还原成当前坏形 ⇒ AC1/AC3 变红；修法在位 ⇒ 绿。把两条实际输出贴进证据。
- [ ] AC5 全量面：6 个 workflow 重写产物逐个在 sandbox globals 下加载，`manager-tick-core` / `pool-quality-judge` / `fan-in-execute` / `execute-suite-fix` 四个均为 0 活跃插值（`drain-directives` / `run-routines` 保持 0）。
- [ ] AC6 不回归：`packages/quay/test/build-plugin-dist.test.mjs` 全绿 + 新增用例覆盖 AC1/AC3；`--for-task` scoped 门绿。

## DoD

- [ ] 发布面（`dist-plugin` 分支或等价产物）重跑后，`workflows/*.js` 在消费形态下**可加载**——真实落地，不是 fixture：至少 `manager-tick-core.js` 与 `pool-quality-judge.js` 在只含 sandbox globals 的上下文里 eval 通过。
- [ ] AC3 守卫已接入一条**会在 CI / scoped 门真实运行**的检查（贴出它跑起来的输出），⛔ 不是只写在注释里。
- [ ] AC4 负控制证据（还原坏形 ⇒ 红）与修复后证据（⇒ 绿）成对贴出。
- [ ] AC1–AC6 全部勾上；本轮改动的 Touches 内文件已提交。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs（`rewriteInvokers`/`rewriteMarkdown` 的 `.js` 载体规则 + 守卫）
- packages/quay/test/build-plugin-dist.test.mjs（AC1/AC3/AC4 用例）
- tasks/gap-dist-rewrite-injects-live-interpolation-into-workflow-js.md（自身：勾 AC + 贴证据）