---
id: gap-ac233-criterion-not-hermetic-host-quota-false-red
title: AC-233 判据非自足——测试依赖 ambient $TMPDIR / npm cache，宿主 /data
  用户配额触顶时同一判据红成假红（恒假），而交付物从未回退
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-233
---
**type:** execution

## Proposal

**现象（两条独立读数，工作树一字未改）**：常设 long-term 判据 AC-233 的判据命令

```
node --no-warnings --experimental-strip-types --test plugin/test/shipped-entry-runnable.test.mjs
```

本轮回红两次（exit 1）；同一份工作树、**未改任何文件**，几分钟后重跑即 **exit 0（2 passed）**。⇒ 交付物没有回退，红的是判据的**读数**。

**实测根因（对照实验，不是主张）**：两次失败点都是**宿主写盘失败**，不是断言失败——`errno 122 = EDQUOT`：

```
# ① negative control：mkdtemp 落在 ambient $TMPDIR
Error: Unknown system error -122: ... mkdtemp '/data/scratch/yale/quay-shipped-entry-nc-XXXXXX'
  at plugin/test/shipped-entry-runnable.test.mjs:221

# ② packedFiles()：npm pack --dry-run 落在 ambient npm cache
status: 134 ... open '/data/home/yale/.npm/_cacache/tmp/***'
  at packedFiles (plugin/test/shipped-entry-runnable.test.mjs:71)
```

`/data` 挂载为 `xfs rw,...,usrquota,prjquota`，本用户的配额在边界上来回摆动——同一秒的可写探针 `mkdir` / `echo > file` 交替成功与失败（本轮实测：21:05 全部失败、21:12 全部成功）。

**对照（若「配额」为假，结果会不同）**：把这两个 ambient 依赖搬到根文件系统上，跑**同一条判据命令** ⇒ **exit 0，2 passed**：

```
TMPDIR=/tmp npm_config_cache=/tmp/npm-cache-probe \
  node --no-warnings --experimental-strip-types --test plugin/test/shipped-entry-runnable.test.mjs   # EXIT=0
```

⇒ 该判据的读数**取决于宿主剩余空间，而不是它所判定的交付物**。这正是硬规则 4c 点名的**恒假**形态（正确实现被判失败）；且它与「交付物真的违规」在 exit code 上**同形**（都是 1），下游无法区分（硬规则 3b）。

**环境侧触发量（记录，⛔ 不是本条要修的对象）**：`~/.cache/quay-e2e-tmp` 累积 **4252** 个未回收的 `quay-e2e-*` 工作区临时目录、**108G**（按 mtime：09-25 400 / 09-26 1685 / 09-27 1671 / 09-28 496，仍在增长；核对时最新一个创建于 3 分钟前并正在被填充成完整工作区）；另有 `/data/scratch/yale` **30912** 条目 / **70G**。**回收这 108G 是环境/独立机制的活**（本仓库源码 grep 不到 `quay-e2e` 字面量，生产者疑在**已安装的 shipped plugin 包**里——作为线索留此，不写进本任务 AC）。

**要修的是判据自身的两处 ambient 依赖**（与「tarball 里有没有形如入口却在安装位置跑不起来的文件」无关）：
① `packedFiles()` 的 `npm pack --dry-run` 读 ambient `~/.npm/_cacache`；
② negative control 的 `fs.mkdtempSync(path.join(os.tmpdir(), "quay-shipped-entry-nc-"))` 读 ambient `$TMPDIR`。

**修法**：**判据必须自足**——自带的临时根 + 显式隔离的 npm cache（`npm_config_cache`），并以**写探针择优**选择可写根，⛔ 不写死 `/tmp` 字面量（硬规则 4 推论二：写死的字面量是依赖宿主的常量，换机就变成真限制且静默）；当**所有**候选根都不可写时，以**可区分的**取值退出（硬规则 3b：不得与「交付物违规」同形）。**单一真相源（硬规则 5b）**：可写根的选择逻辑只有一个落点——落到既有的 `plugin/test/helpers/tmp-workspace.mjs`（349 个测试文件用 `os.tmpdir()`，同一处修才防复发）；⛔ 本任务**不**要求改完这 349 个文件。

