from pathlib import Path


ROOT = Path(__file__).parents[3]


def test_api_startup_requires_a_versioned_schema_and_does_not_create_tables():
    source = (ROOT / "apps" / "api" / "app" / "main.py").read_text(encoding="utf-8")

    assert "SELECT version_num FROM alembic_version" in source
    assert "Base.metadata.create_all" not in source
    assert "ALTER TABLE evidence" not in source


def test_alembic_initial_revision_registers_all_orm_tables_idempotently():
    revision = (ROOT / "migrations" / "versions" / "0001_initial.py").read_text(encoding="utf-8")
    models = (ROOT / "apps" / "api" / "app" / "models.py").read_text(encoding="utf-8")

    assert "revision = \"0001_initial\"" in revision
    assert "Base.metadata.create_all" in revision
    assert models.count("__tablename__") == 18


def test_api_image_carries_the_versioned_migration_entrypoint():
    assert (ROOT / "alembic.ini").is_file()
    assert (ROOT / "migrations" / "env.py").is_file()
    assert "alembic" in (ROOT / "apps" / "api" / "requirements.txt").read_text(encoding="utf-8")


def test_task_queue_revision_declares_leases_retries_and_idempotency_index():
    revision = (ROOT / "migrations" / "versions" / "0002_task_queue.py").read_text(encoding="utf-8")
    models = (ROOT / "apps" / "api" / "app" / "models.py").read_text(encoding="utf-8")

    assert 'revision = "0002_task_queue"' in revision
    assert "uq_tasks_idempotency_key" in revision
    for field in ("max_attempts", "idempotency_key", "next_attempt_at", "leased_until", "lease_token"):
        assert f"{field}: Mapped" in models


def test_n8n_provisioning_allows_schema_bootstrap_without_granting_table_access():
    source = (ROOT / "scripts" / "provision_db_roles.py").read_text(encoding="utf-8")

    assert "GRANT CONNECT ON DATABASE" in source
    assert "GRANT CREATE ON DATABASE" in source
    assert "GRANT USAGE, CREATE ON SCHEMA n8n" in source
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}" in source
