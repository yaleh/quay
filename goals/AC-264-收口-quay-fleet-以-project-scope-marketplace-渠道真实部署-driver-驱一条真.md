---
id: AC-264
title: 收口：quay-fleet 以 project scope + marketplace 渠道真实部署，driver 驱一条真任务到 done，免
  npm 与免 QUAY_PLUGIN_ROOT 由文件系统直接量确认
status: superseded
kind: criterion
goal: GOAL-019
criterion: >-
  python3 - <<'P'

  import json, os, re, sys

  CAR = ".quay/productization-verification.jsonl"

  FLEET = "/home/yale/work/quay-fleet"

  if not os.path.exists(CAR):
      sys.stderr.write("AC-264: carrier %s absent => this AC has never been exercised\n" % CAR); sys.exit(1)
  best = None

  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("ac") != "GOAL-019-AC-264": continue
      if r.get("project_root") != FLEET: continue
      if r.get("install_scope") != "project": continue
      if r.get("install_channel") != "marketplace": continue
      if r.get("npm_global_used") is not False: continue
      if r.get("quay_plugin_root_unset") is not True: continue
      if r.get("goal_ring_ok") is not True: continue
      if r.get("task_status") != "done": continue
      if not r.get("commit_sha"): continue
      if r.get("produced_by_driver") is not True: continue
      mp = str(r.get("plugin_cache_path") or "")
      if not mp or re.search(r"verify-|probe|/tmp/", mp): continue
      best = r; break
  if best is None:
      sys.stderr.write("AC-264: no qualifying record in %s (need ac=GOAL-019-AC-264, project_root=%s, install_scope=project, install_channel=marketplace, npm_global_used=false, quay_plugin_root_unset=true, goal_ring_ok=true, task_status=done, commit_sha set, produced_by_driver=true, non-probe plugin_cache_path)\n" % (CAR, FLEET)); sys.exit(1)
  ST = os.path.join(FLEET, ".claude", "settings.json")

  if not os.path.exists(ST):
      sys.stderr.write("AC-264: %s absent => project-scope enablement cannot be confirmed from the filesystem, so install_scope=project would be self-report only (hard rule 4b)\n" % ST); sys.exit(1)
  try:
      sj = json.load(open(ST, encoding="utf-8"))
  except Exception as e:
      sys.stderr.write("AC-264: %s is not parseable JSON (%s) => cannot confirm enabledPlugins\n" % (ST, e)); sys.exit(1)
  ep = sj.get("enabledPlugins") or {}

  if not any(str(k).startswith("quay@") for k in ep):
      sys.stderr.write("AC-264: %s enabledPlugins carries no quay@* key (keys=%r) => the record's install_scope=project is not corroborated by the project's own settings\n" % (ST, list(ep)[:5])); sys.exit(1)
  CFG = os.path.join(FLEET, ".quay", "config.yml")

  if not os.path.exists(CFG):
      sys.stderr.write("AC-264: %s absent => cannot confirm which quay code the project actually binds to\n" % CFG); sys.exit(1)
  cfg = open(CFG, encoding="utf-8").read()

  bind = [l.strip() for l in cfg.splitlines() if ("path:" in l or "quay-native"
  in l or "quay.js" in l) and not l.strip().startswith("#")]

  if not any(".claude/plugins/cache/" in l for l in bind):
      sys.stderr.write("AC-264: %s binds to no .claude/plugins/cache/ path (binding lines: %r) => the project is not consuming the marketplace-installed plugin, so install_channel=marketplace is self-report only\n" % (CFG, bind[:6])); sys.exit(1)
  devbind = [l for l in bind if "/home/yale/work/quay/plugin" in l or
  "/home/yale/work/quay/packages" in l]

  if devbind:
      sys.stderr.write("AC-264: %s still binds to the quay development checkout (%r) => the deployment is not self-contained and would break the moment that checkout moves\n" % (CFG, devbind[:3])); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = 载体 .quay/productization-verification.jsonl 中存在一条
  ac=GOAL-019-AC-264 的记录，满足 project_root=/home/yale/work/quay-fleet ∧
  install_scope=project ∧ install_channel=marketplace ∧ npm_global_used=false ∧
  quay_plugin_root_unset=true ∧ goal_ring_ok=true ∧ task_status=done ∧
  commit_sha 非空 ∧ produced_by_driver=true ∧ plugin_cache_path
  非空且不匹配探测路径模式（verify-、probe、/tmp/）；并且判据自己再核两个文件系统直接量：quay-fleet/.claude/settings.json
  的 enabledPlugins 含 quay@* 键（否则 install_scope=project 只是自报）∧
  quay-fleet/.quay/config.yml 的绑定行含 .claude/plugins/cache/ 路径且不再指向 quay
  开发检出（/home/yale/work/quay/plugin 或 /home/yale/work/quay/packages）。exit 1 =
  无合格记录，或任一直接量核不过。⛔ 不接受只有自报字段（硬规则 4b：被测对象自己产生的量不能用来判断它自己是否在工作）；⛔ 判据不当场跑 npm ls
  -g（那会把「别人为别的目的装过 quay」误判成本 AC 失败），真正的机制证据是 config.yml 的绑定落点。
