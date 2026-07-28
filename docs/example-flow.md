# End-to-end checkpoint flow

| Step | Durable state | Gate / output |
|---|---|---|
| Idea chat | `conversation_sessions`, `messages` | Missing-field questions |
| Confirm spec | `idea_versions(v1)`, project Git | User confirmation |
| Literature search | `papers`, `evidence`, BibTeX | DOI/source verification |
| Novelty review | evidence-linked assessment | Insufficient evidence blocks strong claims |
| Experiment plan | `proposals(pending)` | User sees cost, impact and artifacts |
| Run | `experiments`, MLflow | Approved proposal only |
| Result review | `artifacts`, metrics | PNG/PLY/JSON/PDF preview/download |
| Daily/weekly report | `reports`, `audit_events` | n8n schedule and notification extension |
| User correction | structured proposal | No silent execution |
| Idea v2 | `idea_versions(v2)`, invalidation flags | Approved revision only |
| Local rerun | new proposal and experiment | Correct checkpoint scope |
| LaTeX build | Git source and archived PDF | Approved fixed compiler task |
