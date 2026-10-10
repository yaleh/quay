---
id: gap-ac264-fleet-project-scope-deployment-rotted
title: AC-264 第二次立案：quay-fleet 的 project-scope plugin 部署已烂（settings 键被抹、install
  记录消失、config 绑定指向不存在的 cache 版本、marketplace 源目录被删）——真实重装 + 修复绑定 + 落成提交
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-264
---
**type:** execution

## Proposal

**这是 AC-264 的第二次立案。** 第一次 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 已 `done`（2026-09-15 落地），但判据**当前为假**——本轮直接重跑 `goals/AC-264-…md` 的 criterion（逐字，cwd=/data/home/yale/work/quay），exit 1，stderr 逐字：

```
AC-264: /home/yale/work/quay-fleet/.claude/settings.json enabledPlugins carries no quay@* key (keys=[])
```

**为什么上一次的修复没有守住（全部为立案当轮直接量，非推断）**

上一次把「project scope 已启用」实现成了 **quay-fleet 仓里一个被跟踪的文件**（提交 `9009b43 deploy: project-scope quay plugin from the marketplace channel (AC-264)`），并往载体 `.quay/productization-verification.jsonl` 追加了一条 2026-09-15 的记录。但那不是静态事实——它是 Claude Code plugin 子系统管理的**活状态**，由若干 **在本仓之外、机器全局、且会被回收** 的产物共同承载，任一被回收，部署即死：

| 直接量 | 立案当轮（2026-10-09） | 上一轮记录（2026-09-15） |
|---|---|---|
| `quay-fleet/.claude/settings.json` 的 `enabledPlugins` | `{}`（键被抹；工作树相对 `9009b43` 是**未提交修改**，`git diff` 逐字见 Evidence） | `{"quay@quay": true}` |
| 同文件 `extraKnownMarketplaces.quay.source.path` | **缺失** | `/home/yale/work/quay-plugin-dist` |
| `~/.claude/plugins/installed_plugins.json` 里 quay-fleet 的 project-scope 记录 | **不存在**（`quay@quay` 只有 claudecodeui / cantus / `/tmp` scratch×2 / claudecodeui-worktrees 的 local·project 记录，外加一条 **user** scope 0.17.0） | `scope: project`, `projectPath: /data/home/yale/work/quay-fleet`, `installPath: …/0.7.0` |
| marketplace 源目录 `/home/yale/work/quay-plugin-dist` | **已删除**（`ls` 报不存在） | 存在（dist-plugin @ `578187b0…`） |
| `quay-fleet/.quay/config.yml` 的 `providers.native.path` | `…/cache/quay/quay/**0.9.0**/vendor/quay-native` —— 该版本目录**已不存在**（cache 现有 0.10.0/0.11.0/0.14.0/0.15.0/0.16.0/0.17.0） | `…/0.7.0/…`（当时存在） |

⇒ **两条纪律同时命中**：①硬规则 4b——判据（正确地）拒绝只信 self-report，改读 `settings.json` 的键作为「project scope 已启用」的直接量；但那个键本身是**可被别处重写的活投影**，所以它红了也说不清「整条链烂到哪」；②真正没被守住的是 AC 命题里的**「自足」**——上一轮记录把 `plugin_cache_path` 锚在一个**会被后续 `claude plugin install` 顶掉的 cache 版本**上、把 marketplace 源锚在一个**会被清理的临时目录**上。任何一个被回收，部署即死，而判据只读一个键，红得晚且无解释力。

⛔ **本任务不是把键写回去。** 手写 `{"quay@quay": true}` 到 settings.json 能让判据机械翻真，但那正是 AC-264 的 `expect` 逐字禁止的「只有自报字段」形态——`installed_plugins.json` 里没有 project-scope 记录时，那个键是**无机制背书的孤儿声明**。正确修复 = **真实地以 project scope + marketplace 渠道重装**，并让绑定落在**不会随别处操作被回收**的落点。

**要做的事**

