import type {
	BoardActionKind,
	BoardActionPayload,
	BoardSnapshotPayload,
	BoardState,
	ISODateTimeString
} from './types.js';
import { importBoardSnapshotFromJson } from './board-json.js';
import {
	persistCreatorBoardActionLog,
	persistCreatorBoardSnapshot,
	restoreCreatorBoardState,
	type PersistCreatorBoardActionLogOptions,
	type PersistCreatorBoardSnapshotOptions
} from './board-persistence.svelte.js';

export interface LocalBoardSnapshot {
	snapshotVersion: number;
	actionCursor: number;
	boardState: BoardState;
}

export interface BoardActionLogEntry<TKind extends BoardActionKind = BoardActionKind> {
	action: BoardActionPayload<TKind>;
	receivedAt: ISODateTimeString;
}

function createEmptyBoardState(): BoardState {
	return {
		elements: [],
		viewport: {
			x: 0,
			y: 0,
			zoom: 1
		}
	};
}

function cloneSerializable<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

function toIsoString(value: Date | ISODateTimeString): ISODateTimeString {
	return typeof value === 'string' ? value : value.toISOString();
}

function isProtocolSnapshot(snapshot: LocalBoardSnapshot | BoardSnapshotPayload): snapshot is BoardSnapshotPayload {
	return 'snapshot_version' in snapshot;
}

function normalizeSnapshot(snapshot: LocalBoardSnapshot | BoardSnapshotPayload): LocalBoardSnapshot {
	if (isProtocolSnapshot(snapshot)) {
		return {
			snapshotVersion: snapshot.snapshot_version,
			actionCursor: snapshot.action_cursor,
			boardState: cloneSerializable(snapshot.board_state)
		};
	}

	return {
		snapshotVersion: snapshot.snapshotVersion,
		actionCursor: snapshot.actionCursor,
		boardState: cloneSerializable(snapshot.boardState)
	};
}

function normalizeActionEntry<TKind extends BoardActionKind>(
	entry: BoardActionLogEntry<TKind>
): BoardActionLogEntry<TKind> {
	return {
		action: cloneSerializable(entry.action),
		receivedAt: entry.receivedAt
	};
}

export class LocalBoardStore {
	snapshotVersion = $state(0);
	actionCursor = $state(0);
	boardState = $state<BoardState>(createEmptyBoardState());
	actionLog = $state<BoardActionLogEntry[]>([]);

	get hasSnapshot() {
		return this.snapshotVersion > 0;
	}

	get actionCount() {
		return this.actionLog.length;
	}

	getSnapshot(): LocalBoardSnapshot {
		return {
			snapshotVersion: this.snapshotVersion,
			actionCursor: this.actionCursor,
			boardState: cloneSerializable(this.boardState)
		};
	}

	replaceSnapshot(snapshot: LocalBoardSnapshot | BoardSnapshotPayload) {
		const normalized = normalizeSnapshot(snapshot);
		this.snapshotVersion = normalized.snapshotVersion;
		this.actionCursor = normalized.actionCursor;
		this.boardState = normalized.boardState;
		this.actionLog = [];
	}

	loadSnapshot(snapshot: LocalBoardSnapshot | BoardSnapshotPayload) {
		this.replaceSnapshot(snapshot);
	}

	importFromJson(jsonText: string) {
		const snapshot = importBoardSnapshotFromJson(jsonText);
		this.replaceSnapshot(snapshot);
		return snapshot;
	}

	persistCreatorSnapshot(
		boardId: string,
		options: PersistCreatorBoardSnapshotOptions = {}
	) {
		return persistCreatorBoardSnapshot(boardId, this.getSnapshot(), options);
	}

	persistCreatorActionLog(
		boardId: string,
		options: PersistCreatorBoardActionLogOptions = {}
	) {
		return persistCreatorBoardActionLog(boardId, this.actionLog, options);
	}

	persistCreatorBoardState(
		boardId: string,
		options: PersistCreatorBoardSnapshotOptions & PersistCreatorBoardActionLogOptions = {}
	) {
		const didPersistSnapshot = this.persistCreatorSnapshot(boardId, options);
		const didPersistActionLog = this.persistCreatorActionLog(boardId, options);
		return didPersistSnapshot || didPersistActionLog;
	}

	restoreCreatorBoard(
		boardId: string,
		options: PersistCreatorBoardSnapshotOptions & PersistCreatorBoardActionLogOptions = {}
	) {
		const restoredState = restoreCreatorBoardState(boardId, options);
		if (restoredState.snapshot === null) {
			return false;
		}

		this.replaceSnapshot(restoredState.snapshot);
		this.actionLog = restoredState.actionLog;
		return true;
	}

	appendAction<TKind extends BoardActionKind>(
		action: BoardActionPayload<TKind>,
		receivedAt: Date | ISODateTimeString = new Date()
	) {
		return this.appendActionLog({
			action,
			receivedAt: toIsoString(receivedAt)
		});
	}

	appendActionLog<TKind extends BoardActionKind>(entry: BoardActionLogEntry<TKind>) {
		if (this.actionLog.some((existingEntry) => existingEntry.action.action_id === entry.action.action_id)) {
			return false;
		}

		this.actionLog = [...this.actionLog, normalizeActionEntry(entry)];
		return true;
	}

	clear() {
		this.snapshotVersion = 0;
		this.actionCursor = 0;
		this.boardState = createEmptyBoardState();
		this.actionLog = [];
	}
}

export const localBoardStore = new LocalBoardStore();
