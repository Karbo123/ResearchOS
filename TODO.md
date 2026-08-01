# Research OS TODO

最后更新：2026-08-01（Asia/Shanghai）

状态：`[ ]` 待处理、`[~]` 进行中、`[!]` 外部阻塞。已完成并验证的任务不再保留在 TODO，已归档到 Git 历史。

## 未完成与阻塞任务

- [~] `P2-WSL2-060` 明确 WSL2 运行副本同步流程：`D:\ResearchOS` 是开发主仓库（提交/推送在 D 侧），`~/ResearchOS`（ext4）是 WSL2 运行副本，三服务（API 8080 / Mastra 4111 / Supermemory 6767）从运行副本启动；修改 `apps/*`、`scripts/`、`package.json` 或根配置文件后必须同步到运行副本并重建/重启对应服务。AGENTS.md 与 README 双语已补充该说明；剩余工作：增加 `scripts/sync-wsl.sh`（rsync 排除 `.git`、`node_modules`、`runtime`、`artifacts`、`projects` 等）并实际验证一次 同步 → 重建 → 重启 流程。

- [~] `P0-SUPERMEMORY-LOCAL-053` Supermemory Local 自托管接入（默认 `127.0.0.1:6767`，不依赖云端；替代并合并原 `P0-SUPERMEMORY-052`，其已完成部分不再单独跟踪）：已完成本地回环自动认证/显式 key/Mastra 集成与失败关闭（053-A）、官方 embedding 配置面与 `supermemory_embedding_unsupported` 失败关闭（053-B）；剩余两项均为外部阻塞：
  - [!] `P0-SUPERMEMORY-LOCAL-053-C` `0.0.7-rc.2` 二进制只实现本地 ONNX embedding（`Xenova/bge-base-en-v1.5`，768 维，仅英语），官方文档的 `SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL` 在该 build 中未实现（2026-08-01 隔离实测：以进程环境传入远程 embedding 变量启动全新数据目录实例，仍加载本地 ONNX worker，stub 收到 0 请求；远程 embedding API 本身可用，`Qwen3-Embedding-8B` 1024 维正常返回）。解除条件：安装实现远程 embedding 环境变量的服务端 build，并在真实服务上完成摄取/检索验收；切换模型/维度必须使用全新数据目录或完整重索引。
  - [!] `P0-SUPERMEMORY-LOCAL-053-D` 真实 Supermemory Local 验收 `npm run supermemory:acceptance`：文本摄取/搜索、双项目隔离、Graph 节点、Super RAG、`forget` 撤销和 delete 撤销（远端 GET 404）已通过；PDF 终态处理与图片摄取硬编码依赖 Gemini/Vertex key（PDF 提取走 Mistral OCR → Gemini 2.5 Flash；图片描述走 `provider: "gemini"`，无 key 时 `0.0.7-rc.2` Windows/Linux build 均崩溃；用户 OpenAI-compatible 多模态后端无法接管，已隔离实测复核）。解除条件：为 Supermemory 服务配置 Gemini/Vertex key 或安装稳定支持 PDF/图片的 build。阻塞期间脚本如实返回 `partial`（退出码 1），不得伪造通过或降级。

- [~] `P1-MASTRA-050` Mastra 官方能力扩展：Approval/HITL、Guardrails/Processors、Supervisor Agents、Evals/Datasets、Observability/Tracing/Feedback、Durable/Schedules 与范围评估均已接入并验证；仅剩：
  - [~] `P1-MASTRA-050-E` 材料索引真实 provider 验收：有界 PDF/文本 chunk、来源过滤、多模态上传已实现，未另行启用 Mastra 内置向量存储；真实 Supermemory provider 验收受 Gemini/Vertex key 外部阻塞（见 `P0-SUPERMEMORY-LOCAL-053-D`）。

- [!] `P2-DEPS-056` dev-only `@hono/node-server@1.19.17`（GHSA-frvp-7c67-39w9，<2.0.5）经 `@mastra/deployer`→`@hono/node-ws@1.3.1` 的 peer `^1.19.11` 引入；修复版 2.x 与 `@hono/node-ws@1.3.1` peer 范围不兼容，`npm audit fix` 建议的 `@mastra/deployer@1.21.0` 是破坏性降级，已拒绝。仅影响 mastra CLI/deployer dev 工具链，服务只监听 `127.0.0.1`，`npm audit --omit=dev` 为 0。解除条件：`@hono/node-ws` 或 Mastra 上游发布支持 `@hono/node-server@2.x` 的兼容版本后重跑 `npm audit` 验证。

- [!] `P0-RUNNER-007` 在真实 GPU Windows/WSL2 主机验证 GPU 任务与资源记录；解除条件是可用的真实 GPU 主机，当前只能完成 CPU/固定监督器验收。

- [~] `P1-UPLOAD-009` 大规模异步材料索引与跨材料语义检索：固定 `material_index` 队列、Defender 后索引、PDF/文本有界 chunk、图片/不可提取 PDF 原文件上传和项目范围 Supermemory hybrid 搜索已实现（跨材料 `documents` 检索 similarity 非空已在 `supermemory:acceptance` 中通过）；失败重放与 PDF/图片跨材料端到端结果仍待 Gemini/Vertex key 解除后验收（见 `P0-SUPERMEMORY-LOCAL-053-D`）。

- [!] `P2-INSTALLER-029` 签名 EXE、干净 Windows VM 安装/升级/卸载验收和 GitHub Release 发布：Inno Setup 源码与 CI 工作流已就绪，`v0.3.0` tag 已推送，CI 全量验证通过并产出 draft Release（未签名、未发布）。解除条件：配置 `INSTALLER_SIGNING_CERT_PFX_B64`/`INSTALLER_SIGNING_CERT_PASSWORD` 完成签名、干净 Windows VM 安装/升级/卸载验收，以及用户授权发布 draft Release。

- [~] `P2-HA-021` 长期无人值守运行、外部告警与恢复演练：有界健康监控、失败事件 JSONL、受限告警 webhook 和只读备份恢复演练已实现并通过实测（`ops:monitor once` API/Mastra 200；`ops:recovery-drill` 对 `20260730T200648Z` 备份通过）。剩余：目标主机上的真实长期部署、外部告警接收端和跨重启恢复演练。
