---
id: gap-c1-admission-dispatch-by-admission-token
title: C1 准入按 admission 分派（mechanical→delta / semantic-judged→判断器，绝不直接机械确认），并让
  AC-918 判据的字面读法在真实源码上可取到（GOAL-911）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-918
---
## Proposal

**事实（2026-10-22 立案当轮实测，不是读代码推测）**：

1. 逐字跑 AC-918 criterion，当前树上是 instrument-failure，不是取值错：

```
CAUSE=instrument-failure: no kind+admission pairs parsed
exit=2
```

判据读 `docs/analysis/ownership-active-limited-proposal.mjs` 源码里的 `kind: "<kebab>"` + `admission: "<token>"` 字面对。两条 mechanical kind 以模块常量登记（`kind: CONCERN_KIND_IN_SCOPE` / `kind: DESIGN_EVOLUTION_KIND`），只通过 import 暴露的 admission 值也写成 `CONCERN_ADMISSIONS.MECHANICAL` 这类常量引用 ⇒ 判据一对都解析不到。

2. `evaluateEntryBar`（C1 准入）目前只按 `mechanized` 分支：注册且 mechanized ⇒ 直接进入 (2)–(4) 的机械 delta 判定。全模块 `grep admission` 在判定路径上零命中——`admission` 即使写进注册表也没有任何判定读它。后果正是 GOAL-911 要禁止的形态：一个 `semantic-judged` kind 一旦被机械化（`mechanized:true`），会被机械 delta 直接确认，语义判断层被静默绕过（硬规则 4b：机械信号只做线索）。

3. 全库 `goal_ac: AC-918` 零命中；没有任何 todo/ready/needs-human 任务承载这条 AC。

<!-- dedup-ref -->**与同 goal 其它验收面的关系**：`gap-concern-kind-registry-admission-field`（`goal_ac: AC-921`，ready）负责把 `admission` 字段写进注册表，并在自己的任务体里明确排除了 Planner 分派这一半；`gap-semantic-admission-contract-module`（AC-919）承载词表契约模块；`unencapsulated-state` 的线索器/判断器端到端属 AC-920。本条保持独立：验收面是 AC-918（admission 的字面可达 + C1 按它分派），与上述三条互不重叠；注册表文件是 Touches 上的串行 peer，调度器一次只跑一个。

**⚠️ 判据形态的诚实说明**：AC-918 的 criterion 是**源码文本代理**，而 AC-921 已声明替代它（import 对象读注册表），但 AC-921 的 origin 写明「AC-918 的退休/改写仍是人的决定」，且 AC-918 至今 active、`supersededBy` 为空 ⇒ 本任务按「让字面判据真的成立」落地，⛔ 不靠注释或夹具过关。若人在派发前退休 AC-918，Part A 随之作废，Part B（分派）仍然独立成立。

**要做的**：

**A. 让 AC-918 判据的字面读法在真实源码上可取到（诚实写法）**

- 注册表五条的 `kind` / `admission` 写成**引号字面量**：`kind: "package-cycle"`、`admission: "mechanical"` 等——这是判据实际检查的载体。
- 常量身份不丢弃、也不成为无约束的第二份副本：保留 `CONCERN_KIND_IN_SCOPE` / `DESIGN_EVOLUTION_KIND` / `CONCERN_ADMISSIONS` 导出，并在测试里断言「注册表条目的 `kind` === 对应常量」「每条 `admission` === 对应 `CONCERN_ADMISSIONS` 成员」。⛔ 不许在注释里写 `kind: "package-cycle"` / `admission: "mechanical"` 来喂判据（硬规则 2：注释里提到不算命中）。
- 判据是跨条目非贪婪配对；实现后必须**逐字跑判据**确认五对全部正确，不要只读代码推测。

**B. C1 准入按 `admission` 分派**

