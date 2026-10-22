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

- [x] AC-921 criterion 逐字执行 exit 0 且 stdout 含 `OK: 5 registered kinds carry the declared admission`：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-921 --json | jq -r .criterion > /tmp/ac921-criterion.sh && bash /tmp/ac921-criterion.sh`。
- [x] 五条 kind 的 admission 由 **import 对象**读到且等于字面期望：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");const got=Object.fromEntries(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission]));const want={"package-cycle":"mechanical","design-evolution-regression":"mechanical","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged","spine-without-extension-point":"semantic-judged"};console.log(JSON.stringify(got),m.CONCERN_KIND_REGISTRY.length);process.exit(Object.keys(want).every(k=>got[k]===want[k])&&m.CONCERN_KIND_REGISTRY.length===5?0:1)'` exit 0。
- [x] `unencapsulated-state` 是新登记条目且**未被**说成已机械化：同一条 import 断言 `e.mechanized===false && e.admission==="semantic-judged" && /NOT LANDED/.test(e.detector)` 且 `m.concernKindState("unencapsulated-state").state === m.CONCERN_KIND_STATES.NOT_YET_MECHANIZED`，全部成立时 exit 0。
- [x] `registryAdmissionViolations` 能取假：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` exit 0，且新 test 块内三条合成注册表负臂（错值 / 缺字段 / 非法 token）各自 `evaluated:true` 并点名对应 kind，正向分支对真实注册表返回 `{evaluated:true,missing:[],invalid:[]}`。
- [x] 反向臂在真树上实跑（先 `cp` 备份，⛔ 不用 `git checkout --`）：①把 `package-cycle` 的 admission 改成 `CONCERN_ADMISSIONS.SEMANTIC_JUDGED` ⇒ criterion exit 1 且 stderr 含 `package-cycle`；②删掉 `god-file-size` 的 admission 行 ⇒ criterion exit 1 且 `invalid` 数组含 `god-file-size`；③把 `spine-without-extension-point` 的 admission 改成 `"maybe"` ⇒ criterion exit 1 且点名该 kind。三次 `cp` 回拷后 criterion 复跑 exit 0。三次的 exit code 与 stderr 原文进收尾记录。

## DoD

- [x] 在**任务 worktree 的树**上 import 注册表读对象：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");console.log(JSON.stringify(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission])))'` 输出含五个 kind→admission 对且条目数为 5；⛔ 用 `grep -c admission` 之类文本计数充当这条的替代不算。
- [x] 同一读数在 fan-in 后的 develop 提交内容上复现一次（`git show develop:docs/analysis/ownership-active-limited-proposal.mjs` 落到临时文件后同样 import 读对象），两次读数一致——这是「字段真的进了权威基线」的直接量，不是工作树上的自证。
- [x] criterion 在任务 worktree 的树上 exit 0，stdout 为 `OK: 5 registered kinds carry the declared admission`；实际命令与输出贴进收尾记录。
- [x] `node --test plugin/test/ownership-active-limited-proposal.test.mjs` 在任务 worktree 的树上 exit 0，含新增的 admission test 块与三条负臂。
- [x] 收尾记录含三次反向臂的实际 exit code、stderr 原文、以及回拷后 criterion 的 exit 0 输出——⛔「测试存在 / 字段写了」不算完成。
- [x] 注册表段头注释已写明 admission 与 mechanized 的分工（谁回答「确认靠谁」、谁回答「仪器是否落地」），供后续 kind 登记时照抄。

## 收尾记录

实现提交：worktree `task/gap-concern-kind-registry-admission-field`（已 `git merge develop`，develop 是其祖先）。

