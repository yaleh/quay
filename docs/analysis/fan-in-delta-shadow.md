# fan-in delta 影子评估（E2）

> 只读、可复跑。记录 fan-in step-4 delta 判定的**现行判定 vs 候选规则判定**；
> 现行放行决策逐字不变（AC6：本任务不放松 fail-closed、不启用跳过、不缩短落地锁、不改 AC/DoD/G3）。
> 候选规则版本：`fan-in-delta-shadow-v1`，规则名 `doc-surface-exact-object-only`。
> 影子记录载体：`.quay/fan-in-step-trace.jsonl` 的 `delta-shadow` step-end（与 suite-skip/suite-end 同一
> 共享载体，每 fan-in 一条；⛔ 不新增 carrier，carrier-registry 与 gitignore 棘轮不受影响）。

## 复跑命令

**影子分类**（对任意 delta 重现现行 + 候选判定，单行 JSON）：

```bash
node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts \
  --classify-delta --shadow --root <repo-root> <delta-path>…
```

**本任务的真实影子记录**（本任务自身的 delta，走与 fan-in step-4c 相同的分类路径与记录函数）：

```bash
cd /data/home/yale/work/quay-worktrees/gap-fan-in-delta-shadow-evaluation
git diff --name-only develop...HEAD \
  | xargs node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts \
      --classify-delta --shadow --root "$PWD"
```

**读取影子记录**（从共享 step-trace 载体过滤 `delta-shadow`）：

```bash
grep '"step":"delta-shadow"' /data/home/yale/work/quay/.quay/fan-in-step-trace.jsonl
```

**真实窗口样本构成**（对既有 fan-in 过程日志 `.quay/fan-in-*.log` 的 `step:"delta"` 判定做计数，
窗口截至 2026-11-01）：

```bash
cd /data/home/yale/work/quay
python3 - <<'EOF'
import glob, json, re, collections
code = doc = 0
doc_dir = collections.Counter()
for f in glob.glob('.quay/fan-in-*.log'):
    for line in open(f):
        if '"step":"delta"' not in line: continue
        try: rec = json.loads(line)
        except: continue
        r = rec.get('reason','')
        if r.startswith('code delta'):
            code += 1
            m = re.search(r'code delta \((.*?)\) → run suite', r, re.S)
            if m:
                for p in re.findall(r'"([^"]+)"', m.group(1)):
                    t = p.split('/')[0]
                    if t in ('goals','meta','docs','adr','docs-managed','measurements','milestones'):
                        doc_dir[t] += 1
        elif 'doc-only' in r or 'reuse' in r:
            doc += 1
print('code-delta:', code, 'doc/skip:', doc, 'doc-dir code-delta:', dict(doc_dir))
EOF
```

## 候选规则与覆盖论证

**规则**：一条 delta 路径是 candidate-doc（候选可跳）当且仅当它是 task 文件，或它落在 doc 面
（`tasks/ goals/ docs/ docs-managed/ meta/ adr/ .quay/ measurements/ milestones/ orchestration/archive/ plugin/loop/`
+ 项目声明的 `loop.doc_surfaces`）且**没有任何 change/full 层 checker 的【精确文件】`@static-object` 命中它**。

**覆盖论证（假说，本报告负责检验）**：checker 的精确文件对象（如
`docs/analysis/ac69-slot-release-vs-dispatch-gap.json`）是「我读**这个**文件」的精确信号；目录前缀与
`*`/`**` glob（如 `plugin/`、`plugin/loop/*-tick-core.md`）是「我读**一族**文件」的宽泛声明。假说主张
宽泛声明在 doc 面上**过登记**，故可被精确对象判定取代。

**候选与现行的关系（结构上不取假）**：候选只在 doc 面内收窄（candidate-doc ⊇ 现行 doc）；对非 doc 面
路径候选与现行同 fail-closed（code）。故候选绝不把 product code / unknown path 判成可跳。

## 真实窗口样本构成（截至 2026-11-01）

