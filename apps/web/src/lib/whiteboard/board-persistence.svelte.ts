import { browser } from '$app/environment';

import type { BoardActionLogEntry } from './board-store.svelte.js';
import type { LocalBoardSnapshot } from './board-store.svelte.js';
import type { BoardActionPayload, ParticipantRole, Viewport } from './types.js';

const creatorSnapshotStoragePrefix = 'whiteboard:creator-snapshot';
const creatorActionLogStoragePrefix = 'whiteboard:creator-action-log';

export interface CreatorBoardStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface PersistCreatorBoardSnapshotOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardStorage;
	role?: ParticipantRole | null;
}

export interface PersistCreatorBoardActionLogOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardStorage;
	role?: ParticipantRole | null;
}

export interface RestoreCreatorBoardSnapshotOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardStorage;
}

export interface RestoreCreatorBoardActionLogOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardStorage;
}

export interface RestoreCreatorBoardStateResult {
	snapshot: LocalBoardSnapshot | null;
	actionLog: BoardActionLogEntry[];
}

export class CreatorBoardStorageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CreatorBoardStorageError';
	}
}

export function canPersistCreatorBoardState(role: ParticipantRole | null | undefined) {
	return role === 'owner';
}

export function getCreatorBoardSnapshotStorageKey(boardId: string) {
	const normalizedBoardId = boardId.trim();
	if (normalizedBoardId === '') {
		throw new Error('board id is required');
	}

	return `${creatorSnapshotStoragePrefix}:${normalizedBoardId}`;
}

export function persistCreatorBoardSnapshot(
	boardId: string,
	snapshot: LocalBoardSnapshot,
	options: PersistCreatorBoardSnapshotOptions = {}
) {
	const canUseStorage = (options.isBrowser ?? browser) && canPersistCreatorBoardState(options.role);
	if (!canUseStorage) {
		return false;
	}

	const storage = options.storage ?? window.localStorage;
	const storageKey = getCreatorBoardSnapshotStorageKey(boardId);
	storage.setItem(storageKey, JSON.stringify(snapshot));
	return true;
}

export function getCreatorBoardActionLogStorageKey(boardId: string) {
	const normalizedBoardId = boardId.trim();
	if (normalizedBoardId === '') {
		throw new Error('board id is required');
	}

	return `${creatorActionLogStoragePrefix}:${normalizedBoardId}`;
}

export function persistCreatorBoardActionLog(
	boardId: string,
	actionLog: BoardActionLogEntry[],
	options: PersistCreatorBoardActionLogOptions = {}
) {
	const canUseStorage = (options.isBrowser ?? browser) && canPersistCreatorBoardState(options.role);
	if (!canUseStorage) {
		return false;
	}

	const storage = options.storage ?? window.localStorage;
	const storageKey = getCreatorBoardActionLogStorageKey(boardId);
	storage.setItem(storageKey, JSON.stringify(actionLog));
	return true;
}

export function restoreCreatorBoardSnapshot(
	boardId: string,
	options: RestoreCreatorBoardSnapshotOptions = {}
) {
	const canUseStorage = options.isBrowser ?? browser;
	if (!canUseStorage) {
		return null;
	}

	const storage = options.storage ?? window.localStorage;
	const storageKey = getCreatorBoardSnapshotStorageKey(boardId);
	const rawSnapshot = storage.getItem(storageKey);
	if (rawSnapshot === null) {
		return null;
	}

	return normalizeStoredSnapshot(parseStoredValue(rawSnapshot, 'creator board snapshot'));
}

export function restoreCreatorBoardActionLog(
	boardId: string,
	options: RestoreCreatorBoardActionLogOptions = {}
) {
	const canUseStorage = options.isBrowser ?? browser;
	if (!canUseStorage) {
		return [];
	}

	const storage = options.storage ?? window.localStorage;
	const storageKey = getCreatorBoardActionLogStorageKey(boardId);
	const rawActionLog = storage.getItem(storageKey);
	if (rawActionLog === null) {
		return [];
	}

	return normalizeStoredActionLog(parseStoredValue(rawActionLog, 'creator board action log'));
}

