import { describe, expect, it } from 'vitest';

import { BoardActionIdentityStore } from './action-identity.svelte.js';
import { LocalBoardStore } from './board-store.svelte.js';
import { AppConnectionState } from './connection-state.svelte.js';
import { AppSessionState } from './session-state.svelte.js';
import type { SocketLike } from './socket-client.js';
import {
	createWhiteboardSyncController,
	type WhiteboardSyncControllerOptions
} from './sync-controller.svelte.js';
import type { BoardActionPayload, BoardSnapshotPayload } from './types.js';

const openState = 1;
const closedState = 3;

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: string[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(public readonly url: string) {}

	send(data: string) {
		if (this.readyState !== openState) {
			throw new Error('socket must be open to send');
		}

		this.sent.push(data);
	}

	close(code = 1000, reason = 'closed') {
		if (this.readyState === closedState) {
			return;
		}

		this.readyState = closedState;
		this.onclose?.({ code, reason, wasClean: code === 1000 });
	}

	open() {
		this.readyState = openState;
		this.onopen?.({});
	}

	receive(message: unknown) {
		const serialized = typeof message === 'string' ? message : JSON.stringify(message);
		this.onmessage?.({ data: serialized });
	}
}

function createHarness(overrides: Partial<WhiteboardSyncControllerOptions> = {}) {
	const sockets: FakeSocket[] = [];
	const storage = createStorage();
	const scheduled: Array<{
		cancelled: boolean;
		delayMs: number;
		executed: boolean;
		handler: () => void;
	}> = [];
	const boardStore = new LocalBoardStore();
	const connectionState = new AppConnectionState();
	const identityStore = new BoardActionIdentityStore({
		actionIdFactory: () => 'action_test',
		initialClientSequence: 10
	});
	const sessionState = new AppSessionState();
	let requestCounter = 0;

	const controller = createWhiteboardSyncController({
		boardStore,
		connectionState,
		createSocket: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		identityStore,
		isBrowser: true,
		reconnectDelayMs: 10,
		relayWsUrl: 'ws://relay.example.test/api/v1/ws',
		requestIdFactory: () => `req_${++requestCounter}`,
		sessionState,
		setTimeoutFn: (handler: () => void, delayMs: number) => {
			scheduled.push({ cancelled: false, delayMs, executed: false, handler });
			return (scheduled.length - 1) as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimeoutFn: (timeout: ReturnType<typeof setTimeout>) => {
			const scheduledTask = scheduled[timeout as number];
			if (scheduledTask) {
				scheduledTask.cancelled = true;
			}
		},
		storage,
		...overrides
	});

	return {
		boardStore,
		connectionState,
		controller,
		identityStore,
		scheduled,
		sessionState,
		sockets,
		storage,
		runScheduled(index: number) {
			const task = scheduled[index];
			if (!task || task.cancelled || task.executed) {
				throw new Error(`scheduled task ${index} is not runnable`);
			}

			task.executed = true;
			task.handler();
		}
	};
}

function createSnapshot(): BoardSnapshotPayload {
	return {
		target_actor_id: 'actor_guest_1',
		snapshot_version: 7,
		action_cursor: 42,
		board_state: {
			elements: [
				{
					id: 'shape_1',
					kind: 'shape',
					created_by: 'actor_owner_1',
					created_at: '2026-03-28T06:30:00.000Z',
					updated_at: '2026-03-28T06:30:00.000Z',
					shape: 'rectangle',
					x: 24,
					y: 32,
					width: 180,
					height: 120,
					rotation: 0,
					stroke: '#111827',
					fill: '#fef3c7',
					stroke_width: 2
				}
			],
			viewport: {
				x: 8,
				y: 16,
				zoom: 1.25
			}
		}
	};
}

function createAction(actionId = 'action_shape_remote'): BoardActionPayload<'shape.create'> {
	return {
		action_id: actionId,
		action_kind: 'shape.create',
		client_sequence: 1,
		object_id: `shape_${actionId}`,
		object_version: 1,
		data: {
			shape: 'ellipse',
			x: 100,
			y: 120,
			width: 220,
			height: 140,
			stroke: '#111827',
			fill: '#dbeafe',
			stroke_width: 3
		}
	};
}

function createStorage(initialValues: Record<string, string> = {}) {
	const values = new Map(Object.entries(initialValues));

	return {
		getItem(key: string) {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			values.set(key, value);
		}
	};
}

describe('WhiteboardSyncController', () => {
	it('sends owner snapshots to requested guests and clears them on ack', () => {
		const { boardStore, controller, sessionState, sockets } = createHarness();
		boardStore.replaceSnapshot(createSnapshot());

		expect(controller.connectOwnerSession({ nickname: 'Owner', deviceId: 'device_owner_1' })).toBe(true);
		sockets[0].open();
		sockets[0].receive({
			type: 'session.created',
			request_id: 'req_create_owner',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: {
				join_code: 'ABCD1234',
				role: 'owner',
				max_participants: 4,
				expires_in_seconds: 86400
			}
		});

		expect(controller.phase).toBe('ready');
		expect(sessionState.role).toBe('owner');

		sockets[0].receive({
			type: 'board.snapshot.request',
			request_id: 'req_snapshot_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				target_actor_id: 'actor_guest_1'
			}
		});

		expect(controller.pendingSnapshotTargetIds).toEqual(['actor_guest_1']);
		const snapshotRequest = JSON.parse(sockets[0].sent.at(-1) ?? '{}');
		expect(snapshotRequest.type).toBe('board.snapshot');
		expect(snapshotRequest.request_id).toBe('req_snapshot_guest_1');
		expect(snapshotRequest.payload.target_actor_id).toBe('actor_guest_1');
		expect(snapshotRequest.payload.snapshot_version).toBe(7);
		expect(snapshotRequest.payload.action_cursor).toBe(42);

		sockets[0].receive({
			type: 'board.snapshot.ack',
			request_id: 'req_snapshot_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				snapshot_version: 7
			}
		});

		expect(controller.pendingSnapshotTargetIds).toEqual([]);
	});

	it('blocks guest editing until the snapshot is received and acknowledged', () => {
		const { boardStore, controller, sessionState, sockets } = createHarness();

		expect(
			controller.connectGuestSession({
				deviceId: 'device_guest_1',
				joinCode: 'ABCD1234',
				nickname: 'Guest'
			})
		).toBe(true);
		sockets[0].open();
		sockets[0].receive({
			type: 'session.joined',
			request_id: 'req_join_guest',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				role: 'guest',
				owner_actor_id: 'actor_owner_1',
				participants: [
					{
						actor_id: 'actor_owner_1',
						nickname: 'Owner',
						role: 'owner',
						color: '#f97316'
					},
					{
						actor_id: 'actor_guest_1',
						nickname: 'Guest',
						role: 'guest',
						color: '#0ea5e9'
					}
				]
			}
		});

		expect(controller.phase).toBe('awaiting_snapshot');
		expect(controller.editingLocked).toBe(true);
		expect(sessionState.role).toBe('guest');
		expect(controller.sendBoardAction(createAction('action_guest_blocked'))).toBe(false);

		const snapshot = createSnapshot();
		snapshot.target_actor_id = 'actor_guest_1';
		sockets[0].receive({
			type: 'board.snapshot',
			request_id: 'req_snapshot_guest',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: snapshot
		});

		expect(controller.phase).toBe('ready');
		expect(controller.editingLocked).toBe(false);
		expect(boardStore.snapshotVersion).toBe(7);
		expect(boardStore.boardState).toEqual(snapshot.board_state);

		const snapshotAck = JSON.parse(sockets[0].sent.at(-1) ?? '{}');
		expect(snapshotAck.type).toBe('board.snapshot.ack');
		expect(snapshotAck.request_id).toBe('req_snapshot_guest');
		expect(snapshotAck.payload.snapshot_version).toBe(7);
	});

	it('reapplies guest join handshake after reconnecting and resumes from a new snapshot', () => {
		const { boardStore, controller, runScheduled, scheduled, sockets } = createHarness();

		controller.connectGuestSession({
			deviceId: 'device_guest_1',
			joinCode: 'ABCD1234',
			nickname: 'Guest'
		});
		sockets[0].open();
		sockets[0].receive({
			type: 'session.joined',
			request_id: 'req_join_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				role: 'guest',
				owner_actor_id: 'actor_owner_1',
				participants: []
			}
		});
		sockets[0].receive({
			type: 'board.snapshot',
			request_id: 'req_snapshot_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: {
				...createSnapshot(),
				target_actor_id: 'actor_guest_1'
			}
		});

		sockets[0].close(1006, 'temporary network loss');

		expect(controller.phase).toBe('reconnecting');
		expect(controller.editingLocked).toBe(true);
		expect(scheduled).toHaveLength(1);

		runScheduled(0);
		expect(sockets).toHaveLength(2);
		sockets[1].open();

		const resentJoin = JSON.parse(sockets[1].sent[0] ?? '{}');
		expect(resentJoin.type).toBe('session.join');
		expect(resentJoin.payload.join_code).toBe('ABCD1234');
		expect(resentJoin.payload.nickname).toBe('Guest');

		sockets[1].receive({
			type: 'session.joined',
			request_id: 'req_join_guest_2',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				role: 'guest',
				owner_actor_id: 'actor_owner_1',
				participants: []
			}
		});
		sockets[1].receive({
			type: 'board.snapshot',
			request_id: 'req_snapshot_guest_2',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: {
				...createSnapshot(),
				target_actor_id: 'actor_guest_1',
				snapshot_version: 9
			}
		});

		expect(controller.phase).toBe('ready');
		expect(controller.editingLocked).toBe(false);
		expect(boardStore.snapshotVersion).toBe(9);
	});

	it('restores the owner board from local storage after reconnecting and flushes queued actions', () => {
		const {
			boardStore,
			controller,
			runScheduled,
			scheduled,
			sessionState,
			sockets,
			storage
		} = createHarness();

		controller.connectOwnerSession({ nickname: 'Owner', deviceId: 'device_owner_1' });
		sockets[0].open();
		sockets[0].receive({
			type: 'session.created',
			request_id: 'req_create_owner_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: {
				join_code: 'ABCD1234',
				role: 'owner',
				max_participants: 4,
				expires_in_seconds: 86400
			}
		});

		const snapshot = createSnapshot();
		boardStore.replaceSnapshot(snapshot);
		expect(controller.persistOwnerBoardState()).toBe(true);
		expect(
			storage.getItem('whiteboard:creator-snapshot:board_owner_1')
		).not.toBeNull();

		sockets[0].close(1006, 'network error');
		expect(controller.phase).toBe('reconnecting');
		expect(scheduled).toHaveLength(1);

		const queuedAction = createAction('action_after_reconnect');
		expect(controller.sendBoardAction(queuedAction)).toBe(true);

		runScheduled(0);
		expect(sockets).toHaveLength(2);
		sockets[1].open();

		const resentCreate = JSON.parse(sockets[1].sent[0] ?? '{}');
		expect(resentCreate.type).toBe('session.create');
		expect(resentCreate.payload.nickname).toBe('Owner');

		sockets[1].receive({
			type: 'session.created',
			request_id: 'req_create_owner_2',
			board_id: 'board_owner_2',
			actor_id: 'actor_owner_1',
			payload: {
				join_code: 'WXYZ5678',
				role: 'owner',
				max_participants: 4,
				expires_in_seconds: 86400
			}
		});

		expect(controller.phase).toBe('ready');
		expect(sessionState.boardId).toBe('board_owner_2');
		expect(boardStore.snapshotVersion).toBe(7);
		expect(boardStore.boardState).toEqual(snapshot.board_state);

		const flushedAction = JSON.parse(sockets[1].sent.at(-1) ?? '{}');
		expect(flushedAction.type).toBe('board.action');
		expect(flushedAction.payload.action_id).toBe('action_after_reconnect');
		expect(
			storage.getItem('whiteboard:creator-snapshot:board_owner_2')
		).not.toBeNull();
	});

	it('applies remote board actions idempotently through the board store', () => {
		const { boardStore, controller, sockets } = createHarness();
		controller.connectGuestSession({
			deviceId: 'device_guest_1',
			joinCode: 'ABCD1234',
			nickname: 'Guest'
		});
		sockets[0].open();
		sockets[0].receive({
			type: 'session.joined',
			request_id: 'req_join_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_guest_1',
			payload: {
				role: 'guest',
				owner_actor_id: 'actor_owner_1',
				participants: []
			}
		});
		sockets[0].receive({
			type: 'board.snapshot',
			request_id: 'req_snapshot_guest_1',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			payload: {
				target_actor_id: 'actor_guest_1',
				snapshot_version: 1,
				action_cursor: 0,
				board_state: {
					elements: [],
					viewport: { x: 0, y: 0, zoom: 1 }
				}
			}
		});

		const action = createAction();
		sockets[0].receive({
			type: 'board.action',
			request_id: 'req_remote_action',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			sent_at: '2026-03-28T06:45:00.000Z',
			payload: action
		});
		sockets[0].receive({
			type: 'board.action',
			request_id: 'req_remote_action_duplicate',
			board_id: 'board_owner_1',
			actor_id: 'actor_owner_1',
			sent_at: '2026-03-28T06:45:01.000Z',
			payload: action
		});

		expect(boardStore.actionCount).toBe(1);
		expect(boardStore.boardState.elements).toHaveLength(1);
	});
});
