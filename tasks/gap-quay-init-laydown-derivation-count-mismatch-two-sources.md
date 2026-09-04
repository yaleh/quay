---
id: gap-quay-init-laydown-derivation-count-mismatch-two-sources
title: 「该落地哪些 plugin/scripts 脚本」有两份互不共享的独立判定——laydown-set-check.sh --list（约62）与
  quay-init.sh derive_loop_scripts()（约119-132）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`docs/proposals/archguard-generation-era-primitives.md` §2.9 报出：`laydown-set-check.sh --list`
认定应落地 **62** 个 `plugin/scripts` 脚本；`quay-init.sh` 自己的 `derive_loop_scripts()` 实际落地
**119–132** 个。"判定该落地什么"的两处逻辑不是同一份正本。

本次立案时现场核实：`bash plugin/scripts/laydown-set-check.sh --list | wc -l` 当前给出 **64**
（与文档的 62 同量级，接近但不完全相等——两个数字本身会随开发漂移，不是本任务的判据来源，本任务
的判据是**两个独立实现之间的对称差**，不是任一方的绝对值）。`derive_loop_scripts()`
（`quay-init.sh:1194`，包装 `_derive_loop_scripts_once()`，四类来源合并：前缀推导/裸文件名解析/
mechanism 语料范围限定/torn-read 三次重试取稳定值）与 `laydown-set-check.sh` 是两套独立维护的枚举
实现，`quay-init.sh:921-931` 的头部注释自述其设计初衷是"从 shipped mechanism docs 自己的引用推导，
避免第二份手工维护的副本"——但 `laydown-set-check.sh` 本身就是这样一份"第二份副本"，与设计初衷
矛盾。

这正是 `docs/proposals/archguard-generation-era-primitives.md` §3 P2（身份复制）"判定重写"的一个
新实例：同一个问题（"该落地哪些脚本"）在仓库里有两个独立算出的答案，且没有任何机制断言它们必须
相等。

**修法方向**：收敛为单一正本——让 `laydown-set-check.sh --list` 直接调用/复用 `quay-init.sh` 的
`derive_loop_scripts()`（或者反过来，`quay-init.sh` 复用 `laydown-set-check.sh` 的枚举结果），不能
两边各自维护一份枚举逻辑。已有的 `gap-laydown-derivation-is-sensitive-to-reference-spelling-dependency-closure`
（done）修的是 `derive_loop_scripts()`**内部**一个具体的正则遗漏（裸文件名引用不被计入），不是这两
个独立实现之间的统一问题，不是重复。

## AC

- [ ] AC1（现场先量差异）：跑 `bash plugin/scripts/laydown-set-check.sh --list | sort > /tmp/a.txt`
      与用等价方式取出 `derive_loop_scripts()` 的枚举结果（如临时插桩打印，或跑一次
      `--dry-run --loop` 观察其枚举出的文件列表）`sort > /tmp/b.txt`，跑 `diff /tmp/a.txt /tmp/b.txt`，
      贴出两条命令、两边计数、以及对称差清单（哪些文件只在一边出现）
- [ ] AC2：收敛为单一正本后，重新执行 AC1 的对照命令，两边计数相等且对称差为空
- [ ] AC3：新增或扩展一个静态检查（可挂在 `plugin/test/laydown-set-check.test.mjs`），断言"该落地
      什么"只有一处实现，另一处必须 import/调用它而非独立重新枚举——防止未来再分裂出第三份
- [ ] AC4：`node --experimental-strip-types plugin/test/laydown-set-check.test.mjs` exit 0

## DoD

用一次真实 `--dry-run --loop`（或等价方式）验证收敛后的枚举结果与 `laydown-set-check.sh --list`
完全一致（AC2 的真实输出贴进任务体），且现有 `plugin/test/quay-init-laydown-closure.test.mjs` /
`plugin/test/quay-init-laydown-dist-closure.test.mjs` 全绿——不是"看代码逻辑上应该一致"就算，要有
一次真跑的对称差=空输出。

## Touches

- plugin/scripts/quay-init.sh（`derive_loop_scripts` / `_derive_loop_scripts_once`）
- plugin/scripts/laydown-set-check.sh
- plugin/test/laydown-set-check.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- tasks/gap-quay-init-laydown-derivation-count-mismatch-two-sources.md
