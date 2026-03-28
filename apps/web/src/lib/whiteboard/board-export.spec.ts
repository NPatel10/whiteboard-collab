import { describe, expect, it } from 'vitest';

import { exportBoardSnapshotToPng, exportBoardSnapshotToJson, exportBoardStateToJson, exportBoardStateToPng, buildBoardExportScene } from './board-export.js';
import type { LocalBoardSnapshot } from './board-store.svelte.js';
import type { BoardPngRenderRequest } from './board-export.js';
import type { BoardState } from './types.js';

const boardState: BoardState = {
	elements: [
		{
			id: 'stroke_1',
			kind: 'stroke',
			created_by: 'actor_1',
			created_at: '2026-03-26T10:00:00.000Z',
			updated_at: '2026-03-26T10:00:01.000Z',
			stroke: '#111827',
			stroke_width: 8,
			points: [
				{ x: 10, y: 20 },
				{ x: 40, y: 60 }
			]
		},
		{
			id: 'shape_1',
			kind: 'shape',
			created_by: 'actor_2',
			created_at: '2026-03-26T10:01:00.000Z',
			updated_at: '2026-03-26T10:01:30.000Z',
			shape: 'rectangle',
			x: 100,
			y: 120,
			width: 50,
			height: 30,
			rotation: 0,
			stroke: '#0f172a',
			fill: '#fef3c7',
			stroke_width: 2
		},
		{
			id: 'text_1',
			kind: 'text',
			created_by: 'actor_3',
			created_at: '2026-03-26T10:02:00.000Z',
			updated_at: '2026-03-26T10:02:30.000Z',
			x: 200,
			y: 80,
			width: 70,
			height: 40,
			text: 'Export me',
			font_size: 24,
			color: '#1f2937',
			align: 'center'
		},
		{
			id: 'sticky_1',
			kind: 'sticky',
			created_by: 'actor_4',
			created_at: '2026-03-26T10:03:00.000Z',
			updated_at: '2026-03-26T10:03:30.000Z',
			x: -40,
			y: -10,
			width: 30,
			height: 20,
			text: 'Note',
			background: '#fde68a',
			color: '#111827'
		}
	],
	viewport: {
		x: 0,
		y: 0,
		zoom: 1
	}
};

const snapshot: LocalBoardSnapshot = {
	snapshotVersion: 12,
	actionCursor: 33,
	boardState
};

describe('board export', () => {
	it('exports json for board states and snapshots', () => {
		expect(JSON.parse(exportBoardStateToJson(boardState, { pretty: false }))).toEqual(boardState);
		expect(JSON.parse(exportBoardSnapshotToJson(snapshot, { pretty: false }))).toEqual(snapshot);
	});

	it('builds a png scene and forwards it to the renderer', async () => {
		const exportOptions = {
			minimumWidth: 1,
			minimumHeight: 1
		};
		const scene = buildBoardExportScene(boardState, exportOptions);
		expect(scene).toEqual({
			backgroundColor: '#ffffff',
			width: 406,
			height: 256,
			offsetX: 88,
			offsetY: 58,
			elements: [
				{
					kind: 'stroke',
					points: [10, 20, 40, 60],
					stroke: '#111827',
					strokeWidth: 8
				},
				{
					kind: 'shape',
					shape: 'rectangle',
					x: 100,
					y: 120,
					width: 50,
					height: 30,
					rotation: 0,
					stroke: '#0f172a',
					fill: '#fef3c7',
					strokeWidth: 2
				},
				{
					kind: 'text',
					x: 200,
					y: 80,
					width: 70,
					height: 40,
					text: 'Export me',
					fontSize: 24,
					color: '#1f2937',
					align: 'center'
				},
				{
					kind: 'sticky',
					x: -40,
					y: -10,
					width: 30,
					height: 20,
					text: 'Note',
					background: '#fde68a',
					color: '#111827'
				}
			]
		});

		const renderRequests: BoardPngRenderRequest[] = [];
		const renderer = {
			render(request: BoardPngRenderRequest) {
				renderRequests.push(request);
				return 'data:image/png;base64,exported-board';
			}
		};

		await expect(exportBoardStateToPng(boardState, { ...exportOptions, renderer })).resolves.toBe(
			'data:image/png;base64,exported-board'
		);
		await expect(exportBoardSnapshotToPng(snapshot, { ...exportOptions, renderer })).resolves.toBe(
			'data:image/png;base64,exported-board'
		);

		expect(renderRequests).toHaveLength(2);
		expect(renderRequests[0]).toEqual({
			scene,
			pixelRatio: 2
		});
		expect(renderRequests[1]).toEqual({
			scene,
			pixelRatio: 2
		});
	});
});
