# Example Flow

1. The user discusses an Idea with the Mastra clarification Agent. The Agent updates a strict draft and asks only blocking questions.
2. After explicit confirmation, the API creates a project row and a Git workspace, writes Idea v1, and enqueues the fixed research bootstrap Workflow.
3. Bounded academic search stores metadata candidates. Open PDF ingestion separately records SHA-256 files and page-level quote candidates.
4. Mastra proposes a topic-specific plan from the current Idea, verified evidence, policies, and resource constraints. It cannot submit a run.
5. The user reviews and approves the Proposal. The API revalidates project state and the fixed execution contract.
6. The native supervisor creates or reuses the project `.venv`, launches the fixed entry through the Linux backend (`.venv/bin/python`), and validates `metrics.json` and `checkpoint.json`.
7. The API registers artifacts, metrics, checkpoints, SHA-256 values, and audit events. A later Idea change creates a new version rather than replacing history.
8. Evidence-grounded paper generation creates a LaTeX Patch Proposal. Approval checks the Git baseline and file hash before writing and committing it.

At every model boundary, failure is returned directly. No local response, alternate model, or unrelated experiment is substituted.
