---
schema: researchos/knowledge-document@1
project_id: fixture-memory-1a2b
id: experiment:method-ablation/plan
kind: experiment_plan
title: Method ablation plan
status: confirmed
depends_on:
  - id: idea:current
    relation: tests
    impact: review_required
  - id: experiment:benchmark-protocol
    relation: follows
    impact: rerun_required
workspace_scopes:
  - implementation:method
experiment_id: 11111111-1111-4111-8111-111111111111
artifact_ids: []
evidence_ids: []
---

# Method ablation plan

## Question being tested

Does geometry uncertainty add signal beyond batch diversity under the same annotation budget?

## Fixed code and configuration

```ts
export const seeds = [13, 37, 73]
export const budgets = [0.05, 0.1]
export const variants = ['diversity', 'geometry', 'combined'] as const
```

## Success and failure criteria

The combined variant must improve the pre-registered primary metric without reducing long-tail recall beyond the declared tolerance.

