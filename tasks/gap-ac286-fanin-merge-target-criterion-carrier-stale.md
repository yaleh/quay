---
id: gap-ac286-fanin-merge-target-criterion-carrier-stale
title: AC-286 判据点名的承载者随机械 fan-in 抽取迁走（`2440b52d0`）⇒ 判据恒红，且是冻结population 119 条里唯一
  failing 的一条——改为【结构化解析 runMechanicalFanIn 的定义模块】，恢复「机械 fan-in 合并目标仍是
  develop」的回归防护
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-286
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-21，cwd = 主检出 `/home/yale/work/quay`）**

`goals/AC-286-worker-机械-fan-in-的合并目标仍然是-develop-回归防护.md` 的 criterion（`status: achieved`，
其 GOAL-023 已 `achieved` ⇒ 本 AC 已离开复验域且**未**声明 `long-term: true`）**逐字重跑 exit 1**，逐字：

```
CAUSE=default-assignment-not-found — no line in plugin/scripts/worker-driver.ts assigns
'const mergeTarget = opts.mergeTarget ?? ...' — the mechanical fan-in's default merge-target
expression may have been refactored; this criterion needs updating, not silently passed
```

判据自己**预告了**这次成因，且它 fail-closed 是设计如此（⛔ 不是硬规则 3b 的静默通过——它给了具名
`CAUSE=`，与「合格」不同形）。

**population 读数（`node --experimental-strip-types packages/quay/bin/quay.ts goal check --stale-pass`，纯读）**：

| 量 | 读数 |
|---|---|
| `frozenScope` | **119** |
| `failing` | **`["AC-286"]`** |
| `staleUnverified` / `notEvaluated` / `amendedUnverified` | `[]` / `[]` / `[]` |

⇒ 119 条逐条判过，**AC-286 是唯一为假的一条**（硬规则 3 的枚举，不是布尔化的"有个红的"）。
⇒ 这也是本任务**不做**系统性扩面的依据：不是某一类判据集体失效，是**一条判据的承载体被搬走**。

**成因：承载者搬迁，不是被守护的保证回归。**

- commit `2440b52d0`（2026-09-20 21:28Z，任务 `gap-arch-worker-fan-in-extract-from-worker-driver`，**done**）
  把机械 fan-in 整段从 `plugin/scripts/worker-driver.ts` 抽到 `plugin/scripts/worker-fan-in.ts`
  （`worker-driver.ts` 6112→4453 行；新模块 1772 行），`runMechanicalFanIn` 的**定义**随之下移。
- 该 commit message 逐字写明它**已经**处置了同类断言：「Four source-structure assertions that read
  worker-driver.ts's TEXT are repointed at the module that now owns the code (FAN_IN / FANIN_SRC);
  their negative arms ("this bad shape is gone") now check BOTH files so strength is not reduced.」
  那四条住在仓库测试里（`plugin/test/worker-driver.test.mjs:183`、`plugin/test/worker-driver-fan-in-s06.test.mjs:12`、
  `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs:44`）——**同类断言里住在 goal store 的那一条
  （本 AC 的 criterion）不在它的扫描面内**：`grep -rn '<basename>' plugin/scripts plugin/test` 结构上看不到
  `goals/AC-286-*.md`。（硬规则 5b：修完一个实例后在同一载体里 grep 其它适用点——那次做对了一半，
  扫面只覆盖了仓库内。）

**保证本身仍成立（本轮直接量，⛔ 不是推断）**：

| 面 | 读数 |
|---|---|
| 新承载体的默认赋值 | `plugin/scripts/worker-fan-in.ts:1138`：`const mergeTarget = opts.mergeTarget ?? "develop";` |
| 生产调用点（driver 内） | `plugin/scripts/worker-driver.ts:3513`：`spawnMechanicalFanIn({ task: taskId, worktree: paths[0], root: rootDir, runId })` —— **不传** `mergeTarget` ⇒ 取默认 |
| CLI 面（`--mechanical-fan-in`） | `worker-driver.ts:4306`：`mergeTarget: mechMergeTarget`，来自 `--merge-target`，缺省 `undefined` ⇒ 取默认 |
| 原判据的**同一个谓词**（同一行正则）作用在解析出的现有承载体上 | exit 0，命中行逐字含 `"develop"` |

