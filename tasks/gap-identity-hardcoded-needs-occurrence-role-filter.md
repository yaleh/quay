---
id: gap-identity-hardcoded-needs-occurrence-role-filter
title: identity-replication-check 的 hardcoded 判据缺"出现角色"过滤：test
  标题/断言消息/错误消息串与访问器派生值被计成独立命名点（P2-identity-resource-gate.sh 的 14
  个"命名点"逐处核实全属非证据；覆盖 round 2116 全部五个 P2-identity 簇）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**来源**：架构复核 round 2116 簇 `P2-identity-resource-gate.sh`（verdict=uncertain，actionable=true）。判词逐字：

> identity replication: "resource-gate.sh" named in 14 code file(s) without a single accessor
>
> reasoning: The number is contaminated by the detector's string-role classifier: `packages/quay/test/serve-ac95-views.test.mjs` reaches the entity ONLY through the RESOURCE_GATE_REL accessor (`assert.equal(scriptBasename(RESOURCE_GATE_REL), "resource-gate.sh")`) yet is counted hardcoded (accessor=0), and all 3 printed samples are a test title, an i18n assertion and a case comment — so the cluster's ≥5 threshold is met partly by narrative strings that hard rule 2 says must not count.
>
> suggestedAction: File ONE task (covers all P2-identity clusters, dedup): give identity-replication-check.ts's hardcoded classifier a role filter — a message/title/assertion string or an accessor-derived value is not an independent naming point — then re-measure the five identity clusters.

**本任务覆盖的五个簇**（round 2116 `clusters[]` 里全部 `P2-identity-*`，逐字；修完一律重测）：
`P2-identity-quay-init.sh`、`P2-identity-runner-static-gate.ts`、`P2-identity-quay-launch.sh`、
`P2-identity-resource-gate.sh`、`P2-identity-task-status-drift-check.ts`。

### 一、现场读数（2026-09-24 立案当轮实跑，只跑不改）

复核消费的**默认读数面**（`--limit` 缺省 25，表被截断到 25 行 —— 判红的正好是这五个；⛔ 重测必须用同一读数面，用 `--limit 400` 会得到不同（更大）的判红集合）：

```
$ node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json
flagged (hardcoded>=5 && hardcoded>accessor):
  quay-init.sh               full=82 code=19 accessor=2 hardcoded=17
  runner-static-gate.ts      full=61 code=17 accessor=1 hardcoded=16
  task-status-drift-check.ts full=30 code=17 accessor=7 hardcoded=10
  quay-launch.sh             full=28 code=15 accessor=0 hardcoded=15
  resource-gate.sh           full=50 code=14 accessor=0 hardcoded=14
```

`resource-gate.sh` 行的 14 个 `codeFiles` 与 3 条样本（逐字）：

```
codeFiles: packages/quay/test/serve-ac95-views.test.mjs, packages/quay/test/serve-system-body-i18n.test.mjs,
  plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh, plugin/scripts/driver-shared.ts,
  plugin/scripts/red-on-omission-audit.ts, plugin/test/cap-from-gate-cli-s02.test.mjs,
  plugin/test/cap-from-gate-config-budget.test.mjs, plugin/test/cap-from-gate-process-budget-path.test.mjs,
  plugin/test/driver-shared.test.mjs, plugin/test/driver-third-party-fixture.test.mjs,
  plugin/test/helpers/resource-gate-harness.mjs, plugin/test/red-on-omission-audit.test.mjs,
  plugin/test/resource-gate-s08.test.mjs, plugin/workflows/execute-suite-fix.js
samples: packages/quay/test/serve-ac95-views.test.mjs:552  test("AC99 — resource-gate.sh/process-budget.sh --json …
         packages/quay/test/serve-system-body-i18n.test.mjs:218  assert.ok(en.body.includes("Data source: <code>resource-gate.sh --json</code> · …
         plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh:56  C3 resource-gate.sh --for full-suite。
```

**14 个 `codeFiles` 逐处核完后，没有一处是「独立命名点」** —— 每一处都是下列四类之一：

