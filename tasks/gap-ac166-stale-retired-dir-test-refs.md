---
id: gap-ac166-stale-retired-dir-test-refs
title: gap-ac166 退役 .claude 双副本后 fixture-hash 前置 + M179 readdirSync
  两条测试仍引用已退役目录，全量 suite 确定性 2 红
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

gap-ac166-second-copy-retirement（done）退役了 `.claude/workflows/` 与 `.claude/skills/` 双副本，但留下两处确定性 suite 红，阻塞所有 fan-in 的全量门：

1. `plugin/test/quay-init-loop-fixture-hash.test.mjs:103` 前置断言 `precondition: repo-root .claude/workflows must exist`——`.claude/workflows` 已被退役（`git ls-tree develop` 为空），前置恒假。
2. `plugin/test/plugin-packaging.test.mjs:663`（M179）`fs.readdirSync('.claude/skills')`——目录整体 `git mv` 到 archive 后不复存在，抛 ENOENT。

根因：gap-ac166 的 `## Touches` 未覆盖 fixture-hash 测试与其源 `plugin/test/helpers/quay-init-install-fixture.mjs`（`_pluginSurfaceHash` 第 190 行仍 walk `path.join(pluginRoot, "..", ".claude", "workflows")`，注释 181–188 亦陈旧）；`plugin-packaging.test.mjs` 虽在 Touches 里，但只改了 M143 断言、漏了 M179 的 `readdirSync`。

修复方向：`_pluginSurfaceHash` 去掉 `.claude/workflows` 根（收敛到 `plugin/workflows` 单一根）；fixture-hash 测试移除 `.claude/workflows` 前置与 `.claude/workflows`-only 测试；M179 断言改为「`.claude/skills` 不存在」（ENOENT 语义），归档断言保留。修完做 5b sweep：grep 全仓其余 `.claude/workflows`/`.claude/skills` 引用，确认仅剩合法的退役检查/负控制/archive 路径，命中数贴提交。

## AC

- [x] AC1（能取假，机制级）：`_pluginSurfaceHash` 不再 walk `.claude/workflows`——`grep -n '\.claude.*workflows' plugin/test/helpers/quay-init-install-fixture.mjs` 命中 0 处 walk 根。
- [x] AC2（能取假）：`node --experimental-strip-types --test plugin/test/quay-init-loop-fixture-hash.test.mjs` exit 0（无 `.claude/workflows must exist` 前置红）。
- [x] AC3（能取假）：`node --experimental-strip-types --test --test-name-pattern "M179" plugin/test/plugin-packaging.test.mjs` exit 0（无 ENOENT）。
- [x] AC4：全量 `scripts/test.sh` 绿（这两条确定性红消除，无新增红）。

## DoD

两条确定性 suite 红（fixture-hash 前置 + M179 readdirSync）消除，全量 suite 绿；`_fixtureHash` 对 `plugin/workflows` 单一根的覆盖仍能取假（workflow-only 变更仍改 hash）。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs
- plugin/test/quay-init-loop-fixture-hash.test.mjs
- plugin/test/plugin-packaging.test.mjs
- tasks/gap-ac166-stale-retired-dir-test-refs.md（自身）