import { describe, expect, it } from 'vitest';

import { LocalBoardStore } from './board-store.svelte.js';
import type { BoardActionPayload, BoardSnapshotPayload } from './types.js';

function createSnapshot(): BoardSnapshotPayload {
	return {
		target_actor_id: 'actor_1',
		snapshot_version: 7,
		action_cursor: 42,
		board_state: {
			elements: [
				{
					id: 'stroke_1',
					kind: 'stroke',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:30:00.000Z',
					updated_at: '2026-03-26T10:30:00.000Z',
					stroke: '#0f172a',
					stroke_width: 4,
					points: [
						{ x: 12, y: 18, pressure: 0.4 },
						{ x: 24, y: 30, pressure: 0.8 }
					]
				}
			],
			viewport: {
				x: 8,
				y: 16,
				zoom: 1.5
			}
		}
	};
}

function createAction(): BoardActionPayload<'shape.create'> {
	return {
		action_id: 'action_1',
		client_sequence: 1,
		action_kind: 'shape.create',
		data: {
			shape: 'rectangle',
			x: 100,
			y: 120,
			width: 240,
			height: 140,
			stroke: '#111827',
			fill: '#fef3c7',
			stroke_width: 2
		}
	};
}

function createBoardStateJson() {
	return JSON.stringify({
		elements: [
			{
				id: 'shape_1',
				kind: 'shape',
				created_by: 'actor_1',
				created_at: '2026-03-26T10:30:00.000Z',
				updated_at: '2026-03-26T10:30:00.000Z',
				shape: 'ellipse',
				x: 40,
				y: 50,
				width: 120,
				height: 80,
				rotation: 0,
				stroke: '#111827',
				fill: '#fef3c7',
				stroke_width: 2
			}
		],
		viewport: {
			x: 16,
			y: 24,
			zoom: 1.25
		}
	});
}

describe('LocalBoardStore', () => {
	it('replaces the board snapshot and clones incoming data', () => {
		const store = new LocalBoardStore();
		const snapshot = createSnapshot();

		store.replaceSnapshot(snapshot);

		expect(store.hasSnapshot).toBe(true);
		expect(store.snapshotVersion).toBe(7);
		expect(store.actionCursor).toBe(42);
		expect(store.boardState).toEqual(snapshot.board_state);
		expect(store.actionCount).toBe(0);

		const snapshotElement = snapshot.board_state.elements[0];
		if (snapshotElement.kind !== 'stroke') {
			throw new Error('expected stroke element in snapshot');
		}

		snapshotElement.points[0].x = 999;

		const storeElement = store.boardState.elements[0];
		if (storeElement.kind !== 'stroke') {
			throw new Error('expected stroke element in store');
		}

		expect(storeElement.points[0].x).toBe(12);
	});

	it('appends unique actions to the action log', () => {
		const store = new LocalBoardStore();
		const action = createAction();

		expect(store.appendAction(action, new Date('2026-03-26T10:31:00.000Z'))).toBe(true);
		expect(store.appendAction(action, '2026-03-26T10:32:00.000Z')).toBe(false);
		expect(store.actionCount).toBe(1);
		expect(store.actionLog[0]).toEqual({
			action,
			receivedAt: '2026-03-26T10:31:00.000Z'
		});

		action.data.x = 360;

		const loggedAction = store.actionLog[0].action as BoardActionPayload<'shape.create'>;
		expect(loggedAction.data.x).toBe(100);
	});

	it('imports a board state from json into the store', () => {
		const store = new LocalBoardStore();
		const snapshot = store.importFromJson(createBoardStateJson());

		expect(snapshot.snapshotVersion).toBe(1);
		expect(snapshot.actionCursor).toBe(0);
		expect(store.hasSnapshot).toBe(true);
		expect(store.snapshotVersion).toBe(1);
		expect(store.actionCursor).toBe(0);
		expect(store.boardState).toEqual({
			elements: [
				{
					id: 'shape_1',
					kind: 'shape',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:30:00.000Z',
					updated_at: '2026-03-26T10:30:00.000Z',
					shape: 'ellipse',
					x: 40,
					y: 50,
					width: 120,
					height: 80,
					rotation: 0,
					stroke: '#111827',
					fill: '#fef3c7',
					stroke_width: 2
				}
			],
			viewport: {
				x: 16,
				y: 24,
				zoom: 1.25
			}
		});
	});

	it('clears board state and log entries', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createSnapshot());
		store.appendAction(createAction());

		store.clear();

		expect(store.hasSnapshot).toBe(false);
		expect(store.snapshotVersion).toBe(0);
		expect(store.actionCursor).toBe(0);
		expect(store.boardState).toEqual({
			elements: [],
			viewport: {
				x: 0,
				y: 0,
				zoom: 1
			}
		});
		expect(store.actionLog).toEqual([]);
	});
});
