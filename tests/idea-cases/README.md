# Idea test cases

This directory is the only permitted source of research-Idea inputs used by automated tests.

- Each test case is a UTF-8 `*.json` text file with a filename equal to its lowercase kebab-case `id`.
- `scripts/idea_case_loader.py` performs strict validation and refuses unknown fields, invalid modes, duplicate IDs, path overrides, and runtime Idea injection.
- `scripts/acceptance_test.py` and `apps/api/tests/test_contracts.py` must load cases by public ID; they must not embed research Idea text or follow-up facts.
- Add or change a test only by editing a visible JSON file here. Do not add command-line Idea overrides or dynamically generated cases.
- Run `python scripts/check_idea_case_sources.py` after changes.

`clarification_mode` is either `automatic` (fewest necessary questions) or `detailed` (broader adaptive discovery). The `expect` object contains only assertions that are stable enough for automation.
