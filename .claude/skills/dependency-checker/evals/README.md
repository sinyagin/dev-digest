# dependency-checker evals

Test cases for running this skill through the `skill-creator` eval loop
(with-skill vs. without-skill).

- `evals.json`: prompts, expected output, and assertions (the answer key).
- Evals 1–2 run against this repo as it is (no fixture). Their assertions
  name current real findings, so update them when the repo's dependencies change.
- `files/planted-repo/`: a two-package fixture (`api` uses pnpm, `web`
  uses npm) with four planted problems. `node_modules/` is git-ignored, so
  generate stub installs before each run:

  ```bash
  cp -r files/planted-repo <workdir> && node <workdir>/setup.mjs
  ```

  Point the agent at `<workdir>`, never at this folder. The neighbouring
  `evals.json` would leak the answers.

Grading results and benchmarks belong in `../dependency-checker-workspace/`
(git-ignored), not here.