origin: "人 2026-09-15 指定本 GOAL 的目标包含「在 quay-fleet project scope
  实际部署和验证」。现状实测（2026-09-15）：quay-fleet 的 .claude/settings.json 已有 enabledPlugins
  {quay@quay: true}，但 .quay/config.yml 的 providers.native.path 与 mcp_entry 仍直接指向
  /home/yale/work/quay/plugin/vendor/… 开发检出 ⇒ 声明了 project scope 而实际消费的是 dev 树，不是
  marketplace 产物。AC-203 的教训（driver_alive=1 ∧ carrier_records>0 两个代理量在 goal-ring
  state=failed 时照样绿，goal-driver.ts:2179 注释自述该形态）决定了本 AC 必须交叉核文件系统直接量而不能只信记录字段。"
activatedAt: 2026-09-15T04:05:08.100Z
statusLog:
  - at: 2026-09-15T04:05:08.100Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-019 已激活，本 AC 进入在评
  - at: 2026-09-15T07:03:55.429Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-10-11T20:25:46.833Z
    from: achieved
    to: superseded
    actor: worker:gap-ac264-supersede-config-binding-reversed-by-plugin-root-ruling
    reason: |-
      终态 superseded —— 本判据的 config.yml 绑定支与仓当前【人裁定的】意图结构性互斥，不是漂移，且不可能稳定为真。
      (i) 根因 = 裁定反转，不是腐烂：AC-264 立条时（2026-09-15）把「走的是 marketplace 渠道」的机制证据定为 config.yml 里一条指向 .claude/plugins/cache/ 的绑定行。此后人于 2026-10-06 裁定反转（任务 gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it，修法 (D) 逐字）：native provider 的 config.yml 不再写 `path`/`mcp_entry`（即 path/mcp_entry 这两项绑定），Core 缺省按 plugin-root.ts 解析 <插件根>/vendor/quay-native，自定义 provider 仍写显式 path；/quay:init 对已有 config 的迁移必须逐行删除这两项。逐字理由（packages/quay/src/init.ts:1004-1005）：一条 declared path 会把运行时冻结到写下它的那次 install-cache 版本上（install-cache 冻结运行时），插件升级永不生效。并把三类量切开：绑定（决定行为，目标为零）/ 指引（只有 .quay/plugin）/ 读数（观察运行中的进程）。
      (ii) ⇒「绑定行数 = 0」是当前仓的明文意图，而判据要求绑定行数 >= 1 且落在 cache 下 ⇒ 二者结构性互斥；任何「把判据修绿」的动作都只能把 path 加回去，那既是倒退、又会在下一次 quay init 被逐行删除。2026-10-12 01:11 quay-fleet 跑的一次真 quay init（fleet 提交 8bce695，subject 逐字 chore(quay-init): initialize quay project files (plugin v0.19.0)）正是按 (D) 把上述两行绑定逐行删掉的。前两次立案（gap-ac264-quay-fleet-project-scope-plugin-only-deployment / gap-ac264-fleet-project-scope-deployment-rotted）都不是修错了：它们被一次正确的、人裁定的后续操作推翻。
      (iii) 不降覆盖（supersede 前逐条实测，fail-closed）：AC-264 真正断言的【保证】（quay-fleet 以 project scope 走 marketplace 渠道真实部署、且自足：不经 npm、不设 QUAY_PLUGIN_ROOT、不绑开发检出）仍被活体承接者承载 —— quay-fleet/.claude/settings.json 的 enabledPlugins = {"quay@quay": true}；~/.claude/plugins/installed_plugins.json 含 scope=project ∧ projectPath=/data/home/yale/work/quay-fleet ∧ installPath=/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0 ∧ version=0.19.0；运行中进程 cmdline = /data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/scripts/dist/driver-anchor.js __anchor --root /data/home/yale/work/quay-fleet；「不绑开发检出」由【缺席】表达 —— quay-fleet/.quay/config.yml 的非注释 path/mcp_entry 行数 = 0（即绑定为 0，比钉一条 cache 版本更自足：无版本可冻、无开发检出可指）；该缺席是一条被钉的契约，不是巧合：plugin/test/quay-init.test.mjs:160-161 的两条 doesNotMatch，且 plugin/scripts/provider-binding-resolvability-check.ts 对省略形态给 NOT-EVALUATED (exit 3)，不与「合格」同形（硬规则 3b）。⇒ 被撤销的只是「用 config.yml 绑定行当证据」这一种形态，保证本身另有承接者。
      (iv) 连带面：AC-242 的 criterion 逐字是 goal-store.ts check --stale-pass，它此刻是 achievedButFailing: ["AC-242"] 的唯一成因；本条 supersede 后该读数随之消失（同 gap-ac259-supersede-frozen-cycle-literal-and-restore-develop-dev 的先例形态）。⛔ 不改写 AC-264 的 criterion 文本使其通过（那是取巧路径），⛔ 不把 path/mcp_entry 加回 quay-fleet/.quay/config.yml（那是倒退，直接违反 2026-10-06 人裁定 (D)）。
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T04:05:08.099Z
---
