# Research OS TODO

最后更新：2026-08-02（Asia/Shanghai）

状态：`[ ]` 待处理、`[~]` 进行中、`[!]` 外部阻塞。已完成并验证的任务不再保留在 TODO，已归档到 Git 历史。

## 未完成与阻塞任务

- [~] `P0-SUPERMEMORY-LOCAL-053` Supermemory Local 自托管接入（默认 `127.0.0.1:6767`，不依赖云端；本地回环自动认证/显式 key/Mastra 集成与失败关闭、官方 embedding 配置面与 `supermemory_embedding_unsupported` 失败关闭等已完成部分已归档到 Git 历史）：剩余两项均为外部阻塞：
  - [!] `P0-SUPERMEMORY-LOCAL-053-C` 远程 embedding 服务端 build 已确认：官方 `server-v0.0.5` 完整实现 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL/API_KEY`（2026-08-01 二进制字符串与隔离实测双重确认，摄入时真实发起 `POST /v1/embeddings`）；`server-v0.0.6` 与 `0.0.7-rc.2` 回退该功能，仅剩本地 ONNX worker（2026-08-01 对 rc.2 linux-x64 隔离启动+摄入复核：配置远程变量后仍下载加载 `Xenova/bge-base-en-v1.5` 本地模型，不调用远程端点）。WSL2 运行副本使用 v0.0.5 + `Qwen3-Embedding-8B`（1024 维，`https://ai.gitee.com/v1`，全新数据目录），已配置可用 embedding key（`UJF7WB...`，实测 1024/2000 维均返回 200）并完成端到端摄入+向量 upsert（2026-08-01）。用户要求的 2000 维仍被上游硬限制挡住：服务端 pgvector HNSW 在向量 upsert 阶段有约 1024 维上限（隔离实测：1024 维摄入/upsert 正常；1536 维与 2000 维均 `Failed to upsert chunk embeddings`，API 已正确返回对应维度向量，失败发生在索引写入，非 API 维度能力问题）——pgvector 属于 Supermemory 服务端二进制内部的 PGlite（`CREATE EXTENSION IF NOT EXISTS vector` + `vector(N)` 列），本项目代码不创建也不依赖 pgvector，该项无法通过二进制补丁解决。原 800ms 硬编码超时（v0.0.5 搜索路径 query embedding 超时 `interactive:800ms`，二进制源码 `pP6={interactive:{...sdk:800}, batch:{...sdk:20000}}`；`/v4/search` 处理器写死 `profile:"interactive"` 且 schema 不接受 profile；官方配置文档无超时项，无法通过配置/API 绕过）**已由用户批准的字节级补丁解除并部署到生产（2026-08-01）**：该常量在二进制偏移 220680268 处以明文 JS 存在（不在压缩流内），把 `sdk:800` 等长替换为 `sdk:20000`（19 字节等长替换，`--version` 仍报 0.0.5）后二进制可正常启动，用 3s 延迟的模拟 embedding 端点实测摄入与搜索均成功（搜索 timing 3026ms、score=1；旧二进制在该延迟下必然超时）；生产替换后对 `ai.gitee.com` 实测摄入 1135ms、搜索 timing 4398ms、score 0.79 成功。原版备份 `/home/karbo/bin/supermemory-server-linux-x64.v0.0.5-orig.bak`（sha256 `b2fccca3ff2b5607ce41028c759f375c4ecf5461adc9f3306f41c2757edaf375`）；在用补丁版 sha256 `7d19ddadf484a0539dd813227c2e24ad0e191b8e5db291c2caf2c1ef63a2e7d6`；补丁副本另存 `/tmp/supermemory-server-v0.0.5-patched`（WSL）作追溯依据。打补丁原因：服务端源码不在公开仓库（闭源构建，修改源码重新编译不可行）、v0.0.5 之后无官方 build 实现远程 embedding、API 无超时覆盖项，而摄入与搜索链路实测完整可用，唯一现实路径是补丁二进制；上游升级到新 build 后需按新偏移重打补丁并记录新哈希。曾记录的变通路径“自托管 v0.0.5 内置 MCP 搜索走 batch 20s”经 2026-08-01 复核为错误：官方文档明确 MCP 是平台专属功能，自托管二进制 `/mcp` 实测 404。解除条件（800ms 超时已解除，仅剩 2000 维阻塞）：上游发布同时支持远程 embedding 且不再有约 1024 维 HNSW upsert 上限的 build；或接受 1024 维为已验证可用配置。
  - [!] `P0-SUPERMEMORY-LOCAL-053-D` 真实 Supermemory Local 验收 `npm run supermemory:acceptance`：文本摄取/搜索、双项目隔离、Graph 节点、Super RAG、`forget` 撤销和 delete 撤销（远端 GET 404）已通过；PDF 终态处理与图片摄取硬编码依赖 Gemini/Vertex key（PDF 提取走 Mistral OCR → Gemini 2.5 Flash；图片描述走 `provider: "gemini"`，无 key 时 `0.0.7-rc.2` Windows/Linux build 均崩溃；用户 OpenAI-compatible 多模态后端无法接管，已隔离实测复核）。解除条件：为 Supermemory 服务配置 Gemini/Vertex key 或安装稳定支持 PDF/图片的 build。阻塞期间脚本如实返回 `partial`（退出码 1），不得伪造通过或降级。

