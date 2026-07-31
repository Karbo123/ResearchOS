# Security

## Trust Model

Research OS is a single-user local MVP. It listens only on loopback and assumes the Windows account controls access. It is not a multi-tenant service and does not claim virtual-machine isolation.

## Model Boundary

Agents receive validated, bounded business objects. They do not receive process, SQL, arbitrary path, credential, or unrestricted network tools. Model output is never interpreted as a command. Model failure returns a structured error and no assistant message is persisted.

Luna, Terra, and Sol credentials are independent. Public settings expose only `key_configured`. Runtime code does not read Codex configuration or authentication files. Logs, audits, workflow inputs, and reports must not contain model keys.

## Experiment Boundary

Only approved, allowlisted experiment types run. Project paths are derived from UUIDs and validated beneath `projects/`; artifact paths remain beneath `artifacts/`. Python runs use a per-project `.venv`. Children receive a minimal environment without application credentials.

The supervisor provides fixed launch arguments, timeout, process-tree termination, bounded logs, required structured outputs, SHA-256 registration, and audit records. Untrusted high-risk code requires a separately managed virtual machine because native process controls cannot guarantee kernel isolation or resource hard limits.

## Uploads and Evidence

Uploads are size- and extension-limited and scanned with Windows Defender. Scanner absence, threat detection, timeout, or scan failure rejects the upload. Uploaded material remains untrusted context and is not executed.

PDF evidence is downloaded only from a fixed HTTPS host allowlist, limited to 25 MB, checked for a PDF signature, hashed, parsed without evaluation, and stored with page locators. Extracted passages are candidates for claim-level review, not automatic proof.

## Files and Secrets

`.env`, `runtime/`, local databases, backup archives, model keys, cookies, and authentication material are ignored and must never be committed. Project patches cannot target `.git`, `.env`, credentials, or paths outside the project. Approved patches bind a Git commit and content hash; conflicts fail before commit and modified files are restored.

## Network

Only fixed academic providers, approved repository providers, configured model endpoints, and local loopback services are valid network destinations. External requests use timeouts and a project User-Agent. Do not bind API or Studio to a LAN or public interface.

## Dependency Risk

Mastra `@mastra/core@1.55.0` currently pins `@ai-sdk/provider-utils@3.0.30`, for which the production audit reports an upstream advisory and no newer compatible 3.x release is published. The application does not force an unsupported transitive override. Model input is bounded, requests have a fixed timeout, retries are disabled, and concurrency is constrained while the upstream packages are monitored for a compatible patch.
