---
id: AC-179
title: G8 dashboard 卡片在运行中的 Web 上真实渲染
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  python3 - <<'AC179CRIT_PY'

  # AC-179 (G8) — GET /dashboard on a LIVE production serve instance carries the
  goal-card element.

  # The verdict is an external HTTP GET of /dashboard; the ADDRESS is derived
  from the live host.

  #

  # WHY THE ADDRESS IS NO LONGER PARSED OUT OF THE CMDLINE (2026-09-23,

  # gap-ac179-criterion-cmdline-port-literal-stale): ce0f47518 made the web
  port's default

  # kernel-assigned, so the launcher cmdline carries `--port 0` — the REQUEST,
  never the bound port.

  # The old derivation read `host:0`, which connects to nothing, and reported
  "no running instance /

  # addr=none" while the card was rendering on the real port the whole time. The
  bound port is

  # knowable only from the carrier `活服务状态载体` (the port read back from the
  socket).

  # ⛔ The carrier DERIVES the address; it never decides the verdict — a
  self-reported value may not

  # judge the reporter (硬规则 4b). The external HTTP GET below is what decides.

  import errno, json, os, subprocess, sys



  def fail(msg): sys.stderr.write("AC-179 fail: " + msg + "\n"); sys.exit(1)



  def not_evaluated(msg): sys.stderr.write("AC-179 NOT-EVALUATED: " + msg +
  "\n"); sys.exit(3)



  def alive(pid):
      try: os.kill(pid, 0); return True
      except OSError as e: return e.errno == errno.EPERM


  def cwd_of(pid):
      try: return os.readlink("/proc/%d/cwd" % pid)
      except OSError: return None


  def reachable(host):
      # A wildcard bind is reached on loopback (the rule server-state.ts's probeAddress uses).
      return "127.0.0.1" if host in ("0.0.0.0", "::", "", "*") else host


  def helper_addr(pid):
      """(addr, cause) from the SINGLE derivation point (the shared live-address helper) — which
      owns the whole carrier read (path, schemaVersion shape, the ONE 'web' entry, its `up` field and
      its host/port). ⛔ This criterion no longer parses the carrier itself: 17 inlined copies of that
      step had already drifted into three different semantics (a missing `up` was read as pass, as
      fail, and as unusable in different files). Passing the candidate's own pid lets the helper's
      owner check refuse a stale carrier that names another instance (硬规则 4b: derive, don't trust)."""
      try:
          r = subprocess.run(["node", "--no-warnings", "--experimental-strip-types",
                              os.path.join(root, "plugin", "scripts", "live-web-address.ts"), root, str(pid)],
                             capture_output=True, text=True, timeout=25)
      except subprocess.TimeoutExpired: return None, "the derivation helper exceeded the 25s wall clock"
      except OSError as e: return None, "the derivation helper could not be spawned (%s)" % e
      out = (r.stdout or "").strip()
      err = (r.stderr or "").strip()
      if r.returncode == 0 and out: return out, None
      return None, err or ("the derivation helper exited %d with no sub-state" % r.returncode)


  def reachable_addr(addr):
      """Normalize a helper address for probing: a wildcard bind is reached on loopback (the rule
      server-state.ts's probeAddress uses)."""
      host, _, port = addr.rpartition(":")
      return "%s:%s" % (reachable(host), port)


  def cmdline_addr(pid):
      """(addr, note) for the address the process's OWN cmdline names. `--port 0` is a REQUEST, not an
      address (the kernel picks the port), so such a cmdline carries NONE — and saying so is the point:
      it must neither be rendered as an address nor be allowed to erase one derived elsewhere."""
      try:
          with open("/proc/%d/cmdline" % pid, "rb") as fh: argv = fh.read().decode("utf-8", "replace").split("\0")
      except OSError as e: return None, "cmdline unreadable (%s)" % e
      host, port = None, None
      for i, a in enumerate(argv):
          if a == "--host" and i + 1 < len(argv): host = argv[i + 1]
          if a == "--port" and i + 1 < len(argv): port = argv[i + 1]
      if port is None: return None, "its cmdline names no --port at all"
      if not port.lstrip("-").isdigit(): return None, "its cmdline --port %r is not a number" % port
      if int(port) == 0: return None, "its cmdline carries --port 0 (kernel-assigned), which names no address — the bound port is knowable only from the carrier"
      if host is None: return None, "its cmdline names --port %s but no --host" % port
      return "%s:%s" % (reachable(host), port), None


  def probe(addr):
      """None ⇔ the card is present on this address; else the NAMED cause of this address's failure."""
      url = "http://%s/dashboard" % addr
      try:
          r = subprocess.run(["curl", "-sf", "--max-time", "10", url], capture_output=True, text=True, timeout=25)
      except subprocess.TimeoutExpired: return "timeout: curl %s exceeded the 25s wall clock" % url
      except OSError as e: return "curl could not be spawned (%s)" % e
      if r.returncode != 0:
          if r.returncode == 7: return "connection refused (curl exit 7) at %s" % url
          if r.returncode == 28: return "timeout (curl exit 28) at %s" % url
          return "curl exit %d at %s (%s)" % (r.returncode, url, (r.stderr or "").strip()[:160])
      if 'id="goal-card"' in r.stdout: return None
      return 'card missing: %s answered without id="goal-card"' % url


  g = subprocess.run(["git", "rev-parse", "--show-toplevel"],
  capture_output=True, text=True)

  if g.returncode != 0: not_evaluated("cannot resolve the repo root (git
  rev-parse --show-toplevel exit %d): %s" % (g.returncode, g.stderr.strip()))

  root = g.stdout.strip()


  # ── candidates: `quay.ts serve` processes whose cwd IS the repo root (the
  scope, unchanged) ──

  pg = subprocess.run(["pgrep", "-f", "quay.ts serve"], capture_output=True,
  text=True)

  pids = []

  for tok in pg.stdout.split():
      if not tok.isdigit(): continue
      if cwd_of(int(tok)) == root: pids.append(int(tok))
  pids.sort()


  if not pids:
      fail("no running quay.ts serve instance with cwd=%s — GET /dashboard containing id=\"goal-card\" cannot be evaluated on a live surface (pgrep -f 'quay.ts serve' matched 0 processes rooted here)" % root)

  # ── the address comes from the helper, per candidate (no carrier path is
  named here) ──


  # ── per candidate: derive + ACCUMULATE. ⛔ No candidate may clear an address
  another derived:

  #    the criterion's own `sh -c` process matches the pgrep pattern (its cwd IS
  the gate root) and

  #    used to overwrite the loop variable with the empty string — that is how a
  live card came to be

  #    reported as "addr=none". ──

  cand, addrs, live = [], [], []

  for p in pids:
      got, notes = [], []
      if not alive(p):
          notes.append("the process had exited by derivation time")
      else:
          live.append(p)
          ha, hnote = helper_addr(p)
          if ha is not None:
              got.append(reachable_addr(ha))
          else:
              notes.append("its address is not derivable: %s" % hnote)
          caddr, cnote = cmdline_addr(p)
          if caddr is not None: got.append(caddr)
          else: notes.append(cnote)
      for a in got:
          if a not in addrs: addrs.append(a)
      cand.append((p, got, notes))

  if not live:
      fail("all %d candidate(s) under cwd=%s had exited by derivation time — GET /dashboard containing id=\"goal-card\" cannot be evaluated on a live surface" % (len(pids), root))

  if not addrs:
      lines = ['no live candidate exposed a derivable address, so GET /dashboard containing id="goal-card" cannot be reached at all — this is NOT a pass',
               "  root: %s" % root,
               "  candidates (quay.ts serve with cwd=root): %d" % len(pids)]
      for p, got, notes in cand:
          lines.append("    pid=%d addr=underivable cause=%s" % (p, "; ".join(notes) or "no address could be derived"))
      not_evaluated("\n".join(lines))

  # ── the verdict: an EXTERNAL HTTP GET of /dashboard, one accumulated address
  at a time ──

  outcome = {}

  for a in addrs:
      cause = probe(a)
      if cause is None:
          print('AC-179 ok: GET http://%s/dashboard carries id="goal-card" (address derived from the live host, not from a launcher literal)' % a)
          sys.exit(0)
      outcome[a] = cause

  lines = ['no candidate served GET /dashboard containing id="goal-card" (curl
  -sf --max-time 10)',
           "  root: %s" % root,
           "  candidates (quay.ts serve with cwd=root): %d" % len(pids)]
  for p, got, notes in cand:
      if got:
          for a in got:
              lines.append("    pid=%d addr=%s cause=%s" % (p, a, outcome.get(a, "not attempted")))
      else:
          lines.append("    pid=%d addr=underivable cause=%s" % (p, "; ".join(notes) or "no address could be derived"))
  fail("\n".join(lines))

  AC179CRIT_PY
