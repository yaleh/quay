---
id: gap-ff-cert-gate-deadlock-zero-landings-since-dist-kernel-activation
title: P0 全 loop 停摆：dist-kernel 激活后 ff 证书闸的分类器不可解析 ⇒ 自 15:03
  起【零任务落地】，且该缺陷的修复自身也落不了地（需人工激活）
status: superseded
labels:
  - gap
  - defect
  - needs-human
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-09-11，读生产实时状态，⛔ 非推断；发现者 = `gap-ac161-...` 的 per-task worker）**

### ① 停摆事实（两个独立读数互校）

- `git log develop --since=2026-09-11T15:00:00 --format='%s' | grep -c '翻 .* done'` ⇒ **0**（自 15:03 worker driver 重启起，无任何任务落地）。
- `.quay/fan-in-ff-escalations.jsonl` 最后一条 `ff-escalation-resolved` 是 `2026-09-11T14:38:15Z`（runId `wk-prod-1788972473`，**旧 driver**）⇒ 15:03 之后没有任何 ff 成功过。
- 两条独立任务在 ff 步 0.2 秒内死掉：`gap-ac161-...`（15:54:38）、`gap-aged-project-post-upgrade-driver-e2e`（17:20:43）。0.2s 说明死在**取锁之前** = suite 证书闸。

### ② 根因（读代码 + 直接复现，逐字）

生产 worker driver 现为 **dist bundle**：`/home/yale/work/quay/packages/quay/plugin/scripts/dist/worker-driver.js`
（15:03 重启，run-id `wk-prod-1789139008`；此前跑的是 `.ts` kernel `/home/yale/work/quay/plugin/scripts/worker-driver.ts`）。
这次切换是 `gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（**status: done**）的激活——即 dist kernel 是**有意为之的**，⛔ 不要靠「改回 .ts kernel / 设 QUAY_PLUGIN_ROOT」来绕（那会回退该 done 任务在第三方项目无 `plugin/` 时的能力）。

`ff-merge.ts` 的 `suiteCertGate` 用 `path.join(scriptsDir, "select-static-checks-for-touches.ts")`，而生产传入的 `scriptsDir` = `resolveKernelScriptsDir()` = `…/packages/quay/plugin/scripts/dist`，该目录下只有 `dist/select-static-checks-for-touches.js`（`packages/quay/plugin/` 是 gitignored 构建产物树）。逐字复现：

```
$ node --experimental-strip-types /home/yale/work/quay/packages/quay/plugin/scripts/select-static-checks-for-touches.ts \
      --classify-delta --root /home/yale/work/quay/packages/quay tasks/gap-ac161-….md
Error: Cannot find module '/home/yale/work/quay/packages/quay/plugin/scripts/select-static-checks-for-touches.ts'
RC=1   （stdout 空）
```

证书闸 `ff-merge.ts:287` 是 `if (status !== 0 || stdout.trim() !== "")` ⇒ RC=1 被读成
`suite_head..tip delta classified non-inert (covered)` ⇒ **code 2，不取 merge lock**。

同一条命令在 `.ts` kernel 的 `scriptsDir`（`/home/yale/work/quay/plugin/scripts`）下 ⇒ `RC=0 + stdout 空` = **惰性 ⇒ 闸本该放行**。⇒ 是**布局**差异，不是判据差异。

### ③ 为什么「每个任务都必然中」

`flipTaskDone` 在 `from==="ready"` 时必写一次 `tasks/<id>.md`；在 `from==="done"` 且 develop 尚未落地时**reset→flip 写两次**。⇒ `suite_head..tip` 永不为空 ⇒ 闸永远去调那个跑不起来的分类器 ⇒ **任何任务的首次落地都必失败**。

### ④ 鸡生蛋（本条与既有任务的区别）

`gap-ff-merge-suite-cert-classifier-unshipped-and-misreported`（status: ready）**已经实现了修复**（见其任务体 `## 落地`：`ff-merge.ts:siblingScriptArgv` 布局感知解析 + `package.sh` 让注册表随包出厂 + `classifyDeltaVerdict` 三态取值），并且其 AC2 已在真实前缀 `/tmp/quay-ac-ff` 上端到端证明「doc-only delta ⇒ 放行，develop 快进」。**但该修复自身落不了地**——落地必须过它正在修的那道闸。⇒ 机械路径无法自解。

