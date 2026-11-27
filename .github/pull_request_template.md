## What changes

<!-- One or two sentences. Link the issue if there is one. -->

## Checks

- [ ] `make check` passes (ruff, pyright, unit tests, consistency gate)
- [ ] `make verify` passes
- [ ] `sha256sum -c prereg/HASHES.txt` passes
- [ ] No key, token or `.env` content is in the diff

## If this touches numbers or documents

- [ ] Every figure is a marker filled from `analysis/out/numbers.json`; none is typed by hand
- [ ] `numbers.json` was rewritten by `make analyse`, not edited, and the change is explained above
- [ ] No file listed in `prereg/HASHES.txt` is modified, and nothing under `runs/` is edited
