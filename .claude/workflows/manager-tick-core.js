export const meta = {
  name: 'manager-tick-core',
  description: '管理者 tick 的持久化核：独立自我审计 + 把"该跑什么/该判什么"作为指令交还主循环',
  whenToUse: '每次 manager tick 的第一步，也是主循环唯一需要记住的一条：调它，然后照它返回的指令做',
  phases: [{ title: 'Audit', detail: '用 meta-cc 独立审计管理者本轮行为（含"判准有没有真被应用"）' }],
}

// ══ 本文件的设计（人 2026-08-07 提出，逐条都是对我前一个错误前提的纠正）══════════════
//
//  ① workflow 结晶的是【重复的 agent 行为序列】——"哪一步不许跳"，不是多智能体扇出。
//  ② subagent 不缺上下文：meta-cc 索引着管理者会话历史，它可以自己查。
//  ③ **tick workflow 本身就是快路径，职责是发现问题；深路径在 tick 里、workflow 外。**
//  ④ args 分工：高频/结构化/我已有的 ⇒ args 传；低频/需探查/我不一定记得的 ⇒ 让它自己查。
//  ⑤ **【本版核心】把"调用工具的要求"和"judge 的判准"放进本文件，但【不】发给 subagent，
//     而是在 subagent 跑完后【贴在返回结果后面交还主循环】。**
//     ⇒ 主循环的 tick 只需记住一条：**调这个 workflow，然后照它返回的指令做**。
//     ⇒ 判准不再是"我记得应用"的散文，而是每轮作为数据出现在眼前的东西；
//        且它活在磁盘上，**不依赖本会话上下文存活**（跨 clear/compact 稳定）。
//
//  这直接修掉一个实证缺陷：judge 从 workflow 移到主循环后，判准执行退化为"记得应用"，
//  自审 agent 于 2026-08-07 12:2x 当场抓到——上一轮 tick-log 通篇没应用过任何一条判准。
//
// ── 成本实测（四轮，每轮把瓶颈往下推一层）─────────────────────────────────────
//   轮1 探索式（agent 自己读文档找命令）  121 次工具调用 / 677s
//   轮2 固定命令块下发给 agent             12 次 / 334s
//   轮3 读数+judge 移出 workflow            1 agent 6 次 / 137s
//   轮4（本版）指令回传，主循环只记一条    同上 + 主循环侧读数 ~1.2s
//
//   两个真瓶颈（都不是"调用次数"）：
//   (a) 固定命令包进 agent 要 46s，主循环直接跑只要 102ms～1.3s——
//       命令本身 1.7s 就返回，多出的 44s 全是"读 prompt→决定→读结果→生成结构化输出"。
//   (b) 自审 222s 里 meta-cc 只占 27s，**167s 是模型读完 14,715 字符后的纯推理**
//       ⇒ 驱动量是【返回体积】，故强制 content_summary + preview_length + limit。
//
// ── 脚本层能力边界（探针 wf_af76a6df-2c3 实测）───────────────────────────────
//   globalThis 仅：log / phase / budget / setTimeout / clearTimeout /
//                  agent / parallel / pipeline / workflow / args
//   无 require / process / fetch；`import()` 在语法检查阶段即被拒；`export` 仅允许用于 meta。
//   ⇒ 脚本层零 I/O，固定命令只能由主循环执行——这正是本版把它【回传】而非【执行】的原因。

// ⚠️ 改本文件后的验证：**必须实际调用一次 Workflow**，不要拿 `node --check` 当通过。
//    2026-08-07 21:5x 实测：我在模板串里写了未转义的反引号，`node --check` **通过**
//    （反引号提前终止模板串，剩余字节碰巧仍是合法 JS），而 Workflow 解析器报
//    `Unexpected token (91:41)` —— tick 的核心机制当场不可用。
//    **模板串里的每个反引号都要写成 \`；`${` 也要转义**（早先踩过一次 String.raw 不挡 ${}）。
//    通则同本文件判准 ②b：一个"通过"的检查，只有在它检查的正是你需要的保证时才算数。

const MODEL = 'sonnet'
const ROOT = '/home/yale/work/quay'
const MGR_SESSION = 'b8dc91a6-64e8-4d70-a715-9ec8e16a4f11'

