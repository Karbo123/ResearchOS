---
schema: researchos/knowledge-document@1
project_id: fixture-memory-1a2b
id: run:method-ablation-seed-13
kind: run_result
title: 消融实验 seed 13 结果
status: reviewed
depends_on:
  - id: experiment:method-ablation/plan
    relation: executes
    impact: rerun_required
workspace_scopes:
  - implementation:method
experiment_id: 11111111-1111-4111-8111-111111111111
run_id: method-ablation-seed-13
artifact_ids:
  - 22222222-2222-4222-8222-222222222222
evidence_ids: []
---

# 消融实验 seed 13 结果

## Run identity and status

该文档只描述测试形状，不表示真实科研结果。

## Metrics

| Variant | Primary metric | Long-tail recall |
| --- | ---: | ---: |
| diversity | 0.712 | 0.604 |
| geometry | 0.718 | 0.611 |
| combined | 0.726 | 0.619 |

## What this run does not prove

单个 seed 不能证明总体提升，也不能替代预先规定的统计分析。

