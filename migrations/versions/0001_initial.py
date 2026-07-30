"""Create the initial Research OS application schema.

The first migration is deliberately idempotent so an existing MVP database
can be adopted without dropping rows. Future schema changes must use explicit
revision files instead of changing the ORM startup path.
"""

from __future__ import annotations

from alembic import op

from apps.api.app.db import Base
from apps.api.app import models  # noqa: F401: register all mapped tables


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
    op.execute("ALTER TABLE evidence ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb")


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
