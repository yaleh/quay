---
id: gap-quay-init-config-heredoc-leaks-maintainer-comments
title: quay-init 把写给维护者的 heredoc 注释原样写进下游 .quay/config.yml（且句子被拼断）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：`plugin/scripts/quay-init.sh:1505` 用未加引号的 heredoc（`cat > "$cfg" <<EOF`）写出第三方项目的 `.quay/config.yml`。heredoc 正文里夹着一段**写给 quay 维护者的注释**（`:1523-1536`：「本 heredoc 是【新装】写者……」「本 heredoc 的定界符 EOF 未加引号……」「实证 2026-09-18……」「该不变式由 plugin/test/quay-init-loop.test.mjs 的 AC5 钉住……」）。这些注释讲的是 `quay-init.sh` 自身的实现细节，却被**原样写进每一个下游项目的配置文件**。而且这段注释是被拼断的：第一句「⚠️ 本 heredoc 是【新装】写者，而版本级默认值的正本是 packages/quay/src/init.ts 的」没说完，中间插进 7 行别的内容，才接上「LOOP_VERSION_DEFAULTS（CLI 的 quay init --reconcile 子命令用它做 diff）」。

**生产实例**：claudecodeui 的 `.quay/config.yml`（2026-09-20 由 quay-init 写出）原样带着这段注释。读这个配置的人把「实证 2026-09-18 … 整个文件变成非法 YAML … 三个真装机 e2e 全红」误读成了**本项目**发生过的事故（实为 quay 自己的事故，已由 `cd8e46091` 修复并由 AC5 守卫钉住，早于该项目安装）。

**修法（方向）**：
1. 把维护者注释移出 heredoc，放到 `cat` 之上作为 shell 注释；heredoc 正文只保留**对配置使用者有意义**的注释（例如 `loop.test_command` 的参数契约）。
2. 更彻底的一步（推荐）：config 的新装写出迁到 `packages/quay/src/init.ts`（python 部分已按 `gap-arch-quay-init-sh-python-heredocs-to-native` 迁入），用 YAML 序列化器生成，写入前做一次解析回读，再原子写入。这样「未加引号的 heredoc 执行命令替换」这一类问题整体消失，AC5 守卫也可以随之退役。
3. 修正被拼断的那句注释（不论它最终留在哪里）。

## AC

- [ ] `node --test plugin/test/quay-init-loop.test.mjs` 退出 0，新增用例：在临时目录新装一次，写出的 `.quay/config.yml` 中不含 `heredoc`、`EOF`、`quay-init-loop.test.mjs`、`实证 2026-09-18` 这类维护者用语（断言按行，列出命中行）。
- [ ] 同一用例：写出的文件能被 YAML 解析，且 `providers.native.path`、`loop.test_command`、`loop.worktree_root`、`loop.fork_baseline` 取值与改动前逐字一致（负控，行为不回归）。
- [ ] `grep -n "而版本级默认值的正本是" plugin/scripts/quay-init.sh packages/quay/src/init.ts` 命中的那一句是完整的一句（下一行不是另一段注释）。
- [ ] `bash scripts/test.sh --for-task gap-quay-init-config-heredoc-leaks-maintainer-comments` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：用含修复版本的插件在一个全新的临时第三方目录跑一次真实 `quay-init`（不是只跑单测），写出的 `.quay/config.yml` 不含维护者注释且 YAML 合法；对一个已有项目跑一次升级路径（`quay init --reconcile` 或等价入口），结果保持合法 YAML 且用户自定义的键不被覆盖。完成记录附两次写出的文件摘要。

## Touches

- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- plugin/test/quay-init-loop.test.mjs
- tasks/gap-quay-init-config-heredoc-leaks-maintainer-comments.md
