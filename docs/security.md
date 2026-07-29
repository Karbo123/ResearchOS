# Security policy

## Trust boundaries

1. UI/n8n 输入是不可信数据，进入服务时使用 Pydantic 和 JSON Schema 校验。
2. Research API 只生成高层 Runner 请求，不接受 shell command、SQL、工作目录或任意路径。
3. Runner 再次校验 `extra=forbid`，只执行枚举化任务；LaTeX 使用固定 `paper/main.tex` 和固定 `latexmk` 参数。
4. 高成本实验、代码/配置变更、依赖安装、删除、外发和论文编译先进入 `proposals`，明确批准后才执行。
5. Secret 只通过容器环境或 secret manager 注入，不写入项目 Git、聊天或实验配置。
6. 实验快照只从固定项目 Git 根和受控 `artifacts/` 根生成；相对路径、Git 状态、tag、manifest 和 SHA-256 均由 API 与 Runner 双重校验。

## Adaptive clarification agent

- 澄清 Agent 每轮只接收最新消息、当前草稿和最多 12 条最近对话，输出严格 `codex-clarification.schema.json`；它没有浏览、Shell、文件、SQL 或外部工具权限。
- 复杂度与成本层级由 API 的确定性评分选择；Bridge 按 `simple/medium/complex` allowlist 二次核对模型和推理强度，拒绝调用方指定任意模型。
- 明显领域可以作为可纠正假设推断；数据权限、GPU/预算、截止时间、新颖性、引用和结果不得臆造。
- Bridge 只从项目 `.env` 读取明确允许的 provider、模型、推理键和单独迁移的 `OPENAI_API_KEY`；运行时不读取宿主机 Codex 配置目录或 `auth.json`，也不复制或返回认证对象、refresh token、Cookie 或其他 Secret。健康端点只显示模型目录、提供方、配置来源和 `auth_exposed=false`。
- 模型失败必须返回结构化 API 错误；系统不切换未显式选择的 provider，不生成规则/关键词回复，不静默继续，也不写入助手消息。

## Container policy

- Runner 使用非 root UID、`no-new-privileges`、drop all capabilities、只读 root filesystem、PID/CPU/内存限制和临时目录配额。
- API/Runner 的仓库根目录构建上下文由 `.dockerignore` 限制；`.env`、Git 元数据、`projects/`、`artifacts/`、n8n 数据和文档不会进入镜像构建上下文。运行时绑定目录不是镜像内容，不能用构建代替挂载。
- 生产环境为 Runner 增加独立 Docker network，默认拒绝出站网络；按数据源或任务临时授权。
- 每个真实 GPU 任务应在独立容器/作业中执行，并加磁盘配额、超时、取消、镜像 digest 和命令模板 ID。
- 上传文件限制 50 MB、允许 MIME 清单并去除客户端路径。生产环境还需恶意文件扫描和解压炸弹防护。

## Experiment snapshot boundary

Before a run is submitted, the project Git worktree must be clean. The API rejects tracked or untracked PDF, image, PLY/PCD, dataset, model-weight, database-backup, runtime-log, source-bundle, cache, forbidden-directory, or oversized file paths. It then creates an annotated immutable `run/<run_id>` tag and writes a controlled recovery bundle under `artifacts/reproducibility/<project_id>/<run_id>/`.

The bundle contains `source.tar`, ProjectSpec, policy, effective configuration and seeds, environment identity, data/model manifests, dependency lock-file hashes, and `snapshot.json`. It contains hashes and metadata rather than silently copying external datasets or model weights. PostgreSQL stores artifact rows and `artifact_dependencies`; the source tar is downloadable only through the API artifact route.

The API validates the project commit and snapshot before enqueueing. The Runner validates the fixed workspace, clean status, tag target, snapshot manifest, every snapshot file hash, and the configured Runner identity again before execution. `RUNNER_IMAGE_DIGEST=unavailable` is explicitly unverified local-development state; a release deployment must set a full `sha256:<64 hex>` digest. A local image name or build fingerprint is not a substitute for an immutable release identity.

The project `.gitignore` is part of this boundary, but it is not the only control: the snapshot module scans both indexed files and working-tree entries, and the Runner rechecks the contract. Never add backups, logs, datasets, model weights, Docker layers, package caches, or source archives with a force-add or by bypassing the API.

## Source and publication policy

- 代码记录 source URL、license SPDX、commit/tag、论文关系和下载时间；未知许可证不得运行或再发布。
- GitHub 标题搜索只产生候选，不自动宣称是官方实现。
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
