---
id: gap-ac244-freshness-subject-set-mechanically-derived
title: AC-244：AC-214 的新鲜度主体集合改为机械推导——接线 AC-232/AC-238，新增载体型 AC 不得再静默逃出
status: ready
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-244
---
## Proposal

正本判据 `goals/AC-244-新鲜度约束的主体集合必须由载体机械推导-后加入的载体型-ac-今天-ac-232-ac-238-不得自动逃出-ac-21.md`（goal=GOAL-009）：exit 0 = 载体 `.quay/productization-verification.jsonl` 里**出现过**的每一条 GOAL-009「载体型」AC 都被 AC-214 的新鲜度约束覆盖；exit 1 = 存在只靠载体记录即可永久转绿的 AC 却不在 AC-214 的主体集合里；exit 3 = 读不出（NOT-EVALUATED）。

**现状（本次立案当轮实测，位置判定）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-244 --root .` ⇒ `"verdict": "fail"`，`reason` 逐字 `acceptance failed (exit 1) — carrier-only evidence with no freshness bound in AC-214: GOAL-009-AC-232,GOAL-009-AC-238`。

**根因**：AC-214 的 criterion 里主体集合是**手写死列表**——逐字 `NEED = ["GOAL-009-AC-201", "GOAL-009-AC-203", "GOAL-009-AC-205", "GOAL-009-AC-207"]`，其 title 亦写「四条载体型判据」；而 AC-232/AC-238 的判据正文只读 `p=".quay/productization-verification.jsonl"`、只凭「载体里存在过一条记录」就 `sys.exit(0)` ⇒ 一旦转绿即永久绿，却不在 NEED 里 ⇒ 逃出新鲜度约束。AC-244 自己的判据已经**机械推导**主体集合（扫 `goals/AC-*.md` × 载体出现过的 AC ∩「判据正文只读载体、不读源码/清单」），所以这是**接线缺口**（判据存在、覆盖集合未接上），不是要造新机制。

**为什么不能只把两条 ID 手工补进 NEED**：手写列表正是本缺陷的成因。本次实测 AC-239/AC-240 的判据正文同样只读载体（`carrier_path=yes, src_re=-`），只是尚无载体记录而未进主体集合；它们一有载体记录就会以同一形态逃出，而**当场没有任何判据会拦下**（AC-244 会报红，但实际执行新鲜度检查的 AC-214 自己不会）。⇒ 修法 = 让 AC-214 的判据**自己机械推导**主体集合（与 AC-244 判据同一规则），并与声明的 `NEED` 比对，`SUBJ − NEED` 非空即 fail-closed；新增载体型 AC 从此不可能静默逃出。这不是新机制，是把已有判据的覆盖集合接到机械推导上（AC-244 的 `origin` 逐字：这是 wiring 缺口，不是要造新机制）。

<!-- dedup-ref -->
**相关但机制不同的既有任务（仅作溯源，不重复立案）**：`gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207`（status=done）解的是「AC-203/205/207 的记录不写 `build_sha` ⇒ AC-214 恒读不到」，即**字段契约**；`gap-goal-criteria-bare-failing-exit-unattributable`（AC-241）解的是「失败出口不写成因」，即**失败可归因性**。本条解的是「主体集合是手写列表 ⇒ 新 AC 逃出」，即**覆盖集合**，与前两者改的是 AC-214/判据生态的不同位置，互不替代。

## Plan

1. **改 AC-214 判据（必须经 Provider ABI 写，⛔ 不直改 `goals/*.md`）**：新判据正文落成临时文件后
   `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write AC-214 --criterion "$(cat <文件>)" --expect "<新 expect>" --root .`
   ，改完**必须回读**（`… get AC-214 --root .`）确认落盘的就是新正文。⛔ 只改判据正文/expect，**不改 pass/fail 语义**（除新增守卫外，既有新鲜度逻辑逐字保留）。
2. **判据新增：机械推导 + fail-closed 守卫**（插在 `NEED` 定义之后、新鲜度循环之前）：
   - 在既有载体遍历里顺手收集 `seen` = 载体中出现过的 `ac`（`re.fullmatch(r"GOAL-009-AC-\d+", a)`）；
   - 逐 `goals/AC-*.md` 解析 frontmatter（按**行首独立 `---`** 判边界，⛔ 不用 `split("---")[1]`；`criterion:` 块标量按 `>-`/`|-` 折叠读取），取满足全部四项者进 `SUBJ`：`goal == "GOAL-009"` ∧ `("GOAL-009-"+id) in seen` ∧ 正文含 `CARRIER` ∧ 正文**不**匹配 `SRC_RE = re.compile(r"\.(ts|js|mjs|sh|json|md|yml)\b")`。`\b` 词边界是必需的：子串写法下 `.json` 会命中载体自己的 `.jsonl` ⇒ 候选集恒空 ⇒ 判据恒绿（硬规则 3b）；
   - `NEED` 扩为 6 条：补 `"GOAL-009-AC-232"`、`"GOAL-009-AC-238"`（⛔ **不**加 AC-239/AC-240——它们尚无载体记录，加进去只会让判据停在 `no evidence yet`）；
   - 守卫：`unwired = sorted(SUBJ - set(NEED))`；非空 ⇒ `sys.stderr.write("carrier-type AC with no freshness bound in NEED: %s\n" % ",".join(unwired))` + `sys.exit(1)`。这正是「新增载体型 AC 不得静默逃出」的执行点。
3. **声明文本与推导同步**：AC-214 的 `title` 去掉写死的「四条」（改后须确认 `ls goals/AC-214-*.md | wc -l` == 1——`fileNameForId` 复用既有文件名，不应重命名；若被重命名则本任务 Touches 须同步改），`expect` 改为引用「机械推导的主体集合（当前 = AC-201/203/205/207/232/238）」。
4. **测试钉**：新增 `plugin/test/ac214-freshness-subject-set.test.mjs`，用 `mktemp -d` 夹具（**自造** `goals/` 六个 AC-201/203/205/207/232/238 记录 + `.quay/productization-verification.jsonl` + `packages/quay/package.json`），从 `goals/AC-214-*.md` 经 YAML 解析取 `criterion`、以 `bash` 在夹具内执行，断言守卫的**取假**与**不误红**两向（AC4/AC5）。夹具内 ⛔ 不写 `tasks/`（免触 task-file-bypass-check），⛔ 不依赖生产 `goals/` 内容。
5. **生产实跑（读生产载体，⛔ 夹具不算）**：worktree 内补一份**与生产载体逐字节相同**的 `.quay/productization-verification.jsonl`（记 sha256 对照），`--root <worktree>` 跑 `gate AC-244` / `gate AC-214`（见 AC3）。

## Acceptance Criteria

- [ ] AC1 机制在位：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts get AC-214 --root .` 的输出中，`SUBJ`（机械推导块）与 `unwired`（守卫）各命中 ≥1；贴命中前 3 行（硬规则②：引用计数前先打印命中）。
- [ ] AC2 接线：同一条输出中 `NEED = […]` 整行同时含 `GOAL-009-AC-232` 与 `GOAL-009-AC-238`；贴该行原文。
- [ ] AC3 生产转绿（读生产载体）：worktree 内 `.quay/productization-verification.jsonl` 与生产主检出该文件 `sha256` 相同（贴两条 sha256），随后 `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-244 --root <worktree>` ⇒ `"verdict": "pass"`，同命令 `gate AC-214 --root <worktree>` ⇒ `"verdict": "pass"`；贴两份 JSON。对照（改前）：本次立案当轮 `gate AC-244 --root .` ⇒ `"verdict": "fail"`，reason 逐字含 `GOAL-009-AC-232,GOAL-009-AC-238`。
- [ ] AC4 守卫取假（fixture 负控制）：夹具里额外放一条「判据只读载体、且不在 NEED」的 GOAL-009 AC（合成 `AC-239`）及其载体记录 ⇒ 判据 `exit 1`，stderr 含 `carrier-type AC with no freshness bound in NEED` **且**指名该 AC；贴输出与 exit code。
- [ ] AC5 守卫不误红（fixture 正控制）：同夹具去掉那条额外 AC，载体里 6 条 NEED 记录**不带** `build_sha`/`commit` ⇒ 判据 `exit 1` 但 stderr 是 `no evidence yet:`（证明控制流越过守卫、到达新鲜度阶段，守卫不是恒红）；贴输出与 exit code。
- [ ] AC6 测试钉：`node --test plugin/test/ac214-freshness-subject-set.test.mjs` 全绿（含 AC4/AC5 两向断言）；贴 `pass/fail` 计数行。
- [ ] AC7 全量套件绿（外层 verification-round 验证）——本条的量的产生处是 fan-in/外层的 suite 轮，⛔ 不是 worker 自己的读数；worker 只提供 scoped 门读数（`bash scripts/test.sh --for-task gap-ac244-freshness-subject-set-mechanically-derived --allow-thin`），全量绿与否由外层判定。

## Definition of Done

AC1–AC6 全绿 + 全量套件绿（外层）。真实落地 = **生产载体上的读数**：`goal-store gate AC-244` 由 fail 变 pass、`gate AC-214` 保持 pass；且守卫在合成载体型 AC 上实测取假（AC4）、在无证据载体上不误红（AC5）。⛔ 只改测试/只改文档不算落地；⛔ 不以「判据文本里出现了 SUBJ 字样」代替 AC3/AC4 的行为读数（硬规则 4 推论三：判据 AC 必须至少有一条读生产载体，且负控制不得只由注入 seam 满足）。

## Touches

- goals/AC-214-交付证据必须新鲜-四条载体型判据不得-一旦转绿即永久绿.md
- plugin/test/ac214-freshness-subject-set.test.mjs (new)
- tasks/gap-ac244-freshness-subject-set-mechanically-derived.md
