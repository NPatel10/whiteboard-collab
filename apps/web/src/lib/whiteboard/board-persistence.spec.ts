import { describe, expect, it } from 'vitest';

import {
	canPersistCreatorBoardState,
	getCreatorBoardActionLogStorageKey,
	getCreatorBoardSnapshotStorageKey,
	persistCreatorBoardActionLog,
	persistCreatorBoardSnapshot,
	restoreCreatorBoardActionLog,
	restoreCreatorBoardSnapshot,
	restoreCreatorBoardState,
	CreatorBoardStorageError
} from './board-persistence.svelte.js';
import type { BoardActionLogEntry } from './board-store.svelte.js';
import type { LocalBoardSnapshot } from './board-store.svelte.js';

function createSnapshot(): LocalBoardSnapshot {
	return {
		snapshotVersion: 3,
		actionCursor: 12,
		boardState: {
			elements: [
				{
					id: 'shape_1',
					kind: 'shape',
					created_by: 'actor_1',
					created_at: '2026-03-26T10:30:00.000Z',
					updated_at: '2026-03-26T10:30:00.000Z',
					shape: 'rectangle',
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
		}
	};
}

function createActionLog(): BoardActionLogEntry[] {
	return [
		{
			action: {
				action_id: 'action_1',
				client_sequence: 1,
				action_kind: 'viewport.update',
				data: {
					viewport: {
						x: 24,
						y: 36,
						zoom: 1.5
					}
				}
			},
			receivedAt: '2026-03-26T10:32:00.000Z'
		}
	];
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

describe('creator board snapshot persistence', () => {
	it('only allows creator sessions to persist board state', () => {
		expect(canPersistCreatorBoardState('owner')).toBe(true);
		expect(canPersistCreatorBoardState('guest')).toBe(false);
		expect(canPersistCreatorBoardState(null)).toBe(false);
	});

	it('builds a stable storage key from the board id', () => {
		expect(getCreatorBoardSnapshotStorageKey(' board_1 ')).toBe('whiteboard:creator-snapshot:board_1');
	});

	it('persists snapshots to the provided storage in browser mode', () => {
		const written: Array<{ key: string; value: string }> = [];
		const snapshot = createSnapshot();

		const didPersist = persistCreatorBoardSnapshot('board_1', snapshot, {
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
				value: JSON.stringify(snapshot)
			}
		]);
	});

	it('skips local storage when running outside the browser', () => {
		const written: Array<{ key: string; value: string }> = [];

		const didPersist = persistCreatorBoardSnapshot('board_1', createSnapshot(), {
			role: 'owner',
			isBrowser: false,
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

	it('skips local storage for guest creator snapshots', () => {
		const written: Array<{ key: string; value: string }> = [];

		const didPersist = persistCreatorBoardSnapshot('board_1', createSnapshot(), {
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
});

describe('creator board action log persistence', () => {
	it('builds a stable storage key from the board id', () => {
		expect(getCreatorBoardActionLogStorageKey(' board_1 ')).toBe(
			'whiteboard:creator-action-log:board_1'
		);
	});

	it('persists action logs to the provided storage in browser mode', () => {
		const written: Array<{ key: string; value: string }> = [];
		const actionLog = createActionLog();

		const didPersist = persistCreatorBoardActionLog('board_1', actionLog, {
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
				value: JSON.stringify(actionLog)
			}
		]);
	});

	it('skips local storage when running outside the browser', () => {
		const written: Array<{ key: string; value: string }> = [];

		const didPersist = persistCreatorBoardActionLog('board_1', createActionLog(), {
			role: 'owner',
			isBrowser: false,
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

	it('skips local storage for guest creator action logs', () => {
		const written: Array<{ key: string; value: string }> = [];

		const didPersist = persistCreatorBoardActionLog('board_1', createActionLog(), {
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
});

describe('creator board restore', () => {
	it('restores snapshot and action log payloads from storage', () => {
		const snapshot = createSnapshot();
		const actionLog = createActionLog();
		const storage = createStorage({
			[getCreatorBoardSnapshotStorageKey('board_1')]: JSON.stringify(snapshot),
			[getCreatorBoardActionLogStorageKey('board_1')]: JSON.stringify(actionLog)
		});

		expect(restoreCreatorBoardSnapshot('board_1', { isBrowser: true, storage })).toEqual(snapshot);
		expect(restoreCreatorBoardActionLog('board_1', { isBrowser: true, storage })).toEqual(actionLog);
		expect(restoreCreatorBoardState('board_1', { isBrowser: true, storage })).toEqual({
			snapshot,
			actionLog
		});
	});

	it('returns an empty restore result when storage is missing', () => {
		const storage = createStorage();

		expect(restoreCreatorBoardSnapshot('board_1', { isBrowser: true, storage })).toBeNull();
		expect(restoreCreatorBoardActionLog('board_1', { isBrowser: true, storage })).toEqual([]);
		expect(restoreCreatorBoardState('board_1', { isBrowser: true, storage })).toEqual({
			snapshot: null,
			actionLog: []
		});
	});

	it('rejects malformed stored payloads', () => {
		const storage = createStorage({
			[getCreatorBoardSnapshotStorageKey('board_1')]: 'not json'
		});

		expect(() => restoreCreatorBoardSnapshot('board_1', { isBrowser: true, storage })).toThrow(
			CreatorBoardStorageError
		);
	});
});
