#!/usr/bin/env python3
"""Combine every logged hypothesis into one table with a global Bonferroni adjustment."""
import glob, os, pandas as pd
OUT = os.path.join(os.path.dirname(__file__), "results")
frames = []
for fn in glob.glob(os.path.join(OUT, "*_tests.csv")):
    df = pd.read_csv(fn); df["source"] = os.path.basename(fn).replace("_tests.csv", ""); frames.append(df)
all_ = pd.concat(frames, ignore_index=True)
m = len(all_); all_["global_bonferroni_p"] = (all_["p"] * m).clip(upper=1.0)
all_ = all_.sort_values("p")
cols = [c for c in ["source", "family", "label", "n", "roi", "sharpe", "cagr", "t", "p", "global_bonferroni_p"] if c in all_.columns]
all_[cols].to_csv(os.path.join(OUT, "ALL_TESTS_combined.csv"), index=False)
print(f"{m} hypotheses logged across {all_.source.nunique()} files")
pos = all_[(all_.t > 0)]
print(f"\npositive-return results that survive global Bonferroni (p*{m} < 0.05):")
print(pos[pos.global_bonferroni_p < 0.05][cols].to_string(index=False))
print(f"\nnominally significant positives (p<0.05) that do NOT survive: {int(((pos.p < 0.05) & (pos.global_bonferroni_p >= 0.05)).sum())}")
