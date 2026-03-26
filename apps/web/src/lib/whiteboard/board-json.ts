import type {
	BoardElement,
	BoardSnapshotPayload,
	BoardState,
	Point,
	ShapeKind,
	StrokeElement,
	StrokePoint,
	TextElement,
	Viewport
} from './types.js';

import type { LocalBoardSnapshot } from './board-store.svelte.js';

const supportedShapeKinds: ShapeKind[] = ['rectangle', 'ellipse', 'diamond', 'line', 'arrow'];
const supportedTextAlignments: TextElement['align'][] = ['left', 'center', 'right'];

export class BoardJsonImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BoardJsonImportError';
	}
}

export function importBoardSnapshotFromJson(jsonText: string): LocalBoardSnapshot {
	const payload = parseBoardJson(jsonText);
	return normalizeImportedSnapshot(payload);
}

export function importBoardStateFromJson(jsonText: string): BoardState {
	return importBoardSnapshotFromJson(jsonText).boardState;
}

function parseBoardJson(jsonText: string): unknown {
	try {
		return JSON.parse(jsonText);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown parse failure';
		throw new BoardJsonImportError(`Invalid JSON: ${message}`);
	}
}

function normalizeImportedSnapshot(payload: unknown): LocalBoardSnapshot {
	if (!isRecord(payload)) {
		throw new BoardJsonImportError('Unsupported board import payload: expected a JSON object');
	}

	if (hasBoardState(payload)) {
		return {
			snapshotVersion: readSnapshotVersion(payload),
			actionCursor: readActionCursor(payload),
			boardState: readBoardState(readRecordPayload(payload, 'board_state', 'boardState'))
		};
	}

	if (hasBoardStateShape(payload)) {
		return {
			snapshotVersion: 1,
			actionCursor: 0,
			boardState: readBoardState(payload)
		};
	}

	throw new BoardJsonImportError(
		'Unsupported board import payload: expected board_state or elements/viewport properties'
	);
}

function readBoardState(value: unknown): BoardState {
	const boardState = readRecord(value, 'board_state');
	return {
		elements: readBoardElements(readRecordPayload(boardState, 'elements')),
		viewport: readViewport(readRecordPayload(boardState, 'viewport'))
	};
}

function readBoardElements(value: unknown): BoardElement[] {
	const elements = readArray(value, 'board_state.elements');
	return elements.map((element, index) => readBoardElement(element, `board_state.elements[${index}]`));
}

function readBoardElement(value: unknown, path: string): BoardElement {
	const element = readRecord(value, path);
	const kind = readString(element, 'kind', `${path}.kind`);
	const baseElement = {
		id: readString(element, 'id', `${path}.id`),
		kind,
		created_by: readString(element, 'created_by', `${path}.created_by`),
		created_at: readString(element, 'created_at', `${path}.created_at`),
		updated_at: readString(element, 'updated_at', `${path}.updated_at`)
	};

	switch (kind) {
		case 'stroke':
			return {
				...baseElement,
				kind,
				stroke: readString(element, 'stroke', `${path}.stroke`),
				stroke_width: readNumber(element, 'stroke_width', `${path}.stroke_width`),
				points: readStrokePoints(readRecordPayload(element, 'points'), `${path}.points`)
			};
		case 'shape':
			return {
				...baseElement,
				kind,
				shape: readShapeKind(element, `${path}.shape`),
				x: readNumber(element, 'x', `${path}.x`),
				y: readNumber(element, 'y', `${path}.y`),
				width: readNumber(element, 'width', `${path}.width`),
				height: readNumber(element, 'height', `${path}.height`),
				rotation: readNumber(element, 'rotation', `${path}.rotation`),
				stroke: readString(element, 'stroke', `${path}.stroke`),
				fill: readString(element, 'fill', `${path}.fill`),
				stroke_width: readNumber(element, 'stroke_width', `${path}.stroke_width`)
			};
		case 'text':
			return {
				...baseElement,
				kind,
				x: readNumber(element, 'x', `${path}.x`),
				y: readNumber(element, 'y', `${path}.y`),
				width: readNumber(element, 'width', `${path}.width`),
				height: readNumber(element, 'height', `${path}.height`),
				text: readString(element, 'text', `${path}.text`, true),
				font_size: readNumber(element, 'font_size', `${path}.font_size`),
				color: readString(element, 'color', `${path}.color`),
				align: readTextAlignment(element, `${path}.align`)
			};
		case 'sticky':
			return {
				...baseElement,
				kind,
				x: readNumber(element, 'x', `${path}.x`),
				y: readNumber(element, 'y', `${path}.y`),
				width: readNumber(element, 'width', `${path}.width`),
				height: readNumber(element, 'height', `${path}.height`),
				text: readString(element, 'text', `${path}.text`, true),
				background: readString(element, 'background', `${path}.background`),
				color: readString(element, 'color', `${path}.color`)
			};
		default:
			throw new BoardJsonImportError(`Unsupported board element kind at ${path}: ${kind}`);
	}
}

