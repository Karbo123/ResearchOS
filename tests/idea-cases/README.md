# Public Idea Cases

This directory is the only source for automated research-Idea inputs.

- One UTF-8 JSON file per public case ID.
- `scripts/idea-case-loader.ts` performs strict validation and rejects unknown fields, invalid modes, duplicate IDs, filename mismatch, and path escape.
- `scripts/acceptance-test.ts` and Vitest load cases by public ID; tests must not embed replacement Idea text.
- Add or edit a case file here, then run `npm run idea-cases:check`.

Keys, credentials, private research text, and runtime-generated Ideas do not belong in this directory.
