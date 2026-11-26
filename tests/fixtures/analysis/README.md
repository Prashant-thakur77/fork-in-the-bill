# Synthetic analysis fixtures

Everything under this folder is generated test data, not experiment data. `make_fixtures.py` writes it from a fixed seed. Every run directory has `"fixture": true` in its `meta.json`, every instance id starts with `fixture__`, and the timestamps are arbitrary. The tests use it to check the analysis, the consistency gate and ledger verification against known answers.

The real runs are in `runs/` at the top of the repository.