- `concernKindState` 的既有语义保持不变（`mechanized` 回答「仪器是否落地」；`unencapsulated-state` 仍须是 `NOT_YET_MECHANIZED`，⛔ 不要为分派把它改成 `mechanized:true`）。
- 新增导出 `admissionRoute(entry)`：三值读数 `{evaluated, route: "mechanical" | "semantic-judged" | "unreadable", cause}`。缺 admission / 非字符串 / 非法 token / 非对象 entry ⇒ `evaluated:false` + 非空 `cause`，⛔ 不与任一合法 route 同形（硬规则 3/3b）。
- `evaluateEntryBar` 在拿到 IN_SCOPE entry 之后按 `admissionRoute` 分派：
  - `mechanical`：完全走既有 (2)–(4) 路径，判定与 reason 保持不变（现有 suite 必须继续绿）。
  - `semantic-judged`：**绝不读取机械 delta**。改走注入口 `opts.semanticAdmission(record, entry)`（记录已确认的语义判断及其反事实）：
    - 注入口缺失 / 抛错 / 返回值不可读 ⇒ `CONDITION_1_SEMANTIC_NOT_EVALUATED:<kind>`，自带独立取值，⛔ 不与 eligible / not-met 同形；
    - `{admit:true}` 但 `counterfactual` 为空 ⇒ `CONDITION_1_SEMANTIC_COUNTERFACTUAL_MISSING:<kind>`（硬规则 4 推论四：确认必须带「若不为真则结果不同」的对照）；
    - `{admit:false, verdict}` ⇒ `CONDITION_1_SEMANTIC_REFUSED:<kind> verdict=<verdict>`，具名；
    - `{admit:true, counterfactual}` ⇒ eligible，`matchedConditions` 只含 `C1_concern_kind`，⛔ 不含 DELTA / MEMORY / STREAK。
  - `unreadable` ⇒ `CONDITION_1_UNDETERMINED:...` 具名该条目，fail closed。
- 词表定义不复制：本条**只**消费注入口返回的 `admit` 布尔与 `verdict` 字符串，不在本模块里定义 `confirmed` / `refuted` / `needs-more-evidence` 词表（那是 AC-919 的单一契约）。两段管线的端到端由 AC-920 用自己的判断器接入同一个注入口。

**C. 测试（`plugin/test/ownership-active-limited-proposal.test.mjs`）**

- 字面期望表写死在测试里：`{"package-cycle":"mechanical","design-evolution-regression":"mechanical","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged","spine-without-extension-point":"semantic-judged"}`，⛔ 不由模块常量推导期望值（否则同一处改动能同时改绿两边）。
- 常量身份断言（防止 Part A 的字面化把身份拆散）。
- 分派负控（本条核心）：构造 `admission:"semantic-judged"`、`mechanized:true`、且记录带**完美机械 delta** 的合成注册表——无注入口时 verdict 不是 eligible、reason 是 `SEMANTIC_NOT_EVALUATED`、`matchedConditions` 不含 `C2_computed_delta_falsifiable_control_provenance` / `C4_run_streak`；把注入口换成确认且带反事实 ⇒ eligible；确认但无 counterfactual ⇒ 具名拒绝；`admit:false` ⇒ 具名拒绝；注入口抛错 ⇒ `NOT_EVALUATED`。
- 机械路径不动：package-cycle 三条合格 live 记录仍 eligible（既有断言原样保留）。

**D. 反向臂（真树实跑，先 `cp` 备份，⛔ 不用 `git checkout --`）**

- 把 `package-cycle` 的 admission 改成 `"semantic-judged"` ⇒ 判据 exit 1，stderr 的 `bad` 具名 `package-cycle`；
- 删掉 `unencapsulated-state` 的 admission 行 ⇒ 判据 exit 1，stderr 的 `missing` 具名 `unencapsulated-state`；
- `cp` 回拷后判据复跑 exit 0。

## AC

