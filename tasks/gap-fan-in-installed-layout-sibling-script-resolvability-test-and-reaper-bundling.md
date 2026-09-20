---
id: gap-fan-in-installed-layout-sibling-script-resolvability-test-and-reaper-bundling
title: fan-in 兄弟脚本在【打包安装+外部项目】布局下可解析的真实布局测试，并把 worktree-process-reaper 打进
  dist（缺陷成簇：分类器 registry 与 reaper 同类）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-fan-in-instrument-availability-self-check
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（同一族：把兄弟脚本改走统一解析器）。

**问题（直接量）**：`ff-merge.ts` 通过 `siblingScriptArgv(scriptsDir, name)` 解析 `select-static-checks-for-touches.ts`、`touches-orthogonality-check.ts`、`worktree-process-reaper.ts` 等兄弟脚本，可解析 = dev `.ts` 存在，或 `<scriptsDir>/dist/<name>.js` 存在。实测：本仓 `plugin/scripts/dist`（102 个文件）与本机 0.7.0 缓存的 `scripts/dist`（99 个文件）都有 `select-static-checks-for-touches.js` 而**没有** `worktree-process-reaper.js`；`packages/quay/scripts/build-plugin-dist.mjs` 与 `package.sh` 没有 reaper 的打包引用。所以装好的 quay 里 reaper 解析不到（另一项目日志 `worktree-process-reaper not resolvable`），只是它在失败路径上才触发，暂时无害。**没有任何测试在「纯打包安装 + 外部项目」布局下运行过这些解析**——registry 路径缺陷与 reaper 缺失是同一类漏测（缺陷成簇，硬规则 5b）。0.10.0 产物是否同样缺失未验证，本任务要先读产物取数。

**做法**：① 打包入口清单（`packages/quay/scripts/build-plugin-dist.mjs`）加入 `worktree-process-reaper`。② `ff-merge.ts` 导出它所有 `siblingScriptArgv` 调用点的脚本名清单（单一定义，⛔ 测试不各抄一份）。③ 新增测试 `plugin/test/installed-layout-sibling-resolvability.test.mjs`：用真实 `package.sh`/`build-plugin-dist.mjs` 产物（不是手拼目录）建打包布局，断言清单里每个脚本都可解析；再在一个临时外部 git 项目上跑一次证书闸（flip 提交惰性、非 flip 的 code delta 走已评估的分类器），确认端到端不出现 not-evaluated / not resolvable。

## AC

- [ ] 修复前取数：对当前 `packages/quay/scripts/package.sh` 的真实产物，列出清单中「不可解析」的脚本名（应至少含 `worktree-process-reaper.ts`），贴出命令与输出（硬规则 12b：先查现状再修）；并对 v0.10.0 的产物做同一取数，贴出结果。
- [ ] `node --test plugin/test/installed-layout-sibling-resolvability.test.mjs` exit 0：清单中每个脚本在打包布局下可解析；清单由 `ff-merge.ts` 导出，`grep -n "siblingScriptArgv(" packages/quay/src/fan-in/ff-merge.ts` 的调用点数量（贴出条数与前 3 条）等于清单长度（新增调用点而忘登记 ⇒ 用例红）。
- [ ] 反例判据：把 `worktree-process-reaper` 从 `build-plugin-dist.mjs` 入口清单里临时删除，上述用例必须变红；还原后变绿（两次输出都贴出）。
- [ ] 端到端：打包布局 + 临时外部项目上，证书闸对 flip 提交与对 `src/app.ts` 的 delta 均给出**已评估**结论（无 not-evaluated），reaper 步骤日志不含 "not resolvable"。
- [ ] `scripts/test.sh --for-task gap-fan-in-installed-layout-sibling-script-resolvability-test-and-reaper-bundling` exit 0。

## DoD

用真实打包产物在真实外部临时项目上走通一次 fan-in 证书闸与 reaper，日志里没有任何 not-evaluated / not resolvable；并有一条会在「再新增一个兄弟脚本而忘了打包」时变红的测试，证据是产物上的真实读数，不是 fixture 自证。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs
- packages/quay/scripts/package.sh
- packages/quay/src/fan-in/ff-merge.ts
- plugin/scripts/worktree-process-reaper.ts
- plugin/test/installed-layout-sibling-resolvability.test.mjs
- tasks/gap-fan-in-installed-layout-sibling-script-resolvability-test-and-reaper-bundling.md