// args 到达时是【字符串】不是对象（实测 wf_6f8cc053-f52）：直接 args.x 会静默 undefined。
const A = (() => { try { return typeof args === 'string' ? JSON.parse(args) : (args ?? {}) } catch { return {} } })()
const PRIOR = A.prior ? `\n上一轮读数（只报差异）：\n${A.prior}\n` : ''

// ══ 交还给主循环的指令 ①：该跑什么 ══════════════════════════════════════════
// 判据的单一来源。改判据改这里，主循环照抄——它不需要记住任何一条命令。
const READ_CMD = String.raw`cd /home/yale/work/quay
echo "PC=$(git log --oneline --since='1 day ago' | wc -l)"
lat=$(gh release view --json tagName -q .tagName 2>/dev/null); echo "release=$lat ahead=$(git rev-list --count $lat..develop 2>/dev/null)"
python3 -c "import json;d=json.load(open('packages/quay/package.json'));print('plugin_in_files='+str('plugin' in d.get('files',[])))"
python3 -c "import json;print('manifest='+json.load(open('plugin/.claude-plugin/plugin.json'))['version'])"
grep -o 'avg10=[0-9.]*' /proc/pressure/cpu | head -1; echo "load1=$(cut -d' ' -f1 /proc/loadavg) node=$(pgrep -cf 'bin/node')"
# ^ 2026-08-12：`pgrep -c node`（按 comm 匹配）在本机【恒返回 0】——实测同一时刻 `pgrep -cf node`=68、
#   `ps -eo args | grep -c '^/home/yale/.nvm.*bin/node'`=24、load1=14.08。而 `ps -eo comm | grep -cx node` 也=0
#   ⇒ 本机 node 进程的 comm 不是字面 "node"。**一个恒为 0 的读数携带零信息**——与已退休的判准 ⑥、
#   与 mon_outer 那个「硬编码签名⇒恒 DEAD」的布尔同族。改为 `-f` 按完整命令行匹配。
#   **一般形态：读数与 load1 这类独立量矛盾时，先怀疑读法，别急着当成系统状态突变（⑤）。**
for p in quay archguard meta-cc; do [ -f /home/yale/work/$p/.halt ] && echo "halt:$p"; done
tmux list-panes -a -F '#{session_name}:#{window_name}=#{pane_current_command}' 2>/dev/null | grep quay-0 | tr '\n' ' '; echo
echo "outer_bq=$(tail -40 orchestration/tick-log.md | grep -oE '^> \*\*[0-9]{2}:[0-9]{2}Z' | tail -1)"
echo "outer_tbl=$(grep -m1 '^| 2026' orchestration/tick-log.md | grep -oE '[0-9]{2}:[0-9]{2}Z')"
echo "outer_li=$(tail -40 orchestration/tick-log.md | grep -oE '^- \`[0-9]{2}:[0-9]{2}[xZ]*\`' | tail -1)"
echo "outer_any=$(tail -40 orchestration/tick-log.md | grep -oE '[0-9]{2}:[0-9]{2}[xX]?Z' | tail -1)  # 三种写死格式全空时的兜底"
# ^ 2026-08-12：outer 的 tick-log 换到【第三种】格式（`- \`HH:MMZ\` \`verb\` — …` 列表项），
#   而上面两条写死格式的读法【都】静默返回空——正是 manager-loop-tick.md:665 钉过的
#   「日志格式是会变的，而写死格式的读法不会报错，只会安静地返回旧值」，这次连旧值都没有，返回空。
#   ⇒ 加第三种 + 一个不依赖行首形态的兜底。**判读：`outer_any` 有值而前三个全空 ⇒ 格式又变了，当轮补读法。**
python3 -c "
import json,os,time
d=json.load(open('.quay/full-suite-state.json'))
ms=d.get('durationMs')
print('suite=%s/%s dur=%s age=%smin'%(d['state'],d.get('reason'),('%.1fs'%(ms/1000)) if ms else '跑着呢(无终态时长)',int(time.time()-os.path.getmtime('.quay/full-suite-state.json'))//60))"
# ^ 2026-08-08 03:1x：durationMs 在 running 态是 null，早前我手打的变体直接 ms/1000 → TypeError，
#   **整条 suite 读数当轮丢失，而丢失的恰恰是"正在跑"这个最该看的状态**。
#   两个教训：(a) ⑥′(a) 原型——我执行的命令块与 workflow 交还的不一致，加字段加出了崩溃；
#   (b) 同族形状——**读数在它最有价值的那个状态下不可用**，与"闸门只在没事时才绿"同构。
git rev-list --left-right --count develop...integration | awk '{print "diverge="$1"/"$2}'
echo "commits30m=$(git log --oneline --all --since='30 minutes ago' | grep -vc '^[0-9a-f]* manager:')"
echo "mon_procs=$(ps -eo args | grep -cE 'SUITE-TERMINAL|full-suite-state\.json' | tr -d ' ') （枚举而非布尔——见下方注释）"
ps -eo pid,etime,args | grep -E 'SUITE-TERMINAL|full-suite-state\.json' | grep -v grep | sed 's/^\(.\{110\}\).*/\1…/'
python3 orchestration/manager-anchor-check.py
if [ -f .quay/manager-write-freeze.txt ]; then
  fz=$(grep -v '^#' .quay/manager-write-freeze.txt | grep -v '^$')
  since=$(date -u -d "@$(stat -c %Y .quay/manager-write-freeze.txt)" +%Y-%m-%dT%H:%M:%SZ)
  echo "freeze_active=1 paths=$(echo "$fz" | wc -l) since=$since"
  echo "freeze_violations=$(git log --since="$since" --format='' --name-only 2>/dev/null | sort -u | grep -Fx "$fz" | tee /tmp/.mgr-fz-hit | wc -l)"
  [ -s /tmp/.mgr-fz-hit ] && { echo "  ⚠️ 冻结成立后仍被改的路径（逐条）："; sed 's/^/    /' /tmp/.mgr-fz-hit; }
  # 负控制：谓词对一个已知在清单内的路径必须命中，否则 0 是谓词坏不是真 0（今天补的「零计数」那一半）
  echo "freeze_predicate_selftest=$(echo 'plugin/scripts/manager-start.sh' | grep -cFx "$fz")  # 必须=1"
else
  echo "freeze_active=0（无冻结清单）"
fi
# ^ 2026-08-12：vhs-merge 那棵树持有 10 个未解冲突,其中 7 个是 manager 层文件。outer 请求冻结、我确认。
#   **不写成承诺而写成读数,是因为 C17**：一条规则若「守」与「不守」在记录上无法区分,它就只能靠意志——
#   而我今天已实证过一次「守不住」（C8 读了 7 次引用了 7 次仍违反 8 次）。
#   ⇒ 违反表现为 freeze_violations 非 0 + 逐条列出路径（枚举而非布尔,硬规则③）。
#   解冻条件写在清单文件头部;删除清单时须在 tick-log 记一行。
echo "=== inbox（A15：判据是列目录本身，不看计数器；最近 5 封 + 总数）==="
ls -la --time-style=+%H:%MZ .quay/manager-inbox/ 2>/dev/null | tail -n +2 | sort -k6 -r | head -5
echo "inbox_total=$(ls -1 .quay/manager-inbox/ 2>/dev/null | wc -l)"
# ^ 2026-08-12 补进执行点（人问「是你的 tick 操作漏了？」后查实）：A15「收件箱每轮必查」此前只写在
#   orchestration/manager-tick-core.md 的散文核里，而【本 READ_CMD 从不测它】——我 10:20Z 查过一次后
#   连续两轮 tick 未查，期间漏读 outer 10:39Z 报的 round-18 infra-error 根因（resource-gate.test.mjs
#   故意杀子进程、stderr 的 Killed 被 childKilledBySignal 误判）与 10:28Z 点名给 manager 的 inner /clear 裁定。
#   代价：我 10:54Z 把 outer 已报过的事当作自己的发现讲回给它，且我那版只有症状没有根因。
#   ⚠️ A15 本身就是 2026-08-09 那次漏读 6 封 archguard 报告之后补的——**上次只补进散文核、没补进执行点，
#   于是同一个漏读复发**。这正是档案点名的「修正写在复盘小节、执行块不动 = 修了个没人执行的副本」。
#   ⇒ 判据放进读数块：漏查会表现为读数里缺这一块（可被 ⑥′ 自检抓到），而不是靠我记得。
# ^ 2026-08-07：我把 suite 监视器从 suite-state-trigger --monitor 换成了自记 prev 的轮询
#   （原因：suite-state-trigger 用共享的 .quay/suite-state-last.json 做边沿触发，
#    outer 也挂着一个实例，两者互偷事件——我那个挂了 1h45m 零事件）。
#   换监视器时【这条检查一度还指着旧签名】，等于换完就失去覆盖而不自知——
#   §1.4e 同型：换实现要同步换判据，否则"检查通过"检查的是一个已经不存在的东西。
# ^ 2026-08-08 01:2x：上面那句预言的事真的发生了，而且是在我自己的仪表盘上。
#   原来两行是【硬编码签名 → 布尔】：mon_outer 的签名 'quay-0:outer.0 -S -3' 已匹配零进程，
#   于是它每轮恒返回 DEAD——与已退休的 ⑥ 同型：答案恒定的判准携带零信息。
#   另外我连续三轮把它写成"mon_suite/mon_commit 双 alive"，而本命令块【从不输出 mon_commit】——
#   这一半成立：该读数在块里没有来源。
# ^ 2026-08-08 01:5x **当轮自我更正（重要，本身就是一次 ②b 违规）**：
#   我当时进一步断言"不存在任何 commit 监视器进程"，证据是 ps 无匹配 + TaskList 为空。
#   **五分钟后 commit 监视器 btat0fqct 发来事件——它一直活着。**
#   两个来源都对 Monitor 工具的任务【不完备】：ps 看不到（不是独立进程），
#   TaskList 也不列它（实测同一时刻仍返回 "No tasks found"）。
#   ⇒ **判 Monitor 死活，ps 和 TaskList 都不是完备来源；唯一可靠证据是它是否还在发事件。**
#   教训是 ②b 的原样重演，只不过这次发生在【我用来给自己定罪的证据】上：
#   **给自己定罪同样要过来源完备性这一关，认错不豁免举证责任。**
#   ⇒ 改为【枚举实际进程】而不是"按名字问在不在"：少了一个监视器会表现为少一行，
#   而不是一个我可以照抄成 alive 的布尔。一般形态：**布尔化的存在性检查会把"对象没了"伪装成"检查失败"，
#   而枚举把两者区分开。**`

// ══ 交还给主循环的指令 ②③④：判准 / 收尾 / 发消息 —— 全部搬出 .js（2026-08-08 05:5x，人指示）══
// 三段原是持久散文常量，性质相同：【持久】但【高频编辑】（判准 6h 内改了 15 次）——
// 每次编辑都要求跑一遍完整 Workflow（含自审 agent，60-110k token / 3-6 分钟）验证解析，
// 而那个验证只为防一个仅存在于【JS 模板串】里的风险（反引号提前终止导致 node --check 假绿）。
// 抽成纯 markdown 后该风险不存在——编辑这三个文件后【不需要】跑 Workflow，Read 一下确认落地即可；
// 只有改 .js 本身（本文件的结构/READ_CMD/AUDIT_SCHEMA/audit 的 prompt）才需要。
// git 跟踪（不同于 manager-pending.md 的 gitignored+可丢失——这三样是判断史/操作规程，
// 不是待办队列，理应可 blame/可 diff）。本 workflow 仍零 I/O，读不了这些文件；
// 让主循环去读，和它已经在做的"读 manager-pending.md"是同一个模式，只是把它推广到全部三段。
const JUDGE_CRITERIA = '**判准正本已搬出，读 `orchestration/manager-tick-criteria.md`（git 跟踪）逐条判读。**\n文件不存在或读不到 ⇒ 判准文件本身出问题了，当轮升级，不要凭记忆代打。'
const SENDING = '**发消息的正确形态已搬出，读 `orchestration/manager-tick-sending.md`（git 跟踪）照做。**\n文件不存在或读不到 ⇒ 先按 ADR-016 三段式送，事后核实必须走 meta-cc（不要凭记忆重建规程）。'
const CLOSING = '**收尾步骤已搬出，读 `orchestration/manager-tick-closing.md`（git 跟踪）照做。**\n文件不存在或读不到 ⇒ 至少做够两件：哨兵清扫在先，tick-log 追加一行在后（不要颠倒——颠倒过一次，见该文件史）。'

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['violations', 'undeclaredActions'],
  properties: {
    violations: {
      type: 'array',
      description: '管理者本轮违反自己规则的实例；空数组=未发现',
      items: {
        type: 'object', required: ['rule', 'evidence', 'status'],
        properties: {
          rule: { type: 'string' },
          evidence: { type: 'string' },
          status: {
            type: 'string',
            enum: ['新发生', '已入账', '判准已退休'],
            description: '新发生=本轮首次且 tick-log violations 列里没有；已入账=已在某一行的 violations 列（evidence 里必须引出那一行的时刻列）；判准已退休=该判准已被明文退休，本条不成立',
          },
        },
      },
    },
    undeclaredActions: {
      type: 'array', items: { type: 'string' },
      description: '你在证据里看到、但主循环【没有】声明的动作（漏报检测）；看不到就返回空',
    },
  },
}

phase('Audit')
const audit = await agent(
  `你审计【管理者自己】最近这一轮的行为。用 meta-cc 查会话 \`${MGR_SESSION}\`
（deferred 工具，先 ToolSearch 取 schema：\`mcp__meta-cc__query_session_content\`）
加 \`git log --oneline --since='40 minutes ago' -- ${ROOT}\`。

**⚠️ 第一纪律：读证据，不许从标题猜（人 2026-08-07 裁定）。**

**⚠️ 第二纪律：每条 violation 必须给 \`status\`，这是【计数正确性】的要求（2026-08-08 02:2x）。**
上一轮你返回 4 条，其中 **3 条早已在 tick-log 的 violations 列里入账**（01:2xZ / 01:4xZ / 01:5xZ），
**第 4 条断的是判准 ⑥ 缺席，而 ⑥ 已于 2026-08-07 20:1x 明文退休**（答案恒定 ⇒ 零信息，
被 ⑥′ 取代）——你比对的样本是 08-07 16:5x，早于退休。
**危害是机械的**：第六列是「连续 N 轮都在做」的唯一计数来源，
**把旧账当新账重报，会让计数虚高、阈值失真**——与 ⑦「承认即须入账」同一个计数面，方向相反。
⇒ 逐条标 \`新发生\` / \`已入账\`（evidence 里引出那一行的时刻列）/ \`判准已退休\`。
**检测照旧要做，不要因为怕重复就不报**——分类是你的活，抑制不是。
**另**：你上一轮自己写了「因 8 次工具调用预算已用尽，未能读更多行确认」——
**预算用尽就说不知道，不要把"没读到"写成 violation**（这正是 ②b：来源不完备 ≠ 不存在）。

上一版给了 3 次工具调用的硬预算，结果它只读到 commit **subject line** 就下结论，
一轮产出 **1 条假阳性 + 1 条无法证实**：把"管理者记录【接受上一轮违规】的那条提交"
读成了"本轮新发生违规"（重复计数），又因读不到 tick-log 正文而把"六条判准是否落地"
判为存疑——**实测那份正文里 ①② 各出现 4 次、③④⑤⑥ 各 3 次，逐条落地了**。
⇒ **省调用省出了错误结论。断言任何一条违规之前，必须读到承载证据的那段原文。**

**但"读证据"不等于"随便拉大段文本"**——真正贵的是体积：上上版 222s 里 meta-cc 只占 27s，
**167s 是模型读完 14,715 字符宽查询结果后的纯推理**。所以按【最便宜且能承载证据的源】选：

| 要查的 | 用什么 | 为什么 |
|---|---|---|
| **管理者 tick-log 正文** | **\`tail -N orchestration/manager-tick-log.md\`（直接读磁盘文件）** | **人 2026-08-07 裁定：记账进 gitignore、【可丢失】，自审也应读这个可丢失的文件而不是 git。该文件已脱离跟踪，\`git show\` 读不到新内容。** |
| 提交做了什么 | \`git show --stat\` / \`git log\` | 代码改动仍在 git 里，这条不变 |
| 会话里实际调了什么工具/说了什么 | meta-cc | 只有它有；但**必须**带 \`content_summary: true\`、\`preview_length: 120\`、\`limit: 15\` |

- **工具调用上限 8 次**（够读证据，不够漫游）
- **meta-cc 最多 2 次**，且只用于 git 里查不到的东西${PRIOR}

**判重复计数**：管理者的 tick-log 若是在**记录/接受一条已被指出的旧违规**，
那不是新违规——看清楚是"又犯了一次"还是"在承认上一次"。

只查这五条，逐条给证据（**引用你读到的原文片段**，不得是印象、不得只凭 subject line）：
1. **§1.b2 工具使用**：跨会话发消息用的是 \`plugin/scripts/send-keys-reliable.sh\`，
   还是手搓裸 \`tmux send-keys\`？有没有"该有现成工具却没查就自己搓"的动作？
2. **§1.5 该做却问人**：有没有把**自己已经有答案**的事推给人决定？
3. **§0 边界回流**：有没有写任务体/AC/DoD、跑验证、替项目调试代码、直接改项目代码？
4. **§4 已知失效（2026-08-08 06:5x 改为指针，不再是内嵌摘要——人裁定）**：
   读 \`orchestration/manager-loop-tick.md\` 的「## 4. 已知的自身失效形态」表格**全部行**逐条核对
   （核查当时该表 7 行：角色回流 / 把印象当测量 / 管道后读 \$? / 截断显示当全貌 /
   零命中当没发生 / \`--since='N min ago'\` 静默零 / 手搓代替现成工具；表可能已增行，以你实读为准）。
   **不要用记忆里的旧清单**——旧清单曾是内嵌在这里的 6 项摘要，与源表不同步两项缺失、
   一项（"无条件 echo"）查无来源，已在 2026-08-08 由人裁定改为指针，永远读源表，不再复制。
5. **判准有没有被真的应用**（**读 \`tail -40 orchestration/manager-tick-log.md\`，不要用 git**——
   该文件已 gitignore 且【允许丢失】：**文件不存在或行数不足不算违规**，如实说明读不到即可）：
   管理者上一轮的 tick-log 行里，六条判准（PC 有效性 /
   陈旧当现状 / 监视器 / halt / 突变 / 两种读法一致性）是否**逐条出现过结论**。
   **这条是补偿性检查**——judge 已从 workflow 移到主循环，执行点退化为"记得应用"，
   而 2026-08-07 12:2x 首轮即命中（上一轮 tick-log 通篇没应用过任何一条）。不许略过。

**关于熔态动作（2026-08-07 修正分工，别再生成它）**：
上一版让你列 moltenActions，实测返回空数组，而本轮明明有三件（换 suite 监视器、
修 READ_CMD 陈旧判据、答"355 秒是否少跑"）。**根因是结构性的，不是你失职**：
① 你与主循环**并行**跑，本轮提交常落在你之后（实测 4a25e589 在你运行中途、65d2e98f 在你结束后）；
② **多数熔态动作根本不进 git**——换监视器是 TaskStop+Monitor 两次工具调用、答疑是几条只读 Bash，零提交；
③ 你的 meta-cc 被限成 preview_length=120，只够看片段，不足以识别"他换了监视器"。
⇒ **"本轮做了什么"只有主循环完整知道，该由它声明；你的活是【核验】不是【生成】。**

所以：**不要列举主循环做了什么**。只在证据里发现【主循环没声明、但确实发生过】的动作时，
把它放进 \`undeclaredActions\`（这是漏报检测）。看不到就返回空数组，**不要凑数**。`,
  { label: 'self-audit', phase: 'Audit', schema: AUDIT_SCHEMA, model: MODEL }
)

// ══ 把指令贴在结果后面交还主循环 ══════════════════════════════════════════════
// 主循环的 tick 只需要记住一条：调这个 workflow，然后照下面返回的指令做。
return {
  audit,
  指令: {
    第一步_跑这个命令块拿读数: READ_CMD,
    第二步_按这些判准逐条判读: JUDGE_CRITERIA,
    第三步_收尾: CLOSING,
    第四步_发消息时照这个: SENDING,
    说明: '这三段由本 workflow 从磁盘上的 .js 交还给你，不依赖你的会话上下文——' +
          '判准是数据不是记忆，跨 clear/compact 稳定。改判据请改 .claude/workflows/manager-tick-readings.js。',
  },
}