⇒ 台账的「此刻为假」是**判据点名的承载者失效**，⛔ 不是它守护的保证回归。

**为什么上一轮的修复没顶住**：AC-286 的判据（2026-09-17 落笔，同轮把判据「收紧为对 mergeTarget 默认赋值
语句的位置判定」）把承载体**钉死在一个文件路径**上。它顶不住**承载者搬迁**：任何把该表达式搬走的合法重构
都会重新把它变假，与判据本身写得多严无关。同型先例：`tasks/gap-ac157-catalog-carrier-moved-criterion-stale.md`
（done，AC-157：catalog 枚举搬迁把判据变假，修法 = 「把判据移到真正承载该角色的文件上」）。
**本任务是该类的第二个实例**，且比第一个更进一步（见下「取舍」第三条）。

**四个修法的取舍**：

- ✗ **把赋值搬回 `worker-driver.ts`**：拒绝。让代码迁就判据，与 `gap-arch-worker-fan-in-extract-from-worker-driver`
  刚确立的去 1659 行抽取方向相反。
- ✗ **只把路径换成 `worker-fan-in.ts`**（照 AC-157 的形态）：**不够**。同一个搬运动作已经把它变假过一次；
  换个前缀只是把下一次搬家的日期推后。本任务要求**结构化解析**——判据自己去问「现在是谁定义 `runMechanicalFanIn`」，
  搬家的那天它跟着走，而不是等下一轮台账变红再人工重锚。
- ✗ **退役本 AC（`superseded`）**：拒绝。GOAL-023 §4 逐字写着「worker fan-in 目标继续是 develop——已经是现状，
  本方案不改变这条，只做回归防护验证」⇒ 这条保证**今天仍是本仓库的意图**，退役它等于删掉守卫。
- ✗ **声明 `long-term: true`**：不解决。它只是把这条 AC 搬进 AC-216 复验域（每轮重跑），判据本身仍为假。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）与可追溯性，均在案且**不重复**：`grep -rn '^goal_ac: AC-286' tasks/`
⇒ **零命中**（本 AC 前无任何主）；`gap-ac157-catalog-carrier-moved-criterion-stale`（done，AC-157，「承载者搬迁
⇒ 判据 stale」，同一机制、不同 AC）；`gap-ac192-reanchor-criterion-to-attemptkey`（done，AC-192，「判据测错字段
⇒ 恒红」，相邻机制）；承载者搬迁的 general 教训见 memory `carrier-role-must-move-when-data-leaves-code`。

## Plan

1. **留底**：`node --experimental-strip-types packages/quay/bin/quay.ts goal show AC-286 --json` 取 `criterion` /
   `expect` / `origin` / `activatedAt` 全文落盘 + 记 `criterion` 的 md5（AC1/AC4 的前后对照基线）。
2. **用机件改，⛔ 不手搓 `goals/AC-286-*.md`**（该文件由 store 拥有）：
   `node --experimental-strip-types packages/quay/bin/quay.ts goal write AC-286 --root /home/yale/work/quay \
   --criterion '<新判据全文>' --expect '<新 expect>' --expect-existing`
   —— `--expect-existing`（缺记录即拒的 CAS）防"写了个不存在的 AC 还以为成了"；
   **patch 语义**：省略 `--status` / `--goal` / `--origin` / `--title` ⇒ 保留存储值。
   ⚠️ **落点必须是被读的那棵树**：goal-driver 读的是 `dataRoot` = **主检出**。⛔ 在任务 worktree 里跑
   `goal write` 会把改动落进 worktree 的 `goals/`，driver 读不到 ⇒ 下一轮照旧跑旧判据、照旧立案。
   故 `--root /home/yale/work/quay`（与 CLAUDE.md「写面在主检出、develop 靠同步收敛」一致），并用
   `git -C /home/yale/work/quay log -1 --stat -- goals/` 确认提交落在主检出（store-commit 会自动提交，
   提交形如 `goals: AC-286 field:criterion,expect by cli:<pid>`）。