expect: exit 0（仅遍历 cwd = 仓库根的生产 serve 实例；按位置认元素 id="goal-card"，不认标题/提交主题里的字符串提及）
origin: |
  人 2026-09-06 需求⑥「在 quay web 为 goal 实现相应的页面和 dashboard 卡片」。
  判据读【运行中的服务】而非源码，依据硬规则 4 推论三：
  grep 源码只证明"能产出"，不证明"已产出"。
---

**判据（能取假）**：从**运行中的 `quay serve` 进程**派生地址，`GET /dashboard` 的响应含 `goal-card`。

**取假**：今天必假（`serve-dashboard.ts` 全文 `grep -n goal` = 0 命中；
现有卡片只有 `live-card`/`tests-card`/`sys-card`/`mgr-card`/`task-card`/`fanIn`/`commits`）。

**⊢ 地址从宿主进程派生，不写死字面量**（硬规则 4 推论二：
一个恰好等于当前机器/端口的字面值不是配置，是会静默失效的常量）。
`addr` 取不到时 `test -n` 即判假——**不会因为服务没起而伪装成通过**。

**卡片内容**：每条 active GOAL 的 `AC 达成 x/y`、`fresh|stale|NOT-EVALUATED` 标记、
`activeCount / cap`。

**改动面**：`serve-dashboard.ts` 新增 `renderGoalCard`（照 `renderTaskCard` `:542` /
`renderMgrCard` `:519`）+ `renderDashboardPage`（`:694-746`）的 grid 插入 + `handleDashboard`（`:790-828`）
数据装配；可选 `/dashboard/cards`（`:839-870`）自刷新。