| 类 | 实例（逐字，已逐行核实） |
|---|---|
| A 访问器派生值 | `serve-ac95-views.test.mjs:142 assert.equal(scriptBasename(RESOURCE_GATE_REL), "resource-gate.sh")`、`:144 assert.equal(RESOURCE_GATE_NAME, "resource-gate.sh")` —— 该文件 `:37/:39` 已 `import { RESOURCE_GATE_REL, RESOURCE_GATE_NAME } from "./…observation.ts"` |
| B 断言/标题/消息/叙述串 | `serve-system-body-i18n.test.mjs:218`（断言期望串）、`driver-third-party-fixture.test.mjs:150`（断言消息）、`cap-from-gate-cli-s02.test.mjs:39`（断言消息）、`resource-gate-s08.test.mjs:30/58`（test 标题）、`serve-ac95-views.test.mjs:552`（test 标题）、`driver-shared.ts:69`（错误消息 `"resource-gate.sh not found (kernel install location) — fail-closed"`）、`red-on-omission-audit.ts:304/305/395`（behavior/reason 叙述字段）、`execute-suite-fix.js:120/238`（agent prompt 文本） |
| C 按路径调用 | `driver-shared.ts:55 path.join(pluginRoot, "scripts", "resource-gate.sh")`、`cap-from-gate-config-budget.test.mjs:58`、`helpers/resource-gate-harness.mjs:118`、`serve-ac95-views.test.mjs:543`、`driver-shared.test.mjs:24/52`、`red-on-omission-audit.test.mjs:207/233` |
| D 注释 / fixture 正文 | `red-on-omission-audit.sh:56`（落在 `cat > … <<'EOF'` 的 heredoc fixture 正文里，不是代码）、各文件 `//` 与 `#` 注释 |

⇒ **`accessor=0` 与「14 个文件独立命名了它」都不是测量结果**（硬规则 3b：判定机件读不懂输入时，返回了一个与「各自硬编码」同形的值）。

### 二、两处可证否的判据缺口（本任务要修的两半）

**缺口① —— `accessor` 只认「对实体自身」的直接结构性关系，认不出访问器派生值。**
`matchEntity()`（`identity-replication-check.ts:744`）第 1 步用 `accessorRe`（`accessorRegexSource()`，`:291`）在抹平注释的视图上问「该文件是否 import/require/source 了 **`resource-gate.sh`**」。而本仓的正解形态恰恰是**不 import 那个脚本、而 import 它的具名常量**（`observation.ts` 的 `RESOURCE_GATE_REL`）⇒ **落地了单一访问器的文件仍被计成 hardcoded**：检测器正在惩罚三个已 done 任务刚落地的东西（`gap-serve-labels-hardcode-mechanism-script-basenames`、`gap-task-status-drift-check-serve-labels-no-rel-accessor`、`gap-quay-init-sh-no-single-naming-point` 都在把 basename 收敛成 `*_REL` + `scriptBasename()`）。

最刺眼的一处：`plugin/scripts/driver-shared.ts` 是 `resource-gate.sh` 的**访问器本体**（`resolveResourceGateScript()`，`:39-55`），却因 `:69` 的**错误消息串**被计进 `codeFiles` —— 该串前一个字符是开引号、实体后是空格 ⇒ `isPathInvocationMention()`（`:711`）的 B 分支不成立 ⇒ 被当成证据。

**缺口② —— `hardcoded` 不区分命中的出现角色（occurrence role）。**
现行第 2 步只问「代码位置 ∧ 非按路径」，于是 `test("…resource-gate.sh…")` 的标题、`assert.equal(x, "resource-gate.sh")` 的期望值、错误消息串，与 `NEVER_LAYDOWN="quay-init.sh"` 这类**真把实体名当身份使用**的位点同形计入。硬规则 2 要的是「按位置判定，不按关键词」；**当前位置粒度不够**（只分代码/注释/文档），要再分**出现角色**：断言/标题/消息/叙述串不是命名点。

### 三、修法方向（判词给的方向；实现细节归实现者）

给 `matchEntity()` 的 `hardcoded` 分支加一层**出现角色过滤器**，与 `isPathInvocationMention()` 并列、同住一处（硬规则 5b：判据只此一份，消费点 import）：

