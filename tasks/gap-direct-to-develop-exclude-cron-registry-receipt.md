---
id: gap-direct-to-develop-exclude-cron-registry-receipt
title: cold-start 变更未同步测试/排除集：bypass-check 排除集加
  plugin/scripts/outer-cron-registry.json（AC81 git 跟踪遥测收据，冷启动 cron 重建必直写且无
  fan-in 路——发生率 3：f9577da1/167b7052/f882ad76）+ 三处测试 pin 同步（outer-cron-registry 测试
  旧 cron id + AC4 launcher 测试旧 launcher）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**问题 A（bypass-check 排除集）**：`direct-to-develop-bypass-check.ts` 把 `plugin/scripts/outer-cron-registry.json` 判为代码/断言面（不在 `DESIGN_INTERNAL_RE` 排除集内）。该文件是 **AC81 的 git 跟踪注册表收据**（cron id / 表达式 / prompt sha256 / verifiedAt），**冷启动 cron 重建必须直写 develop**——CronCreate 是会话级动作（进程被杀 → cron 随会话消失 → 按 AC81 四判据清扫重建），**没有对应的任务/worktree/fan-in 路径**（fan-in-execute.js 无 task 即 bad-args）。⇒ 每次冷启动 cron 重建都产生一条直写该文件的 commit，被 bypass-check 报红，阻断其后所有 fan-in。

**发生率（2026-08-17 冷启动实测）**：f9577da1（inner AC81 锚重建，OOM 死会话，manager 已 ruled one-off）+ **167b7052（inner cron 重建）+ f882ad76（outer cron 重建）** = **3 次**同一类。f9577da1 走的是 ruled 表一次性豁免——**按 commit 逐条豁免不可扩展**（每次冷启动都要新增 ruled 条目），正确修法是结构性排除该文件（同 `plugin/skills/manager/**` 先例：`gap-direct-to-develop-exclude-manager-skill-granularity`——"manager 独占 + 走不了 fan-in 路" 同一理由）。

**问题 B（同源——冷启动变更未同步测试 pin）**：同一冷启动把值改了却**没同步三处测试 pin**，develop 上恒 8 红，与问题 A 互锁：
- `plugin/test/outer-cron-registry.test.mjs`：`loadRegistry`（:175/177/178）+ `REAL inner/outer anchor`（:204/232）+ `NOT-EVALUATED 内层正本缺失`（:436）+ `checkVerify`（:475）硬编码旧 cron id `0ccb57cf`/`4e88cb1b`，而注册表已被 f882ad76/167b7052 更新为 `09fabf33`/`a2360e1d`（outer expr 也由 `0,20,40` 归一为 `*/20`）⇒ 判据② id 不匹配 VIOLATED（6 红）。
- `plugin/test/manager-layer-skill.test.mjs`（:87）+ `plugin/test/manager-layer-shipping.test.mjs`（:87）：AC4 断言 launcher 为 `claude-deepseek`，而 d872c6c9/c2cac6a7 已换为 `claude-fjdac` ⇒ 2 红。
- **互锁**：问题 A 的 fan-in 全量 suite 被问题 B 的 8 红挡住；单独修问题 B 的任务其 fan-in 又被问题 A 的 bypass 红（167b7052/f882ad76 未 land）挡住 ⇒ **必须同一 worktree/同一 landing 修 A+B**。

**⛔ 范围（A）**：只加 `plugin/scripts/outer-cron-registry.json` 这一个**精确文件路径**，不加 `plugin/scripts/outer-cron-registry.ts`（读它的 verifier 是产品机件，直改必须仍红）、不加 `plugin/scripts/**`（会掩盖真直投）。
**⛔ 范围（B）**：只同步断言 pin 到当前值，不重写测试结构、不引入新断言。

**能取假（⊢ 对照）**：
- A：加后 167b7052 / f882ad76 / f9577da1（回放）→ design-internal → GREEN；`--baseline b11ce720` enforcement → `ok: true`；`outer-cron-registry.ts` 直改仍 RED。
- B：改后 `node --test plugin/test/outer-cron-registry.test.mjs` 25/25、`manager-layer-skill` 10/10、`manager-layer-shipping` 全绿；全量 suite 由 8 红 → 0 红（本轮）。