**同期一并落地（不在本条判据内，属 DoD）**：`quay goal` 子命令
（`bin/quay.ts:178-206` 加一行 dynamic import + `src/cli/goal.ts`，照 `cli/adr.ts`）；
`/goal` 页面已存在（`serve-goal.ts`，含三态空态与站点导航 `serve-render.ts:702-712`），
本期只需随 `AC-176` 改走 provider client。

<!-- 以下为判据修订记录（2026-09-23），⛔ 不是新增保证，只把派生那一步重锚到活载体 -->

## 判据修订（2026-09-23，gap-ac179-criterion-cmdline-port-literal-stale）

**为什么改**：承载体搬迁 —— 保证本身没变（dashboard 卡片在运行中的生产 Web 上真实渲染），
变的是**地址从哪里派生**。`ce0f47518`（2026-09-18，`gap-serve-same-root-admission-lock`）把 web 端口的
默认改成**内核分配临时端口**：`packages/quay/src/cli/server.ts:485-490` 逐字要求 `--port` 只在调用方显式
具名时才传，`plugin/scripts/start-drivers.ts:58-59` 的默认值是 `0`。于是启动器 cmdline 里那个
`--port 0` 是**请求**、不是**绑定端口** —— 旧判据把它当地址，派生出 `host:0`，那是「连不上」而不是
「没在跑」。**真实端口只在载体里可知**（`start-drivers.ts:26-28` 逐字：「the carrier is the only place
the port is knowable」）。