1. 在 quay-fleet 里**真实重装**（`claude plugin marketplace add <现存源> --scope project` + `claude plugin install quay@quay --scope project`），使两个直接量**同时**在场：`settings.json.enabledPlugins` 含 `quay@*` **且** `installed_plugins.json` 出现 quay-fleet 的 `scope: project` 记录。缺一不算。
2. 修复 `quay-fleet/.quay/config.yml` 的绑定：`providers.native.path` / `mcp_entry` 指向**当前真实存在**的 cache 版本（或一个**稳定的、不随别处安装被回收**的 copy）；`QUAY_NATIVE_ADR_DIR` / `GOAL_DIR` / `META_DIR` 三个 env **逐字保留**（删了会让该项目的 goals/ADR/meta 静默读写 quay 自己的 store，已有既存 gap 记录）。
3. 把 quay-fleet 里被跟踪的 `.claude/settings.json` 改动**落成提交**（⛔ 留在工作树 = 硬规则 11b 的「已生效而未记录」，且机械 fan-in 的 clean-tree 前置会红——上一轮正是栽在 `working tree not clean`）。
4. 重跑 AC-264 判据逐字 → exit 0；并**补一条新的载体记录**（`.quay/productization-verification.jsonl`），字段在写盘前**当场重读** settings.json 与 config.yml 两个直接量（⛔ 不抄 2026-09-15 那条的 0.7.0 旧值）。
5. **诊断上一轮为何未守住**：给出可证伪的定位（哪次操作抹掉了键 / 删了 marketplace 源 / 顶掉了 cache），并据此判断「自足」要不要一道**取假**的常驻检查——若判定需要则落地并给出取假读数；若判定为一次性手工操作、且给出证据，可记为无需（硬规则 12）。

<!-- dedup-ref --> 仅作追溯，不改变本任务的派发与验收：`gap-ac161-4th-regression-agent-runs-scope-user-install-to-refresh-a-shared-plugin-cache`（done）处理的是相邻面「user 级 `~/.claude/settings.json` 被顺手 `--scope user` 安装污染」，其新闸只落在 **user 级**；`gap-ac264-quay-fleet-project-scope-plugin-only-deployment`（done）是本条的前一次修复，其 `## Evidence` 的部署命令与负控制是本次复现的基线。本条修的是 **project 级** 状态被抹，那两条的落点均不覆盖。

## Acceptance Criteria

- [x] AC1（真实重装的两个直接量同时在场）：`/home/yale/work/quay-fleet/.claude/settings.json` 的 `enabledPlugins` 含 `quay@*` 键 **∧** `~/.claude/plugins/installed_plugins.json` 的 `plugins["quay@quay"]` 中存在 `scope=="project"` ∧ `realpath(projectPath)==realpath("/home/yale/work/quay-fleet")` 的记录（注意 `/home/yale` 是 `/data/home/yale` 的软链，两处写法都要 `realpath` 归一）。命令：
```
python3 - <<'P'
import json, os, sys
ep = json.load(open("/home/yale/work/quay-fleet/.claude/settings.json")).get("enabledPlugins") or {}
half1 = any(str(k).startswith("quay@") for k in ep)
d = json.load(open(os.path.expanduser("~/.claude/plugins/installed_plugins.json")))
fleet = os.path.realpath("/home/yale/work/quay-fleet")
half2 = any(e.get("scope") == "project" and os.path.realpath(e.get("projectPath","")) == fleet
            for e in d.get("plugins",{}).get("quay@quay",[]))
print("settings_key=%s install_record=%s" % (half1, half2)); sys.exit(0 if (half1 and half2) else 1)
P
```
→ 读数应打印 `settings_key=True install_record=True`。⛔ 只有 `settings_key=True` 不算——那正是被禁止的自报形态。
→ **实测 exit 0，打印 `settings_key=True install_record=True`**。两条直接量由**同一次真实重装**产生（见 Evidence 的 `marketplace add` + `install` 回读）：settings 键 `{"quay@quay": true}`，install 记录 `scope=project` / `projectPath=/data/home/yale/work/quay-fleet` / `installPath=…/cache/quay/quay/0.17.0`（`installedAt=2026-10-10T02:22:16.205Z`）。

