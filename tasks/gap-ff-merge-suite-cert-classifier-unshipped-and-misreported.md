---
id: gap-ff-merge-suite-cert-classifier-unshipped-and-misreported
title: ff-merge 的 suite 证书闸在【安装布局】下把「分类器根本没跑起来」误报成「delta 被 @static-object
  覆盖（非惰性）」——每个任务的首次 fan-in 必然落地失败
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-239
---
## Finding

**实测（2026-09-11，本机直连 orangevps 的一次真实 AC-239 e2e 运行；⛔ 非推断）**

在升级后的第三方副本（meta-cc，`/home/yale/quay-verify-upgrade-3b0932db-root`）上，一条**真实缺陷修复任务**
`ac239-subagent-session-id-scan` 走到了 driver 机械 fan-in，全链路**每一步都绿**，唯独 `ff` 红：

```
{"ts":"2026-09-11T16:51:08.521Z","step":"suite-start","ok":true}
{"ts":"2026-09-11T16:51:12.704Z","step":"suite-end","ok":true,"wall_ms":4178}
{"ts":"2026-09-11T16:51:12.926Z","step":"anti-drift-land","ok":true}
{"ts":"2026-09-11T16:51:13.016Z","step":"ac-gate","ok":true}
{"ts":"2026-09-11T16:51:13.040Z","step":"flip-done","ok":true}
{"ts":"2026-09-11T16:51:13.096Z","step":"ff","exit":2,"ok":false,
 "reason":"fan-in-ff-merge: 本任务 ac239-subagent-session-id-scan 的 suite 证书未满足 —
           suite_head..tip delta classified non-inert (covered); …NOT acquiring the merge lock"}
```

**根因（读代码 + 在生产布局上复现，⛔ 非推断）**

`packages/quay/src/fan-in/ff-merge.ts:286` 判 `suite_head..tip` 的惰性时，spawn 的是
**`.ts` 源路径**：

```js
const classifyScript = path.join(scriptsDir, "select-static-checks-for-touches.ts");
sh(["node","--experimental-strip-types", classifyScript, "--classify-delta", "--root", classifyRoot, ...])
```

而在**任何 npm 安装布局**里该文件不存在——包里只有**编译产物**
`plugin/scripts/dist/select-static-checks-for-touches.js`。生产布局实测：

```
$ find <prefix>/lib/node_modules/quay -name 'select-static-checks-for-touches*'
<prefix>/lib/node_modules/quay/plugin/scripts/dist/select-static-checks-for-touches.js   ← 只有这个
$ node --experimental-strip-types <prefix>/…/plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root <prefix> tasks/x.md
Error: Cannot find module '…/plugin/scripts/select-static-checks-for-touches.ts'
```

⇒ `verdict.status !== 0` ⇒ 证书闸拒绝。而**每一个** `flip-done`（驱动自己把任务翻 done）都必然产生
非空 delta（`tasks/<id>.md`）⇒ **在安装布局下，任何任务的第一次 fan-in 必然在 ff 处失败**。

**第二个、独立的半边（硬规则 3b：读不懂不得与合格/判决同形）**

`:288` 的 reason 模板是 `` `… non-inert (${verdict.stdout.trim() || "covered"})` `` —— stdout 为空
（= 分类器**根本没给出判决**）时打印的是**字面量 `covered`**。实测读数正是 `(covered)`。
⇒ **「分类器跑不起来」被报成了「分类器判它非惰性、被 @static-object 覆盖」**，这是一个具体判决。
本次执行者据此**差点**投出一条更强的错误结论（「安装布局下结构上永不落地」），是靠回头查
`quay-verify-coldstart-a2a5aac0-root` 上 AC-207 的第二次尝试**成功**才自我推翻的——即该误报确实会误导读者。

**影响（实测，⛔ 不夸大）**

- **不是**「永不落地」：`quay-verify-coldstart-a2a5aac0-root` 的 `e2e-verify-207` 第 1 次 ff 同样红、
  第 2 次 ff 绿（`01:43:20 ff ok=false` → 驱动 reset done→ready → `01:48:53 flip-done ok / ff ok=true`）。
  收敛机制是：第 1 次已把 done 提交留在**任务分支**上，第 2 次的 `flip-done` 成为 **no-op** ⇒ delta 为空 ⇒ 证书通过。
- **但代价是真的**：每个任务至少多烧一轮 fan-in；且本次 ac239 的**落地最终没有发生** ——
  实测（2026-09-11T17:09:34Z）：`git merge-base --is-ancestor task/ac239-subagent-session-id-scan develop` = **NO**，
  `develop` 上只有任务文件提交，实现提交 `e7d7d67`（4 文件：`internal/mcp/query/query.go`、
  `internal/mcp/executor/provider_query.go` + 两个测试）**从未落地**；而该任务的 `status` 在 develop 上
  已是 `done`（fan-in 的 `flip-done` 写进工作树后被 doc 面同步带过去）⇒ 出现「**任务 done 而其实现提交未落地**」
  的漂移。该漂移本应由驱动的 done→ready reset 收敛，但 ac239 在本次观察窗口内没有再被重试
  （`worker-round.jsonl` 最后一轮 16:53:14，此后无新轮）。