**同一宿主、同一时刻的两侧读数**（2026-09-23T08:1xZ，cwd = 主检出）：

| 面 | 读数 |
|---|---|
| 旧判据逐字重跑 | `exit 1`；stderr `no running … instance with cwd=… served … addr=none` |
| 旧判据按 cmdline 派生的地址 | `172.28.0.1:0` ⇒ `curl -sf --max-time 10` **rc=7（连接被拒）**、http=000 |
| 载体 `活服务状态载体` 的 `web` 服务 | `172.28.0.1:6333` ⇒ 同一条 curl+grep **`id="goal-card"` 命中 1** |
| 卡片内容（真数据） | `Stage goals / active 1 / cap 5`、`GOAL-022` + `fresh` + `AC achieved 3/4` + 进度条 |

⇒ 保证成立，坏的是**判据的承载体**。台账同源：本 AC 生命期 930 条 verdict、782 条 pass，
最后一次 pass `2026-09-23T04:09:01.963Z`（生产实例于 `07:29:22Z` 按新默认重启后即失效）。

**次级缺陷（同轮直接量，一并修）**：失败成因被判据**自身的进程**抹掉。判据文本含 `quay.ts serve`
⇒ 消费它的 gate 以 `sh -c "<criterion>"` 运行（`gate/acceptance-runner.ts:151`），runner 自己的 `sh`
进程也命中 `pgrep -f 'quay.ts serve'`，且其 `cwd` 恰等于 `$root`；它对 `--host … --port …` 零命中 ⇒
循环变量 `a` 被**覆盖成空串** ⇒ 报 `addr=none`，**而候选一直在**。这是 AC-241 家族：一条结构上不可能
报出真成因的失败路径。

**改了什么**（作用域与 `expect` 逐字不变；判定仍由**外部** `GET /dashboard` 作出）：

1. 地址从**活宿主**派生：候选仍是 `pgrep -f 'quay.ts serve'` ∧ `/proc/<pid>/cwd == $root`（作用域不变）；
   地址先取载体 `活服务状态载体` 的 `web` 条目（校验 `pid` 活 ∧ `cwd == $root`，**只取 `name == "web"`**，
   `control` 端口不同、取错会打到控制面），再取 cmdline 里**非零**的显式 `--port`（两种部署形态都能解析）。
   ⛔ 无一字面量主机/端口；通配绑定折成回环（`server-state.ts` `probeAddress` 同一条规则）。
2. 地址**累积**，任何候选不得清空已派生的地址。
3. 失败时**逐个候选**写出 `pid` + 派生地址 + 成因（连接被拒 / 超时 / 卡片缺失），不再退化成 `addr=none`。
4. 三分而非二分（硬规则 3b）：`exit 0` 卡片在场；`exit 1` 有地址但拿不到卡片；
   `exit 3` **查不成**（无任一候选能派生地址 —— 例如载体缺失、`--port 0` 且无载体）——
   「查不成」与「合格」不同形，且仍非 0（fail-closed 不放松）。
5. 载体只用于**派生**地址，不作判定真值（硬规则 4b：自报的量不判它自己活着）。

**⛔ 明确不采用的三个方向**：把 web 钉回固定端口（临时端口默认有理由 —— `start-drivers.ts:22`
有「无关进程占住硬编码端口后回答 200 ⇒ 脚本报假绿」的实测；钉回去等于把假绿引回来，且正是硬规则 4
推论二点名的形态）；`superseded` 本 AC（GOAL-001 退出条件仍要求该卡片）；`long-term: true`
（只搬进 AC-216 复验域，判据本身仍为假）。

> `取假：今天必假` 那句是**立案当时**的记录（`serve-dashboard.ts` 无 `goal-card`），
> 已由 `gap-dashboard-goal-card-provider-backed`（done）实现 —— 本条从来不是「卡片缺失」，
> 三次前序修复分别修了卡片存在性 / 渲染耗时 / 归因，**没有一次碰过地址派生**。