- [x] AC2（config 绑定指向真实存在的 cache、不指开发检出，三个 env 保留）：
```
python3 - <<'P'
import os
cfg = open("/home/yale/work/quay-fleet/.quay/config.yml").read()
paths = [l.split("path:",1)[1].strip() for l in cfg.splitlines() if l.strip().startswith("path:")]
assert paths, "no 'path:' binding line"
for p in paths:
    assert ".claude/plugins/cache/" in p, ("not cache-bound", p)
    assert "/home/yale/work/quay/plugin" not in p and "/home/yale/work/quay/packages" not in p, ("dev-bound", p)
    assert os.path.exists(p), ("bound cache path does not exist", p)
for k in ("QUAY_NATIVE_ADR_DIR","QUAY_NATIVE_GOAL_DIR","QUAY_NATIVE_META_DIR"):
    assert k in cfg, ("dropped env", k)
print("AC2 ok:", paths)
P
```
→ 读数应打印 `AC2 ok: [...]`，且列出的 `path:` 在盘上真实存在。
→ **实测 exit 0，打印 `AC2 ok: ['/data/home/yale/.claude/plugins/cache/quay/quay/0.17.0/vendor/quay-native']`**。绑定由 `0.9.0`（该目录已不存在）改为本次安装的 `0.17.0`；`mcp_entry` 同步；三个 env 逐字保留（`grep` 0 处 `0.9.0` 残留在该文件）。

- [x] AC3（改动落成提交，不是工作树里的未记录态）：`git -C /data/home/yale/work/quay-fleet status --porcelain -- .claude/settings.json` 输出为空 **∧** `git -C /data/home/yale/work/quay-fleet show HEAD:.claude/settings.json` 的 `enabledPlugins` 含 `quay@*`。
```
test -z "$(git -C /data/home/yale/work/quay-fleet status --porcelain -- .claude/settings.json)" \
&& git -C /data/home/yale/work/quay-fleet show HEAD:.claude/settings.json | python3 -c 'import json,sys;ep=json.load(sys.stdin).get("enabledPlugins") or {};sys.exit(0 if any(str(k).startswith("quay@") for k in ep) else 1)'
```
→ **实测 exit 0**。两条都成立，且不是「碰巧」：真实重装把被抹掉的工作树改动**恢复成了 HEAD（`9009b43`）的逐字内容** ⇒ `git status --porcelain` 为空、`git show HEAD:` 含 `quay@quay`。此外**新产生的 config 绑定改动也落成了提交**（`e3a6ffb`，`git status --porcelain -- .quay/config.yml` 为空），不是硬规则 11b 的「已生效而未记录」。

- [x] AC4（判据逐字翻真）：以 cwd=`/data/home/yale/work/quay` 逐字重跑 `goals/AC-264-…md` 的 `criterion`（⛔ 从 goal 文件提取原文，不手抄），`exit 0`；在 Evidence 贴出 exit code 与 stderr（成功时为空）。
→ **实测 exit 0**，stderr 为空。criterion 由 `yaml.safe_load` 从 `goals/AC-264-收口-…md` 的前言块**机械提取**后写盘再跑（`/home/yale/work/ac264-2nd-evidence/ac264-criterion.sh`，3219 字节，首行 `python3 - <<'P'`），⛔ 非手抄。判据的两条组成同时为真：①载体里存在合格记录（2026-09-15 那条仍在，其十个字段未变）；②**本轮修好的两个文件系统直接量**——这正是立案当轮 stderr 逐字点名的 `enabledPlugins carries no quay@* key (keys=[])`，现已被负控制证明确实由该键驱动（见 DoD 负控制）。

- [x] AC5（补新载体记录，字段当场重读）：`.quay/productization-verification.jsonl` 追加一条 `ac: "GOAL-019-AC-264"` 记录，其 `plugin_cache_path` 指向**当前真实存在**的 cache 目录且不含 `verify-` / `probe` / `/tmp/`；追加脚本在写盘前对 `settings.json.enabledPlugins` 与 `config.yml` 绑定两个直接量**当场重读**后写入（⛔ 不抄 2026-09-15 那条的旧值）。读回：
```
python3 -c 'import json;r=[json.loads(l) for l in open("/data/home/yale/work/quay/.quay/productization-verification.jsonl") if l.strip()];r=[x for x in r if x.get("ac")=="GOAL-019-AC-264"];print(r[-1] if r else None)'
```
→ 读数：最后一条 `ts` / `plugin_cache_path` 为**本轮**新写入。
→ **实测**：载体现有 2 条 AC-264 记录；末条 `ts=2026-10-10T02:32:03Z`、`plugin_cache_path=/data/home/yale/.claude/plugins/cache/quay/quay/0.17.0`（盘上存在，不匹配 `verify-|probe|/tmp/`）。追加脚本 `/home/yale/work/ac264-2nd-evidence/append-carrier-2nd.py` 对每个命名了真实对象的字段**先读后断言**（settings 键 / config 绑定行 / 由绑定派生的 cache 路径 + `isdir` / `installed_plugins.json` 的项目记录 + `installPath` 与绑定路径 realpath 相等 / marketplace 源路径 + `isdir` / 该记录的 fleet 提交），⛔ 无一条抄自旧记录（旧记录那个已死的 `0.7.0` 未被复制）。**边界（硬规则 4/4b，如实记录）**：本轮是**重部署修复**，未重新驱一条 quay-fleet 任务到 `done`，故 driver 流字段**不冒充**——记录里 `produced_by_driver: false`、`qualifies_ac264_criterion: false`，并带 `repair_round_note` 说明「判据的记录检查仍由 2026-09-15 那条承载」。不勾这一条就等于把「没验证过的 driver 事实」写成已验证。