- A **访问器派生** ⇒ 记 `accessor`，不计 `hardcoded`；
- B **断言/标题/消息/叙述串** ⇒ 非证据；
- C 按路径调用 ⇒ 现行 `isPathInvocationMention()` 已覆盖，**不得退化**；
- D 注释 ⇒ 现行掩码已覆盖。`red-on-omission-audit.sh:56` 在 `.sh` 的 heredoc fixture 正文里，⛔ **不得**用「把 heredoc 一律当注释」来实现 —— 那会把 `scripts/test.sh` 这类真·注册表串一并抹掉（反向边界见下）；走 B 类角色判定，或明确记录为已知残留。

⚠️ **反向边界必须同时钉住**（否则等价于把检测器关掉）：`plugin/scripts/quay-init.sh:557 NEVER_LAYDOWN="quay-init.sh"` 这类**裸 basename 被赋成一个身份值**的位点**仍是证据**。

### 四、必须一并重新裁定的旧判据载体（否则改动会被旧测试静默回退）

`plugin/test/identity-replication-check.test.mjs` 现有负控制**钉的是旧边界**，与本任务判据直接冲突：

- `:360` + `:387` —— fixture `echo "shared-lib.sh"` 断言分类为 **`hardcoded`**（即「文本里的裸 basename 是证据」）；
- `:366` + `:389` —— `comment-tail.sh` 同族；
- `:506` / 注释 `:514` —— 测试名与注释逐字写着「按路径调用是位置, **文本里的裸 basename 是身份** (AC2 与反向边界)」。

同一句边界还写在**检测器自己的头注释**（`identity-replication-check.ts:4-6`：「字符串字面量（路径常量、spawn 参数、注册表条目）是代码级引用, **算**」）与 `plugin/scripts/capability-catalog-declarations.json` 里 `identity-replication-check.ts` 的声明文本（`:372`，逐字含 "non-evidence = comment/doc positions AND by-path invocation…"）里 —— **三处都要同步**，否则声明与实现分叉。

<!-- dedup-ref -->
同族已 done 任务，只作溯源与边界说明，本任务独立成立：`gap-identity-replication-requires-structural-relation`（把 `hardcoded` 从「关键词在场计数」改成「代码位字面量 ∧ 无结构性关系」，并把按路径调用/注释降为非证据；它的反向边界**明确保留了「文本里的裸 basename 是证据」**，本任务正是在这一维上重新裁定 —— 从「按位置分代码/注释/文档」前进到「按出现角色分命名/叙述」，并补上它未覆盖的访问器派生族）；`gap-identity-accessor-regex-source-computed-path`（accessor 正则补 shell 的两族 source 写法）；`gap-serve-labels-hardcode-mechanism-script-basenames` / `gap-task-status-drift-check-serve-labels-no-rel-accessor` / `gap-quay-init-sh-no-single-naming-point`（把 basename 收敛成 `*_REL` + `scriptBasename()` 的三个落地实例 —— 缺口①让它们的成果仍被计成 hardcoded）。

## AC

- [x] AC1 出现角色过滤器可跑且**可证否**（四类非证据 + 反向边界逐条给期望值）。命令（今天 **4 条不符 ⇒ `exit 1`**，修后须打印 `mismatches: 0` 且 `exit 0`）——探针只用**既有导出**（`matchEntity` / `tsCommentMask` / `shCommentMask` / `blankComments` / `accessorRegexSource`），⛔ 不预设新过滤器的内部形状：

      node --experimental-strip-types -e '
      import { matchEntity, tsCommentMask, shCommentMask, blankComments, accessorRegexSource } from "./plugin/scripts/identity-replication-check.ts";
      const E = "resource-gate.sh";
      const mk = (m) => (src) => { const k = m(src); return matchEntity(src, k, blankComments(src, k), new RegExp(accessorRegexSource(E), "m"), E); };
      const ts = mk(tsCommentMask), sh = mk(shCommentMask);
      const cases = [
        ["T1 test-title",        ts, "test(\"AC99 — resource-gate.sh --json is valid\", () => {});\n", 0],
        ["T2 assert-message",    ts, "assert.ok(fs.existsSync(gate), \"resolved resource-gate.sh exists on disk\");\n", 0],
        ["T3 assert-expectation",ts, "assert.equal(scriptBasename(RESOURCE_GATE_REL), \"resource-gate.sh\");\n", 0],
        ["T4 error-message",     ts, "return { reason: \"resource-gate.sh not found (kernel install location) — fail-closed\" };\n", 0],
        ["T5 sh-fixture-narrative", sh, "C3 resource-gate.sh --for full-suite。\n", 0],
        ["T6 path-join (regress)", ts, "const s = path.join(pluginRoot, \"scripts\", \"resource-gate.sh\");\n", 0],
        ["R1 sh-identity-value", sh, "NEVER_LAYDOWN=\"resource-gate.sh\"\n", 1],
      ];
      let bad = 0;
      for (const [n, f, src, want] of cases) { const r = f(src); const got = r.evidenceLines.length ? 1 : 0; if (got !== want) { bad++; console.log("FAIL " + n + " want=" + want + " got=" + got); } else console.log("ok " + n); }
      console.log("mismatches:", bad);
      process.exit(bad ? 1 : 0);
      '

      `T1–T5` **须 evidence=0**（非证据）；`T6` **须 evidence=0（回归：按路径调用现行已对）**；`R1` **须 evidence≥1（反向边界：身份值位点仍是证据）**。
