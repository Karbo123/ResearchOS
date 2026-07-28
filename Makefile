.PHONY: up down logs test validate docs-check

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f api runner n8n

test:
	docker compose run --rm api pytest -q

validate:
	docker compose config --quiet
	python scripts/check_docs_sync.py

docs-check:
	python scripts/check_docs_sync.py