- [x] AC6（诊断 + 是否加常驻检查，带证据）：在 `## Result` 给出上一轮键消失 / 源目录被删 / cache 被顶的可证伪定位（`stat` / `git log` / transcript 锚点，至少一条直接量），并据此决定是否新增一道取假常驻检查：若新增，给出其**取假读数**（改动前如何红、改回如何绿）；若判定为一次性手工操作且给出证据，明记「无需常驻检查」。⛔ 不允许无证据的「可能是……」。
→ **已写进 `## Result`**：三条各有直接量锚点（transcript 会话 id + 时间戳、`stat` mtime、fleet `git log` `-S`）。裁定：**无需新增常驻检查**（本轮是一次**人有意的、跨工作区的机器级 plugin 操作**，该面发生数 = 1；检测本身已存在——quay 的 goal-driver 每轮跑 AC-264 的 criterion，它红了才立的本条）。另留两条**观察项**（不是阻塞位），其一指出了本任务 AC2 自身的形态与「自足」之间的结构性张力。

## Definition of Done

- [x] AC1–AC6 全勾；`quay task check <id>` 的 `missing` 为 `[]`。→ **`task_check` 写入后返回 `acChecked=6/6`、`dodChecked=5/6`**：剩下那一条是**作者自己标注的 `（待外部）` 项**（下条），按本仓既有惯例（`gap-ac232` / `gap-ac205` / `gap-ac194` / `gap-ac255` 等已落地任务同样保持未勾）**保持未勾**，由 fan-in 的 `pass-external` 臂承载——⛔ 不勾它是因为它的 live 谓词此刻为假，不是漏勾（`fan-in-ac-completion-gate.ts` 的 `isLandedCodeComplete` 末臂 `uncheckedItems.every(isOuterVerificationItem)` 认首行末尾的 `（待外部）`）。
- [x] **判据翻 pass**：以 cwd=`/data/home/yale/work/quay` 逐字重跑 `goals/AC-264-…md` 的 criterion ⇒ exit 0（直接读数，不是本任务体自称）——即点名的两个文件系统直接量（`settings.json` 键 / `config.yml` 绑定）**同时**为真。→ **实测 exit 0**；两个直接量的当场读数见 AC1/AC2 与 Evidence。
- [ ] driver 在下一轮独立复验该 criterion 仍 pass（本任务带 `goal_ac: AC-264`）。（待外部）
- [x] **REAL LANDING（DIR-026 Reading A）**：不是「文件里写着 quay@quay」，而是 quay-fleet 真的以 project scope 消费了 marketplace 渠道的插件——`installed_plugins.json` 有该项目的 project-scope 记录 ∧ `config.yml` 绑定的 cache 路径 `test -e` 为真 ∧ 该路径**不是**探测/临时形态（不含 `verify-` / `probe` / `/tmp/`）。→ **三条实测**：`scope=project` / `projectPath=/data/home/yale/work/quay-fleet` / `installPath=/data/home/yale/.claude/plugins/cache/quay/quay/0.17.0`；该路径 `test -e` = True（且其中 `vendor/quay-native/dist/quay-native.js` 1381169 字节在盘）；`probe-shaped` = False。⛔ 不是手写键：键与记录**由同一次 `claude plugin install … --scope project` 一并产生**。
- [x] 负控制做过并留档：把 `settings.json.enabledPlugins` 手工改回 `{}`（或把 config 绑定改回开发检出）⇒ AC-264 判据翻假；恢复 ⇒ 翻真。→ **两臂都做了**，留档 `/home/yale/work/ac264-2nd-evidence/negative-control.log`：①改回 `{}` ⇒ exit 1，stderr 逐字为立案当轮那条 `enabledPlugins carries no quay@* key (keys=[])`；恢复 ⇒ exit 0。②把两条绑定行改回 `/home/yale/work/quay/plugin/vendor/quay-native`（开发检出）⇒ exit 1，stderr 逐字 `binds to no .claude/plugins/cache/ path …`；恢复 ⇒ exit 0。恢复后两个文件的 `sha256` 与改动前逐字节相同、fleet `git status` 对这两个文件为空。
- [x] scoped 门 `bash scripts/test.sh --for-task <id>` 绿（若本任务未改本仓源码，按 `scripts/test.sh` 的 scoped 语义记录实际读数）。→ **实测 exit 0**：`scripts/test.sh: --for-task gap-ac264-fleet-project-scope-deployment-rotted — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in`（本任务未改本仓源码，delta 为空 ⇒ 选择器选 0 个测试文件；`--allow-thin` 下放行）。scoped-gate cache 已写（`developSha=99efed2c9495bb71a5061f3b968e22c7e01b19ca`）。

