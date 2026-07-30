"""Provision isolated PostgreSQL roles and schemas before Alembic runs."""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql


IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def env_value(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    if not value:
        raise RuntimeError(f"{name} must not be empty")
    return value


def identifier(value: str, label: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise RuntimeError(f"{label} is not a safe PostgreSQL identifier")
    return value


def database_url(url: str, database: str) -> str:
    raw = psycopg_url(url)
    parts = urlsplit(raw)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


def psycopg_url(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def ensure_role(connection, name: str, password: str) -> None:
    if connection.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (name,)).fetchone():
        connection.execute(
            sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(name), sql.Literal(password))
        )
    else:
        connection.execute(
            sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(name), sql.Literal(password))
        )


def grant_application_access(connection, database: str, admin: str, api_role: str, n8n_role: str) -> None:
    connection.execute("CREATE SCHEMA IF NOT EXISTS n8n")
    connection.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(database), sql.Identifier(api_role)))
    connection.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(api_role)))
    connection.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(sql.Identifier(api_role)))
    connection.execute(sql.SQL("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {}").format(sql.Identifier(api_role)))
    connection.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}").format(sql.Identifier(admin), sql.Identifier(api_role)))
    connection.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {}").format(sql.Identifier(admin), sql.Identifier(api_role)))
    connection.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(database), sql.Identifier(n8n_role)))
    # n8n checks its schema with CREATE SCHEMA IF NOT EXISTS during startup.
    connection.execute(sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(sql.Identifier(database), sql.Identifier(n8n_role)))
    connection.execute(sql.SQL("GRANT USAGE, CREATE ON SCHEMA n8n TO {}").format(sql.Identifier(n8n_role)))
    connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA n8n TO {}").format(sql.Identifier(n8n_role)))
    connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA n8n TO {}").format(sql.Identifier(n8n_role)))
    connection.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA n8n GRANT ALL ON TABLES TO {}").format(sql.Identifier(admin), sql.Identifier(n8n_role)))
    connection.execute(sql.SQL("ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA n8n GRANT ALL ON SEQUENCES TO {}").format(sql.Identifier(admin), sql.Identifier(n8n_role)))


def ensure_mlflow_database(admin_url: str, admin: str, mlflow_role: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as connection:
        exists = connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", ("research_os_mlflow",)).fetchone()
        if not exists:
            connection.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier("research_os_mlflow"), sql.Identifier(mlflow_role)))
        else:
            connection.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier("research_os_mlflow"), sql.Identifier(mlflow_role)))
    with psycopg.connect(database_url(admin_url, "research_os_mlflow"), autocommit=True) as connection:
        connection.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(mlflow_role)))
        connection.execute(sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(mlflow_role)))
        connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {}").format(sql.Identifier(mlflow_role)))
        connection.execute(sql.SQL("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {}").format(sql.Identifier(mlflow_role)))


def main() -> None:
    admin_url = psycopg_url(os.getenv("MIGRATION_DATABASE_URL", "").strip())
    if not admin_url:
        raise RuntimeError("MIGRATION_DATABASE_URL is required")
    api_role = identifier(env_value("API_DB_USER", "research_api"), "API_DB_USER")
    n8n_role = identifier(env_value("N8N_DB_USER", "research_n8n"), "N8N_DB_USER")
    mlflow_role = identifier(env_value("MLFLOW_DB_USER", "research_mlflow"), "MLFLOW_DB_USER")
    api_password = env_value("API_DB_PASSWORD", "api-development-password")
    n8n_password = env_value("N8N_DB_PASSWORD", "n8n-development-password")
    mlflow_password = env_value("MLFLOW_DB_PASSWORD", "mlflow-development-password")
    with psycopg.connect(admin_url, autocommit=True) as connection:
        admin = connection.info.user
        database = connection.info.dbname
        ensure_role(connection, api_role, api_password)
        ensure_role(connection, n8n_role, n8n_password)
        ensure_role(connection, mlflow_role, mlflow_password)
        grant_application_access(connection, database, admin, api_role, n8n_role)
    ensure_mlflow_database(admin_url, admin, mlflow_role)


if __name__ == "__main__":
    main()
