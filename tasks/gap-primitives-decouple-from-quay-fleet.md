---
id: gap-primitives-decouple-from-quay-fleet
title: quay 去 quay-fleet 依赖：primitives 改本地基线，静态门不再读外部仓库
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

`packages/quay/src/primitives/PROVENANCE.md` 把四个 `.mjs` 声明为 quay-fleet 的逐字节副本，规则是"去 quay-fleet 改再 re-pin"；`primitives-drift-check.ts` 通过 `primitives-drift-manifest.json` 的 `fleetRepo` 读仓库外的 `/data/home/yale/work/quay-fleet-org.git`，并在缺失时 exit 3；`runner-static-gate.ts:691` 把它接进门。结果是 quay 的源真源在 quay-fleet，且换一台机器该不变式永久 NOT-EVALUATED。上游已冻结，双侧比对只剩"本地没被就地改过"这一价值。

本任务翻转方向：quay 成为 canonical；manifest 只保留本地 sha256 基线；checker 只做单侧比对；静态门不再依赖任何外部仓库路径；测试与目录声明同步。

## Plan

1. `PROVENANCE.md`：保留来源与冻结镜像的历史记录，删掉"去 quay-fleet 改"的规则，改为"quay 为 canonical；就地修改必须同提交更新本地基线"。
2. `primitives-drift-manifest.json`：删 `fleetRepo`/`fleetSha`/`fleetSourceDir`；保留四个 sha256（或改名 `localSha256`）。
3. `primitives-drift-check.ts`：只比对本地文件与基线；基线不可读 ⇒ exit 3；不再读外部仓库。
4. `runner-static-gate.ts`：更新注释与 checker 描述；接法不变。
5. 测试：`plugin/test/primitives-drift-check.test.mjs` 改成"改本地文件 ⇒ 红 / 恢复 ⇒ 绿"；`session-primitives-adoption.test.mjs` 去掉 `fleetRepo` 读取与 skip 分支。
6. `capability-catalog-declarations.json` 的描述改为本地基线。
7. `serve-send.ts:43` 注释改为"imports the shared primitive"，不再声称 byte-identical。
8. 夹具去耦：`packages/quay/test/goal-store.test.mjs` 的 quay-fleet 二进制名换成中性占位；`plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt` 保留为历史夹具并加来源说明。
9. 验证：没有外部镜像时 checker 仍能给出 0/1，不再有 3；用临时基线文件模拟基线不可读 ⇒ exit 3。

## AC

- [ ] `node --test plugin/test/primitives-drift-check.test.mjs plugin/test/session-primitives-adoption.test.mjs` 退出码 0。
- [ ] `rg -n 'fleetRepo|/data/home/yale/work/quay-fleet' plugin/scripts packages/quay` 在实现文件零命中；`PROVENANCE.md` 的历史来源段是唯一允许的提及，且显式标注为只读历史。
- [ ] checker 只读仓库内基线；基线不可读 ⇒ exit 3；本地文件改动 ⇒ exit 1；恢复 ⇒ exit 0。
- [ ] 静态门不再有"外部仓库缺失 ⇒ NOT-EVALUATED"的路径；`runner-static-gate.ts` 的注释与行为一致。
- [ ] 负控：删掉一个 primitive ⇒ 红；把基线 sha256 改错 ⇒ 红；只改基线不改文件 ⇒ 红。

## DoD

真实交付物是本地基线 manifest、单侧 checker、静态门注释与实现、同步后的测试与目录声明，以及一份证据文档。证据必须包含改动前后 `rg` 的命中计数、三条负控的实际退出码，以及"无外部镜像仍可评估"的读数；不能只用 fixture。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务把 primitives 的基线从外部仓库改为本地基线，属于依赖方向的清理，未产生 L_D/L_G 数值读数。

## Touches

- packages/quay/src/primitives/PROVENANCE.md
- plugin/scripts/primitives-drift-manifest.json
- plugin/scripts/primitives-drift-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/primitives-drift-check.test.mjs
- plugin/test/session-primitives-adoption.test.mjs
- packages/quay/src/serve/io/serve-send.ts
- packages/quay/test/goal-store.test.mjs
- plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt
- docs/evidence/2026-11-06-primitives-decouple.md (new)
- tasks/gap-primitives-decouple-from-quay-fleet.md
