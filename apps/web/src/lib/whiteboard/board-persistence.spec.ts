import { describe, expect, it } from 'vitest';

import {
	getCreatorBoardActionLogStorageKey,
	getCreatorBoardSnapshotStorageKey,
	persistCreatorBoardActionLog,
	persistCreatorBoardSnapshot
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

describe('creator board snapshot persistence', () => {
	it('builds a stable storage key from the board id', () => {
		expect(getCreatorBoardSnapshotStorageKey(' board_1 ')).toBe('whiteboard:creator-snapshot:board_1');
	});

	it('persists snapshots to the provided storage in browser mode', () => {
		const written: Array<{ key: string; value: string }> = [];
		const snapshot = createSnapshot();

		const didPersist = persistCreatorBoardSnapshot('board_1', snapshot, {
			isBrowser: true,
			storage: {
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
			isBrowser: false,
			storage: {
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
			isBrowser: true,
			storage: {
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
			isBrowser: false,
			storage: {
				setItem(key, value) {
					written.push({ key, value });
				}
			}
		});

		expect(didPersist).toBe(false);
		expect(written).toEqual([]);
	});
});