3. **新判据全文**（本轮已在 4 个 scratch 根上逐臂实测，见下表；实现者须以 `goal show` 取回的文本为准再测一次）：

```bash
bash <<'CRIT'
set -euo pipefail

# 结构解析（⛔ 不钉文件路径）：机械 fan-in 的实现模块 = 定义 runMechanicalFanIn 的那份
FANIN="$(grep -rlE '^export async function runMechanicalFanIn' plugin/scripts/*.ts 2>/dev/null | head -1 || true)"

if [ -z "$FANIN" ]; then
  echo "CAUSE=fanin-module-unresolved — no plugin/scripts/*.ts defines runMechanicalFanIn; the region was renamed/moved again — re-anchor this criterion, do not silently pass" >&2
  exit 1
fi

LINE="$(grep -nE 'const[[:space:]]+mergeTarget[[:space:]]*=[[:space:]]*opts\.mergeTarget' "$FANIN" | head -1 || true)"

if [ -z "$LINE" ]; then
  echo "CAUSE=default-assignment-not-found — $FANIN defines runMechanicalFanIn but carries no 'const mergeTarget = opts.mergeTarget ?? ...' line; the default merge-target expression was refactored — re-anchor this criterion" >&2
  exit 1
fi

case "$LINE" in
  *'"develop"'*) echo "OK — mechanical fan-in ($FANIN) mergeTarget default: ${LINE#*:}"; exit 0 ;;
  *) echo "CAUSE=default-not-develop — mechanical fan-in ($FANIN) mergeTarget default no longer defaults to \"develop\": ${LINE#*:}" >&2; exit 1 ;;
esac
CRIT
```

   ⚠️ 两个 `|| true` **不是装饰**：判据头是 `set -euo pipefail`，而 `grep … | head -1` 在**零命中**时返回非零
   （`head` 早关管道还会给 grep 一个 SIGPIPE）⇒ 没有 `|| true` 时赋值语句本身就中止脚本，**具名 CAUSE 永远打不出来**、
   三态退化成同一个空输出（`pipefail`-vs-`grep` 的既有坑：memory `pipefail-plus-grep-q-makes-predicates-read-false-when-true`）。

   **本轮四臂实测**（在 `/tmp` 的 scratch 根各跑一次，cwd = 该根）：

   | 臂 | 树 | 读数 |
   |---|---|---|
   | 正控制 | 真实 `plugin/scripts/worker-fan-in.ts` | **exit 0**，`OK — mechanical fan-in (plugin/scripts/worker-fan-in.ts) mergeTarget default:   const mergeTarget = opts.mergeTarget ?? "develop";` |
   | 负控制① | 默认值改 `"master"` | **exit 1**，`CAUSE=default-not-develop …?? "master";` |
   | 负控制② | 删掉赋值行 | **exit 1**，`CAUSE=default-assignment-not-found …` |
   | 负控制③ | 定义行改名 `runFanInMech` / 模块挪进子目录 | **exit 1**，`CAUSE=fanin-module-unresolved …` |

   三态互不同形、也⛔不与 pass 同形（硬规则 3b）。

   **三个刻意的覆盖面边界，必须写进 Evidence（⛔ 不是遗漏）**：
   - 解析用**一层** glob `plugin/scripts/*.ts`，**不递归**。递归会捞到 `plugin/scripts/archive/**` 里的旧副本 ⇒
     `head -1` 可能命中**陈旧定义** ⇒ **静默假绿**（硬规则 3b 最危险的那一半）。一层 glob 的代价是模块若挪进
     子目录就报 `CAUSE=fanin-module-unresolved`——**可见的红**，且成因指名要重锚判据。**取可见红，⛔ 不取静默绿。**
   - 正则前缀锚定 ⇒ `runMechanicalFanInV2` 这类**后缀**改名仍会被解析到（同一函数，跟随是对的，已实测）；
     完全改名则落到 `CAUSE=fanin-module-unresolved`。
   - 判据覆盖的是**默认赋值这一处结构事实**（与原判据**同口径**，⛔ 不扩大也不缩小）。它**不**检查调用点是否显式传
     非 develop 目标（那需要文本匹配调用点，假阳性高：`--merge-target` 的 CLI 面与测试都显式传 `"develop"`）。
     这是**有意的边界**，写进 Evidence。
