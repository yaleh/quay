---
id: AC-339
title: ArchGuard 前后可比：同一 archguard 构建对分叉点与当前 tip（并入后为合并提交的两侧）做单根分析，文件数差额与 git
  diff 一致；目录环不增加；packages→plugin 为 0；plugin/scripts→非 kernel
  不上升；plugin/scripts→kernel 强度上升
status: draft
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  [ -f packages/quay/src/kernel/task-transition.ts ] || { echo "NOT-EVALUATED: slice not landed in this tree (packages/quay/src/kernel/task-transition.ts absent)" >&2; exit 3; }
  cli=""; d=$(dirname "$(readlink -f "$HOME/.claude/plugins/cache/archguard/archguard")"); while [ "$d" != "/" ]; do c="$d/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js"; [ -f "$c" ] && { cli=$c; break; }; d=$(dirname "$d"); done
  [ -n "$cli" ] || { echo "NOT-EVALUATED: archguard CLI not resolvable from the installed plugin npm-cache" >&2; exit 3; }
  if ! git merge-base --is-ancestor HEAD develop 2>/dev/null; then before=$(git merge-base HEAD develop); after=$(git rev-parse HEAD); mode=pre-merge
  else after=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-030"&&e.payload&&e.payload.outcome==="landed")r=e.payload.landedSha}catch{}};process.stdout.write(r)})()'); [ -n "$after" ] || { echo "NOT-EVALUATED: no goal branch ahead of develop and no landed goal-merge-result for GOAL-030" >&2; exit 3; }; before=$(git rev-parse "$after^1"); mode=post-merge; fi
  tmp=$(mktemp -d /tmp/goal030-ag.XXXXXX); trap 'rm -rf "$tmp"' EXIT
  added=$(git diff --name-status --no-renames "$before" "$after" -- packages plugin/scripts | awk '$1=="A"' | grep -E "\.ts$" | grep -vcE "\.test\.|/node_modules/"); deleted=$(git diff --name-status --no-renames "$before" "$after" -- packages plugin/scripts | awk '$1=="D"' | grep -E "\.ts$" | grep -vcE "\.test\.|/node_modules/")
  for side in before after; do sha=$(eval echo \$$side); mkdir -p "$tmp/$side/tree"; git archive "$sha" packages plugin/scripts | tar -x -C "$tmp/$side/tree"; find "$tmp/$side/tree" -name node_modules -prune -exec rm -rf {} + 2>/dev/null; (cd "$tmp" && node "$cli" analyze -s "$tmp/$side/tree" -f json --output-dir "$tmp/$side/out" >"$tmp/$side/log" 2>&1) || { echo "NOT-EVALUATED: archguard analyze failed on $side ($sha): $(tail -1 "$tmp/$side/log")" >&2; exit 3; }; done
  node -e '(()=>{const fs=require("fs"),path=require("path");const [tmp,before,after,mode,added,deleted]=process.argv.slice(1);
  const find=(d)=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory()){const r=find(p);if(r)return r}else if(f.name==="package.json"&&/overview/.test(p))return p}return null};
  const rd=(s)=>{const p=find(path.join(tmp,s,"out"));if(!p){console.error("NOT-EVALUATED: no overview/package.json for "+s);process.exit(3)}const j=JSON.parse(fs.readFileSync(p,"utf8"));const mg=j.extensions&&j.extensions.tsAnalysis&&j.extensions.tsAnalysis.moduleGraph;if(!mg){console.error("NOT-EVALUATED: no moduleGraph in "+s);process.exit(3)};return mg};
  const cnt=(s)=>{let n=0;const w=(d)=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())w(p);else if(/\.ts$/.test(f.name)&&!/\.test\./.test(f.name))n++}};w(path.join(tmp,s,"tree"));return n};
  const st=(mg,from,to)=>mg.edges.filter(e=>e.from===from&&(typeof to==="function"?to(e.to):e.to===to)).reduce((a,e)=>a+(e.strength||0),0);
  const B=rd("before"),A=rd("after");const r={mode,before,after,files:{before:cnt("before"),after:cnt("after")},cycles:{before:B.cycles.length,after:A.cycles.length},
  k:{before:st(B,"plugin/scripts","packages/quay/src/kernel"),after:st(A,"plugin/scripts","packages/quay/src/kernel")},
  nk:{before:st(B,"plugin/scripts",t=>t.startsWith("packages/quay/src")&&!t.startsWith("packages/quay/src/kernel")),after:st(A,"plugin/scripts",t=>t.startsWith("packages/quay/src")&&!t.startsWith("packages/quay/src/kernel"))},
  rev:A.edges.filter(e=>e.from.startsWith("packages/")&&e.to.startsWith("plugin/")).length};
  console.log(JSON.stringify(r));
  const expectDelta=Number(added)-Number(deleted);if(r.files.after-r.files.before!==expectDelta){console.error("CAUSE=not-comparable — analyzed file delta "+(r.files.after-r.files.before)+" != git diff delta "+expectDelta+" (A "+added+", D "+deleted+")");process.exit(1)}
  if(r.rev>0){console.error("CAUSE=reverse-edge — packages/** -> plugin/** edges: "+r.rev);process.exit(1)}
  if(r.cycles.after>r.cycles.before){console.error("CAUSE=cycles-increased — "+r.cycles.before+" -> "+r.cycles.after);process.exit(1)}
  if(r.nk.after>r.nk.before){console.error("CAUSE=non-kernel-coupling-increased — plugin/scripts->quay/src(non-kernel) "+r.nk.before+" -> "+r.nk.after);process.exit(1)}
  if(!(r.k.after>r.k.before)){console.error("CAUSE=kernel-edge-not-observed — plugin/scripts->kernel strength "+r.k.before+" -> "+r.k.after+" (the slice adds a kernel import; archguard did not see it)");process.exit(1)}
  console.log("PASS: comparable before/after ("+mode+"): files "+r.files.before+"->"+r.files.after+", cycles "+r.cycles.before+"->"+r.cycles.after+", plugin->kernel "+r.k.before+"->"+r.k.after+", plugin->non-kernel "+r.nk.before+"->"+r.nk.after+", reverse 0")})()' "$tmp" "$before" "$after" "$mode" "$added" "$deleted"
expect: exit 0 = 前后可比且满足全部方向约束；exit 1 = 不可比或任一约束被违反；exit 3 = 切片未落地 / archguard
  CLI 不可解析 / 分析失败。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
phase: pre-merge
---
