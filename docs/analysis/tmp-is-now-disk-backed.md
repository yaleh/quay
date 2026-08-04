# 系统变更：`/tmp` 不再是 tmpfs，已改为磁盘（ext4）

**日期**：2026-08-04（管理者，人明确要求「清理并禁用 tmpfs」）
**范围**：整机级、持久（跨重启），不是本仓库内的配置

---

## 背景

今晚两次全机 OOM，两次分析都指认 `/tmp` 是 tmpfs（即内存）是放大器之一：
worktree、scratch、Node 编译缓存的默认目录全部落在 `/tmp`，与会话/套件直接争抢同一份 16GB 内存。
`A6`（worktree 不许建在 tmpfs）修的是代码层的一部分症状；这次是从根上消除整类风险。

## 前置检查（执行前）

- **测量套件独立运行不接近内存上限**（[[suite-alone-does-not-approach-the-memory-ceiling]]）——
  确认这次操作不是在掩盖套件本身的问题
- **`TMUX_TMPDIR` 依赖**：本会话已在 tmux 外重启；用户另一个 tmux 会话 `lan-1` 已退出；
  确认 `pgrep -af '^tmux'` 清零
- **本会话（`claude` 进程）在 `/tmp` 下没有任何打开的文件**（`/proc/<pid>/fd` 扫描确认）
- **发现一个真实持有者**：`quay serve --host 100.87.141.82:4174`（archguard 的 web server，
  人先前要求启动的，已跑 17 小时），日志写在本会话 scratchpad 下的 `/tmp/.../archguard-serve.log`。
  **判定为可接受的一次性数据**（日志），服务本身不依赖 `/tmp` 做其它事。

## 执行

```bash
sudo systemctl mask tmp.mount   # 阻止 systemd 未来再把 /tmp 挂成 tmpfs（含重启后）
sudo umount -l /tmp             # lazy unmount——不强杀持有打开文件的进程，
                                 # 旧 tmpfs 实例在最后一个引用关闭后自然回收
```

**没有用 `umount` 硬卸载**：archguard serve 进程对日志文件持有打开的写句柄，硬卸载会报 busy 或强制中断；
lazy unmount 让它自然收尾,同时新路径立即对所有新增访问生效。

## 验证

| 检查 | 结果 |
|---|---|
| `df -T /tmp` | `/dev/vda2 ext4 ... 挂载于 /` —— **磁盘，不再是独立挂载点** |
| 读写 | `echo/cat/rm` 正常 |
| `systemctl is-enabled tmp.mount` | **`masked`**——重启也不会恢复 tmpfs |
| archguard serve（pid 1975220） | **全程存活，未受影响**（etimes 从卸载前到卸载后持续递增） |
| 可用内存 | 12384MB（与卸载前基本持平——本来就没有大量数据在 tmpfs 里，
  真正的价值不在这次的即时释放量，而在**未来任何东西写进 `/tmp` 都不再消耗内存**） |

## 一个连带发现：harness 自身的输出通道也走 `/tmp`

执行 `umount -l` 的那条命令本身没有返回输出（`output_file` 报 `ENOENT`）——
**Claude Code 的 Bash 工具结果传递机制依赖 `/tmp/claude-1000/.../tasks/<id>.output`**。
卸载瞬间打断了这条通道,但会话本身在下一条命令时自愈(新路径重新可写)。
**这本身是「/tmp 是 tmpfs」这件事波及面有多广的一个例证**——不止是本仓的 worktree,
连驱动这次操作的工具本身都依赖它。改为磁盘后,这条通道更稳(不会被内存压力打断)。

## 影响范围

**这是整机变更,不随本仓的重装/冷启动流程走,也不会被 `git` 记录复原**——
任何在这台机器上跑的项目(quay/archguard/meta-cc,以及未来任何项目)从现在起,
`/tmp` 都不消耗内存,只消耗磁盘(`/dev/vda2` 当前可用 205GB)。

**遗留的代码层工作不因此免除**:`A6`(tick 文档仍写死 `/tmp/quay-wt-*` 路径)、
Node 默认编译缓存落在 `os.tmpdir()`——**这些仍然值得修**,理由从「防 OOM」变成
「不要在磁盘上无限堆积临时文件」,性质变了但工作量不变。