4. **`expect` 同步**：原 expect 逐字说「worker-driver.ts's mechanical fan-in path …」——判据换了承载体后，
   这句话会与判据漂移（单一真相源）。改成按性质陈述：
   `criterion exits 0 as long as the module that defines runMechanicalFanIn still defaults its merge target to develop`。
   ⛔ `origin` / `activatedAt` / `status` / `goal` 四个字段一字不动（AC4 举证）。
5. **让台账尾事件落到【当前】判据文本上**：换了文本后该 AC 进 `amendedUnverified`（既有 verdict 针对旧文本，
   `payload.criterionHash` ≠ 新指纹，见 `packages/quay/src/goal-store.ts:1710`）——这**不是**绿，必须把新文本
   真跑一次并落账：`quay goal check --stale-pass --sweep`（有界轮转；必要时 `goal gate AC-286`），
   再贴 `goal check --stale-pass` 读数。
6. **负控制跑在【真实判据文本】上**，⛔ 不在草稿上：从 `goal show AC-286 --json` 取回落盘的 criterion 全文，
   在 scratch 副本上做上表 ①②③ 三种变形，逐臂贴 exit code + `CAUSE=`。

## AC

- [ ] **AC1（判据红→绿，同一命令同一对象，前后并排）**：`node packages/quay/bin/quay.ts goal gate AC-286` 改动前
      exit 1（贴含 `CAUSE=default-assignment-not-found` 的原文）⇒ 改动后 exit 0 且 `verdict: "pass"`；并贴
      `criterion` 文本改动前后的 md5 与全文。⛔ 不得改动判据的**覆盖面**（见 Plan 3 第三条边界）。
- [ ] **AC2（可被打红——负控制实跑，⛔ 没有正控制的 exit 1 什么也不证明）**：对 `goal show AC-286 --json` 取回的
      **新判据全文**，三个 scratch 变形各跑一次并贴 exit code 与 `CAUSE=`：① 默认值改 `"master"` ⇒
      `CAUSE=default-not-develop`；② 删掉赋值行 ⇒ `CAUSE=default-assignment-not-found`；③ 定义行改名 ⇒
      `CAUSE=fanin-module-unresolved`。另贴正控制（真实树 exit 0）。
- [ ] **AC3（承载者按【内容】解析，⛔ 不按路径钉）**：贴出解析读数（今天 = `plugin/scripts/worker-fan-in.ts`，
      恰好 1 命中）；并在 scratch 副本里把该模块**整体改名**（如 `worker-fan-in-renamed.ts`，内容不变）后跑
      同一条判据 ⇒ **仍 exit 0**（证明它跟随定义、不跟随文件名）；恢复。
- [ ] **AC4（用机件改 + 作用域最小 + 落点正确）**：① `goal show AC-286 --json` 显示新 `criterion`/`expect`，
      而 `status` 仍 `achieved`、`goal` 仍 `GOAL-023`、`origin`/`activatedAt` 前后逐字相同（并排贴）；
      ② `git -C /home/yale/work/quay show HEAD --stat -- goals/` 显示该记录由 store 的自动提交落在**主检出**
      （⛔ 不在任务 worktree 的 `goals/`），且 diff **只在 criterion 与 expect 两个字段**；
      ③ 贴 `git log -1 --format=%H` 的提交 sha。
- [ ] **AC5（台账面复核，⛔ 不把 `amendedUnverified` 说成绿）**：`quay goal check --stale-pass` 读数里
      AC-286 **不在 `failing`**；若它此刻在 `amendedUnverified`，逐字写明"轮转还没轮到、下次何时可判"，
      ⛔ 不得宣告已复绿。
