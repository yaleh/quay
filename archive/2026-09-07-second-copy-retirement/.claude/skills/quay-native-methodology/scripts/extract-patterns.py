#!/usr/bin/env python3
"""Summarize the V_instance/V_meta/sigma numbers referenced in provenance.md
and iteration reports, for a quick sanity check against reference/patterns.md.
Read-only; does not modify the source experiment.
"""
import re
import sys
import json
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SKILL_DIR.parents[2] if (SKILL_DIR.parents[2] / "experiments" / "quay-native-bootstrap").exists() else None


def find_repo_root():
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "experiments" / "quay-native-bootstrap" / "provenance.md").exists():
            return parent
    return None


def main():
    root = find_repo_root()
    if root is None:
        print(json.dumps({"error": "experiments/quay-native-bootstrap/provenance.md not found from script location"}))
        return 1

    prov = (root / "experiments" / "quay-native-bootstrap" / "provenance.md").read_text(errors="ignore")
    v_instance = re.findall(r"V_instance = [\d.\s×x*]+= ([\d.]+)", prov)
    v_meta = re.findall(r"V_meta = [\d.\s×x*]+= ([\d.]+)", prov)
    sigma = re.findall(r"σ_strict = \d+/\d+ = ([\d.]+)", prov)

    summary = {
        "source": str(root / "experiments" / "quay-native-bootstrap" / "provenance.md"),
        "v_instance_values_found": v_instance[-5:],
        "v_meta_values_found": v_meta[-5:],
        "sigma_strict_values_found": sigma[-5:],
        "last_v_instance": v_instance[-1] if v_instance else None,
        "last_v_meta": v_meta[-1] if v_meta else None,
        "last_sigma_strict": sigma[-1] if sigma else None,
        "note": "HALTED NOT CONVERGED per iteration 88 — do not treat as final/converged values without checking the actual final iteration report.",
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