**⇒ 需要的人工动作（二选一，任一即可解锁）**：
1. 人工把 `task/gap-ff-merge-suite-cert-classifier-unshipped-and-misreported` 快进落进 develop（绕过网关），然后**重建 `packages/quay/plugin/scripts/dist/` 并重启 worker driver**（运行中的 bundle 内联的是旧 ff-merge 代码，落地 ≠ 生效——`driver-code-fix-activation-requires-main-sync-restart`）；或
2. 人工把该分支的 ff-merge 修复手工应用到主检出的 dist bundle 并重启 worker driver。

**⛔ 不要在修复落地前重启到 `.ts` kernel —— 那是回退 `gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（done）。**
**⛔ 不要靠改 `goals/AC-214` 的 NEED 清单来消 scoped 红**（见下）。

## 同窗第二个红（独立成因，勿与上条混）

`gap-ac161-…` 的 scoped 门另有**一条**红：`plugin/test/verify-deliver-coldstart.test.mjs` 的
「AC5 — every AC-214 NEED ac's write point carries a freshness anchor」——
`goals/AC-214-*.md` 的 `NEED` 在 `a26bd6c66`（**2026-09-11 17:16:32**，goal driver 写）加入了
`GOAL-009-AC-239`，而 AC-239 的记录写入点（`plugin/scripts/verify-deliver-coldstart.sh` 的
`ac89_append_goal009 … GOAL-009-AC-239`，见 commit `5e92c08b4`）**只在未落地的分支
`task/gap-aged-project-post-upgrade-driver-e2e` 上**（该分支同样死在 ff）。
⇒ 这是**目标层声明先于产物落地**的次序缺陷，属 goal 层 / 该任务，⛔ 不是 ac161 的缺陷，也⛔ 不该靠改 NEED 消红。

## DoD

`git log develop --since=<重启时刻> --format='%s' | grep -c '翻 .* done'` > 0（落地恢复）；
且 `project_root/.quay/fan-in-ff-escalations.jsonl` 出现新的 `ff-escalation-resolved`。

## Touches

- `packages/quay/src/fan-in/ff-merge.ts`
- `packages/quay/plugin/scripts/dist/`（gitignored 构建产物；激活需重建）
- `tasks/gap-ff-merge-suite-cert-classifier-unshipped-and-misreported.md`

## Evidence

- 生产 driver 进程：`/home/yale/work/quay/packages/quay/plugin/scripts/dist/worker-driver.js --root /home/yale/work/quay --run-id wk-prod-1789139008`
- 失败轨迹：`.quay/fan-in-step-trace.jsonl`（ac161 `step-end ff ok:false` @15:54:38；aged-project @17:20:43）
- 我的复验现场与读数：`/tmp/ac161-ac3-1789147801/`（AC3 真实交付运行 + sha256 前后一致）、`/tmp/ac161-scoped-gate.log`（scoped 门唯一一条红）

## Resolution（2026-09-12，人裁定关闭）

本 Finding 描述的缺陷**已由另一条任务修复并落地**：`gap-ff-merge-suite-cert-classifier-unshipped-and-misreported`（2026-09-11 18:14 翻 done）。修法落在 `packages/quay/src/fan-in/ff-merge.ts`：证书闸改用 `siblingScriptArgv` 解析分类器——`.ts` 不存在时回落到 `dist/<name>.js`，两者都取不到时返回**可区分**的 `classifier not resolvable under …`，不再与「delta 非惰性」同形（硬规则 ③b）。

关闭时的实测读数（⛔ 非推断）：

- 落地恢复：`git log develop --since=2026-09-11T15:00:00 | grep -c '翻 .* done'` ⇒ **5**（其中 18:20、18:27 两条在修复落地之后穿过 ff 步）
- 生产 worker driver 仍是同一个 dist 进程（`dist/worker-driver.js`，15:03 起未重启）⇒ 修复是在**触发本缺陷的同一布局下**被验证的，不是靠换回 `.ts` 规避
- 本 Finding 自身 AC 0/0、无实现面，其内容已被上述任务完全覆盖 ⇒ 记 `superseded` 而非 `done`