- [ ] **AC6（保证本身仍为真的直接量，⛔ 不是"我改好了"的自述）**：并排贴出 ① `worker-fan-in.ts:1138` 的默认赋值行；
      ② 生产调用点 `worker-driver.ts:3513` 不传 `mergeTarget` 的逐字行；③ `grep -rlE '^export async function
      runMechanicalFanIn' plugin/scripts/*.ts` 恰好 1 命中的读数。若任一条不成立 ⇒ 本任务判负（改判据只是把红藏起来）。
- [ ] **AC7（入库自检）**：`node plugin/scripts/task-schema-check.ts tasks/gap-ac286-fanin-merge-target-criterion-carrier-stale.md`
      ⇒ exit 0，且 `node packages/quay/bin/quay.ts task check gap-ac286-fanin-merge-target-criterion-carrier-stale --json`
      的 `missing` = `[]`。

## DoD

**REAL LANDING（DIR-026 Reading A）**：不是「我改了判据文本」，而是 **goal store 里 AC-286 这条记录此刻在真实仓库上
重跑 exit 0**，且这个绿①**可被打红**（AC2 三臂实跑）、②**跟随代码而非路径**（AC3）、③**被守护的保证仍为真**
（AC6 的直接量）、④台账尾事件是针对**当前**判据文本的 verdict（`payload.criterionHash` = 当前指纹，
⛔ 不是旧文本留下的 stale pass，⛔ 也不是 `amendedUnverified`）。

1. **落地对象**：`goal gate AC-286` 在真实 goal store 上 `pass`，且该记录的新文本**存在于 goal-driver 读的那棵树**
   （主检出）——⛔ 不接受只落在 worktree 副本里的"已改好"。
2. **⛔ 不把"改判据"当消解**：AC6 的三条直接量必须同时在场。
3. **⛔ 不得放松判据**：新判据与原判据**同覆盖面**（同一行正则、同一类 CAUSE 枚举），**多出**结构化解析与
   三条互不同形的 CAUSE。任何"改成恒真"的做法（例如去掉 `case` 分支、或把 `exit 1` 改成 `exit 0`）判负。
4. **可回滚**：写明回滚形态（`goal write AC-286 --criterion '<旧全文>' --expect '<旧 expect>'`，旧全文取自 AC1 留底）
   与它的作用域（只改 store 里一条记录的两个字段，不触碰任何代码）。
5. **证据留痕**：判据输出、三臂负控制、解析读数、前后 diff 与提交 sha，落成**任务体内联**或 `.quay/ac286-*`
   **未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句"已改好"）。

## Touches

- goals/AC-286-worker-机械-fan-in-的合并目标仍然是-develop-回归防护.md
- tasks/gap-ac286-fanin-merge-target-criterion-carrier-stale.md

（说明：本任务的落地面是 **goal store 里一条 AC 记录的 `criterion`/`expect` 两个字段**——经 `quay goal write`
（provider ABI 写路径 + `commitStoreWrite` 自动提交）落盘，**不产生任何产品代码改动**，故 Touches 只有这两个具体路径，
⛔ 没有"实现文件 + 测试文件"那一对可列。⛔ **不加仓库侧测试**：这条保证的守卫**按设计**住在 goal store（criterion 由
goal-driver 每轮/轮转复跑），在 `plugin/test/` 再放一份是**同一谓词的第二副本**（单一真相源原则，且 `gap-ac157` 的先例
同样选了这条路）；更要紧的是它**挡不住本缺口**——本次抽取**已经**逐条重锚了仓库测试里的四条同类断言，漏掉的恰是
**仓库扫描面之外**的那一条。证据一律内联任务体或写进 `.quay/` 下**未跟踪** scratch 文件：按
`touches-glob-on-quay-runtime-artifacts-blocks-promotion`，未跟踪运行时产物不进 anti-drift 的 `actualFiles`，
声明它们反而是噪声且会挡晋升。）
