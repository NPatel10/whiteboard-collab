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

function createEditableSnapshot(): BoardSnapshotPayload {
	return {
		target_actor_id: 'actor_1',
		snapshot_version: 11,
		action_cursor: 88,
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
				},
				{
					id: 'shape_1',
					kind: 'shape',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:31:00.000Z',
					updated_at: '2026-03-26T10:31:00.000Z',
					shape: 'rectangle',
					x: 140,
					y: 160,
					width: 200,
					height: 120,
					rotation: 0,
					stroke: '#111827',
					fill: '#fef3c7',
					stroke_width: 2
				},
				{
					id: 'text_1',
					kind: 'text',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:32:00.000Z',
					updated_at: '2026-03-26T10:32:00.000Z',
					x: 260,
					y: 280,
					width: 180,
					height: 80,
					text: 'Editable note',
					font_size: 24,
					color: '#111827',
					align: 'left'
				},
				{
					id: 'sticky_1',
					kind: 'sticky',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:33:00.000Z',
					updated_at: '2026-03-26T10:33:00.000Z',
					x: 420,
					y: 440,
					width: 220,
					height: 160,
					text: 'Move me',
					background: '#fef08a',
					color: '#111827'
				}
			],
			viewport: {
				x: 16,
				y: 24,
				zoom: 1.25
			}
		}
	};
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

	it('tracks selection, transforms supported elements, and deletes targeted objects', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createEditableSnapshot());

		expect(store.updateSelection(['shape_1', 'missing', 'sticky_1', 'shape_1'])).toEqual([
			'shape_1',
			'sticky_1'
		]);
		expect(store.hasSelection).toBe(true);

		expect(
			store.transformObject(
				'shape_1',
				{
					x: 180,
					y: 200,
					width: 240,
					height: 140,
					rotation: 25
				},
				'2026-03-26T10:40:00.000Z'
			)
		).toBe(true);
		expect(
			store.applyTransformUpdate(
				{
					object_id: 'text_1',
					x: 300,
					y: 320,
					width: 240,
					height: 96
				},
				'2026-03-26T10:41:00.000Z'
			)
		).toBe(true);
		expect(
			store.applyTransformUpdate(
				{
					object_id: 'sticky_1',
					x: 460,
					y: 480,
					width: 260,
					height: 180
				},
				'2026-03-26T10:42:00.000Z'
			)
		).toBe(true);
		expect(
			store.transformObject(
				'stroke_1',
				{
					x: 0,
					y: 0
				},
				'2026-03-26T10:43:00.000Z'
			)
		).toBe(false);

		const shape = store.boardState.elements.find((element) => element.id === 'shape_1');
		const text = store.boardState.elements.find((element) => element.id === 'text_1');
		const sticky = store.boardState.elements.find((element) => element.id === 'sticky_1');

		if (!shape || !text || !sticky) {
			throw new Error('expected editable elements to exist');
		}

		expect(shape).toMatchObject({
			x: 180,
			y: 200,
			width: 240,
			height: 140,
			rotation: 25,
			updated_at: '2026-03-26T10:40:00.000Z'
		});
		expect(text).toMatchObject({
			x: 300,
			y: 320,
			width: 240,
			height: 96,
			updated_at: '2026-03-26T10:41:00.000Z'
		});
		expect(sticky).toMatchObject({
			x: 460,
			y: 480,
			width: 260,
			height: 180,
			updated_at: '2026-03-26T10:42:00.000Z'
		});

		expect(store.updateSelection(['text_1', 'missing'])).toEqual(['text_1']);
		expect(store.deleteSelectedObjects()).toBe(true);
		expect(store.boardState.elements.map((element) => element.id)).toEqual([
			'stroke_1',
			'shape_1',
			'sticky_1'
		]);
		expect(store.selectedObjectIds).toEqual([]);
		expect(store.deleteObject('shape_1')).toBe(true);
		expect(store.deleteObject('missing')).toBe(false);
		expect(store.boardState.elements.map((element) => element.id)).toEqual(['stroke_1', 'sticky_1']);
	});

	it('captures undo and redo history for local board edits', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createEditableSnapshot());
		store.updateSelection(['shape_1', 'sticky_1']);

		expect(
			store.transformObject(
				'shape_1',
				{
					x: 180,
					y: 200,
					width: 240,
					height: 140,
					rotation: 25
				},
				'2026-03-26T10:40:00.000Z'
			)
		).toBe(true);
		expect(store.canUndo).toBe(true);
		expect(store.canRedo).toBe(false);
		expect(store.undoDepth).toBe(1);

		expect(store.undo()).toBe(true);
		expect(store.canUndo).toBe(false);
		expect(store.canRedo).toBe(true);
		expect(store.boardState.elements.find((element) => element.id === 'shape_1')).toMatchObject({
			x: 140,
			y: 160,
			width: 200,
			height: 120,
			rotation: 0
		});
		expect(store.selectedObjectIds).toEqual(['shape_1', 'sticky_1']);

		expect(store.redo()).toBe(true);
		expect(store.canUndo).toBe(true);
		expect(store.canRedo).toBe(false);
		expect(store.boardState.elements.find((element) => element.id === 'shape_1')).toMatchObject({
			x: 180,
			y: 200,
			width: 240,
			height: 140,
			rotation: 25
		});

		expect(
			store.deleteObjects(['shape_1', 'sticky_1'])
		).toBe(true);
		expect(store.canRedo).toBe(false);
		expect(store.undoDepth).toBe(2);
		expect(store.undo()).toBe(true);
		expect(store.boardState.elements.map((element) => element.id)).toEqual([
			'stroke_1',
			'shape_1',
			'text_1',
			'sticky_1'
		]);
		expect(store.selectedObjectIds).toEqual(['shape_1', 'sticky_1']);
	});

	it('persists creator snapshots without exposing live store state', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createSnapshot());

		const written: Array<{ key: string; value: string }> = [];
		const didPersist = store.persistCreatorSnapshot('board_1', {
			role: 'owner',
			isBrowser: true,
			storage: {
				getItem() {
					return null;
				},
				setItem(key, value) {
					written.push({ key, value });
				}
			}
		});

		expect(didPersist).toBe(true);
		expect(written).toEqual([
			{
				key: 'whiteboard:creator-snapshot:board_1',
				value: JSON.stringify({
					snapshotVersion: 7,
					actionCursor: 42,
					boardState: {
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
				})
			}
		]);

		store.boardState.viewport.x = 999;

		expect(written[0].value).toContain('"x":8');
	});

	it('persists creator action logs without exposing live store state', () => {
		const store = new LocalBoardStore();
		const action = createAction();

		store.appendAction(action, '2026-03-26T10:31:00.000Z');

		const written: Array<{ key: string; value: string }> = [];
		const didPersist = store.persistCreatorActionLog('board_1', {
			role: 'owner',
			isBrowser: true,
			storage: {
				getItem() {
					return null;
				},
				setItem(key, value) {
					written.push({ key, value });
				}
			}
		});

		expect(didPersist).toBe(true);
		expect(written).toEqual([
			{
				key: 'whiteboard:creator-action-log:board_1',
				value: JSON.stringify([
					{
						action,
						receivedAt: '2026-03-26T10:31:00.000Z'
					}
				])
			}
		]);

		action.data.x = 999;

		expect(written[0].value).toContain('"x":100');
	});

	it('skips creator board persistence for guest sessions', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createSnapshot());
		store.appendAction(createAction(), '2026-03-26T10:31:00.000Z');

		const written: Array<{ key: string; value: string }> = [];
		const didPersist = store.persistCreatorBoardState('board_1', {
			role: 'guest',
			isBrowser: true,
			storage: {
				getItem() {
					return null;
				},
				setItem(key, value) {
					written.push({ key, value });
				}
			}
		});

		expect(didPersist).toBe(false);
		expect(written).toEqual([]);
	});

	it('restores creator board state from storage', () => {
		const snapshot = createSnapshot();
		const action = createAction();
		const storage = createStorage({
			'whiteboard:creator-snapshot:board_1': JSON.stringify({
				snapshotVersion: snapshot.snapshot_version,
				actionCursor: snapshot.action_cursor,
				boardState: {
					elements: snapshot.board_state.elements,
					viewport: snapshot.board_state.viewport
				}
			}),
			'whiteboard:creator-action-log:board_1': JSON.stringify([
				{
					action,
					receivedAt: '2026-03-26T10:31:00.000Z'
				}
			])
		});

		const store = new LocalBoardStore();
		const restoreResult = store.restoreCreatorBoard('board_1', {
			isBrowser: true,
			storage
		});

		expect(restoreResult).toEqual({ restoredFromStorage: true });
		expect(store.snapshotVersion).toBe(7);
		expect(store.actionCursor).toBe(42);
		expect(store.boardState).toEqual(snapshot.board_state);
		expect(store.actionLog).toEqual([
			{
				action,
				receivedAt: '2026-03-26T10:31:00.000Z'
			}
		]);
	});

	it('creates a fresh board when snapshot storage is missing', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createSnapshot());
		store.appendAction(createAction());

		const restoreResult = store.restoreCreatorBoard('board_1', {
			isBrowser: true,
			storage: createStorage()
		});

		expect(restoreResult).toEqual({ restoredFromStorage: false });
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

	it('creates a fresh board when only partial storage remains', () => {
		const storage = createStorage({
			'whiteboard:creator-action-log:board_1': JSON.stringify([
				{
					action: createAction(),
					receivedAt: '2026-03-26T10:31:00.000Z'
				}
			])
		});

		const store = new LocalBoardStore();
		const restoreResult = store.restoreCreatorBoard('board_1', {
			isBrowser: true,
			storage
		});

		expect(restoreResult).toEqual({ restoredFromStorage: false });
		expect(store.hasSnapshot).toBe(false);
		expect(store.actionLog).toEqual([]);
	});

	it('clears board state and log entries', () => {
		const store = new LocalBoardStore();
		store.replaceSnapshot(createSnapshot());
		store.appendAction(createAction());
		store.updateSelection(['shape_1']);
		store.transformObject(
			'shape_1',
			{
				x: 180,
				y: 200
			},
			'2026-03-26T10:40:00.000Z'
		);

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
		expect(store.canUndo).toBe(false);
		expect(store.canRedo).toBe(false);
	});
});