- **AC1**（criterion 逐字，worktree 树）：`bash /tmp/ac921-criterion.sh` → stdout `OK: 5 registered kinds carry the declared admission`，**exit=0**。
- **AC2**（import 对象读五条 kind）：stdout `{"package-cycle":"mechanical","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged"} 5`，**exit=0**。
- **AC3**（`unencapsulated-state` 未机械化）：stdout `{"mechanized":false,"admission":"semantic-judged","state":"not-yet-mechanized"}`，**exit=0**。
- **AC4**：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` → `tests 34 / pass 34 / fail 0`，**exit=0**。新增 `AC921-1(admission)`（字面期望表）与 `AC921-2(admission)`（真实注册表零违例 + 三条合成注册表负臂 + 不可读注册表 `evaluated:false` 臂）。
- **AC5**（反向臂，真树实跑，先 `cp` 到 `/tmp/ac921-backup.mjs`，⛔ 未用 `git checkout --`）：
  - ① `package-cycle` → `CONCERN_ADMISSIONS.SEMANTIC_JUDGED`：**exit=1**，stderr 原文 `ADMISSION-WRONG bad=[["package-cycle","mechanical"]] invalid=[] got={"package-cycle":"semantic-judged","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged"}`
  - ② 删掉 `god-file-size` 的 admission 行：**exit=1**，stderr 原文 `ADMISSION-WRONG bad=[["god-file-size","semantic-judged"]] invalid=["god-file-size"] got={"package-cycle":"mechanical","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","unencapsulated-state":"semantic-judged"}`
  - ③ `spine-without-extension-point` → `"maybe"`：**exit=1**，stderr 原文 `ADMISSION-WRONG bad=[["spine-without-extension-point","semantic-judged"]] invalid=["spine-without-extension-point"] got={"package-cycle":"mechanical","design-evolution-regression":"mechanical","spine-without-extension-point":"maybe","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged"}`
  - 三次 `cp` 回拷后 criterion 复跑：**exit=0**，stdout `OK: 5 registered kinds carry the declared admission`，且落盘文件与备份逐字相同（`file-identical-to-backup=true`）。
- **DoD1**（worktree 树 import 读对象）：见 AC2 行，五个 kind→admission 对、条目数 5。
- **DoD2**（develop 侧复现）：退出前 develop 尚不含本次提交（fan-in 在本 worker 退出后才 ff）。已取等价直接量：`git show HEAD:docs/analysis/ownership-active-limited-proposal.mjs` 落临时文件后 import，读数与工作树读数 `diff` 无输出（逐字相同），而 develop 是 HEAD 的祖先 ⇒ ff-merge 后 develop 的该文件内容 = HEAD。落地后逐字复核命令：`git show develop:docs/analysis/ownership-active-limited-proposal.mjs > /tmp/x.mjs && node --input-type=module -e 'import("/tmp/x.mjs").then(m=>console.log(JSON.stringify(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission]))))'`。
- **DoD6**：注册表段头注释新增 `admission` 键说明，并新增一段「`admission` 与 `mechanized` 正交」——前者回答「确认靠谁」，后者回答「仪器是否落地」，并写明 `semantic-judged` kind 不会靠堆机械信号变成 mechanized。
- **范围**：未改任何 `kind:` 字面量（`CONCERN_KIND_IN_SCOPE` / `DESIGN_EVOLUTION_KIND` 常量身份保持），未把 `registryAdmissionViolations` 接进 `evaluateEntryBar` / `concernKindState`（分派属 AC-918 的另一半）。
- **一处规格张力的诚实落法**：`registryAdmissionViolations` 判的是**合法性**，负臂 (a)「改成对面取值」用的是另一个**合法** token，故校验器按设计不报违例；该臂由测试内字面期望表 `EXPECTED_ADMISSION` 的比较点名 `package-cycle`（测试注释写明两项检查的分工）。若要让校验器也判「取值对不对」，模块内就必须放第二份期望表——正是本条明令禁止的漂移，故不这么做。
- **门**：`bash scripts/test.sh --for-task gap-concern-kind-registry-admission-field --allow-thin` **exit=0**；`anti-drift-touches-check.ts` → `ANTI-DRIFT OK … all within declared Touches`。

## ADR-007 暗轴记录

- L_D code:doc: `git-lens-instrument.mjs ld --numstat-file <git diff --numstat develop...HEAD>` → docLines=0 codeLines=146 ratio=0.000 verdict=PASS
  （该读数是本条 **diff 范围**的读数，由仪器的 numstat 接口给出；不是全仓 L_D 比值。）
- L_G：该轴仍暗,理由:本条只给既有注册表条目加一个字段与一个测试文件，未新增任何模块/目录级依赖边，未对目录级 cycle 仪器取全仓读数

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-concern-kind-registry-admission-field.md