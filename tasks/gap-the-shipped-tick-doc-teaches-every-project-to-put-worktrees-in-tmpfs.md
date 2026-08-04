---
id: gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs
title: the shipped tick doc teaches every target project to build worktrees in
  /tmp — and /tmp is tmpfs, the amplifier that took the whole machine down
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

2026-08-04 02:15Z **整机 OOM**，所有 Claude Code 与 tmux 进程死亡。
`docs/analysis/the-machine-ran-out-of-memory.md` 的分解：`/tmp` 的 tmpfs 占 **4.4GB**，
其中包含在飞 worktree 与 scratch，**与会话争同一份 16GB 内存**。

本仓的活 worktree 已由外层挪到磁盘（`/tmp/quay-wt-*` → `/home/yale/work/quay-worktrees/*`，
三条分支 tip 逐字未变）。**但那只解决了本仓的卫生，没有解决耐久的那一半。**

### 真正的问题：这个做法写在交付物里，正在传播

`plugin/loop/fast-mode-loop-tick.md` **随 quay 插件包铺进每一个目标项目**
（`plugin/scripts/publish-dist-branch.sh` 的核心是 `rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"`
——**整个 `plugin/` 子树**）。它逐字写着：

```
:188   git -C /tmp/quay-wt-<slug> rebase master
:220   把 $TEST_COMMAND 对应的 runner 脚本复制进 /tmp/quay-wt-<slug>/ 对应位置
:299   派发形态：后台 Agent(run_in_background)，subagent 自建 /tmp/quay-wt-<slug> worktree
```

**⇒ 每一个新装 quay 的项目、每一个被派出去的 subagent，都会照着把 worktree 建进内存盘。**

**这不是本仓的卫生问题，是交付物在传播一个刚刚把这台机器打死的做法。**

### 完整引用面（外层实测，未截断）

**第一次扫描外层用了 `head -20`，把 `plugin/loop/fast-mode-loop-tick.md` 的命中截掉了**——
如实记下，因为它与本仓反复付学费的那条同形：**扫描自己的限制器会吃掉真阳性，且不会有任何提示。**
重扫（无上限）后，`plugin/` 子树内（= 随交付物分发的范围）的命中：

| 文件 | 性质 |
|---|---|
| `plugin/loop/fast-mode-loop-tick.md:188,220,299` | **指令**——要改的正身 |
| `plugin/scripts/inner-blocked-signal.ts:33,139` | 注释描述 worktree 位置；**其逻辑依赖的是「linked worktree 的 `.git` 是文件」，不依赖 `/tmp`** ⇒ 改路径不影响行为，但注释会变成错的 |
| `plugin/scripts/test-isolation-check.ts:410,1224,1253-1256` + `plugin/test-isolation-violations.txt:28` + `plugin/test/test-isolation-check.test.mjs:13,183-194` | **联锁**：`/tmp/quay-wt-*` 被列为 R6「永不匹配」前缀（保护在用 worktree 不被清理器删掉）。worktree 一旦移出 `/tmp`，**这条豁免就不再保护任何东西**——要么随之调整，要么明确记录它已成空转 |
| `plugin/test/resource-gate.test.mjs:159-167` | 仅测试夹具里的字符串。**外层已实测 `plugin/scripts/resource-gate.sh` 内没有任何 `/tmp` 或 `quay-wt` 耦合** ⇒ **此处不构成联锁**（假设过，查了，不成立，如实记下） |

仓内非交付物的引用（`docs/analysis/fast-mode-batch2-prompt.md:33,36,60` 等）同样要改，
但**优先级低于 `plugin/`**——那三行只影响本仓，`plugin/` 那三行影响每一个装了 quay 的项目。

### 与既有规格的关系

