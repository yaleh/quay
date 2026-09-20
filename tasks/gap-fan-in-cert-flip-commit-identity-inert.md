---
id: gap-fan-in-cert-flip-commit-identity-inert
title: suite 证书闸对 driver 自己的 flip-done 提交按【身份】判惰性，不再交给依赖 registry
  的分类器——外部项目每个任务白烧 3～6 次全量 suite 的根因修复
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（分类器在安装布局下没跑起来）、gap-fan-in-ff-retry-reruns-suite-on-inert-increment（惰性增量不重跑 suite）、gap-ff-merge-quotepath-breaks-inert-retry。

**问题（另一项目实测报告 + 本仓复现，2026-09-20）**：flip-done 在 suite 跑完之后把 `tasks/<id>.md` 提交到任务分支，tip 于是超过 `suite_head`；证书闸（`packages/quay/src/fan-in/ff-merge.ts` 约 455-467 行）因此必须判定 `suite_head..tip` 是否惰性，调 `select-static-checks-for-touches.ts --classify-delta`。该分类器读 `<root>/plugin/scripts/runner-static-gate.ts`（`TEST_SH_REL` 硬编码），外部项目没有它 ⇒ exit 2 ⇒ `not-evaluated` ⇒ fail-closed 拒 ff ⇒ 白烧一次全量 suite；重投直到某次 flip-done 恰为 no-op（delta 为空）才落地。该项目实测每个任务 3～6 次尝试、3 次全量 suite 才落一次，3 个任务因此被重试上限翻成 needs-human。本仓复现：`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root <无 registry 的外部项目> tasks/x.md` exit 2；放一个空 `plugin/scripts/runner-static-gate.ts` 后 exit 0（`tasks/x.md` 惰性、`src/app.ts` 与 `README.md` 判为代码）。`ff-merge.ts` 与 `v0.10.0` 无差异，缺陷在 develop 上同样存在。

**人的裁定（2026-09-20，逐字）**：不希望 driver 自动停掉所有任务；重试上限保持不变；「仍会一次翻出多个 needs-human，每个都带同样的原文判词：接受」；不做仪器故障免计数、不做失败指纹停派（历史回放：指纹相同即停会停 92 个任务，其中 89 个后来落地，故否决）。

**做法**：证书闸在调分类器**之前**先做身份判定：若 `git rev-list suite_head..tip` **恰好一个提交**，且其父提交 == `suite_head`，且 `git diff --name-status suite_head tip` **恰好一行、状态为 M、路径 == 该任务在 `tasks_dir` 下的任务文件**（`tasks_dir` 读自 `.quay/config.yml` 已启用 provider，⛔ 不写死 `tasks/`）⇒ 判惰性，不调分类器。任一条不满足 ⇒ 落回现有分类器路径（行为不变）。不改重试上限、不改 needs-human 逻辑。

## AC

- [ ] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例覆盖：① 单个 flip 提交、仅 M 该任务文件 ⇒ 惰性且**分类器未被调用**（以调用计数或 stub 断言）；② 同一提交多改一个文件 ⇒ 落回分类器；③ 两个提交 ⇒ 落回分类器；④ 状态为 A/R/D ⇒ 落回分类器；⑤ 改的是**别的任务**的文件 ⇒ 落回分类器；⑥ `tasks_dir` 配成非 `tasks/` 目录时按配置判定。
- [ ] 反例判据（硬规则 4 推论三）：把身份判定短路关掉（注入 seam 置为 false）后，用例 ① 必须变红（证明它读到了真实的判定，不是回声）。
- [ ] 真实对象：在临时外部 git 项目（无 `plugin/scripts/runner-static-gate.ts`）里，建任务分支、造 suite_head、追加一个只改 `tasks/<id>.md` 的 flip 提交，运行证书闸——修复前 `NOT-EVALUATED`（贴出原文），修复后通过（贴出原文）。同一项目里追加一个改 `src/app.ts` 的提交后仍走分类器（结果仍为 NOT-EVALUATED，贴出）——证明身份判定不放宽其它路径。
- [ ] `scripts/test.sh --for-task gap-fan-in-cert-flip-commit-identity-inert` exit 0。

## DoD

在无 registry 的外部项目里，真实走通「suite 绿 → flip-done → 证书闸」不再因 NOT-EVALUATED 被拒；只改任务文件的 flip 提交被判惰性，任何多出的文件或提交仍走原分类器；重试上限与 needs-human 逻辑字节未变。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-fan-in-cert-flip-commit-identity-inert.md
