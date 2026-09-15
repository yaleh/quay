import re, subprocess, sys, collections
BR = sys.argv[1] if len(sys.argv)>1 else "dist-plugin"
files = subprocess.run(["git","ls-tree","-r","--name-only",BR],capture_output=True,text=True,check=True).stdout.split()
fileset = set(files)
carriers = [f for f in files if f.rsplit(".",1)[-1] in ("md","sh","js")]
ANY_RE = re.compile(r'[A-Za-z0-9_${}/.-]*(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
BAD_RE = re.compile(r'(^|[^A-Za-z0-9_${}.-])(\.?/)?plugin/(scripts|gate-scripts)/dist/[A-Za-z0-9_.-]+\.js')
TS_RE  = re.compile(r'\$\{CLAUDE_PLUGIN_ROOT\}/(scripts|gate-scripts)/([A-Za-z0-9_.-]+\.ts)')
BARE_TS = re.compile(r'(?<![A-Za-z0-9_${}/.-])((scripts|gate-scripts)/[A-Za-z0-9_.-]+\.ts)')
total=0; bad=[]; dangling=[]; bare_ts=[]
per_ext = collections.Counter(); per_ext_bad = collections.Counter()
for f in carriers:
    try: txt = subprocess.run(["git","show","%s:%s"%(BR,f)],capture_output=True,text=True,check=True).stdout
    except Exception: continue
    ext = f.rsplit(".",1)[-1]
    n = len(ANY_RE.findall(txt)); total+=n; per_ext[ext]+=n
    for m in BAD_RE.finditer(txt):
        bad.append((f, m.group(0).strip())); per_ext_bad[ext]+=1
    for m in TS_RE.finditer(txt):
        tgt = "%s/%s"%(m.group(1),m.group(2))
        if tgt not in fileset: dangling.append((f,m.group(0),tgt))
    for m in BARE_TS.finditer(txt):
        if m.group(1) not in fileset: bare_ts.append((f,m.group(0)))
print("carriers=%d total_dist_refs=%d"%(len(carriers),total))
print("per_ext_total=%r"%dict(per_ext))
print("BAD(cwd-relative plugin/ prefix)=%d per_ext=%r"%(len(bad),dict(per_ext_bad)))
for x in bad[:5]: print("   BAD:",x)
print("DANGLING(plugin-root-anchored raw .ts)=%d"%len(dangling))
for x in dangling[:15]: print("   DANG:",x)
print("BARE(scripts/X.ts not anchored, target missing on branch)=%d"%len(bare_ts))
for x in bare_ts[:20]: print("   BARE:",x)
