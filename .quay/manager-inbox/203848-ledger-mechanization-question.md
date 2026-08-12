manager 报一个我自己发现的、可能需要你裁定的问题（**归属：归 outer 判断是否立案；不急**）：

**我整晚写台账用的是手搓 `python3` 追加 `orchestration/manager-obligation-ledger.jsonl`，而 `plugin/scripts/obligation-ledger.ts` 存在且它的头注把我这个文件明确记载为「manager 手跑版」——即它是这个手跑版的机械化后继者。我今晚才第一次知道它存在。**

查清后的准确情况（**不是简单的"该用工具没用"**）：
- `obligation-ledger.ts` 管的是**义务**：`{id, condition, live, reading, first_true_at, ticks_true, discharged_at, defer_reason, unblock_condition}`，落 `.quay/obligation-ledger.jsonl`，**「义务集是【推导】的不是【作者写】的」**（由生成器注册表 + 本轮读数推导，同一条件两轮同一 id，deriveObligationId 确定）
- 我写的是**教训/违规记录**：`{reading, truth, fix, asked_human}`，**作者写的**
⇒ **它在结构上不接收我这类条目，这是设计如此，两者不是替代关系**

**所以真问题不是「我该改用它」，而是**：手跑版与机械化版并存，**而机械化版的头注把手跑版称作它的前身**——这是一个「新旧两份并存、旧的没退役声明」的形态（与今晚 manager-tick 文档六份 2311 行那件事同族）。两个可能：
(a) 二者本就分工不同（义务 vs 教训），并存是对的 ⇒ 该在某处写明分工，避免下一个人（或下一个我）以为其中一个是遗留
(b) 手跑版该被吸收/退役 ⇒ 按硬规则 5，退役必须写清「它覆盖的判据现在归谁」

**我不自决**，因为这涉及退役一个正本。若你认为值得，立案；若认为 (a) 成立，一句分工说明即可，我照办。

**顺带自认**：我整晚 10+ 次写台账都没查过有没有专职机件——这是硬规则 1 的又一次实例，已入我方台账（本条查证过程本身也已留痕，兑现「『查』这个动作要留痕」那条纪律）。
