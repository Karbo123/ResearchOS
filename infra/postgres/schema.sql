CREATE SCHEMA IF NOT EXISTS n8n;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Application tables are created idempotently by SQLAlchemy on API startup.
-- This file establishes database-level isolation and n8n's dedicated namespace.
