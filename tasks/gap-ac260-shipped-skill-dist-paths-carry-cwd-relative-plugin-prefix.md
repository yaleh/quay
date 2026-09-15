---
id: gap-ac260-shipped-skill-dist-paths-carry-cwd-relative-plugin-prefix
title: 交付面 skill/loop 文档里的 scripts/dist/*.js 引用全部带 cwd 相对 plugin/ 前缀——在消费项目里一个都解析不到
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-260
---
**type:** execution

## Proposal

**根因**：`packages/quay/scripts/build-plugin-dist.mjs:445-459` 的 `rewriteMarkdown` 把 markdown 里的 `plugin/scripts/X.ts` 引用重写成 `plugin/scripts/dist/X.js`，但**从不加任何 plugin-root 前缀**（该文件内 `CLAUDE_PLUGIN_ROOT` grep 零命中）。

**实测读数（2026-09-15，对 `dist-plugin` 分支直接测量）**：交付面共 96 个 `scripts/dist/*.js` 引用，**其中带 cwd 相对 `plugin/` 前缀的 96 个、在消费项目布局下解析得到的 0 个**，跨 `loop/fast-mode-loop-tick.md` 与 8 个 skill（`cold-start` / `manager` / `drivers` / `loop-driver` / `routines` / `quay-file-task` / `quay-directive` / `quay-task-operator`）。

**为什么这些路径在消费项目里解析不到**：`plugin/scripts/publish-dist-branch.sh:106-107` —— plugin-level marketplace source 不支持 path 子目录参数，所以孤儿分支的根**就是 plugin 本身**。消费项目的 plugin cache 里没有 `plugin/` 这一层，于是 `plugin/scripts/dist/X.js` 全部落空。这是「在开发检出里两个锚点恰好重合 ⇒ 自测结构上不可能报红」的又一实例。

**一个更错一层的特殊形态**：`skills/cold-start/SKILL.md:35,52,118,169` 用的是 `<root>/plugin/...`，其中 `<root>` 是**工作区 root** 而不是 plugin root —— 比其余 8 处多错一层（既错前缀、又错锚点）。

**判据刻意不锁具体写法**：⛔ 不要求必须是 `${CLAUDE_PLUGIN_ROOT}`。官方文档对「该变量在 SKILL.md 正文中是否可用」未明确表态（只确认 hooks 与 MCP command 上下文可用）；间接证据支持可用（`plugin/scripts/start-drivers.ts:116` 注释称其 harness-provided、`plugin/skills/init/SKILL.md:41-44` 已在生产依赖它），但实现时**必须先实测**，不可用就换等价的自解析形式（相对 skill 文件自身位置解析等）。

**范围与 Touches 纪律**：本条的修点是 rewrite 产出侧。若实测表明必须同时改 `plugin/skills/cold-start/SKILL.md` 源文件本身（那四处 `<root>/plugin/...`），**先更新 `## Touches` 再改**——不要在未声明的文件上落改动（fan-in 的 delta 判定会把它判成与任务无关）。

**查重（按机制，不按症状）**：`gap-delivery-laydown-dist-closure-gap`（done）改的是 quay-init 闭包正则能否解析两段 `dist/X.js`，不是 rewrite 产出的前缀；`gap-tick-core-third-copy-drift-packages-face`（superseded）是 npm 面快照漂移。两条都不覆盖本条。

## Contract

measure shipped_dist_ref_prefix = `git show dist-plugin:skills/cold-start/SKILL.md` 等交付面文件里 scripts/dist/*.js 引用的 resolvable_count 与 cwd_relative_count 两个计数
band n/a: 不设数值带——判据是「消费项目布局下解析得到的引用数 = 引用总数」，不是一个区间
invariant marketplace_root_is_plugin = 孤儿分支的根就是 plugin 本身，故交付面 markdown 不得出现以 plugin/ 开头的 cwd 相对脚本路径
invoke `node --experimental-strip-types packages/quay/scripts/build-plugin-dist.mjs --rewrite`
control 把一个已修好的引用改回 plugin/scripts/dist/X.js 形态 ⇒ 新测试必须红（判据能取假）
resume 重跑 `bash plugin/scripts/publish-dist-branch.sh` 后重新测量交付面引用的 resolvable_count

## Acceptance Criteria

- [ ] AC1：`rewriteMarkdown` 产出的每一个 `scripts/dist/*.js` 引用在消费项目的 plugin cache 布局下解析得到——对真实 `dist-plugin` 交付面（或同款 `--rewrite` 产物）逐个引用做存在性核对，resolvable_count 等于引用总数、cwd_relative_count 为 0。
- [ ] AC2：负控制能取假——`plugin/test/shipped-skill-dist-path-resolvability.test.mjs` 把一个引用改回 `plugin/scripts/dist/<name>.js` 形态后必须红，改回正确形态必须绿（红绿两面都实测，⛔ 不是「跑一遍看它绿」）。
- [ ] AC3：`skills/cold-start/SKILL.md` 的 `<root>/plugin/...` 四处（`:35` / `:52` / `:118` / `:169`）在 rewrite 产物里不再以工作区 root 为锚点——按位置核对该文件的 rewrite 产物，工作区-root 锚点命中数为 0（注释/散文提及不算命中）。
- [ ] AC4：`${CLAUDE_PLUGIN_ROOT}` 在 SKILL.md 正文里究竟可用与否由**实测**确定，读数写进 `## Evidence`（可用 ⇒ 采用它；不可用 ⇒ 采用等价自解析形式）；⛔ 不得只凭 `plugin/skills/init/SKILL.md:41-44` 的既有用法推断可用。
- [ ] AC5：生产载体读数——实现落地并重跑 `bash plugin/scripts/publish-dist-branch.sh` 之后，真实 `dist-plugin` 交付面上 resolvable_count 等于引用总数（⛔ 只有 fixture 满足不算，硬规则 4 推论三）。

## Definition of Done

- [ ] AC1–AC5 全勾，且 AC1/AC5 的读数取自真实 `dist-plugin` 交付面而非 fixture（inherited-core 的标准 DoD：REAL LANDING 才是门槛，artifacts 不是）。
- [ ] 实现落地后**重跑 `bash plugin/scripts/publish-dist-branch.sh`**——否则 AC-260 读到的仍是旧交付面（同「落地后不重启 = 改动不生效」那一族）。
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac260-shipped-skill-dist-paths-carry-cwd-relative-plugin-prefix` 绿；全量由 fan-in 机械跑，本任务自身不要求。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 无（立案当轮按人给定的根因/实测读数/Touches 原样落盘）

## Touches

- packages/quay/scripts/build-plugin-dist.mjs
- plugin/test/shipped-skill-dist-path-resolvability.test.mjs (new)
- tasks/gap-ac260-shipped-skill-dist-paths-carry-cwd-relative-plugin-prefix.md
