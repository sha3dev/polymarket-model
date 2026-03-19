Read these files before making any implementation changes:

- `AGENTS.md`
- `ai/contract.json`
- `ai/rules.md`
- `prompts/refactor-contract.md`
- `.code-standards/refactor-source/public-contract.json`
- `.code-standards/refactor-source/preservation.json`
- `.code-standards/refactor-source/analysis-summary.md`

Your job is to refactor the project into the fresh scaffold under `src/` and `test/` following the rules in `ai/rules.md` and `prompts/refactor-contract.md`.

Implementation reminders:

- Let Biome decide final layout and wrapping.
- Fix `error` rules first; review `warning` rules carefully instead of overcorrecting them.
- Simplify before introducing abstractions or extra files.
- Rewrite `README.md` after behavior is stable so it documents the real result.