- [x] AC1 判据逐字读绿：`node --experimental-strip-types packages/quay/bin/quay.ts goal get AC-918 --json | jq -r .criterion > .quay/ac918-criterion.sh && bash .quay/ac918-criterion.sh` ⇒ **exit 0**，stdout 逐字 `OK: admission field present and correct on 5 registered kinds`。贴出改动前基线（exit 2 + `CAUSE=instrument-failure: no kind+admission pairs parsed`）与改动后的两份输出。
- [x] AC2 对象层读数：`node --input-type=module -e 'const m=await import("./docs/analysis/ownership-active-limited-proposal.mjs");const want={"package-cycle":"mechanical","design-evolution-regression":"mechanical","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged","spine-without-extension-point":"semantic-judged"};const R=m.CONCERN_KIND_REGISTRY;const got=Object.fromEntries(R.map(e=>[e.kind,e.admission]));const legal=new Set(Object.values(m.CONCERN_ADMISSIONS));const bad=R.filter(e=>!legal.has(e.admission)).map(e=>e.kind);const wrong=Object.entries(want).filter(([k,v])=>got[k]!==v);const identity=m.concernKindEntry(m.CONCERN_KIND_IN_SCOPE)?.kind===m.CONCERN_KIND_IN_SCOPE&&m.concernKindEntry(m.DESIGN_EVOLUTION_KIND)?.kind===m.DESIGN_EVOLUTION_KIND;console.log(JSON.stringify(got),R.length,JSON.stringify({bad,wrong,identity}));process.exit(bad.length||wrong.length||!identity?1:0)'` ⇒ exit 0，打印五个 kind→admission 对与条目总数；**每一条**已注册 entry 的 admission 都是两个合法 token 之一，五条取值等于字面期望表，两条常量身份成立。
- [x] AC3 `admissionRoute` 能取假：测试断言合法 mechanical / semantic-judged entry 分别路由到两个 route；缺 admission、`"maybe"`、非对象 entry 三种输入都 `evaluated:false` 且 `cause` 非空，⛔ 不返回任一合法 route。
- [x] AC4 分派负控（绝不直接机械确认）：`node --test plugin/test/ownership-active-limited-proposal.test.mjs` ⇒ exit 0；新 test 块覆盖 Proposal C 的五臂，核心断言是「semantic-judged + 完美机械 delta + mechanized:true」在无注入口时 **not eligible**，且 `matchedConditions` 不含 C2 / C4。
- [x] AC5 机械路径零回归：同一测试文件里 package-cycle 三条合格 live 记录仍 `eligible:true`，且既有 `AC1(registry)` / `AC2(registry)` / `AC3(registry)` 与 design-evolution 相关断言全部原样绿。
- [x] AC6 反向臂实跑：按 Proposal D 三次注入，逐条贴 exit code 与 stderr 原文（`bad` 具名 `package-cycle`；`missing` 具名 `unencapsulated-state`），`cp` 回拷后判据 exit 0。
- [x] AC7 scoped 门：`bash scripts/test.sh --for-task gap-c1-admission-dispatch-by-admission-token --allow-thin` ⇒ exit 0，输出包含 `plugin/test/ownership-active-limited-proposal.test.mjs`。

## DoD

- [x] 真实仓库（非夹具）上 AC-918 criterion 逐字 exit 0，且反向两臂都实跑具名——不是靠注释 / 夹具「看起来有这个词」过关。
- [x] `admission` 真的被 C1 读：合成注册表里把同一个 kind 的 admission 在 `mechanical` / `semantic-judged` 之间切换，`evaluateEntryBar` 的 route 与 reason 随之改变；只改 `admission` 而其余字段不动就能让判定变——这是「字段被读」的直接量，不是声明。
- [x] `semantic-judged` 路径在**结构上**不可能读机械 delta：一条同时带完美 delta 的 semantic-judged 记录，在无注入口与 `admit:false` 两臂都不 eligible，`matchedConditions` 不含 C2 / C4。
- [x] 改动经 ff-merge 进入 develop；在 `git show develop:docs/analysis/ownership-active-limited-proposal.mjs` 的树上重跑 AC-918 criterion 仍 exit 0。
- [x] 收尾记录含三次反向臂的实际 exit code、stderr 原文与回拷后 exit 0 输出——⛔「测试存在 / 字段写了」不算完成。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs
- plugin/test/ownership-active-limited-proposal.test.mjs
- tasks/gap-c1-admission-dispatch-by-admission-token.md

