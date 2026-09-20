---
id: gap-classify-delta-registry-path-layout-aware
title: --classify-delta 的 registry
  查找认打包安装布局（<插件根>/scripts/runner-static-gate.ts），装好的 quay 在外部项目里对非 flip 的 delta
  也能出结论
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-fan-in-cert-flip-commit-identity-inert
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（把分类器与 registry 装进产物）。

**问题（读码，2026-09-20）**：`plugin/scripts/select-static-checks-for-touches.ts:60` 硬编码 `TEST_SH_REL = "plugin/scripts/runner-static-gate.ts"`，`:770` 按 `<root>/${TEST_SH_REL}` 读，找不到 ⇒ exit 2。而 `packages/quay/scripts/package.sh:170-178` 打包时把注册表放在 `<插件根>/scripts/runner-static-gate.ts`（拍平，没有 `plugin/` 层）。`ff-merge.ts` 的 `classifyRootCandidates` 给出 `[root, scriptsDir/../.., scriptsDir/../../.., scriptsDir/..]`，其中 `scriptsDir = <插件根>/scripts/dist`，于是 `<插件根>/plugin/scripts/…` 在纯打包安装里永不存在。本机 0.7.0 缓存能命中只是因为缓存里恰好带了一份嵌套 `plugin/`；0.6.1–0.6.3 缓存里则根本没有该文件。结果：任何非 quay 自宿主项目里，装好的 quay 对**非 flip 提交**的 delta（例如 worker 在 suite 之后又提交了别的文件）也无法分类。

**做法**：让 registry 查找同时接受 `<root>/plugin/scripts/runner-static-gate.ts` 与 `<root>/scripts/runner-static-gate.ts`（先前者、后者作兜底），⛔ 不引入第二份路径常量副本（导出一个候选列表，供 `classifyRootCandidates` 与分类器共用）；`classifyRootCandidates` 保证包含打包布局的插件根。**不改语义**：外部项目既无自身 registry、又不在打包布局下 ⇒ 仍是 `not-evaluated`（不发明「空 registry」判决）。

## AC

- [ ] `node --test plugin/test/select-static-checks-for-touches.test.mjs` exit 0，新增用例：① `<root>/plugin/scripts/runner-static-gate.ts` 存在 ⇒ 现有行为不变；② 仅 `<root>/scripts/runner-static-gate.ts` 存在 ⇒ 命中；③ 两者皆无 ⇒ exit 2 且 stderr 含原有 "registry file … not found" 文案（负控制：证明没有伪造判决）。
- [ ] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例：以打包布局（`scriptsDir=<pluginroot>/scripts/dist`，registry 在 `<pluginroot>/scripts/`）为 scriptsDir、外部项目为 root，对 `tasks/x.md` 判惰性、对 `src/app.ts` 判 non-inert（均为**已评估**，不是 not-evaluated）。
- [ ] 路径常量单一：`grep -rn "runner-static-gate.ts" packages/quay/src/fan-in/ff-merge.ts plugin/scripts/select-static-checks-for-touches.ts` 打印命中并确认只有一处常量定义，其余为引用/注释（前 3 条命中贴出）。
- [ ] `scripts/test.sh --for-task gap-classify-delta-registry-path-layout-aware` exit 0。

## DoD

用真实 `package.sh` 产出的打包布局（不是 fixture 拼出来的目录）作 scriptsDir，对一个外部临时 git 项目运行证书闸的分类路径：`tasks/x.md` 判惰性、`src/app.ts` 判 non-inert，且两者均为已评估结论；拿掉打包 registry 后同命令回到 not-evaluated（对照）。

## Touches

- plugin/scripts/select-static-checks-for-touches.ts
- plugin/test/select-static-checks-for-touches.test.mjs
- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-classify-delta-registry-path-layout-aware.md