| 量 | 值 |
|---|---|
| delta 判定总数（有 trace） | 2537 |
| code delta（跑全量） | 2423 |
| doc-only / develop-advance reuse（跳过全量） | 114 |
| classify failed（判不出，fail-closed 跑全量） | 0 |
| doc 面 code-delta（历史累计：goals/meta/docs/adr） | 225 / 4 / 3 / 1 |

> doc 面 code-delta 里 `goals/` 的 225 条在 `gap-doc-surfaces-missing-goals-prefix` 落地后归零；
> `docs/`/`meta/`/`adr/` 的少量条是精确文件对象（`docs/analysis/ac69-*.json`、
> `docs/analysis/criterion-failure-attribution.baseline.json`、`orchestration/archive/AC58-*.md`）——
> 这些在候选规则下**同样**是 code（精确对象命中），候选不产生分歧。

## 分歧清单（可复跑）

候选规则在**真实窗口内产生 0 条分歧**——现行判 code 的 delta 全部含 product code 或精确 checker 对象，
候选同样判 code；现行判 doc 的 delta 候选同样判 doc。

候选唯一会分歧的类别是**结构性假想**：一个仅被 `plugin/loop/*-tick-core.md` /
`plugin/loop/*-loop-tick.md` glob 命中、而未被任何精确对象命中的新文件（例如
`plugin/loop/hypothetical-new-tick-core.md`）。该类文件当前不存在于真实 delta 中；一旦出现，候选会把
它判为 candidate-doc（可跳），而现行判 code。该分歧**正是候选的漏检**（见下）。

## 候选漏检（负控制，AC3）

候选规则**不得**凭文件后缀或「非 HUB_FILES」自动宣称安全。逐类核对（真实 registry 判定）：

| 类别 | 样例路径 | 候选判定 | 依据 |
|---|---|---|---|
| 跨包消费者 | `packages/quay-github/src/*.ts` | code | `import-graph-check` object `packages/` |
| 构建/打包/锁文件 | `package.json` / `package-lock.json` | code | unknown ⇒ fail-closed |
| 共享夹具 | `plugin/test/fixtures/*` | code | `test-isolation-check` object `plugin/test/` |
| 测试发现 | `scripts/test.sh` | code | `checker-mutation-check`/`landing-target-check` object |
| 静态 checker 读取文档 | `orchestration/manager-tick-core.md` | code | `rhythm-consumer-check` glob `orchestration/*-tick-core.md` |
| 证书失效 | `packages/quay/src/fan-in/ff-merge.ts` | code | `import-graph-check` object `packages/` |
| 目标分支前进 | develop 前进面 | 现行 4b reuse 机制，候选不参与 | 复用判定独立于候选 |
| **候选假说反例** | `plugin/loop/hypothetical-new-tick-core.md` | **candidate-doc（漏检）** | `rhythm-consumer-check` glob `plugin/loop/*-tick-core.md` 真实读它 |

> 最后一行是**对假说的证伪**：registry 确实用 glob 登记了 doc 面文件
> （`plugin/loop/*-tick-core.md`、`plugin/loop/*-loop-tick.md`，被 `rhythm-consumer-check` /
> `judgment-consumer-check` / `retired-clause-check` 读取）。因此「glob 过登记」对 doc 面**不成立**——
> 候选规则会漏检一个真实的静态 checker 读取面。漏检必须显式报告（AC5：不能用零观察漏检替代覆盖论证）。

## 收益估算（AC5）

- **潜在可省全量次数**：真实窗口内 **0 次**（候选 0 条分歧）。
- **duration 估算**：0 次 × suite p50 4.1min ≈ **0 min/窗口**（只取真实 delta 判定窗口，不设 40% 跳过率硬目标）。
- **CPU 估算**：**not-evaluated**——影子路径未采集 gnu-time CPU 计量，不能用 wall-time 换算 CPU-seconds
  （E1 同一条纪律：CPU-seconds 只取真实 CPU 计量）。

## 建议

**拒绝启用（reject），继续观察。** 依据：① 候选在真实窗口恢复 0 次全量跳过，收益为零；② 唯一会产生的
分歧类别（`plugin/loop/*-tick-core.md` glob-only 新文件）是已证实的漏检——覆盖论证不成立。任何实际放宽
验证面都需要独立任务与授权（本任务不启用）。
