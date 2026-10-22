---
id: gap-concern-kind-registry-admission-field
title: CONCERN_KIND_REGISTRY 每个 kind 带 admission（mechanical /
  semantic-judged）并登记 unencapsulated-state 槽位——AC-921 判据 import
  注册表对象，不扫源码文本（GOAL-911）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-921
---
## Proposal

**事实（2026-10-22 立案当轮 import 实测，不是读代码推测）**：`CONCERN_KIND_REGISTRY`（`docs/analysis/ownership-active-limited-proposal.mjs:331`）当前只有 4 条，**没有任何一条**带 `admission`，且 `unencapsulated-state` **根本没有登记**。以 import 读对象得 `got={}`（五个 kind 全缺），逐字跑 AC-921 判据：

```
ADMISSION-WRONG bad=[["package-cycle","mechanical"],["design-evolution-regression","mechanical"],["god-file-size","semantic-judged"],["unencapsulated-state","semantic-judged"],["spine-without-extension-point","semantic-judged"]] invalid=["package-cycle","design-evolution-regression","spine-without-extension-point","god-file-size"] got={}
exit=1
```

**为什么要把判据换成「读对象」**：本文件的两条 mechanical kind 用模块常量登记（`kind: CONCERN_KIND_IN_SCOPE` / `kind: DESIGN_EVOLUTION_KIND`）。任何 `kind:\s*"…"` 的源码正则只能匹配带引号的字面量 ⇒ 一个**正确**的实现会被报成 `missing: [package-cycle, design-evolution-regression]`（假红）；反过来，注释里写一行 `kind: "package-cycle"` + `admission: "mechanical"` 就能让文本判据变绿（硬规则 2：按位置判定，注释不算命中）。AC-921 因此 import 模块对象来读注册表本身。⛔ 本条**不**重写、不退役 AC-918（退休/改写是人的决定），也**不**实现 Planner 的 admission 分派——那一半靠对象读不到，需要一条独立的行为判据，不在这里冒充。

**要做的（单模块 + 单测试文件）**：

1. 在 `CONCERN_KIND_STATES` 旁新增导出常量 `CONCERN_ADMISSIONS = Object.freeze({ MECHANICAL: "mechanical", SEMANTIC_JUDGED: "semantic-judged" })`，并在注册表段头注释补一段钉死两者分工：**admission 回答「确认靠谁」（机械可取假 vs 语义判断）**，**mechanized 回答「探测器/可计算 delta/负对照是否已落地」**——两者正交，⛔ 不合并、不互相推导。
2. 五个条目都加 `admission` 字段：
   - `package-cycle` / `design-evolution-regression` = `CONCERN_ADMISSIONS.MECHANICAL`；
   - `spine-without-extension-point` / `god-file-size` = `CONCERN_ADMISSIONS.SEMANTIC_JUDGED`；
   - **新增** `unencapsulated-state` 条目（同样 `Object.freeze`）：`admission: CONCERN_ADMISSIONS.SEMANTIC_JUDGED`、`mechanized: false`（线索器与判断器都未落地 ⇒ `concernKindState` 必须继续给 `NOT_YET_MECHANIZED`，⛔ **不要**给它 `mechanized:true`）、`deltaComputable: false`、`negativeControl: false`、`occurrenceThreshold: null`、`deltaCaliber: null`、`readDelta: null`、`fingerprintOf: null`；`detector` 写真实落点而非承诺：`"NOT LANDED — semantic-judged slot: the clue reader (plugin/scripts/unencapsulated-state-clue.ts) and the recorded-verdict judge are not landed yet; mechanical signals may only produce candidates, never a confirmation"`。
3. 新增导出校验器 `registryAdmissionViolations(registry = CONCERN_KIND_REGISTRY)`，返回 `{ evaluated: boolean, missing: string[], invalid: string[], cause: string|null }`：
   - 输入不是数组或为空 ⇒ `evaluated:false` + 非空 `cause`，⛔ 不与「零违例」同形（硬规则 3 / 3b）；
   - `admission` 缺失或不是字符串 ⇒ 该条 `kind` 进 `missing`；值不在 `Object.values(CONCERN_ADMISSIONS)` ⇒ 进 `invalid`；两者都**点名 kind**，⛔ 不返回裸 boolean，⛔ 不用「有问题」这种不带名字的结论。
   - 本条**不**把它接进 `evaluateEntryBar` / `concernKindState` 的判定路径——那是分派，属于 AC-918 expect 的另一半。
4. 在 `plugin/test/ownership-active-limited-proposal.test.mjs` 加 test 块，**import 注册表对象**断言：
   - 期望映射以**测试文件里的字面表**写死（`{ "package-cycle": "mechanical", ..., "spine-without-extension-point": "semantic-judged" }`），⛔ 不用模块内常量推导期望值——否则同一处改动能同时改绿两边（硬规则 4：结构上不可能取假的量不是测量）；
   - 真实 `CONCERN_KIND_REGISTRY` 过 `registryAdmissionViolations()` 得 `{evaluated:true, missing:[], invalid:[]}`；
   - 负臂：三个**合成**注册表分别（a）把一条 admission 改成对面取值、（b）删掉一条的 admission 字段、（c）塞一个 `"maybe"` 非法值，都必须 `evaluated:true` 且点出**那一条** kind。合成注册表是 import 路径上的对象，不是源码文本 ⇒ 证明判的是对象本身。
