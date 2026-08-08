**给 outer / inner 发消息，三条都是踩过的**

**⚠️ 2026-08-08 03:2x 我自己违反了下面第 1 条，值得先读这段（自审报出，新发生）**：
我手搓了裸 `tmux send-keys`（C-u ×1 → 文本 → sleep 3 → Enter）发了约 2500 字节给 outer，
**送达成功了——但那是运气**：脚本头部记的失败模式 1 实测「1554 字节需要按 30 次 C-u」，我按了 1 次；
失败模式 2「长文本紧跟 Enter 被丢弃」我用 `sleep 3` 代替了「轮询到两次 capture 相同」；
我当时看到的 `paste again to expand` 正是该模式要解决的那个歧义态。
**最该记的是它为什么没被我发现**：我在 tick-log 里写的是「**机械核实送达**」——
这个说法让整件事看起来更严谨，而**正是这个"更严谨"的外观挡住了"我用对工具了吗"这一问**。
**事后核实结果，替代了规定的过程。** 与 ⑦b 同族：核了结果就默认过程没问题。
⇒ **机械补救（下面第 4 条）**：记录里必须出现所用的投递工具名，让"裸 tmux"无处藏在"已核实送达"后面。

1. **用 `plugin/scripts/send-keys-reliable.sh <目标> <文本> <目标会话 transcript.jsonl>`**，
   不要手搓裸 `tmux send-keys`——ADR-016 要求三次独立调用，合并会丢 Enter（2026-08-07 踩过）。
2. **超时设 120 秒**：`RELIABLE_DELIVERY_VERIFY_S=120 bash plugin/scripts/send-keys-reliable.sh …`
   （人 2026-08-07 裁定；脚本默认 60 秒，env 可覆盖，**不需要改产品脚本**）。
3. **消息经文件传，不要内联**：`MSG=$(cat <file>)`。内联时文本里的单引号（如 `fan-in'd`）
   会截断 shell 引用——2026-08-07 踩过两次。
4. **记录里必须写出【用的哪个投递工具】，不只是【送达没送达】（2026-08-08 03:2x 新增）**：
   tick-log 里任何一次跨会话投递，都要写成 `投递=send-keys-reliable.sh` 或 `投递=裸 tmux（违规）`。
   理由是机械的，与 ⑤「数字必须带判定词」同型：**只记结果，工具选择就不可见**——
   「已核实送达」既可能是走了脚本，也可能是手搓侥幸成功，两者在记录上无法区分，
   于是「这次守了纪律」和「这次没守」不留痕迹。**结果正确不等于过程合规，记录要能分开这两件事。**

**0. 发之前先确认目标空闲（2026-08-07 20:2x 定位到的真因，最省事的一条）**：
今晚三次"真丢弃"有共同因素——**发送时 outer 正在忙**（`✽ Pontificating… · thinking` /
状态行有 `esc to interrupt`）。忙时消息 `enqueue` 后约 3 秒被 `remove`，**直接丢弃，不是迟到**。
所以往忙的目标重发只会再丢一次。发之前查一眼：
```bash
tmux capture-pane -p -t <目标> -S -3 | grep -q 'esc to interrupt' && echo 忙 || echo 闲
```
**忙 ⇒ 不发**。挂一次性等待（`until … idle; do sleep 10; done`，用 Bash `run_in_background`，
退出即通知），空闲了再发。**不要挂持久监视器盯"转闲"——那个触发条件与"有没有事发生"无关，
今晚已因噪声退役过一次。**

**报 FAIL 时先核实再决定（这条最要紧，2026-08-07 17:1x 已改写）**：
该脚本的 FAIL **是歧义的**，它自己分不开这两种情况——今天两种都发生过：
  (a) **真假阴性**：消息已进 transcript，只是有界轮询没等到 ⇒ **重发会让对方收到两遍**；
  (b) **真失败**：消息 `enqueue` 后 3 秒被 `remove`，**被丢弃了** ⇒ **不重发 = 发现永久丢失**。
**`加长轮询修不了 (b)`**——丢弃的消息等再久也不会出现。今天 120s 那次就是 (b)。
**（这推翻了人 16:5x「假阴性可接受，加长轮询到 2 分钟」的前提：那个裁定假设失败形态是迟到。）**

~~**唯一可靠的判据是 `type=user` 且非 sidechain**（`queue-operation` / `attachment` 都不算送达）~~
**⚠️ 上面这句是错的，2026-08-08 05:5x 实测推翻——它把两种真实送达形态排除了。**

**实测（05:39 那封"两条我自己的错"）**：脚本报 `FAIL——120s 轮询后 transcript 仍未出现内容匹配的
真实 user`，**但消息确实送到了**，outer 随后在处理它。查原始 jsonl，该内容落成：
```
type=queue-operation  ts=05:39:23.157Z
type=queue-operation  ts=05:39:42.590Z
type=attachment       ts=05:39:23.157Z  isSidechain=False
零条 type=user 纯字符串记录
```
⇒ **长文本/粘贴形态的投递，成功后就是落成 `queue-operation` + `attachment`。**
把它们排除 ⇒ 成功投递被判成 FAIL。

**正确判据（当前认知，随实测更新）**：核实送达要**在原始 transcript jsonl 里按内容特征串搜全部
记录类型**，`type=user` / `queue-operation` / `attachment` 任一命中即为已送达：
```bash
grep -c '<本条特征串>' ~/.claude/projects/-home-yale-work-quay/<目标会话id>.jsonl
# ≥1 ⇒ 已送达，不要重发；0 ⇒ 再等（投递可能仍在进行），别急着补发
```
**`mcp__meta-cc__query_session_content role=user` 对这个问题不完备**（②b 的实例）——
它只回 `type=user`，查不到 queue-operation/attachment，会把成功投递报成 0 条。
读会话历史的其它用途仍优先用 meta-cc；**只有"这条消息送到没有"这一问要直读 jsonl。**

**⚠️ 脚本的 FAIL 是自述，不是结论（②e）**：`send-keys-reliable.sh` 报 FAIL 只说明
**它没确认到**，不说明**没送到**——这两个是不同命题。**假 FAIL 比真 FAIL 更贵**：
我曾据一次假 FAIL 推翻了自己一条正确的等待策略、写了一条基于错误前提的判准（②g，已撤回）、
还在 tick-log 记了一条并不存在的违规。**收到 FAIL 时先自己查原始文件，再决定要不要补发。**
