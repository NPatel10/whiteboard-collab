# Whiteboard Collab

Real-time collaborative whiteboard prototype built as a small monorepo:

- `apps/web`: SvelteKit frontend for the landing flow and whiteboard shell
- `apps/relay`: Go relay service for session lifecycle, snapshots, presence, and live action fan-out

The relay is intentionally lightweight. It does not store board content durably. The owner browser is the source of truth, while the relay keeps only in-memory board/session metadata and active WebSocket connections.

## What is implemented

- Single-route app flow on `/` with landing, owner board, guest board, reconnecting, and invalid-code states
- Share-code based session creation and joining
- WebSocket-based relay contract for:
  - `session.create`
  - `session.join`
  - `board.snapshot`
  - `board.action`
  - `presence.update`
  - `participant.kick`
  - `board.code.revoke`
  - `heartbeat.ping`
- Owner-side local persistence of board snapshot and action log in `localStorage`
- Board JSON export helpers and PNG export via Konva
- Unit tests for whiteboard modules and Go tests for relay behavior
- Playwright coverage for the main route states

## Architecture

### Frontend

The web app is a SvelteKit app using Tailwind CSS and `shadcn-svelte` style primitives. The current UI is intentionally focused on a single route and a small number of collaboration states instead of multi-page navigation.

Core whiteboard modules live under `apps/web/src/lib/whiteboard` and include:

- local board state and action log management
- reconnect-aware WebSocket client logic
- owner snapshot persistence and restore
- sync controller for owner/guest session orchestration
- JSON and PNG export helpers

### Relay

The Go service exposes:

- `GET /api/v1/healthz`
- `GET /api/v1/config`
- `GET /api/v1/ws` for WebSocket upgrades

The relay keeps room metadata in memory, assigns join codes, enforces participant limits, requests snapshots from the owner when guests join, relays board actions and presence events, and disconnects guests when the code is revoked or the board becomes unavailable.

## Repository layout

```text
.
|- apps/
|  |- relay/   # Go relay service
|  `- web/     # SvelteKit frontend
|- doc/        # API, UI, and planning notes
|- docker-compose.yml
`- package.json
```

## Prerequisites

For local development without Docker:

- Bun `1.x`
- Go `1.25+`

Docker-based development only requires:

- Docker
- Docker Compose

## Local development

### 1. Install dependencies

```bash
bun install
```

### 2. Configure the web app

Create a local env file for the web app:

```bash
cp apps/web/.env.example apps/web/.env
```

On PowerShell:

```powershell
Copy-Item apps/web/.env.example apps/web/.env
```

The relay works with its built-in defaults, so you can start it without additional setup. If you want to override relay settings locally, export the relay environment variables in your shell before running it.

### 3. Start the relay

```bash
bun run dev:relay
```

This starts the Go service on `http://localhost:8080` by default.

### 4. Start the web app

In a second terminal:

```bash
bun run dev:web
```

Then open `http://localhost:5173`.

## Docker

To run both services together:

```bash
docker compose up --build
```

Services:

- web: `http://localhost:5173`
- relay: `http://localhost:8080`

The compose file wires the web app to the relay container automatically and includes health checks for both services.

## Environment variables

### Web app

Defined in `apps/web/.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_RELAY_HTTP_URL` | `http://localhost:8080` | Base HTTP URL for relay config and related runtime references |
| `PUBLIC_RELAY_WS_URL` | derived from relay HTTP URL | WebSocket endpoint used by the whiteboard client |
| `PUBLIC_DEFAULT_NICKNAME` | `Guest` | Prefilled nickname for the join flow |

If `PUBLIC_RELAY_WS_URL` is omitted, the app derives it from `PUBLIC_RELAY_HTTP_URL`.

### Relay

Documented in `apps/relay/.env.example`. These are normal process environment variables; the Go service does not auto-load a local `.env` file by itself.

| Variable | Default | Description |
| --- | --- | --- |
| `RELAY_ADDR` | `:8080` | HTTP listen address |
| `RELAY_MAX_PARTICIPANTS_PER_BOARD` | `4` | Max participants allowed in a board session |
| `RELAY_JOIN_CODE_LENGTH` | `8` | Join code length |
| `RELAY_CODE_TTL_SECONDS` | `86400` | Join code/session TTL based on last activity |
| `RELAY_HEARTBEAT_INTERVAL_SECONDS` | `25` | Expected heartbeat interval used for idle timeout handling |

## Common commands

From the repository root:

```bash
bun run dev:web
bun run build:web
bun run check:web
bun run test:web

bun run dev:relay
bun run build:relay
```

Relay tests:

```bash
go test ./apps/relay/...
```

## Sync model

The important runtime behavior is:

1. Owner creates a board through WebSocket.
2. Relay returns a board id, actor id, and join code.
3. Guest joins with the join code and nickname.
4. Relay asks the owner for a fresh snapshot.
5. Owner sends `board.snapshot`.
6. Guest acknowledges the snapshot and starts receiving live `board.action` and `presence.update` events.

Notes:

- The owner browser is the authority for board content.
- Owner board state is persisted locally in the browser.
- The relay is not a durable database.
- If the owner disappears, guests cannot continue independently.

## Testing

### Web

- unit tests: Vitest
- end-to-end tests: Playwright

The web test command runs both:

```bash
bun run test:web
```

### Relay

Run:

```bash
go test ./apps/relay/...
```

## Project docs

The `doc/` folder contains the working notes used to shape the implementation:

- `doc/basic.md`: project scope and MVP summary
- `doc/apis.md`: HTTP and WebSocket contract
- `doc/ui-pages.md`: route states and UI behavior
- `doc/design-guideline.md`, `doc/plan.md`, `doc/tasks.md`: design and planning references

## Current status

This project is an MVP/prototype focused on the collaboration flow, relay contract, and whiteboard state model. The current emphasis is on:

- reliable owner/guest session orchestration
- reconnect and snapshot behavior
- browser-local owner recovery
- a clean single-route UI shell for collaboration
