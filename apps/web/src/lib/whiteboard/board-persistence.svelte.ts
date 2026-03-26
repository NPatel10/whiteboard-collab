import { browser } from '$app/environment';

import type { LocalBoardSnapshot } from './board-store.svelte.js';

const creatorSnapshotStoragePrefix = 'whiteboard:creator-snapshot';

export interface CreatorBoardSnapshotStorage {
	setItem(key: string, value: string): void;
}

export interface PersistCreatorBoardSnapshotOptions {
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
