# effort 降档效果对照读数（role 层 high→low）
> 只读、可复跑。本文件由 `scripts/effort-tiering-effect.mjs` 生成。
> 测量对象：`gap-role-effort-tiering-selector-pool-judge-meta-driver`（2026-11-01 落地）把
> selector / pool-judge / meta-driver 三个 role 的 effort 从 high 降到 low 之后的生产会话。

## 复跑命令（一条）
```bash
node scripts/effort-tiering-effect.mjs --sessions-dir /data/home/yale/.claude/projects/-data-home-yale-work-quay --root /data/home/yale/work/quay
```

代码/输入指纹：脚本 sha256=`5104431218b9`，输入 sha256=`103e895b9475`，git HEAD=`aa14b9b7a753`。
扫描：4114 个会话文件；role 匹配（selector/pool-judge/meta-driver）2222 个；无 user 记录 5 个；含坏行文件 0 个。

## 方法
- **role 分类**（首条 user 消息，子串匹配）：selector=`resident task selector`；pool-judge=`pool-quality gate for the quay task pool` 或 `architecture-review judge for the quay repo`；meta-driver=`You are the meta-driver:`；其余 = other。
- **effort 分桶**：会话内所有带 `effort` 字段的 assistant 记录取值唯一 ⇒ high/low；≥2 个不同取值 ⇒ `mixed`；缺 `effort` 字段或缺 `usage` ⇒ `not-evaluated`（独立取值，⛔ 不并入 high/low）。
- **指标**：`msgs` = 带 `message.usage` 且 input/output tokens 均为数字的 assistant 记录数；`output/msg` = Σoutput_tokens/msgs；`fresh/msg` = Σinput_tokens/msgs（`input_tokens` 本身即非缓存 fresh input）；`cache_read/msg` = Σcache_read_input_tokens/msgs；会话时长 = 会话内最晚−最早 timestamp。
- **样本是否足够**：n = 会话数；任一侧（high 或 low）n < 20 标为不足。
- ⛔ `output_tokens` 字段未必包含推理（thinking）token——若推理 token 不在其中，本对照会**低估**降档对推理侧的影响；这是字段局限，不是测量失败。

## 对照读数

### selector
| effort | 读数 |
|---|---|
| high | n=891；output/msg p50=186.4（均值 236.2）；fresh/msg p50=20858；cache_read/msg p50=38208；时长 p50=0.2 min / p90=0.6 min |
| low  | n=44；output/msg p50=219.3（均值 263.9）；fresh/msg p50=15672；cache_read/msg p50=43753.1；时长 p50=0.2 min / p90=0.5 min |

- mixed：n=0；not-evaluated：n=1。
- 样本是否足够：high n=891，low n=44 ⇒ **足够**（双侧 n ≥ 20）。

### pool-judge
| effort | 读数 |
|---|---|
| high | n=896；output/msg p50=512.5（均值 627.4）；fresh/msg p50=8259.8；cache_read/msg p50=33929.5；时长 p50=0.7 min / p90=1.8 min |
| low  | n=25；output/msg p50=618.1（均值 744）；fresh/msg p50=7896.8；cache_read/msg p50=27480.6；时长 p50=0.8 min / p90=1.4 min |

- mixed：n=0；not-evaluated：n=1。
- 样本是否足够：high n=896，low n=25 ⇒ **足够**（双侧 n ≥ 20）。

### meta-driver
| effort | 读数 |
|---|---|
| high | n=354；output/msg p50=1399（均值 1981.1）；fresh/msg p50=457792.5；cache_read/msg p50=0；时长 p50=0.4 min / p90=2.7 min |
| low  | n=9；output/msg p50=728.4（均值 887.6）；fresh/msg p50=2665.4；cache_read/msg p50=48706.6；时长 p50=3.8 min / p90=8.4 min |

- mixed：n=0；not-evaluated：n=1。
- 样本是否足够：high n=354，low n=9 ⇒ **不足**（任一侧 n < 20，不宣称收益或损失）。

## 方向一览（high → low，均值/中位）
| role | output/msg（均值） | fresh/msg（p50） | 时长（p50） | 样本是否足够 |
|---|---|---|---|---|
| selector | 236.2 → 263.9（12%） | 20858 → 15672（-25%） | 10.3s → 13.6s（32%） | 足够 |
| pool-judge | 627.4 → 744（19%） | 8259.8 → 7896.8（-4%） | 43.7s → 49.6s（14%） | 足够 |
| meta-driver | 1981.1 → 887.6（-55%） | 457792.5 → 2665.4（-99%） | 22.2s → 3.81min（931%） | **不足** |

## 结论
**三选一：`keep`**
- 理由：双侧样本足够的 role（selector/pool-judge）未出现明显回归（output/msg 均值 ≤ high×1.2 且时长 p50 ≤ high×1.5）；meta-driver 任一侧 n < 20，样本不足、不宣称收益或损失。因此保留 low（不 revert）。⛔ 这是「未见明显伤害」而不是「已证明降档有效」——详见报告对照表。
- 可重测条件：待 meta-driver 的 low 侧 n ≥ 20 后复测以确认。

> 判词口径：只有 high 与 low 双侧 n ≥ 20 的 role 才参与收益/损失判断；「明显回归」的保守界为 output/msg 均值 > high×1.2 或 时长 p50 > high×1.5。这**不是统计检验**，只是对照读数的保守解读。⛔ `keep` 是「未见明显伤害、不 revert」，不是「已证明降档有效」。
