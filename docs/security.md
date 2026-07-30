# Security policy

## Trust boundaries

1. UI/n8n 输入是不可信数据，进入服务时使用 Pydantic 和 JSON Schema 校验。
2. Research API 只生成高层 Runner 请求，不接受 shell command、SQL、工作目录或任意路径。
3. Runner 再次校验 `extra=forbid`，只执行枚举化任务；LaTeX 使用固定 `paper/main.tex` 和固定 `latexmk` 参数。
4. 高成本实验、代码/配置变更、依赖安装、删除、外发和论文编译先进入 `proposals`，明确批准后才执行。
5. Secret 只通过容器环境或 secret manager 注入，不写入项目 Git、聊天或实验配置。
6. 实验快照只从固定项目 Git 根和受控 `artifacts/` 根生成；相对路径、Git 状态、tag、manifest 和 SHA-256 均由 API 与 Runner 双重校验。
7. 数值指标和失败诊断由确定性 Python 计算；诊断建议只保存为需审批且不可执行的 Proposal。模型只能解释或质疑，不能计算统计量或启动后续工作。

## Topic-specific planning boundary

The experiment-plan endpoint accepts only the current ProjectSpec, stored page-level evidence, and the active policy snapshot. The structured model response is validated again before it becomes a pending Proposal: evidence IDs must belong to the current project and include a verified quote, locator, PDF hash, source URL, and BibTeX; seeds and budget must satisfy policy and ProjectSpec constraints; and shell, path, command, and arbitrary Runner fields are not part of the plan schema. Approval does not bypass revalidation. An approved plan must match the submitted request exactly and is executed only by the fixed topic template, which invokes `experiment/main.py` and passes plan/resume data through fixed JSON files. The Runner separately rejects forbidden execution keys and requires bounded numeric `metrics.json` plus structured `checkpoint.json`; it never converts an invalid, missing, or failed topic run into a generic classification or point-cloud task.

## Checkpoint rerun boundary

Checkpoint reruns are approval-gated recovery actions. The dedicated endpoint accepts only terminal success/failure checkpoints, resolves the source experiment inside the same project, and reconstructs an allowlisted payload from persisted configuration and seeds. The generic Proposal endpoint cannot mint rerun proposals; approval and the automatic submission repeat the source and payload checks through the normal guarded experiment endpoint. Submission failure is recorded as a structured error, with no provider fallback or unrelated experiment substitution.

## Adaptive clarification agent

- 澄清 Agent 每轮只接收最新消息、当前草稿和最多 12 条最近对话，输出严格 `codex-clarification.schema.json`；它没有浏览、Shell、文件、SQL 或外部工具权限。
- 复杂度与成本层级由 API 的确定性评分选择；API 根据各层独立配置核对模型和推理强度，拒绝调用方指定任意模型。
- 明显领域可以作为可纠正假设推断；数据权限、GPU/预算、截止时间、新颖性、引用和结果不得臆造。
- API 容器直接调用三个独立配置的 OpenAI-compatible URL；运行时不读取宿主机 Codex 配置目录或 `auth.json`，也不复制或返回认证对象、refresh token、Cookie 或其他 Secret。模型设置 GET 只显示 model、URL、推理强度和 `key_configured`，PUT 将 key 写入忽略的 runtime 挂载文件。
- 模型失败必须返回结构化 API 错误；系统不切换未显式选择的 provider，不生成规则/关键词回复，不静默继续，也不写入助手消息。

## Container policy

- Runner 使用非 root UID、`no-new-privileges`、drop all capabilities、只读 root filesystem、PID/CPU/内存限制、每 Run 文件大小/累计磁盘配额和临时目录配额。超限返回结构化错误，不继续写入或提交产物。
- 每个 Run 使用由 `runner-launcher` 创建的新非 root 作业容器；监控器保护取消/失败终态，超时或取消会停止该 Run 容器。只有 launcher 挂载 Docker socket，API 和 Runner supervisor 不挂载；launcher 仅使用固定镜像、固定网络、固定入口和受控挂载。Launcher/Runner 不接受任意命令、路径、URL、网络、镜像或环境字段。启动失败和主题不支持都直接返回结构化错误，不使用 fallback 或无关实验替代。
- Runner 只加入 Compose 的 `internal` `runner-internal` 网络；它不能通过默认网络访问其他服务，也没有外部网络出口。`internal-mlflow-only` 是当前任务模板的受限策略标签，API/MLflow 仍共享该内部控制网络；per-run 容器、硬上限 tmpfs 输出 volume、镜像内固定 micromamba/Conda 环境和受控 GPU `DeviceRequest` 已由 launcher 创建。主题专属模板和真实 GPU 主机验证仍是未完成能力。
- API/Runner 的仓库根目录构建上下文由 `.dockerignore` 限制；`.env`、Git 元数据、`projects/`、`artifacts/`、n8n 数据和文档不会进入镜像构建上下文。运行时绑定目录不是镜像内容，不能用构建代替挂载。
- 生产环境为 Runner 增加独立 Docker network，默认拒绝出站网络；按数据源或任务临时授权。
- 每个真实 GPU 任务在独立非 root 容器/作业中执行，并带磁盘配额、超时、取消、镜像 digest 和命令模板 ID；当前 GPU 能力只保证受控请求和结构化失败，不宣称已在 GPU 主机完成验证。
- 上传文件限制 50 MB、允许 MIME 清单并去除客户端路径。PDF/JSON/CSV/文本/代码解析有长度和行数上限；图片只读取格式和尺寸；ZIP 只读取清单并拒绝路径穿越、过高压缩比和过大声明解压量，不解压或执行。解析摘要进入模型请求时标记为不可信上下文，上传/解析失败会阻止模型调用。生产环境仍需接入独立恶意文件扫描、内容隔离和持久化配额。

