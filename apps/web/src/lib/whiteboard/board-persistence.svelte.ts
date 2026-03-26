import { browser } from '$app/environment';

import type { BoardActionLogEntry } from './board-store.svelte.js';
import type { LocalBoardSnapshot } from './board-store.svelte.js';

const creatorSnapshotStoragePrefix = 'whiteboard:creator-snapshot';
const creatorActionLogStoragePrefix = 'whiteboard:creator-action-log';

export interface CreatorBoardSnapshotStorage {
	setItem(key: string, value: string): void;
}

export interface PersistCreatorBoardSnapshotOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardSnapshotStorage;
}

export interface PersistCreatorBoardActionLogOptions {
	isBrowser?: boolean;
	storage?: CreatorBoardSnapshotStorage;
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
	const canUseStorage = options.isBrowser ?? browser;
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
	const canUseStorage = options.isBrowser ?? browser;
	if (!canUseStorage) {
		return false;
	}

	const storage = options.storage ?? window.localStorage;
	const storageKey = getCreatorBoardActionLogStorageKey(boardId);
	storage.setItem(storageKey, JSON.stringify(actionLog));
	return true;
}
