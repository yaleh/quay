#!/usr/bin/env python3
"""Offline-replay harness for the exp5 rule-set (v2).

Changes from v1 (both harness-found):
 - R1 Done-when uses REAL per-experiment clause totals (done_when.json), not a >=4 proxy.
   Only exp2/exp3 have binary Done-when (4 each); exp1/exp4 have none -> R1 can't fire for them.
 - Ceiling is a separate "redesign-OR-stop" FLAG, removed from the convergence confusion matrix
   (exp4's pre-DIR-008 ceiling-fires are a true stall signal, not a premature convergence-stop).
 - Part B2 now simulates all 5 systematic-explore checks (adds discovery_checks.jsonl).
"""
import json, glob, collections, os

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(HERE, "samples")
def load(name):
    return [json.loads(l) for l in open(os.path.join(S,name)) if l.strip()]
def loadj(name):
    return json.load(open(os.path.join(S,name)))

def canon_onspot(s):
    s=(s or "").strip().upper()
    return "STOP" if (s.startswith("PAUSE") or s.startswith("HALT")) else "CONTINUE"

# ---------------------------------------------------------------- Part A
def rule(f, done_when_total, K=2, BUDGET=10):
    dvi=f.get("dV_instance") or 0.0; dvm=f.get("dV_meta") or 0.0
    iters=f.get("iters_elapsed",0)
    if iters < K:                                   # warmup: no deltas exist yet
        return {"converge":False,"reasons":[],"ceiling_flag":False}
    both_flat=(dvi<0.02) and (dvm<0.02)             # exp4 lesson: BOTH layers
    sustained_flat=both_flat and f.get("consec_flat_count",0)>=K
    sev=(f.get("new_gap_max_severity") or "none").lower()
    no_sig=sev in ("none","minor","")
    met=f.get("done_when_met_count") or 0
    reasons=[]
    if done_when_total>0 and met>=done_when_total: reasons.append("done-when")   # binary complete
    if sustained_flat and no_sig:                 reasons.append("plateau")
    if iters>=BUDGET and both_flat:               reasons.append("budget")
    ceiling_flag=bool(f.get("ceiling_reached") and sustained_flat)
    return {"converge":len(reasons)>0,"reasons":reasons,"ceiling_flag":ceiling_flag}

def part_a(K=2,BUDGET=10,verbose=True):
    rows=load("termination.jsonl"); dw=loadj("done_when.json")
    byexp=collections.defaultdict(list)
    for r in rows: byexp[r["experiment"]].append(r)
    tp=fp=tn=fn=0; first_stop={}; first_ceiling={}; actual_halt={}
    for exp,rs in byexp.items():
        total=dw.get(exp,{}).get("done_when_total",0)
        rs=sorted(rs,key=lambda r:(r.get("iteration") or 0))
        actual_halt[exp]=max((r.get("iteration") or 0) for r in rs)
        for r in rs:
            f=r["features_available_then"]; v=rule(f,total,K,BUDGET)
            it=r.get("iteration") or 0
            onspot=canon_onspot(r.get("on_the_spot_judgment")); div=bool(r.get("divergence"))
            hind_stop = div if onspot=="CONTINUE" else (not div)
            if v["converge"] and exp not in first_stop: first_stop[exp]=it
            if v["ceiling_flag"] and exp not in first_ceiling: first_ceiling[exp]=it
            if   v["converge"] and hind_stop:      tp+=1
            elif v["converge"] and not hind_stop:  fp+=1
            elif not v["converge"] and not hind_stop: tn+=1
            else:                                  fn+=1
    if verbose:
        print(f"\n### Part A — convergence-stop matrix (K={K}, BUDGET={BUDGET}); ceiling reported separately")
        prec=tp/(tp+fp) if tp+fp else float('nan'); rec=tp/(tp+fn) if tp+fn else float('nan')
        print(f"  TP={tp} FP={fp} TN={tn} FN={fn}  precision(stop)={prec:.2f} recall(stop)={rec:.2f}")
        for exp in sorted(byexp):
            fs=first_stop.get(exp); ah=actual_halt[exp]; saved=(ah-fs) if fs is not None else None
            fc=first_ceiling.get(exp)
            print(f"  {exp}: converge-STOP @it{fs}  actual halt @it{ah}  saved={saved}   ceiling-flag @it{fc}")
    return tp,fp,tn,fn,first_stop