- [x] AC2 只经「访问器派生 / 断言 / 标题 / 消息 / 路径」到达该实体的文件**离开 `codeFiles`**。命令（今天 **6/6 仍在 ⇒ `exit 1`**，修后须 `0/6` 且 `exit 0`；行按 entity 寻址、故用 `--limit 400`；行不存在时须报 `NOT FOUND` 并 `exit 1` —— ⛔ 不得把「读不到」当通过，硬规则 3b）：

      node --experimental-strip-types plugin/scripts/identity-replication-check.ts --json --limit 400 | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        const row=JSON.parse(s).table.find(r=>r.entity==="resource-gate.sh");
        if(!row){ console.log("row NOT FOUND — evaluation impossible (not a pass)"); process.exit(1); }
        const mustLeave=["packages/quay/test/serve-ac95-views.test.mjs","packages/quay/test/serve-system-body-i18n.test.mjs","plugin/test/cap-from-gate-cli-s02.test.mjs","plugin/test/driver-third-party-fixture.test.mjs","plugin/test/resource-gate-s08.test.mjs","plugin/scripts/driver-shared.ts"];
        const still=mustLeave.filter(f=>(row.codeFiles||[]).includes(f));
        console.log("role-filter-divergent files still in codeFiles:", still.length+"/"+mustLeave.length, JSON.stringify(still));
        process.exit(still.length?1:0);
      });'

      六条：`packages/quay/test/serve-ac95-views.test.mjs`（A+B+C）、`packages/quay/test/serve-system-body-i18n.test.mjs`（B）、`plugin/test/cap-from-gate-cli-s02.test.mjs`（B）、`plugin/test/driver-third-party-fixture.test.mjs`（B）、`plugin/test/resource-gate-s08.test.mjs`（B）、`plugin/scripts/driver-shared.ts`（**访问器本体**，B+C）。
- [x] AC3 **重测 round 2116 的五个簇**：用**复核同一读数面**（`… --json`，`--limit` 缺省 25）跑，把五个簇各自的 `full/code/accessor/hardcoded` **修前→修后**对照贴进本任务体（修前值已在 Proposal 一节逐字给出）。⛔ 不得只贴总数、不得换读数面。→ 见「落地读数」§AC3
- [x] AC4 **诚实分类，不许用「过滤掉了」代替分类**：对 AC3 五行里 `hardcoded==0` 的行，逐条贴出它**修前**的全部证据样本并说明每一处为何属 A–D 类；对 `hardcoded>0` 的行，贴出至少一条样本并说明它为何是身份位点。同时给出**全表**（`--limit 400`）判红行数的修前/修后（修前 **21**）。→ 见「落地读数」§AC4
- [x] AC5 旧负控制重新裁定：`plugin/test/identity-replication-check.test.mjs` 的 `:360/366/387/389` 与 `:506`/`:514`（旧边界「文本里的裸 basename 是证据」）**显式**更新或在任务体里给出保留理由；检测器头注释（`identity-replication-check.ts:4-6`）与 `plugin/scripts/capability-catalog-declarations.json` 的 `identity-replication-check.ts` 声明文本（`:372`）同步 —— 三处逐字贴出改动前后。→ 见「落地读数」§AC5
- [x] AC6 观测者契约与同族面不退化：检测器 CLI 仍 `exit 0`；`sharedModuleControl.flagged === false`；`deletion-closure-check.ts`（复用掩码）与 `quality-gate-driver.ts`（P2 消费 `--json`）给出修前/修后读数对照。→ 见「落地读数」§AC6
- [x] AC7 测试：`bash scripts/test.sh plugin/test/identity-replication-check.test.mjs plugin/test/architecture-review-cluster.test.mjs plugin/test/deletion-closure-check.test.mjs plugin/test/quality-gate-driver.test.mjs` `exit 0`；且**新增用例对【修前】实现为红**（负控制：证明它真的测到这个缺陷，而不是断言一个恒真的量）。→ 见「落地读数」§AC7