**为什么没被发现**：判据 `classifyScript` 指向的路径在**开发检出**里存在（`plugin/scripts/*.ts` 就在那儿），
只在**安装产物**里缺失 ⇒ 该判据**只被「实现所在的目录」这个夹具满足**，从没在生产载体（npm 安装布局）
上取过一次真读数（硬规则 4 推论三）。与 `gap-upgrade-verify-transport-missing-binding-checker`（⑤）**同族**：
**枚举式交付面漏掉了一个被调用的兄弟**，只是这次是在包的 `files`/打包面，而不是跨主机 scp 面。

## Proposal

方向（⛔ 具体落点由执行者按实际形态定，本段不是预设结论）：

1. **让判据解析到实际存在的那一份**：`ff-merge` 调用 `select-static-checks-for-touches` 时应按布局解析
   （编译产物 `dist/*.js` 与 `.ts` 源二选一，与仓库别处同形），或把该 `.ts` 一并纳入打包面。
   ⛔ 不要只在 `package.sh` 里加一行而不问「还有没有别的 `plugin/scripts/*.ts` 被运行时 spawn」。
2. **`can't-evaluate` 必须与「判决为惰性/非惰性」有可区分取值**：分类器缺失/崩溃时不得报成一个判决
   （现状 `(covered)` 即硬规则 3b 的教科书违例）。修法与仓库既有做法同形（`evaluated:false` /
   `NOT-EVALUATED` 独立取值）。
3. **`classifyRoot` 值得一并核**：`path.resolve(scriptsDir, "..", "..")` 在安装布局下 = **安装前缀**
   （实测 = `<prefix>/lib/node_modules/quay`），而它该是**被合并的那个项目**的 root（注册表 `scripts/test.sh`
   在那儿）。本次不是成因（分类器压根没跑起来），但第 1 条修好后它会立刻变成成因 ⇒ 一并核，
   ⛔ 但不要预设它一定是错的。
4. **5b 产物（必须）**：grep 出所有「运行时 spawn `plugin/scripts/*.ts`」的位点，列一份「在安装布局下
   解析不到」的清单（命中数 + 前 3 条），证明修的不是被报出来的这一个。

## Acceptance Criteria

- [ ] AC1 复现：在**安装布局**（npm 全局装出的 prefix，⛔ 不是开发检出）上跑
      `ff-merge` 判 delta 惰性的那条命令，修复前取到 `Cannot find module` / 非零（真实输出贴回）。
- [ ] AC2 修复后同一现场取到一个**真实判决**（惰性 ⇒ 空输出且 exit 0；非惰性 ⇒ 非空输出），真实输出贴回。
- [ ] AC3 负控制（判据可取假）：塞一个**真的**被 change/full 检查器 `@static-object` 覆盖的路径 ⇒
      必须仍被判非惰性并拒绝；塞一个纯 doc 面路径 ⇒ 必须放行。
- [ ] AC4 可区分取值：注入「分类器缺失 / 崩溃」⇒ 输出必须是一个**独立的 not-evaluated 取值**，
      ⛔ 不得是 `covered`、也不得与「非惰性判决」同形（真实输出贴回）。
- [ ] AC5 5b 产物：给出一份「运行时 spawn 的 `plugin/scripts/*.ts` 在安装布局下是否存在」的机械清单
      （命中数 + 前 3 条），并逐条说明处置。

## Definition of Done

- [ ] 修的是**产品面**（`ff-merge` 的判据解析 / 打包面 / 取值词表），⛔ 不是给某个 AC 加豁免、
      ⛔ 不是在 `fan-in-ff-merge.sh` 里塞一个 `|| true`。
- [ ] AC3 的正负两侧都在**同一现场**取到，互为对照（同一判据、唯一变量是被判的路径）。
- [ ] 落地效果的判据是**产物**：在安装布局上，一个任务**第一次** fan-in 就能 ff 成功
      （⛔ 不是「我加了个解析分支」）。

## Touches

- `packages/quay/src/fan-in/ff-merge.ts`
- `packages/quay/scripts/package.sh`
- `tasks/gap-ff-merge-suite-cert-classifier-unshipped-and-misreported.md`

## Evidence

（本条由 gap-aged-project-post-upgrade-driver-e2e 的一次真实 e2e 派生；原始读数见该任务体的
`## Evidence` 一节，⛔ 不复刻第二份。）
