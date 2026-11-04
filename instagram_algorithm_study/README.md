# Instagram Reach Study

This is a statistical study of how Instagram's ranking turns viewer behaviour into views, and what that means for growing reach. Read [`INSTAGRAM_ALGORITHM_STUDY.md`](INSTAGRAM_ALGORITHM_STUDY.md) for the full write-up, or open `instagram_reach_study.html` for the interactive version.

## Quick start

```bash
pip install numpy pandas
python3 funnel_model.py           # reach model + robustness checks  -> results/funnel_model_results.json
python3 experiment_design.py      # power analysis + retention model -> results/experiment_design_results.json
python3 analyze_my_account.py my_insights_export.csv   # run the stats on your own account
python3 analyze_my_account.py --demo                   # synthetic, clearly labelled example
```

The scripts need only numpy and pandas. The model runs in a few seconds.
