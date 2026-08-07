---
schema: researchos/knowledge-document@1
project_id: fixture-memory-1a2b
id: idea:current
kind: idea
title: 稀疏点云主动学习方案
status: reviewed
depends_on: []
workspace_scopes:
  - overview:idea
  - implementation:method
artifact_ids: []
evidence_ids: []
---

# 稀疏点云主动学习方案

## Research question

在标注预算固定时，如何同时利用几何不确定性与类别覆盖率选择点云样本？

## Core hypothesis

分离建模局部几何不确定性和批次多样性，可以减少重复标注，并改善长尾类别的召回率。

## Proposed method

1. 使用冻结编码器提取点云表示。
2. 计算局部邻域扰动下的预测方差。
3. 在候选池中使用受约束的覆盖选择构造标注批次。

## Open questions

- 该选择规则在不同点数和噪声水平下是否稳定？
- 公平比较是否需要固定预训练数据？