# ---------------------------------------------------------------- Part B1
MECHANIZABLE={"metric_anomaly","transcript_observation","dogfooding","domain_misfit","cross_experiment_comparison","tool_trial"}
def part_b1():
    rows=load("discovery.jsonl")
    print("\n### Part B1 — discovery latency the systematic-explore layer TARGETS")
    agg=collections.defaultdict(lambda:[0,0])
    for r in rows:
        ch=r["features_available_then"].get("discovery_channel","?")
        lat=r["features_available_then"].get("latency_iters"); lat=lat if isinstance(lat,(int,float)) else 0
        cls="mechanizable" if ch in MECHANIZABLE else "irreducible(human)" if ch=="human_live_insight" else "exploit(sim-user)" if ch=="simulated_user" else "other"
        agg[cls][0]+=1; agg[cls][1]+=lat
    for cls in ("mechanizable","irreducible(human)","exploit(sim-user)","other"):
        c,l=agg[cls]
        if c: print(f"  {cls:20s}: {c:2d} discoveries, {l:4d} iters total latency")

# ---------------------------------------------------------------- Part B2
def part_b2():
    print("\n### Part B2 — all 5 systematic-explore checks simulated")
    # (i) ceiling
    rows=load("termination.jsonl"); byexp=collections.defaultdict(list)
    for r in rows: byexp[r["experiment"]].append(r)
    print("  (1) it0 ceiling arithmetic:")
    for exp in sorted(byexp):
        rs=sorted(byexp[exp],key=lambda r:(r.get("iteration") or 0))
        fire=next((r.get("iteration") for r in rs if r["features_available_then"].get("ceiling_reached")),None)
        halt=max((r.get("iteration") or 0) for r in rs)
        print(f"     {exp}: {'flags @it%d (drag to it%d, -%d)'%(fire,halt,halt-fire) if fire is not None else 'no ceiling (correct)'}")
    # (ii) dilution hash
    dil=[r for r in load("transfer_context.jsonl") if r.get("decision_type")=="dilution"]
    fired=sum(1 for r in dil if "paraphrase" in str(r["features_available_then"].get("how_reauthored","")).lower() or r["features_available_then"].get("was_hash_checked") is False)
    print(f"  (2) gate-hash/transclusion: {fired}/{len(dil)} dilution events caught at first occurrence (actual recurred up to 13x)")
    # (iii-v) the 3 added checks
    try: dc=load("discovery_checks.jsonl")
    except FileNotFoundError: dc=[]
    bycheck=collections.defaultdict(lambda:[0,0,0])  # check -> [fire, refute, latency_saved]
    for r in dc:
        k=r["check"]
        if r.get("would_fire"): bycheck[k][0]+=1
        else: bycheck[k][1]+=1
        bycheck[k][2]+=r.get("latency_saved_if_check",0) or 0
    names={"domain_misfit_audit_channel":"(3) domain-misfit audit-channel","dogfooding_evidence_gate":"(4) dogfooding evidence-gate","cross_exp_trap_carry":"(5) cross-exp trap-carry"}
    for k in ("domain_misfit_audit_channel","dogfooding_evidence_gate","cross_exp_trap_carry"):
        fire,ref,lat=bycheck[k]
        print(f"  {names[k]}: fire={fire} refute={ref} latency_saved={lat}"+(" (HONEST REFUTATION)" if fire==0 and ref>0 else ""))
    total_new=sum(bycheck[k][2] for k in bycheck)
    print(f"  >> checks 3-5 add {total_new} iters saved; checks 1-2 dominate (ceiling -65 exp1, hash 3/3)")

if __name__=="__main__":
    print("="*72); print("OFFLINE-REPLAY HARNESS v2 — exp5 rule-set retrodiction"); print("="*72)
    part_a(2,10)
    print("\n  -- parameter sensitivity --")
    for K in (2,3):
        for B in (8,10,12):
            tp,fp,tn,fn,fs=part_a(K,B,verbose=False)
            print(f"    K={K} BUDGET={B}: FP={fp} FN={fn}  exp1 converge-STOP @it{fs.get('exp1')}")
    part_b1(); part_b2()