export function restoreCreatorBoardState(
	boardId: string,
	options: RestoreCreatorBoardSnapshotOptions & RestoreCreatorBoardActionLogOptions = {}
): RestoreCreatorBoardStateResult {
	return {
		snapshot: restoreCreatorBoardSnapshot(boardId, options),
		actionLog: restoreCreatorBoardActionLog(boardId, options)
	};
}

function normalizeStoredSnapshot(value: unknown): LocalBoardSnapshot {
	if (!isRecord(value)) {
		throw new CreatorBoardStorageError('creator board snapshot must be a JSON object');
	}

	const snapshotVersion = readInteger(value, 'snapshotVersion', 'snapshotVersion', 1);
	const actionCursor = readInteger(value, 'actionCursor', 'actionCursor', 0);
	const boardState = value.boardState;

	if (!isRecord(boardState)) {
		throw new CreatorBoardStorageError('creator board snapshot boardState must be an object');
	}

	return {
		snapshotVersion,
		actionCursor,
		boardState: {
			elements: readArray(boardState.elements, 'boardState.elements') as LocalBoardSnapshot['boardState']['elements'],
			viewport: readViewport(boardState.viewport)
		}
	};
}

function normalizeStoredActionLog(value: unknown): BoardActionLogEntry[] {
	if (!Array.isArray(value)) {
		throw new CreatorBoardStorageError('creator board action log must be a JSON array');
	}

	return value.map((entry, index) => normalizeStoredActionLogEntry(entry, index));
}

function normalizeStoredActionLogEntry(value: unknown, index: number): BoardActionLogEntry {
	if (!isRecord(value)) {
		throw new CreatorBoardStorageError(`creator board action log entry ${index} must be an object`);
	}

	const action = value.action;
	const receivedAt = value.receivedAt;

	if (!isRecord(action)) {
		throw new CreatorBoardStorageError(`creator board action log entry ${index} action must be an object`);
	}

	if (typeof receivedAt !== 'string' || receivedAt.trim() === '') {
		throw new CreatorBoardStorageError(
			`creator board action log entry ${index} receivedAt must be a string`
		);
	}

	return {
		action: action as unknown as BoardActionPayload,
		receivedAt
	};
}

function parseStoredValue(rawValue: string, label: string) {
	try {
		return JSON.parse(rawValue) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown parse failure';
		throw new CreatorBoardStorageError(`invalid ${label}: ${message}`);
	}
}

function readInteger(
	value: Record<string, unknown>,
	key: string,
	path: string,
	fallback: number
) {
	const rawValue = value[key];
	if (rawValue === undefined) {
		return fallback;
	}

	if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 0) {
		throw new CreatorBoardStorageError(`${path} must be a non-negative integer`);
	}

	return rawValue;
}

function readArray(value: unknown, path: string) {
	if (!Array.isArray(value)) {
		throw new CreatorBoardStorageError(`${path} must be an array`);
	}

	return value;
}

function readRecord(value: unknown, path: string) {
	if (!isRecord(value)) {
		throw new CreatorBoardStorageError(`${path} must be an object`);
	}

	return value;
}

function readViewport(value: unknown): Viewport {
	const viewport = readRecord(value, 'boardState.viewport');

	return {
		x: readNumber(viewport, 'x', 'boardState.viewport.x'),
		y: readNumber(viewport, 'y', 'boardState.viewport.y'),
		zoom: readNumber(viewport, 'zoom', 'boardState.viewport.zoom')
	};
}

function readNumber(value: Record<string, unknown>, key: string, path: string) {
	const rawValue = value[key];
	if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
		throw new CreatorBoardStorageError(`${path} must be a finite number`);
	}

	return rawValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
