export const meta = {
  name: 'manager-tick-readings',
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
grep -o 'avg10=[0-9.]*' /proc/pressure/cpu | head -1; echo "load1=$(cut -d' ' -f1 /proc/loadavg) node=$(pgrep -c node)"
for p in quay archguard meta-cc; do [ -f /home/yale/work/$p/.halt ] && echo "halt:$p"; done
tmux list-panes -a -F '#{session_name}:#{window_name}=#{pane_current_command}' 2>/dev/null | grep quay-0 | tr '\n' ' '; echo
echo "outer_bq=$(tail -40 orchestration/tick-log.md | grep -oE '^> \*\*[0-9]{2}:[0-9]{2}Z' | tail -1)"
echo "outer_tbl=$(grep -m1 '^| 2026' orchestration/tick-log.md | grep -oE '[0-9]{2}:[0-9]{2}Z')"
python3 -c "
import json,os,time
d=json.load(open('.quay/full-suite-state.json'))
print('suite=%s/%s age=%smin'%(d['state'],d.get('reason'),int(time.time()-os.path.getmtime('.quay/full-suite-state.json'))//60))"
git rev-list --left-right --count develop...integration | awk '{print "diverge="$1"/"$2}'
echo "commits30m=$(git log --oneline --all --since='30 minutes ago' | grep -vc '^[0-9a-f]* manager:')"
ps -eo args | grep -q '[q]uay-0:outer.0 -S -3' && echo mon_outer=alive || echo mon_outer=DEAD
ps -eo args | grep -qF 'SUITE-TERMINAL' && echo mon_suite=alive || echo mon_suite=DEAD
python3 orchestration/manager-anchor-check.py
# ^ 2026-08-07：我把 suite 监视器从 suite-state-trigger --monitor 换成了自记 prev 的轮询
#   （原因：suite-state-trigger 用共享的 .quay/suite-state-last.json 做边沿触发，
#    outer 也挂着一个实例，两者互偷事件——我那个挂了 1h45m 零事件）。
#   换监视器时【这条检查一度还指着旧签名】，等于换完就失去覆盖而不自知——
#   §1.4e 同型：换实现要同步换判据，否则"检查通过"检查的是一个已经不存在的东西。`

// ══ 交还给主循环的指令 ②：该判什么 ══════════════════════════════════════════
// 每一条都对应一次实测过的失效，不是设想。
const JUDGE_CRITERIA = `**判准（逐条应用，并把结论写进 tick-log 行——自审会检查你是否真做了）**

① **PC 有效性**：\`PC\` 必须远大于 0。为 0 ⇒ 查询本身坏了，**后续所有时间窗读数不可信**。
   （2026-08-07：\`--since='60 min ago'\` 静默返 0 而 \`'60 minutes ago'\` 返 13，
    据此误报过一次"系统全停"并推向 §2 升级。**下"零推进"结论前必须先过这条。**）
② **陈旧当现状**：\`suite age\` 很大却被当现状引用？状态文件的 \`failures:[]\` 是空数组，
   **不能用来数失败**，失败清单要从 \`.quay/full-suite.log\` 的 \`✖\` 行取。
②b **来源完备性——下"不存在"结论前必须先过这一条（2026-08-07 一天内踩了三次）**：
   在某个来源里搜不到 X，只有当**该来源对 X 是完备的**时，才等于"X 不存在"。三次实例：
   (i) 在 develop 上搜不到 → 判"未落地"，实际在 integration（**两棵树都要查**）；
   (ii) 在套件日志里搜不到文件名 → 判"这些测试没跑"，实际日志只对 34 个文件输出文件级
        记录，其余文件名根本不出现（**该日志对"某文件跑没跑"本就不完备**）；
   (iii) 报 FAIL 就当"假阴性、已送达"，实际 \`type=user\` 记录数为 0，消息真丢了。
   **机械做法**：先用一个**独立且已知完备**的读数交叉验证。(ii) 那次，用例总数
   （r9=2718✔ vs r10=2710✔+19✖，总数相同）一眼就能否定我的结论，而那个读数一直在手边。
②c **不对称是线索，不是噪声**：若"预期该坏的没坏、不相干的坏了"，通常说明**坏的是机制本身**，
   被保护对象只是碰巧幸存。r10 即此：失败全是"检查分组机制"的用例，而受隔离保护的测试全过
   ——根因是 \`group_of()\` 把未识别组名静默降级 engine，不是那些测试变坏了。
③ **监视器**：\`mon_*=DEAD\`？注意"进程活着"≠"能报得出"——后者属深路径。
④ **\`halt:\`**：出现在不该暂停的项目？（meta-cc 的 halt 已核实为 08-05 人为暂停、
   解除条件未满足，合理在效——不要每轮重新当异常报。）
⑤ **突变**：\`ahead\` / \`diverge\` / \`commits30m\` / \`avg10\` / \`load1\` 相对上一轮。
   **负载升高要溯源到进程**再判异常与否——多数情况是人裁定要做的工作本身。
⑥ ~~同一事实两种读法是否一致（\`outer_bq\` vs \`outer_tbl\`）~~ **已退休，2026-08-07 20:1x**。
   退休理由：该实例已诊断完毕且**答案永久恒定**——outer 改用 blockquote 后，表格读法
   \`grep -m1 '^| 2026'\` 恒返回 09:47Z（实测 outer_bq=20:05Z vs outer_tbl=09:47Z）。
   **一个答案恒定的判准携带零信息**，与我今早裁定 prefriction 触发器「正则过宽、信号已死」同形。
   未修的是**其他消费者**，那是 outer 的活，不是每轮重报的理由。

⑥′ **本轮读数是否足以回答每一条判准（替代 ⑥，自检式，永不恒定）**：
   逐条过一遍 ①②②b②c③④⑤，**任何一条答不出来，本身就是发现**，二选一写明：
     (a) **读数被我省掉了** —— 我执行的命令块与 workflow 交还的不一致（就是这次的根因：
         我把 outer_bq/outer_tbl 两行从实际执行的命令里删了，workflow 里还留着 3 处）；
     (b) **判准已死** —— 答案恒定或对象已不存在 ⇒ 立即退休并替换，不要留着每轮重答。

**🚫 禁用「略」**：tick-log 里任何一条判准都不许写「略」「未取」「同上」。
连续 6 轮的「⑥略」不是笔误，是**结构性遮蔽**：它既不回答、也不退休，于是
「这条判准还有效」和「这条判准早就死了」在记录上无法区分——正是本项目反复出现的
**声明在/保证没了**，这一次发生在我自己的判准表上。**答不了就写为什么答不了。**

**动作类四选一**：\`no-action\` / \`arbitrate\`（动了 \`.halt\` 或次序）/
\`escalate\`（攒给人）/ \`correct\`（纠正外层的**做法**，不能是它的任务内容）。
**自审 violations 非空 ⇒ \`correct\`**，对象是我自己。

**⑦ 承认即须入账（2026-08-07 自审报出，我自己犯的）**：
凡我在**对话里认下**或**写进规则文本**的违规/教训，**必须同时写进当轮 tick-log 的
violations 列**——只写进规则文本不算记账。理由是机械的：**第六列是「连续 N 轮都在做」
的唯一计数来源**，一条只在散文里被承认的违规**永远进不了计数、触发不了任何阈值**，
于是"已经改了"和"从没发生过"在数据上无法区分。
**实例**：「手搓 python 解析 jsonl 而不先问 meta-cc」——我在对话里认了、也写进了第四步的
规则文本，但连续两轮都没进 violations 列，直到自审替我发现。
**这与本项目反复出现的同一形状**：\`group_of\` 组名声明在/隔离保证没了；派生并发公式在/
约束没了；**认错的话在/计数不在**。**声明不是保证，散文不是账。**

**§0 边界的可操作停点（2026-08-07 落盘：我自陈 + 自审独立报出，两来源收敛）**
判断"闸门是否在测量它自称在测量的东西"**是**管理者职责——所以读产品代码定位根因是允许的。
**停点：读到能说清「闸门坏了、坏在哪一行」为止，不读到「该怎么修」。**
  可以：读 \`group_of()\` 发现未识别组名静默降级 engine；逐提交比对定位是哪次改动引入。
  不可以：写补丁、改脚本、设计守卫、跑验证套件替它判断修得对不对。
**机械自测（每轮问一遍）**：我这轮的输出里，**有没有出现"应该改成 X"这种句式**？
有 ⇒ 已越界，删掉改法只留根因。**手里出现 .sh/.ts 实现，是更早的越界信号。**
**已知灰区（记录而非禁止）**：为复现一条失败而在一次性 scratch 树里跑单个脚本
（如 \`bash <arm>.sh --validate\`）——2026-08-07 用过一次，用于区分"真失败 vs 并发 flake"，
未改任何项目文件。灰区的判准是**目的**：为"判断闸门读数是否可信"可以，为"替它调试"不可以。`

// ══ 交还给主循环的指令 ④：跨会话发消息的正确形态（2026-08-07 三次实测教训）══════════
const SENDING = `**给 outer / inner 发消息，三条都是踩过的**

1. **用 \`plugin/scripts/send-keys-reliable.sh <目标> <文本> <目标会话 transcript.jsonl>\`**，
   不要手搓裸 \`tmux send-keys\`——ADR-016 要求三次独立调用，合并会丢 Enter（2026-08-07 踩过）。
2. **超时设 120 秒**：\`RELIABLE_DELIVERY_VERIFY_S=120 bash plugin/scripts/send-keys-reliable.sh …\`
   （人 2026-08-07 裁定；脚本默认 60 秒，env 可覆盖，**不需要改产品脚本**）。
3. **消息经文件传，不要内联**：\`MSG=$(cat <file>)\`。内联时文本里的单引号（如 \`fan-in'd\`）
   会截断 shell 引用——2026-08-07 踩过两次。

**0. 发之前先确认目标空闲（2026-08-07 20:2x 定位到的真因，最省事的一条）**：
今晚三次"真丢弃"有共同因素——**发送时 outer 正在忙**（\`✽ Pontificating… · thinking\` /
状态行有 \`esc to interrupt\`）。忙时消息 \`enqueue\` 后约 3 秒被 \`remove\`，**直接丢弃，不是迟到**。
所以往忙的目标重发只会再丢一次。发之前查一眼：
\`\`\`bash
tmux capture-pane -p -t <目标> -S -3 | grep -q 'esc to interrupt' && echo 忙 || echo 闲
\`\`\`
**忙 ⇒ 不发**。挂一次性等待（\`until … idle; do sleep 10; done\`，用 Bash \`run_in_background\`，
退出即通知），空闲了再发。**不要挂持久监视器盯"转闲"——那个触发条件与"有没有事发生"无关，
今晚已因噪声退役过一次。**

**报 FAIL 时先核实再决定（这条最要紧，2026-08-07 17:1x 已改写）**：
该脚本的 FAIL **是歧义的**，它自己分不开这两种情况——今天两种都发生过：
  (a) **真假阴性**：消息已进 transcript，只是有界轮询没等到 ⇒ **重发会让对方收到两遍**；
  (b) **真失败**：消息 \`enqueue\` 后 3 秒被 \`remove\`，**被丢弃了** ⇒ **不重发 = 发现永久丢失**。
**\`加长轮询修不了 (b)\`**——丢弃的消息等再久也不会出现。今天 120s 那次就是 (b)。
**（这推翻了人 16:5x「假阴性可接受，加长轮询到 2 分钟」的前提：那个裁定假设失败形态是迟到。）**

**唯一可靠的判据是 \`type=user\` 且非 sidechain**（\`queue-operation\` / \`attachment\` 都不算送达）：
\`\`\`
mcp__meta-cc__query_session_content  role=user  session_id=<目标会话id>  contains=<本条特征串>
\`\`\`
**用 meta-cc，不要手搓 python 解析 jsonl**（2026-08-07 我手搓了一遍，犯了自己 §4 列的
「手搓代替现成工具」；meta-cc 按 role 直接筛，更短更准，还顺手能做跨消息审计）。
**返回 0 条 ⇒ 真丢了，补发；返回 ≥1 条 ⇒ 已送达，不要重发。**
**通则：凡要读会话历史，先问一句「meta-cc 能不能答」。**`

// ══ 交还给主循环的指令 ③：收尾必做 ══════════════════════════════════════════
const CLOSING = `**收尾（两件，顺序已在 2026-08-07 修正——见下）**

**⚠️ 顺序修正**：原顺序是「写日志 → 提交 → 哨兵清扫」，于是**哨兵清扫永远发生在日志提交之后，
在结构上不可能被当轮那一行记录**——自审连续三轮（14:3x / 15:4x / 15:5x）都报出"cron 重排未声明"，
那不是"忘了写"，是顺序保证了写不进去。**现改为：先清扫，再写日志（把清扫写进熔态列）。第 2 步「提交」已随 gitignore 裁定作废。**
一般形态：**要求记录某动作，就不能把该动作排在记录之后。**

0. **哨兵清扫（提到最前）**：\`CronList\` → 删除所有 prompt 含 \`[manager-tick]\` 者 → 建一个。
   **绝不靠记住的 ID，内容也不许凭记忆重打——\`cat orchestration/manager-tick-prompt.txt\` 取正本。**
   清扫完把它记进下面第 1 步的熔态列。

1. **向 \`orchestration/manager-tick-log.md\` 追加一行**，六列：
   时刻 / 动作类 / 三项目一句话（含判准逐条结论）/ 仲裁了什么 / 升级项变化 /
   **\`熔｜<动作名>,<动作名>\`**（本轮骨架之外的临时动作；无则 \`熔｜-\`）。
   第六列是上浮规则的计数来源——**没有它，"连续 N 轮都在做"无法判定**。
2. ~~**提交**~~ **——2026-08-07 人裁定「记账进 gitignore」后作废**（\`46ba6360\`）。
   \`orchestration/manager-tick-log.md\` 已脱离 git 跟踪：**没有可提交的东西，也不再需要
   "立即提交防脏树"**——它对 \`git status --porcelain\` 不可见，脏树断言的三个写入者少了我这个。
   理由：tick-log 是**运行时遥测不是代码**，没有任何测试或检查依赖它与代码版本对齐；
   实测 develop 独有的 338 条里 328 条（97%）是三层记账、只有 8 条真内容。
   **代价（已知并接受）**：自审原先用 \`git show <sha>\` 读 tick-log 正文核验判准，
   现在没有提交可读——它仍可读磁盘上的文件，但**丢失按轮归属**；且该文件不再有 git 层的
   跨机持久化。若需要持久化，走遥测那条路（对照 \`milestones/fast-mode-telemetry/*.json\`），
   不要退回把它塞进代码分支。
**深挖不在 tick 的快路径里做**：判不准的记进第六列，在 workflow 外单独深挖。`

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['violations', 'undeclaredActions'],
  properties: {
    violations: {
      type: 'array',
      description: '管理者本轮违反自己规则的实例；空数组=未发现',
      items: {
        type: 'object', required: ['rule', 'evidence'],
        properties: { rule: { type: 'string' }, evidence: { type: 'string' } },
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
4. **§4 已知失效**：把印象当测量 / 管道后读 \$? / 零命中当没发生 /
   \`--since='N min ago'\` 静默零 / 无条件 echo / 截断当全貌。
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