5. 现有断言必须继续绿：`CONCERN_KIND_REGISTRY.length >= 4`、`mechanized` 深等于 `["design-evolution-regression","package-cycle"]`（第 439 行）、`spine-without-extension-point` / `god-file-size` 的 detector 匹配、`AC5(registry)` 的 NOT_YET_MECHANIZED 分支。

⛔ **不要**为了让判据变绿把 `kind:` 改写成带引号字面量——那是 AC-918 旧判据的形状，且会把一条常量身份拆成两份副本。

<!-- dedup-ref -->**与同 goal 其它验收面的关系**：`tasks/gap-semantic-admission-contract-module.md`（`goal_ac: AC-919`）承载两段契约模块 `docs/analysis/semantic-admission-contract.mjs`（词表 / 记录 schema），本条不碰那个文件、也不要求它已经存在；AC-920 承载 `unencapsulated-state` 的线索器与判断器端到端管线，本条只为它**登记槽位**并在 `detector` 里写明 NOT LANDED。三条验收面独立（driver 的 goal-AC 核验读顶层 `goal_ac`），因此保持独立任务。

## AC

- [ ] AC-921 criterion 逐字执行 exit 0 且 stdout 含 `OK: 5 registered kinds carry the declared admission`：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-921 --json | jq -r .criterion > /tmp/ac921-criterion.sh && bash /tmp/ac921-criterion.sh`。
- [ ] 五条 kind 的 admission 由 **import 对象**读到且等于字面期望：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");const got=Object.fromEntries(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission]));const want={"package-cycle":"mechanical","design-evolution-regression":"mechanical","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged","spine-without-extension-point":"semantic-judged"};console.log(JSON.stringify(got),m.CONCERN_KIND_REGISTRY.length);process.exit(Object.keys(want).every(k=>got[k]===want[k])&&m.CONCERN_KIND_REGISTRY.length===5?0:1)'` exit 0。
- [ ] `unencapsulated-state` 是新登记条目且**未被**说成已机械化：同一条 import 断言 `e.mechanized===false && e.admission==="semantic-judged" && /NOT LANDED/.test(e.detector)` 且 `m.concernKindState("unencapsulated-state").state === m.CONCERN_KIND_STATES.NOT_YET_MECHANIZED`，全部成立时 exit 0。
- [ ] `registryAdmissionViolations` 能取假：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` exit 0，且新 test 块内三条合成注册表负臂（错值 / 缺字段 / 非法 token）各自 `evaluated:true` 并点名对应 kind，正向分支对真实注册表返回 `{evaluated:true,missing:[],invalid:[]}`。
- [ ] 反向臂在真树上实跑（先 `cp` 备份，⛔ 不用 `git checkout --`）：①把 `package-cycle` 的 admission 改成 `CONCERN_ADMISSIONS.SEMANTIC_JUDGED` ⇒ criterion exit 1 且 stderr 含 `package-cycle`；②删掉 `god-file-size` 的 admission 行 ⇒ criterion exit 1 且 `invalid` 数组含 `god-file-size`；③把 `spine-without-extension-point` 的 admission 改成 `"maybe"` ⇒ criterion exit 1 且点名该 kind。三次 `cp` 回拷后 criterion 复跑 exit 0。三次的 exit code 与 stderr 原文进收尾记录。

## DoD

- [ ] 在**任务 worktree 的树**上 import 注册表读对象：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");console.log(JSON.stringify(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission])))'` 输出含五个 kind→admission 对且条目数为 5；⛔ 用 `grep -c admission` 之类文本计数充当这条的替代不算。
- [ ] 同一读数在 fan-in 后的 develop 提交内容上复现一次（`git show develop:docs/analysis/ownership-active-limited-proposal.mjs` 落到临时文件后同样 import 读对象），两次读数一致——这是「字段真的进了权威基线」的直接量，不是工作树上的自证。
- [ ] criterion 在任务 worktree 的树上 exit 0，stdout 为 `OK: 5 registered kinds carry the declared admission`；实际命令与输出贴进收尾记录。
- [ ] `node --test plugin/test/ownership-active-limited-proposal.test.mjs` 在任务 worktree 的树上 exit 0，含新增的 admission test 块与三条负臂。
- [ ] 收尾记录含三次反向臂的实际 exit code、stderr 原文、以及回拷后 criterion 的 exit 0 输出——⛔「测试存在 / 字段写了」不算完成。
- [ ] 注册表段头注释已写明 admission 与 mechanized 的分工（谁回答「确认靠谁」、谁回答「仪器是否落地」），供后续 kind 登记时照抄。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-concern-kind-registry-admission-field.md