## Plan

1. `plugin/scripts/direct-to-develop-bypass-check.ts` `DESIGN_INTERNAL_RE` 加 `plugin\/scripts\/outer-cron-registry[.]json`（精确路径，正则转义 `.`）。
2. `plugin/test/direct-to-develop-bypass-check.test.mjs`：`isDesignInternalPath` 正例加该 json；负例加 `plugin/scripts/outer-cron-registry.ts`（仍红，AC 能取假）。
3. `plugin/test/outer-cron-registry.test.mjs`：把硬编码旧 cron id `0ccb57cf`→`09fabf33`、`4e88cb1b`→`a2360e1d`、outer expr `0,20,40 * * * *`→`*/20 * * * *`（:175/177/178/204/215/232/383/436/475 的**注册表断言**处——纯解析函数测试如 :126/:149/:162 的示例 id 不动）。
4. `plugin/test/manager-layer-skill.test.mjs`（:87）+ `plugin/test/manager-layer-shipping.test.mjs`（:87）：AC4 launcher 断言 `claude-deepseek`→`claude-fjdac`。
5. 验证：三个改的测试文件全绿 + `--for-task` scoped 门绿 + enforcement `ok:true`。

## Acceptance Criteria

- [x] AC1: `DESIGN_INTERNAL_RE` 含 `plugin/scripts/outer-cron-registry.json`（精确路径）。
- [x] AC2: 回放——167b7052 / f882ad76 的 bypass-check 判定转 design-internal（GREEN）；`--baseline b11ce720` enforcement 报 `ok: true`。
- [x] AC3: ⛔ 粒度——`plugin/scripts/outer-cron-registry.ts`（verifier 机件）仍判 code-surface（RED），`plugin/scripts/**` 未排除。
- [x] AC4: 测试全绿 + `--for-task` scoped 门绿。
- [x] AC5: 同步后 `plugin/test/outer-cron-registry.test.mjs` 全绿（25/25，旧 cron id pin 清零）。
- [x] AC6: 同步后 AC4 launcher 测试全绿（`claude-deepseek`→`claude-fjdac`）。

## Definition of Done

- [x] `plugin/scripts/outer-cron-registry.json` 进 design-internal 排除集（json 收据转绿、verifier .ts 仍红）+ 三处测试 pin 同步（outer-cron-registry 25/25 + AC4 launcher 绿）+ enforcement `ok:true`。

## Evidence

**实现（A）**：`DESIGN_INTERNAL_RE` 加 `plugin\/scripts\/outer-cron-registry[.]json$`（精确路径，`[.]` 转义点号；只豁免 json 收据）。

**实现（B）**：`outer-cron-registry.test.mjs` 注册表断言处 cron id `0ccb57cf`→`09fabf33`、`4e88cb1b`→`a2360e1d`、outer expr `0,20,40 * * * *`→`*/20 * * * *`；`manager-layer-skill/shipping` AC4 launcher `claude-deepseek`→`claude-fjdac`。

**取假**：① 正例——`isDesignInternalPath("plugin/scripts/outer-cron-registry.json")` = true；② 负例——`plugin/scripts/outer-cron-registry.ts`（verifier 机件）仍 false（RED）；③ 回放——`--baseline b11ce720` enforcement 实跑：`ok: true`（`ac65-authorized-or-ruled-historical-only`），confirmed bypass=0；④ B 反例——改前 8 红（outer-cron-registry 6 + AC4 2），改后全绿。

**验证**：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` → 30/30；`node --test plugin/test/outer-cron-registry.test.mjs` → 25/25；`node --test plugin/test/manager-layer-skill.test.mjs` → 10/10；`bash scripts/test.sh --for-task <本任务> --allow-thin` → EXIT 0。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（DESIGN_INTERNAL_RE 加该 json 路径）
- plugin/test/direct-to-develop-bypass-check.test.mjs（正/负例）
- plugin/test/outer-cron-registry.test.mjs（注册表断言处旧 cron id → 新 id）
- plugin/test/manager-layer-skill.test.mjs（AC4 launcher pin）
- plugin/test/manager-layer-shipping.test.mjs（AC4 launcher pin）
- tasks/gap-direct-to-develop-exclude-cron-registry-receipt.md（自身）