function readStrokePoints(value: unknown, path: string): StrokePoint[] {
	const points = readArray(value, path);
	return points.map((point, index) => readStrokePoint(point, `${path}[${index}]`));
}

function readStrokePoint(value: unknown, path: string): StrokePoint {
	const point = readRecord(value, path);
	return {
		x: readNumber(point, 'x', `${path}.x`),
		y: readNumber(point, 'y', `${path}.y`),
		pressure: readOptionalNumber(point, 'pressure', `${path}.pressure`)
	};
}

function readViewport(value: unknown): Viewport {
	const viewport = readRecord(value, 'board_state.viewport');
	return {
		x: readNumber(viewport, 'x', 'board_state.viewport.x'),
		y: readNumber(viewport, 'y', 'board_state.viewport.y'),
		zoom: readNumber(viewport, 'zoom', 'board_state.viewport.zoom')
	};
}

function readShapeKind(value: Record<string, unknown>, path: string): ShapeKind {
	const shape = readString(value, 'shape', path);
	if (!supportedShapeKinds.includes(shape as ShapeKind)) {
		throw new BoardJsonImportError(`Unsupported shape kind at ${path}: ${shape}`);
	}

	return shape as ShapeKind;
}

function readTextAlignment(value: Record<string, unknown>, path: string): TextElement['align'] {
	const align = readString(value, 'align', path);
	if (!supportedTextAlignments.includes(align as TextElement['align'])) {
		throw new BoardJsonImportError(`Unsupported text alignment at ${path}: ${align}`);
	}

	return align as TextElement['align'];
}

function readSnapshotVersion(value: Record<string, unknown>): number {
	const snapshotVersion =
		readOptionalNumber(value, 'snapshot_version', 'snapshot_version') ??
		readOptionalNumber(value, 'snapshotVersion', 'snapshotVersion') ??
		1;

	if (!Number.isInteger(snapshotVersion) || snapshotVersion <= 0) {
		throw new BoardJsonImportError('snapshot_version must be a positive integer');
	}

	return snapshotVersion;
}

function readActionCursor(value: Record<string, unknown>): number {
	const actionCursor =
		readOptionalNumber(value, 'action_cursor', 'action_cursor') ??
		readOptionalNumber(value, 'actionCursor', 'actionCursor') ??
		0;

	if (!Number.isInteger(actionCursor) || actionCursor < 0) {
		throw new BoardJsonImportError('action_cursor must be a non-negative integer');
	}

	return actionCursor;
}

function hasBoardState(value: Record<string, unknown>) {
	return 'board_state' in value || 'boardState' in value;
}

function hasBoardStateShape(value: Record<string, unknown>) {
	return 'elements' in value && 'viewport' in value;
}

function readRecordPayload(value: Record<string, unknown>, key: string, alternateKey?: string) {
	if (key in value) {
		return value[key];
	}

	if (alternateKey && alternateKey in value) {
		return value[alternateKey];
	}

	throw new BoardJsonImportError(`Missing required property: ${alternateKey ?? key}`);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new BoardJsonImportError(`${path} must be an object`);
	}

	return value;
}

function readArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new BoardJsonImportError(`${path} must be an array`);
	}

	return value;
}

function readString(
	value: Record<string, unknown>,
	key: string,
	path: string,
	allowEmpty = false
): string {
	const fieldValue = value[key];
	if (typeof fieldValue !== 'string' || (!allowEmpty && fieldValue.trim() === '')) {
		throw new BoardJsonImportError(`${path} must be a string${allowEmpty ? '' : ' with content'}`);
	}

	return fieldValue;
}

function readNumber(value: Record<string, unknown>, key: string, path: string): number {
	const fieldValue = value[key];
	if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
		throw new BoardJsonImportError(`${path} must be a finite number`);
	}

	return fieldValue;
}

function readOptionalNumber(value: Record<string, unknown>, key: string, path: string): number | undefined {
	if (!(key in value)) {
		return undefined;
	}

	const fieldValue = value[key];
	if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
		throw new BoardJsonImportError(`${path} must be a finite number`);
	}

	return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
