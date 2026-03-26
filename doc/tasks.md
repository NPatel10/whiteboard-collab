# Real-Time Collaborative Whiteboard Implementation Tasks

## Phase 0: Project Setup

- [x] Finalize canvas library choice for SvelteKit.
- [x] Add `shadcn-svelte` to the frontend stack and configure required UI primitives.
- [x] Set up shared TypeScript types for board models, WebSocket messages, and action payloads.
- [x] Define environment variables for frontend and relay server.
- [x] Add Docker setup for frontend and Go relay server.

## Phase 1: Relay Server Foundation

- [x] Create Go service skeleton with WebSocket endpoint at `/api/v1/ws`.
- [x] Add HTTP endpoints for `/api/v1/healthz` and `/api/v1/config`.
- [x] Implement in-memory room store for board sessions and join codes.
- [x] Implement 8-character alphanumeric code generation.
- [x] Implement last-activity based 24-hour expiry handling.
- [x] Implement board capacity limit of 4 participants.
- [ ] Implement heartbeat handling and idle cleanup.
- [ ] Implement per-IP and per-code rate limiting.
- [x] Add structured logging and error responses.

## Phase 2: WebSocket Protocol

- [ ] Implement `session.create`.
- [ ] Implement `session.join`.
- [ ] Implement `session.join_rejected`.
- [ ] Implement `session.created` and `session.joined`.
- [ ] Implement `participant.joined` and `participant.left`.
- [ ] Implement `board.snapshot.request`.
- [ ] Implement `board.snapshot`.
- [ ] Implement `board.snapshot.ack`.
- [ ] Implement `board.action`.
- [ ] Implement `presence.update`.
- [ ] Implement `participant.kick`.
- [ ] Implement `board.code.revoke` and `board.code.revoked`.
- [ ] Implement `heartbeat.ping` and `heartbeat.pong`.

## Phase 3: Frontend App Shell

- [x] Create single-route SvelteKit app shell for landing and board states.
- [x] Build landing state with `Create board` and `Join board` flows.
- [x] Build join form with code and nickname inputs.
- [x] Add app-level connection state store.
- [x] Add socket client with reconnect logic.
- [x] Add session stores for actor id, board id, join code, role, and participants.
- [x] Add invalid-code, board-full, and reconnecting UI states.

## Phase 4: Whiteboard Core

- [x] Define board element model for strokes, shapes, text, and sticky notes.
- [x] Define viewport model for pan and zoom.
- [x] Implement local board store with snapshot and action log.
- [x] Implement action ids and per-client sequence numbers.
- [x] Implement draw pipeline with throttled or batched actions.
- [x] Implement selection and transform behavior.
- [x] Implement delete behavior.
- [x] Implement per-user undo and redo stacks.
- [x] Implement import from JSON.
- [ ] Implement export to JSON and PNG.

## Phase 5: Real-Time Sync

- [ ] Send high-level board actions over WebSocket.
- [ ] Apply remote actions idempotently.
- [ ] Ignore duplicate actions by `action_id`.
- [ ] Guard against stale actions using client sequence or version checks.
- [ ] Implement guest join snapshot flow from creator to target guest.
- [ ] Block guest editing until snapshot ack completes.
- [ ] Implement reconnect reconciliation flow.
- [ ] Ensure owner reconnect restores board from local storage.

## Phase 6: Whiteboard UI

- [ ] Build toolbar with tools for select, pen, eraser, shapes, text, and sticky notes.
- [ ] Build color and brush controls.
- [ ] Build top bar with share, import, export, and connection status.
- [ ] Build share dialog with code display, copy, revoke, and regenerate actions.
- [ ] Build participant panel with user colors and kick action for owner.
- [ ] Build remote cursor rendering.
- [ ] Build mobile-friendly sheets or drawers for secondary controls.
- [ ] Add visible sync and connection badges.

## Phase 7: Persistence

- [x] Persist creator board snapshot to local storage.
- [x] Persist creator action log to local storage.
- [x] Restore creator board from local storage on reload.
- [x] Ensure guests do not auto-persist board state.
- [x] Handle missing or cleared local storage by creating a fresh board.

## Phase 8: Hardening

- [ ] Add validation for malformed WebSocket messages.
- [ ] Add snapshot timeout handling if owner does not respond.
- [ ] Add owner-offline handling for guests.
- [ ] Add code revocation disconnect handling.
- [ ] Add participant-limit edge case handling.
- [ ] Add TLS-ready production configuration.
- [ ] Add Docker production build and runtime checks.

## Phase 9: Testing

- [ ] Add unit tests for room store, code generation, expiry logic, and rate limiting.
- [ ] Add unit tests for board reducers and action application.
- [ ] Add integration tests for create, join, snapshot sync, and reconnect flows.
- [ ] Add integration tests for invalid code, full board, kicked participant, and revoked code cases.
- [x] Add frontend smoke tests for landing, owner board, and guest board states.

## Phase 10: Demo Readiness

- [ ] Test one owner plus three guests on the same board.
- [ ] Test invalid code flow.
- [ ] Test code revoke and guest disconnect flow.
- [ ] Test owner refresh and local restore flow.
- [ ] Test reconnect after temporary network loss.
- [ ] Test JSON export/import flow.
- [ ] Test touch interactions on tablet or mobile.

## Recommended First Slice

If work starts immediately, build in this order:

1. Relay server foundation
2. Session create and join flow
3. Local whiteboard state model
4. Snapshot sync from owner to guest
5. Basic pen tool plus presence
6. Share dialog and participant list
7. Shapes, text, sticky notes, and polish

## Scope Cut Order

If the schedule compresses, cut in this order:

1. Sticky notes
2. Full mobile polish
3. Advanced shape editing
4. Broad undo and redo support across every object type