<!-- dedup-ref --> 相关但不同机制（均为 `done`，本条不重复其工作）：`gap-shipped-entry-files-not-runnable`（建立该判据、把 `bin/quay.js`+`bin/quay.ts` 排除出 `files`）、`gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry`（曾把每个带 shebang 的随包脚本误判为入口 ⇒ 判据结果依赖运行环境）、`gap-suite-ambient-reds-block-all-code-landings`（ambient 红阻塞落地，属 ff 闸）。本条治的是**同一判据的第三处环境耦合**，不重开上述三条。

## AC

- [ ] AC1 **判据自足（$TMPDIR 侧）**：`TMPDIR` 指向一个不可写路径时，`node --no-warnings --experimental-strip-types --test plugin/test/shipped-entry-runnable.test.mjs` 仍 **exit 0**，且输出不含 `Unknown system error -122`（写探针择优生效）。可复现命令：`TMPDIR=/nonexistent-quota-probe ...`（或 mode 500 的目录）
- [ ] AC2 **npm cache 显式隔离**：该测试调用 `npm pack` 时带**显式** cache 目录（`npm_config_cache` 指向测试自有目录，随测试清理）；**且** `npm_config_cache` 被指向不可写路径时该判据仍 exit 0——证明覆盖真的生效，而非碰巧 ambient 可写
- [ ] AC3 **正向不空转（该判据仍能取假）**：在 `packages/quay/bin/` 注入一个带 shebang、未被 `bin` 声明的 `.ts` 入口（如 `evil.ts`）⇒ 判据 **exit 1** 且报出该文件为违规；移除注入 ⇒ **exit 0**。一条命令可复现，两次读数都贴出（⛔ 只断言「声明的 bin 能跑」不算）
- [ ] AC4 **单一真相源 + 不新增泄漏**：可写临时根的选择只在 `plugin/test/helpers/tmp-workspace.mjs` 一处实现；`grep -n 'os\.tmpdir()' plugin/test/shipped-entry-runnable.test.mjs` **无输出**；`node plugin/scripts/tmp-leak-pairing-check.ts` ⇒ **exit 0**
- [ ] AC5 **自检**：`node plugin/scripts/task-schema-check.ts tasks/gap-ac233-criterion-not-hermetic-host-quota-false-red.md` ⇒ **exit 0**，且 `node packages/quay/bin/quay.ts task check gap-ac233-criterion-not-hermetic-host-quota-false-red --json` 的 `missing` 为 `[]`

## DoD

**真实落地（DIR-026 Reading A：产物/夹具是必要非充分）**——在本宿主上以**生产载体**跑该判据，⛔ 不是「测试文件存在」也不是「能把测试跑起来」：

1. 贴出**原始输出**：判据命令的 exit code + `ℹ pass N` / `ℹ fail N` 两行。
2. 同轮贴出**环境读数**：`echo $TMPDIR`、`df -h /data`、一次写探针（`echo x > /data/scratch/yale/probe-$$` 的成败）——否则无法证明那次绿不是因为宿主恰好空出了空间。
3. **负控制同轮跑**：AC3 的「注入 ⇒ 红 / 撤销 ⇒ 绿」两次读数必须同时出现，证明该判据没有退化成空转（硬规则 4c 的「空转」半边）。
4. **判据自足的直接证据**：`TMPDIR=/nonexistent-quota-probe` 形态下复现一次绿（AC1）——若落地时 `/data` 恰好可写，这一条是**唯一**能证明修的是自足性而不是运气的读数，不可省略。

## Touches

- `plugin/test/helpers/tmp-workspace.mjs`（改：可写临时根的选择——单点实现，写探针择优 + 全不可写时的可区分退出）
- `plugin/test/shipped-entry-runnable.test.mjs`（改：`packedFiles()` 显式 `npm_config_cache`；negative control 改用 helper 的临时根，删掉直接 `os.tmpdir()`）
- `plugin/test/tmp-workspace-writable-root.test.mjs`（新建：helper 可写根选择的直接单测，含「首选不可写 ⇒ 回退」「全不可写 ⇒ 可区分失败」两臂）
- `tasks/gap-ac233-criterion-not-hermetic-host-quota-false-red.md`（self-touch）
