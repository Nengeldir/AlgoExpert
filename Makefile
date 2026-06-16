.PHONY: dev build seed test lint format install docker-up docker-down

install:
	npm install

dev:
	docker compose up --build

build:
	docker compose build

seed:
	docker compose exec backend npm run seed

test:
	npm run test

lint:
	npm run lint

format:
	npm run format

docker-up:
	docker compose up -d

docker-down:
	docker compose down

# Local dev without Docker (requires Node 20+)
dev-local:
	npm run dev

# Export votes for lecture
export:
	curl -H "Authorization: Bearer $${ADMIN_TOKEN}" http://localhost:3000/admin/export