## Evidence

**起点（立案当轮，供对照）**：`settings.json` 工作树相对 HEAD 是未提交修改、`enabledPlugins` 为 `{}`、sha256 `9465082acdd7…`；marketplace 源目录已被删；config 绑 `0.9.0`（不存在）。

**真实重装（本轮，cwd = `/home/yale/work/quay-fleet`）**

```
$ mkdir -p /home/yale/work/quay-plugin-dist && git -C /data/home/yale/work/quay archive origin/dist-plugin | tar -x -C /home/yale/work/quay-plugin-dist
  → 源 = dist-plugin @ a28b82cf685f759a931e2b2000584073f7bb2864，VERSION 0.17.0，bin/quay 在，.claude-plugin/marketplace.json name=quay plugins=[quay→"."]

$ claude plugin marketplace add /home/yale/work/quay-plugin-dist --scope project --json
{"command":"marketplace-add","outcome":"ok","marketplace":"quay","message":"Successfully added marketplace: quay (declared in project settings)\nMarketplace 'quay' was already added from github:yaleh/quay and now points at dir:/home/yale/work/quay-plugin-dist. ..."}

$ claude plugin install quay@quay --scope project -y --json
{"command":"install","outcome":"ok","plugin":"quay@quay","pluginId":"quay@quay","scope":"project","message":"Successfully installed plugin: quay@quay (scope: project)"}
```

⚠️ **机制观察（供后续读者）**：marketplace 的**名字是机器级单例**（`.claude-plugin/marketplace.json` 自己的描述逐字说 "a marketplace name is ONE machine-wide slot"）。因此 `--scope project` 的目录渠道 add **同时改写了机器级 `~/.claude/plugins/known_marketplaces.json` 里 `quay` 槽**（它原先指 `github:yaleh/quay`）。这不是本次的意外，是机制本身；记录在此以免下次被当成又一个「烂」。

**两条直接量的当场回读**

```
settings.json  : {"permissions": {...}, "enabledPlugins": {"quay@quay": true},
                  "extraKnownMarketplaces": {"quay": {"source": {"source": "directory",
                                               "path": "/home/yale/work/quay-plugin-dist"}}}}
installed_plugins.json[quay@quay] 新增一条：
  {"scope":"project","projectPath":"/data/home/yale/work/quay-fleet",
   "installPath":"/data/home/yale/.claude/plugins/cache/quay/quay/0.17.0","version":"0.17.0",
   "installedAt":"2026-10-10T02:22:16.205Z","lastUpdated":"2026-10-10T02:22:16.205Z"}
```

**配置绑定修复（fleet 提交 `e3a6ffb`，`git status --porcelain -- .quay/config.yml` 为空）**

```
-    path: /data/home/yale/.claude/plugins/cache/quay/quay/0.9.0/vendor/quay-native
+    path: /data/home/yale/.claude/plugins/cache/quay/quay/0.17.0/vendor/quay-native
-    - /data/home/yale/.claude/plugins/cache/quay/quay/0.9.0/vendor/quay-native/dist/quay-native.js
+    - /data/home/yale/.claude/plugins/cache/quay/quay/0.17.0/vendor/quay-native/dist/quay-native.js
（三个 env QUAY_NATIVE_{ADR,GOAL,META}_DIR 逐字未动；该文件 `0.9.0` 残留 = 0 处）
```

