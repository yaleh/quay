#!/usr/bin/env bash
# 内层停摆检测（两级）。直接读 transcript 尾部，不需要内层配合。
#
# 签名：最后一条是 assistant 且其中没有 tool_use（有 tool_use = 在等命令返回，不是停摆）
#      + transcript 已静止。
#
# 为什么分两级（2026-08-02 实测）：外部观察无法区分「等自己派的 subagent」与「任务在飞时提问」
# —— 两者 transcript 完全相同，遥测也都是 inProgress 非空，且 subagent 不写独立 transcript。
# 所以 inProgress 非空时只能报 MAYBE 并抬高阈值。真正的解法是内层主动写
# .quay/inner-blocked.json（见 gap-no-explicit-blocked-signal-from-inner-layer）——
# 本脚本的歧义正是那个任务的实测依据。
DIR=/home/yale/.claude/projects/-home-yale-work-quay
SELF=b8dc91a6-64e8-4d70-a715-9ec8e16a4f11
CONFIRM_S=${CONFIRM_S:-90}     # inProgress 为空：内层确实停了
MAYBE_S=${MAYBE_S:-600}        # inProgress 非空：可能只是在等 subagent，抬高到 10 分钟
announced=""
while true; do
  inner=$(ls -t "$DIR"/*.jsonl 2>/dev/null | grep -v "$SELF" | head -1)
  [ -z "$inner" ] && { sleep 30; continue; }
  quiet=$(( $(date +%s) - $(stat -c %Y "$inner") ))
  busy=$(node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json 2>/dev/null \
         | python3 -c 'import sys,json;print(len((json.load(sys.stdin) or {}).get("inProgress",[])))' 2>/dev/null || echo 0)
  thr=$CONFIRM_S; lvl=STALLED
  [ "${busy:-0}" -gt 0 ] && { thr=$MAYBE_S; lvl="STALLED-MAYBE(在飞${busy}，可能在等 subagent)"; }
  if [ "$quiet" -ge "$thr" ]; then
    out=$(tail -c 200000 "$inner" | python3 -c '
import sys,json
last=None
for line in sys.stdin:
    line=line.strip()
    if not line.startswith("{"): continue
    try: o=json.loads(line)
    except Exception: continue
    if o.get("type") in ("assistant","user"): last=o
if not last or last.get("type")!="assistant": raise SystemExit(1)
c=last.get("message",{}).get("content")
if not isinstance(c,list): raise SystemExit(1)
if any(isinstance(x,dict) and x.get("type")=="tool_use" for x in c): raise SystemExit(1)
txt="".join(x.get("text","") for x in c if isinstance(x,dict) and x.get("type")=="text").strip()
print(txt.replace("\n"," ")[-350:] or "(无文本)")
' 2>/dev/null) && {
      sig=$(printf '%s' "$out" | md5sum | cut -c1-8)
      case "$announced" in *"$sig"*) ;; *)
        echo "$lvl 静止 ${quiet}s: $out"
        announced="$announced $sig" ;;
      esac
    }
  else
    announced=""
  fi
  sleep 30
done
