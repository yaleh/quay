# `send-keys-verified.test.mjs` 的隔离清理只删目录，不杀服务端——144 个孤儿进程

**日期**：2026-08-04（管理者，在 tmpfs 清理途中顺带发现）

## 现象

`pgrep -af '^tmux'` 命中 **144 个** `tmux new-session -d -s <name> bash` 进程，
其中 **136 个是 `skv-ok`**，8 个是 `ol-cold`/`ol-stale`/`ol-gone`/`ol-xsub`/`ol-esc`/`ol-api`/`ol-nc`（×2）。
全部创建于 **00:37–00:44Z 这 7 分钟窗口**内，合计占用 **约 670–811MB 内存**。

## 根因

`plugin/test/send-keys-verified.test.mjs` 的 `newHermetic()` 用 `TMUX_TMPDIR` 隔离出一个
全新 socket 目录，测试用例（尤其是「送达一个正常 pane」「输入被吞掉」那两类正控制）会在这个
隔离 socket 上真实启动一个 tmux server + session。清理逻辑：

```js
cleanup() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
},
```

**只删除了临时目录，从未调用 `tmux kill-server`。** 删目录不会终止已经启动的 server 进程——
它的 socket 文件描述符仍然打开，进程继续常驻，永久孤儿化，直到被手工杀掉或重启。

文件头部注释写着「every mkdtemp tmpdir is removed in a finally (test-isolation R6)」——
**这句话是真的，但不完整**：R6 要求的是「删临时目录」，这里做到了；
**但一个会启动 tmux server 的测试,只删目录不够,还必须先杀掉它启动的进程。**

## 规模来源

136 个同名 `skv-ok` 与 7 分钟的窗口大小，和「同一个测试文件被反复单独跑」的模式吻合
（例如迭代开发这个文件时反复执行 `node --test plugin/test/send-keys-verified.test.mjs`）,
而不是来自今晚的 12+ 次全量套件（那样时间会摊开在几个小时,而不是集中在 7 分钟）。

## 已处置

**144 个孤儿进程已按 pid 逐个 `kill -9`,回收约 811MB。**（不是修复,只是清场——
下次这个测试文件被跑,同样的泄漏会重演。）

## 修法（供实现方参考,未验证）

```js
cleanup() {
  try { spawnSync("tmux", ["-S", path.join(sockDir, "default"), "kill-server"]); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
},
```

**判据**：清理后 `pgrep -f "TMUX_TMPDIR=.*skv-"` 或按 socket 路径核对,不应有残留 server。
**负控制**：跑一次这个测试文件前后,`pgrep -c '^tmux'` 应该不变。
