---
id: gap-doc-surfaces-missing-goals-prefix
title: DOC_SURFACES 缺 goals/——goal-store-commit 型旁路写手每次引发 ff-race 都逼全量重跑
  suite，而不是走已有的零成本重试路径
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/select-static-checks-for-touches.ts` 的 `DOC_SURFACES` 登记表（"tasks/", "docs/", "adr/", ".quay/", "measurements/", "milestones/", "orchestration/archive/", "plugin/loop/"）是 fan-in ff 失败后判定"能否零成本重试"的依据：`worker-driver.ts` 的"develop 前进面复用"逻辑（约 :3665-3677）在 ff 失败后重新判定——若 develop 推进的部分经 `--classify-delta` 全部落在 `DOC_SURFACES` 内（"doc/inert"），就直接复用上一次 green、跳过重跑全量 suite、直接重试 ff；否则要重新跑一次全量 suite（约 400-900s 墙钟 + 独占 suite 单飞锁）。

`goals/*.md`（goal-store 的 store-commit，`packages/quay/src/goal-store.ts`）语义上和 `tasks/*.md`/`.quay/` 是同一类东西——任务板/遥测面，纯 markdown，没有任何 checker 把它当代码对象读——但它不在 `DOC_SURFACES` 里，命中 `isDocPath` 的兜底 `return false`，被判成代码，逼一次不必要的全量重跑。

**实测验证（2026-09-09，两条负控制齐全）**：
```
$ node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root . tasks/AC-999-fake.md
（stdout 为空 ⇒ 已正确 classify 为 doc，负控制①：证明测法本身有效）

$ node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root . goals/AC-999-fake.md
goals/AC-999-fake.md
（stdout 非空 ⇒ 被判代码，即本任务要修的缺口）

$ grep "@static-object" scripts/test.sh | grep -i goal
（零命中 ⇒ 没有任何 checker 把 goals/*.md 登记为它读的代码对象，加进 DOC_SURFACES 不会误伤"某个 checker 读 goals/ 当代码"的情形——这条自检本身就是 isDocPath 的 registry-override 分支先于 DOC_SURFACES 生效这一结构保证的，不需要额外机制）
```

**实际收益（过去 48h 实测基线）**：过去 48h 内 goal-store-commit 型旁路写手（`goals: AC-<n> 写盘即提交（store-commit）`）出现 27 次；过去 48h 内 24 次 ff-red 全部是 "not a fast-forward"（develop 在 fan-in 跑 suite 期间被别的写手推进）。凡是"推进面只含 goals/*.md"这一种情形命中的 ff 重试，本任务落地后应从"逼一次全量重跑（约 400-900s + 占用 suite 单飞锁）"降为"零成本重试 ff（无需重跑 suite）"。

**范围边界（明确排除）**：不改变锁机制本身（suite 单飞锁槽数不动）；不改变 promotion-driver/task_write 等其它旁路写手的传播路径（那是 `GOAL-011` 的范围，`orchestration/SPEC-store-commit-unification-2026-09-08.md` §5 阶段 2，本任务与之独立、互不依赖）；不新增机制——只是给已经存在、已经在跑的 `DOC_SURFACES` 登记表加一行。

## Acceptance Criteria

- [x] AC1（能取假，登记表含 goals/）：`grep -n '"goals/"' plugin/scripts/select-static-checks-for-touches.ts` 命中 `DOC_SURFACES` 数组内（⛔ 只在别处提及不算）。
- [x] AC2（能取假，行为验证）：`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root . goals/AC-999-fake.md` 的 stdout 变为空（⛔ 仍非空 ⇒ 假）。
- [x] AC3（能取假，负控制不破坏既有 doc 判定）：同一条命令对 `tasks/AC-999-fake.md` / `docs/x.md` / `.quay/x.json` 跑，stdout 仍为空（⛔ 任一变非空 ⇒ 回归）。
- [x] AC4（能取假，负控制不误伤真代码）：对 `packages/quay/src/goal-store.ts`（真实代码文件，恰好路径含 "goal" 但不在 `goals/` 目录下）跑同一条命令，stdout 仍非空（⛔ 变空 ⇒ 过度匹配，说明改动方式错了——必须是路径前缀匹配 `goals/`，不是子串匹配 "goal"）。
- [x] AC5（能取假，既有测试不回归 + 新增覆盖本次改动）：`plugin/test/fan-in-execute-paths.test.mjs` 里 `① REAL doc delta — tasks/ + docs/ + adr/ + .quay/ only must classify as doc` 这条测试更新覆盖 `goals/`（标题同步改为含 goals/），且 `node --no-warnings --experimental-strip-types --test plugin/test/fan-in-execute-paths.test.mjs plugin/test/select-static-checks-for-touches.test.mjs` 退出 0。

## Definition of Done

`DOC_SURFACES` 数组新增 `"goals/"` 一项；AC1-AC5 全部勾选且可复现（AC2-AC4 的三条命令重新跑一遍读数与任务体一致，不是"测试绿"就算数——DIR-026 Reading A）；`scripts/test.sh` 全量套件绿（无回归）。

## Touches

- plugin/scripts/select-static-checks-for-touches.ts（DOC_SURFACES 数组加一行 "goals/"）
- plugin/test/fan-in-execute-paths.test.mjs（① 号测试标题与断言覆盖 goals/，含新增负控制用例）
- tasks/gap-doc-surfaces-missing-goals-prefix.md