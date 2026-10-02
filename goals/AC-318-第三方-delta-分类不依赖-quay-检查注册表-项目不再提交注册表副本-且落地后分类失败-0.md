---
id: AC-318
title: delta 分类不依赖 quay 检查注册表——无注册表的树落声明面/保守缺省而非分类失败，本仓库落 registry（判据已改为本仓可自证）
status: active
kind: criterion
goal: GOAL-027
criterion: >-
  set -u


  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: 不在
  git 仓库内" >&2; exit 3; }


  cd "$root"


  C=plugin/scripts/select-static-checks-for-touches.ts


  [ -f "$C" ] || { echo "CAUSE=classifier-missing — $C 不存在，本量无法读取（不是 0）" >&2;
  exit 1; }


  own=$(node --experimental-strip-types "$C" --classify-delta --root "$root"
  --resolution 2>/dev/null | tail -1)


  printf '%s' "$own" | grep -q '"mode":"registry"' || { echo
  "CAUSE=own-tree-not-registry — 本仓库携带注册表，应落 registry，实得：$own" >&2; exit 1; }


  T=$(mktemp -d)


  mkdir -p "$T/.quay" "$T/tasks"


  printf 'name: t\n' > "$T/.quay/config.yml"


  printf 'x\n' > "$T/tasks/a.md"


  git -C "$T" init -q


  git -C "$T" -c user.email=c@l -c user.name=c add -A


  git -C "$T" -c user.email=c@l -c user.name=c commit -qm base


  printf 'y\n' >> "$T/tasks/a.md"


  bare=$(node --experimental-strip-types "$C" --classify-delta --root "$T"
  --resolution 2>/dev/null | tail -1)


  printf '%s' "$bare" | grep -q '"mode":"conservative-default"' || { echo
  "CAUSE=no-registry-tree-did-not-fall-to-conservative-default —
  无注册表的树不得分类失败：$bare" >&2; exit 1; }


  printf '%s' "$bare" | grep -q '"registryPath":null' || { echo
  "CAUSE=no-registry-tree-claims-a-registry — 无注册表的树 registryPath 应为 null：$bare"
  >&2; exit 1; }


  printf '%s' "$bare" | grep -q '"docSurfaces":\["tasks","goals",".quay"\]' || {
  echo "CAUSE=conservative-surfaces-wrong — 保守缺省面应为 tasks/goals/.quay：$bare"
  >&2; exit 1; }


  printf 'name: t\nloop:\n  doc_surfaces:\n    - tasks/\n    - docs/\n' >
  "$T/.quay/config.yml"


  git -C "$T" -c user.email=c@l -c user.name=c add -A


  git -C "$T" -c user.email=c@l -c user.name=c commit -qm decl


  printf 'z\n' >> "$T/tasks/a.md"


  decl=$(node --experimental-strip-types "$C" --classify-delta --root "$T"
  --resolution 2>/dev/null | tail -1)


  printf '%s' "$decl" | grep -q '"mode":"declared"' || { echo
  "CAUSE=declared-doc-surfaces-not-honoured — 声明了 loop.doc_surfaces 的树应落
  declared：$decl" >&2; exit 1; }


  printf '%s' "$decl" | grep -q '"docs"' || { echo
  "CAUSE=declared-surfaces-ignored — 声明的前缀未进入 docSurfaces：$decl" >&2; exit 1; }


  rm -rf "$T"


  echo "own=$own"

  echo "bare=$bare"

  echo "decl=$decl"


  exit 0
expect: exit 0（三态互不同形：本仓库 --classify-delta 落 mode=registry；无注册表但
  .quay/config.yml 声明 loop.doc_surfaces 的树落 declared 且声明前缀进入
  docSurfaces；两者都没有的树落 conservative-default 且
  registryPath=null、docSurfaces=[tasks,goals,.quay]）。任一方向塌陷（无注册表当失败 / 本仓也判保守缺省 /
  声明面被忽略）⇒ exit 1 且 stderr 带 CAUSE=…。检查器不存在 ⇒ exit 1（不是 0）。
origin: 立条依据：2026-09-23 对第三方项目
  /data/home/yale/work/claudecodeui（CloudCLI，2026-09-20→09-23，worker-driven
  inner，142 条任务）的驱动过程复盘。人 2026-09-23 裁定：「本仓库形态靠文件是否存在来判断」立为 goal，第 1/2/6 项作为其实例
  task，其余缺陷立独立 task（「按你的意见执行」）。 对应 GOAL-027 范围③；复盘第 2 项的遗留部分（上游 caeca6f9c 只修了
  ff-merge 证书闸，fan-in 第 4 步仍在 worktree 里找注册表）。
activatedAt: 2026-10-01T18:07:03.567Z
statusLog:
  - at: 2026-10-01T18:07:03.567Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:07:03.567Z
---
**判据（能取假）**：①第三方项目 git 里不再跟踪 `plugin/scripts/runner-static-gate.ts`（证明不是靠模仿 quay 形态过关）；②`gap-fan-in-delta-classify-declared-doc-surfaces` 落地 develop 之后，第三方 `.quay/fan-in-*.log` 中 `step:"delta"` 的记录至少 1 条，且 reason 含 `classify failed` 的为 0 条。

**取假**：落笔当轮在 claudecodeui 上 exit 1（仍跟踪注册表副本）。伪造落地时刻重放：成功 166 / 失败 11 ⇒ exit 1。