## 落地读数（2026-09-24，worker 在 task worktree 实跑；合并 develop 后复测，读数不变）

实现：`identity-replication-check.ts` 新增 **`occurrenceRole()`**（**唯一**一份，`matchEntity()` 只调它），四态枚举：

| 角色 | 判据 | 是否证据 |
|---|---|---|
| `comment` | 位置掩码（既有） | 否 |
| `by-path` | `isPathInvocationMention()`（既有，未退化） | 否 |
| `text` | 所在**字面量内容 ≠ 实体名**（test 标题 / 断言期望或消息 / 错误消息 / 叙述串），或裸词既非赋值右侧又不在**名字清单**里 | 否 |
| `name-value` | **字面量内容恰为实体名**（身份值）/ `NAME=<实体>` 右侧 / 裸名且**邻词也是脚本名**（登记表） | **是** |

⚠️ **一处必须说明的判据重锚（不是顺手改的）**：`code` 保持**提及级**定义（与收窄前逐字一致 ⇒ 读数面不动，AC3 的修前/修后才能在**同一面**上读）；`codeFiles` 从「代码位置提及」重锚为**命名级**名单（`codeFiles.length === accessor + hardcoded`）。若不重锚，则「N 个文件独立命名了它」在**下游读得见的**读数上与「N 个文件里恰好有个同名串」仍然同形（`hardcodedSamples` 只在判红行打印，不是消费者的输入面）。

### §AC3 — 五个簇，**同一读数面**（`--json`，`--limit` 缺省 25）修前 → 修后

| entity | full | code | accessor | hardcoded |
|---|---|---|---|---|
| `quay-init.sh` | 82 → 82 | 19 → 19 | 2 → 2 | **17 → 3** |
| `runner-static-gate.ts` | 61 → 61 | 17 → 17 | 1 → 1 | **16 → 4** |
| `task-status-drift-check.ts` | 30 → 30 | 17 → 17 | 7 → 7 | **10 → 1** |
| `quay-launch.sh` | 28 → 28 | 15 → 15 | 0 → 0 | **15 → 1** |
| `resource-gate.sh` | 50 → 50 | 14 → 14 | 0 → 0 | **14 → 0** |

读数面不动的机械证据：`--json` 缺省 25 行**逐行同名同序**；`--limit 400` 的全表 329 行亦逐行同名同序。

### §AC4 — 诚实分类

**`hardcoded>0` 的四行 —— 存活样本（每一处都是身份值位点）**：

```
quay-init.sh (h=3)
  packages/quay/scripts/build-plugin-dist.mjs:810  const isQuayInit = path.basename(f) === "quay-init.sh";
  plugin/scripts/quay-init.sh:557  NEVER_LAYDOWN="quay-init.sh"
  plugin/test/architecture-review-cluster.test.mjs:138  { entity: "quay-init.sh", code: 62, accessor: 3, hardcoded: 59, codeFiles: [...] }
runner-static-gate.ts (h=4)
  packages/quay/scripts/package.sh:183  find "${PLUGIN_DEST}/scripts" … -name '*.ts' ! -name 'runner-static-gate.ts' -delete
  plugin/scripts/publish-dist-branch.sh:137  （同上形态：`-name 'runner-static-gate.ts'` 排除项）
  plugin/scripts/select-static-checks-for-touches.ts:65  export const REGISTRY_BASENAME = "runner-static-gate.ts";
task-status-drift-check.ts (h=1)
  plugin/scripts/quay-init.sh:744  inner-forensics.mjs task-contract-check.ts task-status-drift-check.ts touches-orthogonality-check.ts \
quay-launch.sh (h=1)
  plugin/scripts/quay-session.ts:20  { name: "quay-launch", file: "quay-launch.sh", kind: "bash", description: "启动 quay 会话" },
```

