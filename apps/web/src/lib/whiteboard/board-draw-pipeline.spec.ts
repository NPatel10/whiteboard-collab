import { describe, expect, it } from 'vitest';

import { BoardActionIdentityStore } from './action-identity.svelte.js';
import { StrokeDrawPipeline } from './board-draw-pipeline.svelte.js';
import { LocalBoardStore } from './board-store.svelte.js';

function createActionIdFactory() {
	const ids = ['action_1', 'action_2', 'action_3', 'action_4'];

	return () => {
		const nextId = ids.shift();
		if (!nextId) {
			throw new Error('expected another action id');
		}

		return nextId;
	};
}

describe('StrokeDrawPipeline', () => {
	it('batches stroke append actions while keeping board state current', () => {
		const store = new LocalBoardStore();
		const pipeline = new StrokeDrawPipeline(store, {
			createdByActorId: 'actor_1',
			createObjectId: () => 'stroke_1',
			identityStore: new BoardActionIdentityStore({ actionIdFactory: createActionIdFactory() }),
			batchSize: 3
		});

		expect(
			pipeline.beginStroke(
				{
					point: { x: 12, y: 18, pressure: 0.4 },
					stroke: '#0f172a',
					strokeWidth: 4
				},
				'2026-03-26T10:30:00.000Z'
			)
		).toBe('stroke_1');

		expect(store.boardState.elements).toHaveLength(1);
		expect(store.actionLog.map((entry) => entry.action.action_kind)).toEqual(['stroke.begin']);

		expect(pipeline.appendPoint({ x: 24, y: 30, pressure: 0.45 }, '2026-03-26T10:31:00.000Z')).toBe(true);
		expect(pipeline.appendPoint({ x: 36, y: 42, pressure: 0.5 }, '2026-03-26T10:32:00.000Z')).toBe(true);
		expect(pipeline.appendPoint({ x: 48, y: 54, pressure: 0.55 }, '2026-03-26T10:33:00.000Z')).toBe(true);
		expect(pipeline.pendingPointCount).toBe(0);
		expect(store.actionLog.map((entry) => entry.action.action_kind)).toEqual([
			'stroke.begin',
			'stroke.append'
		]);

		expect(pipeline.appendPoint({ x: 60, y: 66, pressure: 0.6 }, '2026-03-26T10:34:00.000Z')).toBe(true);
		expect(pipeline.endStroke('2026-03-26T10:35:00.000Z')).toBe(true);
		expect(pipeline.activeStrokeId).toBeNull();
		expect(store.boardState.elements[0]).toMatchObject({
			id: 'stroke_1',
			kind: 'stroke',
			created_by: 'actor_1',
			stroke: '#0f172a',
			stroke_width: 4,
			points: [
				{ x: 12, y: 18, pressure: 0.4 },
				{ x: 24, y: 30, pressure: 0.45 },
				{ x: 36, y: 42, pressure: 0.5 },
				{ x: 48, y: 54, pressure: 0.55 },
				{ x: 60, y: 66, pressure: 0.6 }
			]
		});
		expect(store.actionLog.map((entry) => entry.action.action_kind)).toEqual([
			'stroke.begin',
			'stroke.append',
			'stroke.append',
			'stroke.end'
		]);
		expect(store.actionLog[1].action.data).toMatchObject({
			object_id: 'stroke_1',
			points: [
				{ x: 24, y: 30, pressure: 0.45 },
				{ x: 36, y: 42, pressure: 0.5 },
				{ x: 48, y: 54, pressure: 0.55 }
			]
		});
		expect(store.actionLog[2].action.data).toMatchObject({
			object_id: 'stroke_1',
			points: [{ x: 60, y: 66, pressure: 0.6 }]
		});
		expect(store.actionCursor).toBe(4);
		expect(store.canUndo).toBe(true);
		expect(store.undoDepth).toBe(1);
	});

	it('ignores attempts to append or end without an active stroke', () => {
		const store = new LocalBoardStore();
		const pipeline = new StrokeDrawPipeline(store, {
			createdByActorId: 'actor_1',
			createObjectId: () => 'stroke_1',
			identityStore: new BoardActionIdentityStore({ actionIdFactory: createActionIdFactory() })
		});

		expect(pipeline.appendPoint({ x: 10, y: 12 })).toBe(false);
		expect(pipeline.flushPendingPoints()).toBe(false);
		expect(pipeline.endStroke()).toBe(false);
		expect(store.boardState.elements).toEqual([]);
		expect(store.actionLog).toEqual([]);
	});
});
