---
id: gap-retire-unused-quay-author-skill
title: 删除未使用的 quay:author skill + 把 SPEC 探针改指向 quay:execute
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`author` skill（`plugin/skills/author/SKILL.md` + 两份 vendored 副本
`packages/quay/plugin/skills/author/SKILL.md`、`packages/quay-native/skills/author/SKILL.md`，
三份内容基本一致，2026-07-15 首次落地，2026-08-08 最近一次同步提交 9cb480692）在全部会话历史中
（不只是过去一周）从未被真实调用——用精确谓词 `"skill":"author"` / `"skill":"quay:author"` 搜索
全部 transcript（含直属 subagent 与 workflow agent jsonl，覆盖 meta-cc 已知搜不到的两类目录），
命中 0；用已知真实调用过的 `quay:quay-file-task` 同谓词做负控制得 6 次，证明谓词本身有效、非漏检。

根因：`todo→ready` 这条路径已被机械化——`quay-file-task` 立案时即写好四件套，`promotion-driver`
常驻按 `ready-pool-check.ts` 的 `artifactsComplete` 门每轮机械晋升（CLAUDE.md 原话："the promotion
now runs for EVERY eligible candidate"）——完全绕开了这个为"人/agent 交互式撰写四件套"设计的 skill。

冲突（已发现，需一并处理）：`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`
（2026-09-05 仍在编辑）的 AC5 与 T3 实测把 `quay:author` **是否出现在 skill 列表里**（不是是否被
调用）当作插件生命周期隔离的探针信号（"非 quay 项目会话中 PATH 不含 …… 且 `quay:author`
NOT-AVAILABLE"；T3 用 `enabledPlugins:false` 前后 `quay:author` 的 YES/NO 差分证明"启用≠安装"）。
删除该 skill 前必须把这两处探针引用改指向仍存在的 `quay:execute` skill（同一份 SPEC 里其它 AC 已
用同类写法，改法是同构替换），否则这份正在验证的 SPEC 会失效。

删除对象=3 份 vendored SKILL.md 副本（都要删，不留任何一份）+ capability-catalog.sh 等登记面若有
登记项也要摘除；SPEC 探针的 2 处引用（AC5 判据行 + T3 实测行）改写为 `quay:execute`，改写后须保持
"能取假"的原判据形式不变（只换探测对象，不改判据结构）。

人已确认：删除 + 探针改指向 quay:execute（2026-09-05 会话逐字确认）。

## Plan

1. grep 全仓确认 3 份文件路径与所有引用面（capability-catalog / README / 其它 SPEC 文档提及）。
2. 按"vendored 副本一致性"纪律逐份删除并核对无遗留 stub（三份都删，不留任何一份）。
3. 编辑 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` 的 AC5 与 T3 两处，把
   `quay:author` 替换为 `quay:execute`，同时确认 `quay:execute` 在探针语境下同样成立——它也是仅在
   插件启用时可见的 quay skill，语义等价，不需要改判据结构本身。
4. 跑一次真实的"两种 enabledPlugins 设置差分"负控制，或至少确认 T3 描述的差分方法对新探测对象
   （`quay:execute`）依然成立。
5. 核 develop 与 author 是否需要 ff 同步（当前 0/0，预期落地时仍需复核）。

## Acceptance Criteria

- [x] AC1（能取假）：`find . -iname '*author*' -path '*skills*'`（排除 node_modules/.claude/worktrees
      快照）在仓库内不再命中任何 author skill 文件；⛔ 仍残留任一份则假。
- [x] AC2（能取假）：`grep -rn 'quay:author\|"skill":"author"' orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`
      命中 0；同一文件对应位置已改为引用 `quay:execute`；⛔ 仍引用 author 则假。
- [x] AC3（能取假）：SPEC 文档里 AC5/T3 两处改写后，判据的"能取假"形式保持不变（仍是"该 skill
      NOT-AVAILABLE ⇒ 通过"这种结构，只换了探测对象，不是把判据删掉或弱化）；⛔ 判据被弱化或删除
      则假。
- [x] AC4（能取假）：capability-catalog 或其它任何登记面对 author skill 的登记项已摘除
      （`bash plugin/scripts/capability-catalog.sh` 输出不再包含 author skill 条目，或核实它本就
      不在该 catalog 覆盖范围内并在此记录该事实）；⛔ 有登记面仍列出已删除的 skill 则假。
- [x] AC5（能取假）：删除后跑一次相关静态检查/测试套件（至少覆盖 SPEC 涉及的 checker）确认无新增
      红；⛔ 引入新红则假。

## Definition of Done

3 份 author skill 文件已从仓库删除、SPEC 探针 2 处已改指向 `quay:execute` 且判据形式不变、无登记面
残留引用、无新增测试/检查红——一个真实的 `enabledPlugins` 差分场景下 `quay:execute` 的 YES/NO 切换
可复现 T3 原先用 `quay:author` 证明的同一件事。

## Touches

- plugin/skills/author/SKILL.md (delete)
- packages/quay-native/skills/author/SKILL.md (delete)
- plugin/.claude-plugin/plugin.json（编辑：commands[] 与 description 摘除 author 条目）
- plugin/scripts/sync-vendor.sh（编辑：author/execute 镜像收敛为仅 execute）
- plugin/test/plugin-packaging.test.mjs（编辑：wanted/single-source/shippedFiles 三处摘除 author）
- plugin/test/select-tests-for-touches.test.mjs（编辑：AC5 测试摘除 author SKILL.md in-task leg）
- orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md（编辑：AC5×2 + T3 三处 quay:author→quay:execute）
- tasks/gap-retire-unused-quay-author-skill.md（self-touch）