**AC4 — 判据逐字重跑**

```
$ cd /data/home/yale/work/quay && bash /home/yale/work/ac264-2nd-evidence/ac264-criterion.sh
（stdout/stderr 均空）
EXIT=0
```

**负控制（`negative-control.log` 逐字）**

```
ARM 1 设置键：enabledPlugins={} → AC-264: ... enabledPlugins carries no quay@* key (keys=[]) ; exit=1
              恢复                → exit=0
ARM 2 开发检出绑定 → AC-264: ... binds to no .claude/plugins/cache/ path (binding lines: ['path: /home/yale/work/quay/plugin/vendor/quay-native', …]) ; exit=1
              恢复                → exit=0
POST sha256 与 BASELINE 逐字节相同；fleet git status --porcelain -- .claude/settings.json .quay/config.yml 为空
```

**scoped 门**

```
$ bash <wt>/scripts/test.sh --for-task gap-ac264-fleet-project-scope-deployment-rotted --allow-thin
scripts/test.sh: --for-task … — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
EXIT=0
$ node --experimental-strip-types plugin/scripts/worker-driver.ts --write-scoped-gate-cache --task … --develop-sha 99efed2c9495bb71a5061f3b968e22c7e01b19ca --root /data/home/yale/work/quay
{"event":"scoped-gate-cache-written", …}
```

**留档**：`/home/yale/work/ac264-2nd-evidence/`（`settings.json.before`、`config.yml.before`、`settings.json.postrepair`、`config.yml.postrepair`、`ac264-criterion.sh`、`append-carrier-2nd.py`、`negative-control.sh`、`negative-control.log`、`final-verification.txt`）。

## Result

### AC6 — 上一轮为何未守住（可证伪定位，非「可能是」）

**（a）抹掉 `settings.json` 键、并删掉 `installed_plugins.json` 里 quay-fleet 那条 project 记录的那次操作——已定位到一次具体会话，三条直接量互校：**

| 直接量 | 读数 |
|---|---|
| **transcript 锚点**（`meta-cc`，会话 `af351790-8682-4f76-9dfb-27198be775db`） | 02:36:26Z 的 `AskUserQuestion` 逐字把 **quay-fleet** 列为目标：「按各自 scope 卸掉 pin（**project: quay-fleet/lan**；local: claudecodeui ×3、archguard）」；02:37:47Z 该会话跑循环 `… claude plugin uninstall quay@quay --scope "$scope" …`，工具描述逐字 **"Uninstall stale pins and measure each"**；同一会话 2026-10-06T11:23:12Z 又逐字称 **"quay-fleet (pin removed last session)"** |
| **文件系统锚点**（`stat`，**修复前**读数） | `quay-fleet/.claude/` 目录 mtime = `2026-10-04 10:37:47 +0800` == **02:37:47Z** —— 与上表那次循环**同一秒** |
| **状态形状** | `claude plugin uninstall --scope project` 的产物正是观察到的形态：settings 里留 **`{}` 空对象**（不是删键）、`installed_plugins.json` 里该项目记录消失。负控制 ARM 1 复现了同一句 stderr |

⇒ **这是本机一次【人有意的、跨工作区的】集成决策**：把 8 处 per-project pin 清掉、统一由 user-scope 的一份供版。它**不是** quay-fleet 自己的循环干的，也**不是**任何 quay 机件干的。附带抓到一条该操作自己的**前提为假**：其选项文案写「卸掉各项目的 quay@quay 安装（**保留它们 settings.json 里的 enabledPlugins 意愿**）」，而对 fleet 而言 `uninstall` **删掉了那把键**——「保留意愿」在 project scope 上不成立。

**（b）cache 被顶——机制已闭合并可复现地证伪：** fleet 提交 `d20b407`（2026-09-18，`git log -S '0.9.0' -- .quay/config.yml`）把绑定从 `0.7.0` 改成 `0.9.0`，提交信息逐字 "provider path 0.7.0 -> 0.9.0 (matching the installed plugin cache)"；此后机器级安装又 materialize 出 `0.10.0`(09-21)、`0.11.0`(09-25)、`0.14.0`(10-04)、`0.15.0`/`0.16.0`(10-06)，而 **`0.9.0` 目录今天已不在**。⇒ **钉住某个 cache 版本的绑定，会被下一次别处安装回收**——这正是 Proposal 说的「会被顶掉」，现在是可证伪的直接量（`ls` 前后对照 + `git log -S`）。

