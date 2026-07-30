CREATE SCHEMA IF NOT EXISTS n8n;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Application tables are created by the versioned Alembic migration in the
-- db-migrate Compose service. This file establishes extensions and n8n's
-- dedicated namespace for a fresh PostgreSQL volume.
