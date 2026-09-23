---
id: gap-fan-in-delta-classify-declared-doc-surfaces
title: fan-in delta 分类在第三方 worktree 里找 quay 的检查注册表：改读显式声明的 loop.doc_surfaces
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-318
---
## Proposal

**机制**：机械 fan-in 第 4 步（`plugin/scripts/worker-fan-in.ts:1325/1341`）调用 `select-static-checks-for-touches.ts --classify-delta --root <worktree>`，在**目标项目的 worktree** 里查找 quay 自己的检查注册表 `runner-static-gate.ts`（候选 `plugin/scripts/…` 或 `scripts/…`，`select-static-checks-for-touches.ts:81-98`）。上游 `caeca6f9c`（2026-09-20）只给 **ff-merge 证书闸**加了插件根目录候选（`packages/quay/src/fan-in/ff-merge.ts` `classifyRootCandidates`），fan-in 第 4 步仍然只看 worktree ⇒ 第三方项目 exit 2 ⇒ `__CLASSIFY_FAILED__` ⇒ 一律跑全量 suite。

更根本的问题：注册表是 **quay 自己的检查器清单**，它的对象路径全是 quay 的。拿它去判断第三方项目的某个路径「有没有检查器读它」没有意义；分类结果实际上退化为只看 `DOC_SURFACES` 前缀（`select-static-checks-for-touches.ts:267`，`tasks/ goals/ docs/ adr/ .quay/ …`，也是 quay 的布局）。

**生产读数（claudecodeui）**：fan-in 日志 177 次 delta 判定中 11 次 `classify failed → run suite (fail-closed)`。项目随后**把 quay 的注册表副本提交进自己的仓库**（claudecodeui `f7604c68`「supply plugin/scripts/runner-static-gate.ts so fan-in can classify its delta」）才恢复分类——这是在模仿 quay 形态，不是修复。

**修法（方向）**：
1. 第三方项目的 doc/code 分类读 `.quay/config.yml` 中显式声明的 `loop.doc_surfaces`（路径前缀列表）；未声明时用一个与布局无关的保守缺省（只有 `tasks/`、`goals/`、`.quay/` 这类 quay 自己写入的面算 doc），⛔ 不查 quay 注册表。
2. 本仓库（quay 自身）继续用注册表判定；「是不是本仓库」的判断不得靠文件是否存在（由 `gap-repo-shape-inferred-from-test-sh-existence` 统一提供）。
3. fan-in 第 4 步与 ff-merge 证书闸共用同一个分类入口（硬规则 5b：同一判定只有一份实现）。
4. quay-init 写出 `loop.doc_surfaces` 的缺省值，并在 `plugin/skills/init/SKILL.md` 说明。

<!-- dedup-ref -->相关：`gap-classify-delta-registry-path-layout-aware`（done，`caeca6f9c`）修了证书闸那半；本任务修 fan-in 第 4 步并去掉对 quay 注册表的依赖。本任务是 GOAL-027 / AC-318 的承载 task。

## AC

- [ ] `node --test plugin/test/fan-in-execute-paths-s01.test.mjs plugin/test/third-party-capability-degradation.test.mjs` 退出 0，新增用例：一个**不含** `runner-static-gate.ts` 的第三方 worktree 夹具（带 `loop.doc_surfaces: ["docs/", "tasks/"]`）上，delta `["docs/a.md","tasks/t.md"]` 判 doc-only，`["server/x.ts"]` 判 code，两者都**不是** `__CLASSIFY_FAILED__`。
- [ ] 负控：未声明 `loop.doc_surfaces` 的第三方夹具上，`docs/a.md` 判 code（保守缺省），且分类有结论（非 `__CLASSIFY_FAILED__`）；quay 自身仓库的既有分类用例不回归。
- [ ] `node --experimental-strip-types plugin/scripts/config-key-consumer-check.ts --json` 退出 0，且 `doc_surfaces` 的状态为 `has-consumer`。
- [ ] `bash scripts/test.sh --for-task gap-fan-in-delta-classify-declared-doc-surfaces` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：GOAL-027 / AC-318 的判据在 claudecodeui 上读出 exit 0。这要求：该项目删除提交进去的 `plugin/scripts/runner-static-gate.ts` 副本、在 `.quay/config.yml` 声明 `loop.doc_surfaces`、driver 重启到含修复的版本，之后其 fan-in 日志里至少出现 1 次 delta 判定且 `classify failed` 为 0。完成记录写明删除副本的提交与 driver 重启时刻。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/select-static-checks-for-touches.ts
- packages/quay/src/fan-in/ff-merge.ts
- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- plugin/skills/init/SKILL.md
- plugin/test/fan-in-execute-paths-s01.test.mjs
- plugin/test/third-party-capability-degradation.test.mjs
- tasks/gap-fan-in-delta-classify-declared-doc-surfaces.md
