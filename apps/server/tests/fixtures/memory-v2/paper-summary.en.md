---
schema: researchos/knowledge-document@1
project_id: fixture-memory-1a2b
id: paper:geometric-sampling-2024
kind: paper_summary
title: Geometry-aware Sampling for Point Clouds
status: draft
depends_on:
  - id: paper:source-record
    relation: summarizes
    impact: review_required
workspace_scopes:
  - related-work:literature
  - paper:related-work
artifact_ids: []
evidence_ids: []
read_scope: abstract
---

# Geometry-aware Sampling for Point Clouds

## Short summary

The paper proposes a geometry-aware acquisition score. This fixture is intentionally a summary candidate, not a claim that full-text evidence has been verified.

## Datasets and protocol

| Dataset | Split | Budget | Reported metric |
| --- | --- | ---: | --- |
| ShapeSet-A | official | 5% | mean class accuracy |
| ShapeSet-A | official | 10% | mean class accuracy |
| IndoorSet-B | area holdout | 5% | mean IoU |
| IndoorSet-B | area holdout | 10% | mean IoU |

## Open verification items

- Verify the exact random seed policy from the full text.
- Verify whether encoder pretraining is shared by all baselines.