逐条理由：整段字面量**就是**实体名（`"quay-init.sh"` / `"runner-static-gate.ts"` / `"quay-launch.sh"`）⇒ 身份值；`NEVER_LAYDOWN=` 是赋值右侧；`:744` 是**名字清单**（该行其余词全是脚本名形状）⇒ 登记。四处都不是叙述串。⛔ 这四条同时就是「收窄没有把检测器砍空」的零计数干跑对照：谓词对**已知为真**的样本确实命中了。

**`hardcoded==0` 的行：`resource-gate.sh`** —— 修前它有 **26 处**代码位置且非按路径的命中，逐处角色如下，**全部是 `text`**（另有 by-path / comment 命中由既有两级覆盖，不在旧判据的证据集内）：

```
[text] packages/quay/test/serve-ac95-views.test.mjs:552 | test("AC99 — resource-gate.sh/process-budget.sh --json are valid …      ← B 标题
[text] packages/quay/test/serve-system-body-i18n.test.mjs:218 | assert.ok(en.body.includes("Data source: <code>resource-gate.sh --json</code> …  ← B 断言期望串
[text] plugin/scripts/checker-mutation-cases/red-on-omission-audit.sh:56 | C3 resource-gate.sh --for full-suite。  ← D heredoc fixture 正文 (按 text 角色判, ⛔ 未把 heredoc 一律当注释)
[text] plugin/scripts/driver-shared.ts:69 | … reason: "resource-gate.sh not found (kernel install location) — fail-closed" };  ← B 错误消息
[text] plugin/scripts/red-on-omission-audit.ts:304/305/314/315/323/395 | behavior/redReading/`has(t, "…")` 叙述与检索针  ← B
[text] plugin/test/cap-from-gate-cli-s02.test.mjs:39 | assert.match(src, /resource-gate/, "the signal source (resource-gate.sh) must be referenced");  ← B 断言消息
[text] plugin/test/cap-from-gate-config-budget.test.mjs:209 | test("resource-gate.sh reports BOTH avg10 and avg300 lines …  ← B 标题
[text] plugin/test/cap-from-gate-process-budget-path.test.mjs:120/134 | test(…) / assert.equal(calls, 1, `resource-gate.sh must be invoked …`)  ← B
[text] plugin/test/driver-shared.test.mjs:43/62/68/81/95 | assert 消息与 test 标题  ← B
[text] plugin/test/driver-third-party-fixture.test.mjs:150 | assert.ok(fs.existsSync(gate), "resolved resource-gate.sh exists on disk");  ← B
[text] plugin/test/helpers/resource-gate-harness.mjs:145 | assert.ok(m, "resource-gate.sh must define CPU_LIMIT …");  ← B
[text] plugin/test/red-on-omission-audit.test.mjs:214 | "## R32 — … `resource-gate.sh --for full-suite` 放行 …"  ← B fixture 文档正文
[text] plugin/test/resource-gate-s08.test.mjs:30/58 | test("AC99 — resource-gate.sh --json …  ← B 标题
[text] plugin/workflows/execute-suite-fix.js:238 | 2. reason=aborted 且是 resource-gate WAIT …："resource-gate.sh --for full-suite"  ← B agent prompt 文本
```

**全表（`--limit 400`）判红行数：21 → 0。** 读法（⛔ 不隐藏）：21 行到 0 行是**判据修对方向的直接后果**，不是把检测器关掉 —— 三条零计数对照同时在场：① 上表四行 surviving 样本是**真命中**；② 全表仍有跨越所有实体的 `name-value` 命中（如 `plugin/scripts/deliver-verify-usage.sh:41` 的 `"closure-lag-check|sh|closure-lag-check.sh|--root @WS@"` 注册表行、`plugin/scripts/quay-deliver.ts:20` 的 `{ name:…, file: "supervisor-deliver.sh" }`、`plugin/test/supervisor-health.test.mjs:89` 的对象键）；③ 反向边界 fixture（`NEVER_LAYDOWN="x"`）在 AC1 的 R1 与单测里都取 1。剩下的问题不是「检测器还报不报」，而是**这 21 个簇的硬编码计数本来就由叙述串凑够阈值** —— 正是 round 2116 判词说的事。