`orchestration/SPEC-cold-start-one-liner.md:146` 的 **AC9「worktree 不许建在 tmpfs」早已存在**，
**当时的理由只是「重启即消失」**（`:149`）。**2026-08-04 之后它升级为「OOM 成因」**——
同一条判据，严重性换了一个量级：从「你会丢工作」变成「你会打死整台机器」。
AC9c（`:158`）已要求「已存在的 tmpfs worktree 要能被发现」（`git worktree list | grep ^/tmp`）。

**本任务是那条规格的落地实现，不是它的重新提案。**

## Contract

```
measure tmpfs_worktree_paths_in_plugin = `grep -rn "/tmp/quay-wt\|worktree add /tmp" plugin/ | wc -l` 输出的行数字段
measure worktree_root_from_config = `grep -c "worktree_root" .quay/config.yml` 输出的计数字段
measure tmpfs_reject_exit = `bash plugin/scripts/quay-init.sh --loop --root <tmpfs 上的目标> 2>&1; echo $?` 输出的退出码字段
measure disk_accept_exit = `bash plugin/scripts/quay-init.sh --loop --root <真实磁盘上的目标> 2>&1; echo $?` 输出的退出码字段
band tmpfs_worktree_paths_in_plugin = 0
band worktree_root_from_config >= 1
band tmpfs_reject_exit != 0
band disk_accept_exit = 0
invariant 交付物里不出现 tmpfs 下的 worktree 路径；校验拒绝 tmpfs 但绝不拦真实磁盘路径
invoke `bash scripts/test.sh plugin/test/quay-init-loop.test.mjs plugin/test/worktree-root-fs-check.test.mjs`
control 真实磁盘路径必须正常建成并 exit 0——只证明它会拒绝、不证明它不乱拒绝，等于把一种失效换成另一种
resume 先改交付物里的路径约定，再加落地校验；校验的负控制与校验同批落地，不分两次
```

## Chosen mechanism

**worktree 根从配置读，不写死。** 缺省值用**仓库同级的磁盘路径**（如 `<repo>/../<project>-worktrees`），
与 `.quay/config.yml` `loop:` 节其余参数同源（`repo_root` / `test_command` / `tmux_session` 的既有形态）。

**落地时校验根所在的文件系统类型**（`stat -f -c %T <path>` 或 `df -T`），
是 `tmpfs` 就**拒绝并说明原因，不静默继续**。

**不做**：不改 tmpfs 大小；不把校验做成警告（**警告会被读成「装好了」**）；
不在 tick 文档里只写一句纪律而不改机制——**纪律写在文档里而机制写着相反的事，机制赢**
（本任务的立案理由正是如此：外层在简报里写了纪律，而 `plugin/loop/fast-mode-loop-tick.md` 仍在教相反的做法）。

## Acceptance Criteria

- [ ] AC1: **交付物里不再出现 tmpfs 下的 worktree 路径**——`grep -rn "/tmp/quay-wt\|worktree add /tmp" plugin/`
      在**指令位置**为 0 命中（注释/夹具可保留但须与新约定一致）；`plugin/skills/` 一并扫（实跑贴出）
- [ ] AC2: **worktree 根从配置读**——`.quay/config.yml` `loop:` 节新增 `worktree_root`，
      tick 文档与 skill 引用它而不是字面路径；**缺省值是仓库同级的磁盘路径**（实跑贴出解析结果）
- [ ] AC3: **tmpfs 拒绝**——把 worktree 根指到一个真 tmpfs 路径 ⇒ `quay-init --loop` **退出非 0**、
      错误信息说明「该根在 tmpfs 上、这是内存」并给出该改成什么（实跑贴出）
- [ ] AC4: **负控制（这条不过 AC3 不算数）**——真实磁盘路径上 `quay-init --loop` **exit 0** 且 worktree 正常建成。
      **只证明它会拒绝、不证明它不乱拒绝，等于把一种失效换成另一种**（实跑贴出）
