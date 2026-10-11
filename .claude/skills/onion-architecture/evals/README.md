# onion-architecture evals

Test cases for running this skill through the `skill-creator` eval loop
(with-skill vs. without-skill).

- `evals.json` — prompts, expected output and assertions (the answer key).
- `files/<case>/` — fixture modules, each laid out as
  `server/src/modules/<name>/`. Each fixture has three planted layering
  violations and deliberately carries no comments describing them.

## Running

The prompts refer to `server/src/modules/<name>/` relative to the fixture
root. For each run, copy `files/<case>/` into a neutral working directory and
point the agent there. Don't point it at this folder: the path and the
neighbouring `evals.json` would leak the answer to both configurations.

Grading results, timings, benchmarks and the viewer belong in the workspace
next to the skill (`../onion-architecture-workspace/`), not here.