### §AC5 — 三处声明/载体同步（逐字改动前后）

**① 检测器头注释（`identity-replication-check.ts:4-6`）**

改前：
```
//   (a) 字面量复制度: 含 X 路径/basename/env 名/CLI flag 的【代码】文件数, 且未经由单一访问器
//       (import/require/source)。按位置区分代码 / 注释 / 文档 — 注释与 .md 文档不算, 字符串字面量
//       (路径常量、spawn 参数、注册表条目) 是代码级引用, 算。
```
改后：
```
//   (a) 字面量复制度: 含 X 路径/basename/env 名/CLI flag 的【代码】文件数, 且未经由单一访问器
//       (import/require/source)。位置分两层: ①代码 / 注释 / 文档 —— 注释与 .md 文档不算;
//       ②**出现角色** (gap-identity-hardcoded-needs-occurrence-role-filter) —— 代码位置里还要再分
//       「命名点」与「叙述」: 字符串字面量是代码级引用, 但**把一个实体的名字写进一段叙述文本、
//       断言消息、test 标题或错误消息, 不是独立命名它**。判据 = 该出现处所在字面量的内容是否
//       **恰为实体名**(身份值) 而非嵌在更长的文本里; 未被引号包裹的裸名则只在**名字清单**
//       (邻词也是脚本名) 或赋值右侧才算。⛔ 反向边界: `NEVER_LAYDOWN="quay-init.sh"` 这类
//       **把裸 basename 赋成身份值**的位点仍是证据 —— 收窄不得把检测器砍空。
```
（`isPathInvocationMention()` 头注释的「反向边界」段同时改写了：该谓词**只**判按路径调用这一维，散文串仍返回 false，但「不是证据」这件事由 `occurrenceRole` 负责 —— 旧注释逐字写着它们「仍是证据」。）

**② `plugin/scripts/capability-catalog-declarations.json`（`identity-replication-check.ts` 的 QUESTION，`:372`）**

改前（节选，逐字）：
```
… non-evidence = comment/doc positions AND by-path invocation: a path-tail mention, or the entity name as a whole string argument to a call/path-join/spawn argv, since naming WHERE a script lives is the accessor's job, not identity replication), a structural relation (import / re-export / require / source …) distinguished from those code-position name mentions, …
```
改后（节选，逐字）：
```
… non-evidence = comment/doc positions, by-path invocation — … — AND occurrence role: a code-position occurrence counts as an INDEPENDENT NAMING POINT only when it is an identity value (the string literal's content is exactly the entity name, an assignment right-hand side, or a bare name inside a name list/registry), while an occurrence embedded inside a longer string (test title, assertion expectation/message, error message, narrative prose) or a bare word outside such a list is role=text and NOT evidence — gap-identity-hardcoded-needs-occurrence-role-filter; the code count stays the mention-level reading (definition unchanged, so pre/post readings share one face) while codeFiles/accessor/hardcoded are the naming level), a structural relation (import / re-export / require / source …) distinguished from those code-position name mentions, …
```

**③ `plugin/test/identity-replication-check.test.mjs`（旧边界负控制的重新裁定）**

- `:506` 测试名：`isPathInvocationMention — 按路径调用是位置, 文本里的裸 basename 是身份 (AC2 与反向边界)` → `isPathInvocationMention — 按路径调用是位置 (只此一维; 叙述串由 occurrenceRole 排除)`；`:514` 的注释「反向边界: 文本/散文/UI 里的裸 basename 是**命名**, 仍是证据」→「本谓词**只**判「按路径调用」…（这三处）**不是证据**这件事由 occurrenceRole 的 `text` 角色负责 —— ⛔ 旧注释曾写「仍是命名, 仍是证据」，该边界已重新裁定」。断言值不变（该谓词未变）。
- `:520` 那条：测试名与反向 fixture 改写。`usage-text.ts`（`console.error("Usage: node shared-lib.ts --json")`）从「仍须计入」改为「提及级 code=1、**不进 codeFiles**」，并**新增**一条 `identity-value.sh`（`NEVER_LAYDOWN="shared-lib.ts"`）作为非空转的反向边界。
- `:360/:366`（`string-only.sh` / `comment-tail.sh`）**保留**，理由逐字写进 fixture 注释：这两条断言的是**整段字面量恰为实体名**（`echo "shared-lib.sh"`）⇒ 角色仍是 `name-value`，本任务移动的是**另一条**边界（嵌在更长叙述串里的提及）。`comment-tail.sh` 第 3 行同时补注：它必须是身份值形态，否则整文件会被角色过滤提前剔除 → 守卫空转。
- 新增测试 `occurrenceRole — 出现角色四态: 身份值 / 叙述串 / 按路径 / 注释 (AC1 逐态)`；`判红行必须就地给出命中样本` 的两条 fixture 从散文串改成身份值形态（否则断言一个恒为 0 的量 = 空转）。