- [ ] AC5: **发现存量**（SPEC AC9c）——`git worktree list` 里位于 tmpfs 的 worktree 能被一条命令报出（实跑贴出）
- [ ] AC6: **联锁处置**——`test-isolation-check.ts` 的 `/tmp/quay-wt-*` R6 豁免要么随新路径调整、
      要么在任务体里明确记录「它已成空转」并说明为何可接受。**不许默认它还在保护什么**
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group product`（安装是用户可见契约）

## Definition of Done

- [ ] AC3 与 AC4 的实跑输出**都**贴进任务体（拒绝方向与放行方向各一份）
- [ ] 完整套件连跑 2 次全绿（判据是 `fail 0` 且 `cancelled 0`）
- [ ] 任务体记录：**这条缺陷的严重性来自它在交付物里，不在本仓**——
      本仓的活 worktree 02:4xZ 已挪到磁盘，而文档仍在教每个新装的项目建进内存
- [ ] `orchestration/SPEC-cold-start-one-liner.md` AC9 标注为已落地，并写明理由已从「重启即消失」升级为「OOM 成因」

## Touches

- plugin/loop/fast-mode-loop-tick.md
- plugin/scripts/quay-init.sh
- plugin/test/quay-init-loop.test.mjs
- plugin/scripts/test-isolation-check.ts
- docs/analysis/fast-mode-batch2-prompt.md

## Dispatch review

reviewer: outer
at: 2026-08-04T02:50:00Z
changed: **管理者提出、外层立案并补齐引用面。** 管理者给了三条判据（交付物里不出现 tmpfs 路径 /
落地校验文件系统类型 / 负控制必须放行真实磁盘路径），**三条逐条落为 AC1-AC2 / AC3 / AC4**。

**外层补的第一件事是完整引用面**，并如实记下自己的一次失误：
首次扫描用了 `head -20`，**恰好把 `plugin/loop/fast-mode-loop-tick.md` 的命中截掉**，
于是外层只看到 `docs/analysis/` 那份非交付物的副本，**差点把一个交付物缺陷判成本仓卫生问题**。
形态与本仓既有的 AC7 教训同族：**扫描自身的限制器会吃掉真阳性，且不会有任何提示**——
上一次是降噪过滤器 `grep -viE` 吃掉了 `path.join(REPO_ROOT,`，这一次是 `head -20`。

**外层补的第二件事是逐条查联锁，包括查出一条不成立的**：
`test-isolation-check.ts` 的 `/tmp/quay-wt-*` R6 豁免**是真联锁**（路径一改，那条保护落空 ⇒ 落为 AC6）；
而 `resource-gate.test.mjs` 里的 `/tmp/quay-wt-*` **不是**——外层实测
`plugin/scripts/resource-gate.sh` 内没有任何 `/tmp` 或 `quay-wt` 耦合，那些只是测试夹具字符串。
**假设过、查了、不成立，如实写进任务体**，免得实现者按一条不存在的联锁改代码。

**外层核实了管理者关于 SPEC AC9 的说法**：`orchestration/SPEC-cold-start-one-liner.md:146` 确实早已写着
「worktree 不许建在 tmpfs」，`:149` 的理由确实只是「重启即消失」，`:158` 的 AC9c 确实要求能发现存量。
**⇒ 本任务是那条规格的落地实现，不是重新提案**；这一点写进任务体，免得被当成新决定再讨论一轮。

**优先级（管理者的判断，外层同意并给出理由）**：这条不在 OOM 之前定的十一条门槛清单里，
应当排进去且靠前——**不是因为它有趣，是因为它是唯一一条已经造成过全机停摆的**。
外层补一条支持理由：清单里其余各条的代价是「装出来的东西不对」，**这一条的代价是「循环赖以运行的机器没了」**，
而且它**在交付物里自我复制**——每多一个项目装上 quay，就多一台机器承接这个做法。

**排期约束**：与 `gap-init-guesses-the-tmux-session-...` 及
`gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down` **同动 `plugin/scripts/quay-init.sh`，三者须串行**。
`plugin/loop/fast-mode-loop-tick.md` 与在飞的两条分支不相交。