## Experiment snapshot boundary

Before a run is submitted, the project Git worktree must be clean. The API rejects tracked or untracked PDF, image, PLY/PCD, dataset, model-weight, database-backup, runtime-log, source-bundle, cache, forbidden-directory, or oversized file paths. It then creates an annotated immutable `run/<run_id>` tag and writes a controlled recovery bundle under `artifacts/reproducibility/<project_id>/<run_id>/`.

The bundle contains `source.tar`, ProjectSpec, policy, effective configuration and seeds, environment identity, data/model manifests, dependency lock-file hashes, and `snapshot.json`. It contains hashes and metadata rather than silently copying external datasets or model weights. PostgreSQL stores artifact rows and `artifact_dependencies`; the source tar is downloadable only through the API artifact route.

The API validates the project commit and snapshot before enqueueing. The Runner validates the fixed workspace, clean status, tag target, snapshot manifest, every snapshot file hash, and the configured Runner identity again before execution. `RUNNER_IMAGE_DIGEST=unavailable` is explicitly unverified local-development state; a release deployment must set a full `sha256:<64 hex>` digest. A local image name or build fingerprint is not a substitute for an immutable release identity.

The project `.gitignore` is part of this boundary, but it is not the only control: the snapshot module scans both indexed files and working-tree entries, and the Runner rechecks the contract. Never add backups, logs, datasets, model weights, Docker layers, package caches, or source archives with a force-add or by bypassing the API.

## Source and publication policy

- 代码记录 source URL、license SPDX、commit/tag、论文关系和下载时间；未知许可证不得运行或再发布。
- GitHub/GitLab 搜索只产生候选，不自动宣称是官方实现。API 必须先用提供方元数据、项目论文记录和仓库 `CITATION.cff`/README 做双源匹配；未知 SPDX、未固定 40 位 commit 或未批准 Proposal 都会阻止下载。归档仅允许受控主机、大小/条目/解压上限、普通文件和安全相对路径，并在项目 Git 提交前记录 SHA-256。
- 引用必须保存 DOI/稳定 URL、原文 quote 和页码/章节 locator；没有全文证据时不得用于论文事实性结论。
- robots.txt、网站条款、API 速率限制和数据集许可证优先于 Agent 指令。
- 外部发布需要独立 `external_publish` proposal，MVP 不提供自动发布执行器。

## Production hardening checklist

- 更换所有默认密钥，使用 Docker secrets/Vault，轮换 API token。
- 反向代理启用 TLS、SSO/RBAC、CSRF 防护和请求限速。
- PostgreSQL 拆分 API、n8n、MLflow 角色并限制 schema 权限。
- MinIO bucket 使用服务账号、版本化、对象锁和生命周期策略。
- 审计日志发送到只追加存储；关键审批使用签名身份而非 `local-user`。
- 为 PDF/LaTeX/代码解析使用无网络沙箱和恶意内容扫描。

## Local n8n auto-login

`/api/n8n/open` 只为本机个人部署提供无感登录。它使用服务端保存的本地 Owner 凭据调用 n8n 官方登录接口，并转发 n8n 签发的 HttpOnly Cookie；它不会关闭 n8n 用户管理，也不会自行签发或解析 n8n JWT。

- Compose 必须保持 API 与 n8n 为 `127.0.0.1` 端口绑定。
- `.env` 的 Owner 密码和 `N8N_ENCRYPTION_KEY` 不得提交或外发。
- 若需要局域网、服务器或多人访问，必须移除/禁用自动登录入口，改用 TLS、独立账户、SSO/RBAC 或受认证反向代理。
- Cookie 仍会保存在浏览器会话中；清除 Cookie 后重新访问自动登录入口即可，不需要用户记忆密码。
- n8n 工作流节点不能读取容器环境变量；内置工作流只调用 Compose 私有网络内固定的 `http://api:8080`，不向 LLM 或 n8n 表达式暴露 Owner、数据库或对象存储 Secret。
