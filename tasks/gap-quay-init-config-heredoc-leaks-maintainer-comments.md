---
id: gap-quay-init-config-heredoc-leaks-maintainer-comments
title: quay-init 把写给维护者的 heredoc 注释原样写进下游 .quay/config.yml（且句子被拼断）
status: ready
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

- [x] `node --test plugin/test/quay-init-loop.test.mjs` 退出 0，新增用例：在临时目录新装一次，写出的 `.quay/config.yml` 中不含 `heredoc`、`EOF`、`quay-init-loop.test.mjs`、`实证 2026-09-18` 这类维护者用语（断言按行，列出命中行）。
- [x] 同一用例：写出的文件能被 YAML 解析，且 `providers.native.path`、`loop.test_command`、`loop.worktree_root`、`loop.fork_baseline` 取值与改动前逐字一致（负控，行为不回归）。
- [x] `grep -n "而版本级默认值的正本是" plugin/scripts/quay-init.sh packages/quay/src/init.ts` 命中的那一句是完整的一句（下一行不是另一段注释）。
- [x] `bash scripts/test.sh --for-task gap-quay-init-config-heredoc-leaks-maintainer-comments` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：用含修复版本的插件在一个全新的临时第三方目录跑一次真实 `quay-init`（不是只跑单测），写出的 `.quay/config.yml` 不含维护者注释且 YAML 合法；对一个已有项目跑一次升级路径（`quay init --reconcile` 或等价入口），结果保持合法 YAML 且用户自定义的键不被覆盖。完成记录附两次写出的文件摘要。

## 实现读数（AC 逐条 + DoD 两次写出）

**改动面**：`plugin/scripts/quay-init.sh` 的 `write_config()` —— 维护者注释整段移出未加引号的 heredoc，成为 `cat` 之上的 shell 注释（heredoc 正文只剩 `loop.test_command` 契约注释 + `fork_baseline` 一行）；被拼断的那句合成完整一句（`:1515` 单行）。新增用例 `AC1/AC2`（`plugin/test/quay-init-loop.test.mjs`）。`docs/analysis/quay-init-closure-ratchet.baseline.json` 机械重锚（`--reanchor`；footprint 3 files/1022 bytes 不变，只有 fingerprint 变 —— 本次是「源改了」而非「footprint 长了」）。**⛔ `packages/quay/src/init.ts` 未改**：本次落 Proposal 修法 ①+③；修法 ②（新装写出整体迁到 TS 序列化器、让 AC5 守卫退役）是一个独立的更大改动 —— 它会改 `plugin/vendor/quay/dist/quay.js` 这个已提交的构建产物面，与本缺陷的修复不是同一件事，故不在此夹带。

**AC①** `node --test plugin/test/quay-init-loop.test.mjs` → exit 0（7 tests / 7 pass / 0 fail）。新用例按行扫描并逐条列出命中行。
**AC②** 同一用例：`YAML.parse` 通过；`providers.native.path` / `loop.test_command` / `loop.worktree_root` / `loop.fork_baseline` 与改动前逐字一致（归一化机器注入的绝对路径后比对），`loop:` 键集合不变（5 键）。
**AC③** `grep -n "而版本级默认值的正本是" plugin/scripts/quay-init.sh packages/quay/src/init.ts` → 1 命中（`plugin/scripts/quay-init.sh:1515`），整句连同 `LOOP_VERSION_DEFAULTS（…）` 收在一行内，下一行是段的空分隔 `    #`（`init.ts` 本就无此句，故只有一条命中）。
**AC④** `bash scripts/test.sh --for-task gap-quay-init-config-heredoc-leaks-maintainer-comments`（裸形态）→ exit 0，151 tests / 0 fail（选择器实测 coverage 0.60，未触发 thin-selection 拒绝）。生产形态 `--allow-thin`（`.quay/config.yml` 的 `scoped_command`，fan-in 实跑的那条）同样 exit 0 / 151 tests / 0 fail，10 个测试文件。

**负控（RED→GREEN）**：把 `plugin/scripts/quay-init.sh` 单独回退到 HEAD、用例不动 → 新用例**红**，6 条命中行逐条列出（`:27 :28 :30 :36 :37`，含 `heredoc`/`EOF`/`实证 2026-09-18`/`quay-init-loop.test.mjs`）；恢复修复版后绿。⇒ 该用例是测量，不是回声。

**DoD 两次写出**：
1. **全新第三方目录**（`git init` + 一次提交）跑真实 `quay-init --loop`：写出的 `.quay/config.yml` 四个维护者用语零命中、`YAML.parse` 通过；正文只剩给使用者看的 `loop.test_command` 契约注释。
2. **升级面**（两路都跑）：① 同一目录注入用户自有内容（`loop.user_knob`、顶层 `my_team`、`loop_extra_owned_by_user`、用户注释行）后重跑 `quay-init` → 报「unchanged … 无 gratuitous rewrite」，用户键与注释逐字保留；② 删掉 `fork_baseline` 后跑 `quay init --reconcile`（该子命令存在但 `quay init --help` 未列出）→ 报 `filled loop.fork_baseline (was absent)`，YAML 合法、`user_knob` / `my_team` / 顶层用户键与用户注释全部保留。

## Touches

- plugin/scripts/quay-init.sh
- packages/quay/src/init.ts
- plugin/test/quay-init-loop.test.mjs
- docs/analysis/quay-init-closure-ratchet.baseline.json
- tasks/gap-quay-init-config-heredoc-leaks-maintainer-comments.md
