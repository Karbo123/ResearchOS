"""Add durable task queue lease and retry state."""

from __future__ import annotations

from alembic import op


revision = "0002_task_queue"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS because 0001 adopts databases that were created from
    # an older ORM model before migrations became the schema authority.
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5")
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255)")
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ")
    op.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_token VARCHAR(64)")
    op.execute("UPDATE tasks SET next_attempt_at = COALESCE(next_attempt_at, NOW())")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_idempotency_key ON tasks (idempotency_key) WHERE idempotency_key IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_queue_claim ON tasks (status, next_attempt_at, leased_until, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tasks_queue_claim")
    op.execute("DROP INDEX IF EXISTS uq_tasks_idempotency_key")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS lease_token")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS leased_until")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS next_attempt_at")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS idempotency_key")
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS max_attempts")
