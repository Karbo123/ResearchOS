.PHONY: install build start dev test validate

install:
	npm ci

build:
	npm run build

start:
	npm start

dev:
	npm run dev

test:
	npm test

validate:
	npm run typecheck
	npm test
	npm run idea-cases:check
	npm run docs:check
