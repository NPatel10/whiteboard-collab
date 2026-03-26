import { describe, expect, it } from 'vitest';

import {
	BoardJsonImportError,
	importBoardSnapshotFromJson,
	importBoardStateFromJson
} from './board-json.js';

describe('board json import', () => {
	it('imports a snapshot payload with snake_case properties', () => {
		const snapshot = importBoardSnapshotFromJson(
			JSON.stringify({
				snapshot_version: 9,
				action_cursor: 17,
				board_state: {
					elements: [
						{
							id: 'text_1',
							kind: 'text',
							created_by: 'actor_1',
							created_at: '2026-03-26T10:30:00.000Z',
							updated_at: '2026-03-26T10:31:00.000Z',
							x: 200,
							y: 160,
							width: 320,
							height: 120,
							text: 'Imported note',
							font_size: 24,
							color: '#111827',
							align: 'center'
						}
					],
					viewport: {
						x: 12,
						y: 18,
						zoom: 1.5
					}
				}
			})
		);

		expect(snapshot).toEqual({
			snapshotVersion: 9,
			actionCursor: 17,
			boardState: {
				elements: [
					{
						id: 'text_1',
						kind: 'text',
						created_by: 'actor_1',
						created_at: '2026-03-26T10:30:00.000Z',
						updated_at: '2026-03-26T10:31:00.000Z',
						x: 200,
						y: 160,
						width: 320,
						height: 120,
						text: 'Imported note',
						font_size: 24,
						color: '#111827',
						align: 'center'
					}
				],
				viewport: {
					x: 12,
					y: 18,
					zoom: 1.5
				}
			}
		});
	});

	it('imports a bare board state payload', () => {
		const boardState = importBoardStateFromJson(
			JSON.stringify({
				elements: [],
				viewport: {
					x: 0,
					y: 0,
					zoom: 1
				}
			})
		);

		expect(boardState).toEqual({
			elements: [],
			viewport: {
				x: 0,
				y: 0,
				zoom: 1
			}
		});
	});

	it('rejects invalid json and malformed shapes', () => {
		expect(() => importBoardSnapshotFromJson('not json')).toThrow(BoardJsonImportError);
		expect(() =>
			importBoardSnapshotFromJson(
				JSON.stringify({
					elements: [
						{
							id: 'broken',
							kind: 'shape',
							created_by: 'actor_1',
							created_at: '2026-03-26T10:30:00.000Z',
							updated_at: '2026-03-26T10:30:00.000Z',
							shape: 'triangle',
							x: 0,
							y: 0,
							width: 10,
							height: 10,
							rotation: 0,
							stroke: '#000000',
							fill: '#ffffff',
							stroke_width: 1
						}
					],
					viewport: {
						x: 0,
						y: 0,
						zoom: 1
					}
				})
			)
		).toThrow('Unsupported shape kind at board_state.elements[0].shape: triangle');
	});
});