- [~] `P1-MASTRA-050` Mastra 官方能力扩展：Approval/HITL、Guardrails/Processors、Supervisor Agents、Evals/Datasets、Observability/Tracing/Feedback、Durable/Schedules 与范围评估均已接入并验证；仅剩：
  - [~] `P1-MASTRA-050-E` 材料索引真实 provider 验收：有界 PDF/文本 chunk、来源过滤、多模态上传已实现，未另行启用 Mastra 内置向量存储；真实 Supermemory provider 验收受 Gemini/Vertex key 外部阻塞（见 `P0-SUPERMEMORY-LOCAL-053-D`）。

- [!] `P2-DEPS-056` dev-only `@hono/node-server@1.19.17`（GHSA-frvp-7c67-39w9，<2.0.5）经 `@mastra/deployer`→`@hono/node-ws@1.3.1` 的 peer `^1.19.11` 引入；修复版 2.x 与 `@hono/node-ws@1.3.1` peer 范围不兼容，`npm audit fix` 建议的 `@mastra/deployer@1.21.0` 是破坏性降级，已拒绝。仅影响 mastra CLI/deployer dev 工具链，服务只监听 `127.0.0.1`，`npm audit --omit=dev` 为 0。解除条件：`@hono/node-ws` 或 Mastra 上游发布支持 `@hono/node-server@2.x` 的兼容版本后重跑 `npm audit` 验证。

- [!] `P0-RUNNER-007` 在真实 GPU Windows/WSL2 主机验证 GPU 任务与资源记录；解除条件是可用的真实 GPU 主机，当前只能完成 CPU/固定监督器验收。

- [~] `P1-UPLOAD-009` 大规模异步材料索引与跨材料语义检索：固定 `material_index` 队列、Defender 后索引、PDF/文本有界 chunk、图片/不可提取 PDF 原文件上传和项目范围 Supermemory hybrid 搜索已实现（跨材料 `documents` 检索 similarity 非空已在 `supermemory:acceptance` 中通过）；失败重放与 PDF/图片跨材料端到端结果仍待 Gemini/Vertex key 解除后验收（见 `P0-SUPERMEMORY-LOCAL-053-D`）。

- [~] `P2-HA-021` 长期无人值守运行、外部告警与恢复演练：有界健康监控、失败事件 JSONL、受限告警 webhook 和只读备份恢复演练已实现并通过实测（`ops:monitor once` API/Mastra 200；`ops:recovery-drill` 对 `20260730T200648Z` 备份通过）。剩余：目标主机上的真实长期部署、外部告警接收端和跨重启恢复演练。