**（c）marketplace 源被删：** `/home/yale/work/quay-plugin-dist` 不存在（`ls` 报 No such file or directory），而修复当轮 `claude plugin marketplace add` 的返回逐字告知机器级 `quay` 槽**此前已指向 `github:yaleh/quay`** ⇒ 目录源注册早先已被替换掉；配合 shell history 里同族命令（`claude plugin marketplace remove quay` / `marketplace add yaleh/quay`），可定位到「源注册被换掉 + 那个 `/home/yale/work/…` 临时目录后来被清理」两件事，而**两者都不是 quay 机件所为**。

### 裁定：**无需新增常驻检查**（硬规则 12）

- **发生数**：本面（project 级 pin 被**跨工作区的一次人手操作**清除）= **1 次**。
- **检测本身已经存在**：quay 的 goal-driver 每轮跑 `goals/AC-264-…md` 的 criterion；它红了，才立的本条。所以缺的不是「一道闸」，而是**提前量与解释力**。
- **为什么再立一道闸也不解决问题**：肇事者是**另一个工作区里一次经人批准的集成决策**。常驻检查只能在事后重新发现它（现状已是如此），不能阻止它——除非把「其它工作区不许整理本机 plugin 安装」立成规则，那正是硬规则 12 禁止的「凭空设前置」。
- ⇒ 记为**观察项**，不作阻塞位；⛔ 不留任何无证据的因果断言。

### 两条观察项（如实记录，未落地；不是本任务的 AC）

1. **AC-264 的 criterion 的记录检查是「存在盲」的。** 它要求 `plugin_cache_path` 非空且非探测形态，但**不要求该路径存在**——所以它能被一条 `plugin_cache_path` 已死的旧记录（2026-09-15 的 `0.7.0`）满足。这正是「红得晚、且红了也说不清整条链烂到哪」的结构原因。**未改**：改 criterion 要走 `quay goal write`，而此刻改**会立刻把该 goal 判红**（唯一合格的那条记录带着死路径），本条任务要求 criterion exit 0，两者冲突 ⇒ 留观察项给后续作者/人裁定。

2. **本任务 AC2 自身的形态与「自足」有结构性张力（这是本轮最值得留痕的一条）。** AC2 逐字要求绑定行的 `path:` 含 `.claude/plugins/cache/`（AC-264 的 criterion 同样要求）。这把绑定**锁死在某个具体 cache 版本目录**上——而 (b) 已证明该版本会被下一次别处安装回收。quay 自己给消费者项目的**免版本**形态（绑定 `<repo>/.quay/plugin` 软链，`/quay:init` 负责重新指向）**过不了 AC2 与 criterion 的字面**，因为那条路径不含 `.claude/plugins/cache/`。⇒ **在 AC2 的字面约束下，这个部署注定会在下一次机器级安装/卸载时再次腐烂**，修复只能是一次性的重新指向。这条不新增检查（同上：发生数=1 且属人手操作），但它说明「自足」这一半在本条 AC 的措辞里**没有被真正解决**，只被重新指向了一次。

## Touches

- .quay/productization-verification.jsonl
- tasks/gap-ac264-fleet-project-scope-deployment-rotted.md

**Touches 说明（本仓 Touches 纪律）**：修复对象（quay-fleet 的 `.claude/settings.json` / `.quay/config.yml` / `installed_plugins.json`）**不在本仓内**，无法作为本仓 Touches 条目声明——同前次修复 `gap-ac264-quay-fleet-project-scope-plugin-only-deployment` 的处理。故本仓 Touches 只列**真实会动的两个**：证据载体 `.quay/productization-verification.jsonl` 与自身任务体（self-touch）。⛔ 若 AC6 决定新增一道本仓内的取假检查（源码 + 测试），执行时须用 `task_write` 把该源码与测试文件补进 Touches 后再动它们。**本轮 AC6 裁定为「无需新增常驻检查」⇒ 未新增本仓源码/测试，Touches 保持原样不变。**