### §AC6 — 观测者契约与同族面

```
identity-replication-check.ts            CLI exit 0                    （修前 exit 0，不变；它是观测者不是门）
sharedModuleControl.flagged              false                         （修前 false；importAccessor=238, hardcoded 4→3）
deletion-closure-check.ts resource-gate.sh --json
  修前 counts={code:42,comment:72,doc:163,call:37,literal:5,schema:36,fixture:26,touches:41,dcTotal:252,callGraphTotal:37,ratio:6.8108}
  修后 同上逐字不变（它复用 tsCommentMask/shCommentMask/blankComments —— 本任务**没有**动掩码）
quality-gate-driver.ts 的 P2 面（clusterIdentityReport，读 identity --json）
  P2 clusters 修前 22 个（P2-judgment-rewrites + 21 个 P2-identity-*）
  修后  1 个（只剩 P2-judgment-rewrites —— 那是本任务未触及的另一枚子检测器）
  deletionClosureComponents(identity) 候选构件 修前 3 个 [quay-init.sh, runner-static-gate.ts, quay-launch.sh] → 修后 0 个
```

### §AC7 — 测试与负控制

```
$ bash scripts/test.sh plugin/test/identity-replication-check.test.mjs plugin/test/architecture-review-cluster.test.mjs \
      plugin/test/deletion-closure-check.test.mjs plugin/test/quality-gate-driver.test.mjs
EXIT=0   （ℹ tests 89 ℹ fail 0；单文件跑：tests 23 / pass 23 / fail 0）
```

**新增/改写的用例对【修前】实现为红**（负控制，两侧读数都跑过）：
1. 把新测试文件对着 **`git show develop:plugin/scripts/identity-replication-check.ts`** 跑：`SyntaxError: The requested module … does not provide an export named 'occurrenceRole'` ⇒ 新角色判据在修前**不存在**。
2. 去掉该 import 与那条新测试后再对修前实现跑（隔离出**行为**对照）：`✖ literalReplication — 按路径调用/叙述串的文件不再计入… AssertionError: 但它不进 codeFiles (非命名点) 1 !== 0` ⇒ 同一断言修前红、修后绿。
3. AC1 的探针**只用修前就存在的导出**（`matchEntity`/掩码/`accessorRegexSource`），因此对两版都能跑：**修前 `mismatches: 4` + exit 1，修后 `mismatches: 0` + exit 0** —— 这是最干净的两态对照（T1/T2/T4/T5 修前误报为证据）。

⚠️ 残留（如实记，不假装覆盖）：名字清单规则的唯一假阴性方向是**清单首行的第一个名字**（它的一侧邻词是命令词 `printf`），见 `bareWordRole` 注释；本仓当前无命中此形态的实体。

## DoD

判据改在**检测器本体**（`identity-replication-check.ts` 的 `matchEntity()` / `accessorRegexSource()` 及其位置掩码），外加三处声明载体的同步。真实落地 = AC1 与 AC2 两条命令**修前红、修后绿**（两侧读数都贴出），AC3/AC4 的五个簇 + 全表修前/修后读数**贴进本任务体**（每一处存活证据都点出它是什么），AC5 的三处载体逐字贴出改动前后。仅有测试通过不算落地 —— 判据必须能把「查过且合格」与「没查成」分开（硬规则 3b）；AC1 的 `R1` 与 AC4 的逐条分类就是那两个方向上的载体。

## Touches

- `plugin/scripts/identity-replication-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/identity-replication-check.test.mjs`
- `plugin/test/architecture-review-cluster.test.mjs`
- `tasks/gap-identity-hardcoded-needs-occurrence-role-filter.md`