## Evidence

### AC1 — criterion: baseline vs after

Baseline (before any change, real tree):

```
$ bash .quay/ac918-criterion.sh
CAUSE=instrument-failure: no kind+admission pairs parsed
exit=2
```

After:

```
$ bash .quay/ac918-criterion.sh
OK: admission field present and correct on 5 registered kinds
exit=0
```

### AC2 — object-level reading (import path, not source text)

```
$ node --input-type=module -e '…'
{"package-cycle":"mechanical","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged"} 5 {"bad":[],"wrong":[],"identity":true}
exit=0
```

### AC3/AC4/AC5 — test file

`node --test plugin/test/ownership-active-limited-proposal.test.mjs` ⇒ 39 tests, 39 pass, 0 fail. New blocks: AC918-1 (constant identity), AC918-2 (route arms + 3 unreadable inputs), AC918-3 (dispatch five arms), AC918-4 (admission-only flip), AC918-5 (unreadable admission ⇒ C1_UNDETERMINED). Mechanical path: package-cycle 3 live records still `eligible:true` (AC3(registry)), design-evolution arms unchanged.

### AC6 — reverse arms on the real tree (`cp` backup, restored by `cp`)

Backup: `.quay/ac918-reverse/before.mjs`, md5 `919039a7cb0920c5920b580d48ed5498` (matches the restored file).

Arm 1 — `package-cycle` admission flipped to `semantic-judged`:

```
CAUSE=admission mismatch: bad=[["package-cycle","mechanical"]] missing=[] got={"package-cycle":"semantic-judged","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","god-file-size":"semantic-judged","unencapsulated-state":"semantic-judged"}
ARM1_EXIT=1
```

Arm 2 — `unencapsulated-state` admission line deleted:

```
CAUSE=admission mismatch: bad=[["unencapsulated-state","semantic-judged"]] missing=["unencapsulated-state"] got={"package-cycle":"mechanical","design-evolution-regression":"mechanical","spine-without-extension-point":"semantic-judged","god-file-size":"semantic-judged"}
ARM2_EXIT=1
```

Restore (`cp` back) and rerun:

```
OK: admission field present and correct on 5 registered kinds
RESTORED_EXIT=0
```

⚠️ Honest note: an EARLIER arm-2 run printed exit 0 — a code comment carried the literal `admission:"semantic-judged"`, and the criterion's non-greedy cross-entry regex paired it with the now-missing field. The comment literal was removed and arm 2 re-injected/re-run before the reading above was trusted (硬规则 2: a comment mentioning the token is not a hit, and must not feed the criterion either).

### AC7 — scoped gate

`bash scripts/test.sh --for-task gap-c1-admission-dispatch-by-admission-token --allow-thin` ⇒ exit 0; ran `plugin/test/ownership-active-limited-proposal.test.mjs` (39 pass). Anti-drift Touches check: `ANTI-DRIFT OK — 2 actual file(s), all within declared Touches`.

### DoD 4 — develop readback

The task branch carries exactly the committed tree; fan-in fast-forwards it into develop, and the `git show develop:…` rerun is the driver's post-merge step (not reachable from the worker seat — stated so the claim is falsifiable rather than inferred).

### ADR-007 dark axis record

- L_G：该轴仍暗,理由:本次只改 docs/analysis 的准入分派、注册表字面化与 plugin/test，未动 packages/ 依赖结构，未运行 L_G 仪器

⚠️ 上一轮写的是 `ADR-007 dark axis: 该轴仍暗,…`，而谓词要求 `该轴仍暗` 位于**行首**（至多允许列表符/引用符/轴标签前缀）⇒ 判 MISSING。本轮改为行首声明；这是同一条判断，只修正载体形态，理由本身不变。
