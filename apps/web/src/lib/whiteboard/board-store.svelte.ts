import type {
	BoardActionKind,
	BoardActionPayload,
	BoardElement,
	BoardSnapshotPayload,
	BoardState,
	ISODateTimeString,
	ActorId,
	ObjectId,
	SelectionUpdateActionData,
	StrokeAppendActionData,
	StrokeBeginActionData,
	StrokeEndActionData,
	StrokePoint,
	TransformUpdateActionData
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

export interface RestoreCreatorBoardResult {
	restoredFromStorage: boolean;
}

interface BoardEditorState {
	boardState: BoardState;
	selectedObjectIds: ObjectId[];
}

const defaultUndoHistoryLimit = 50;

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

function createEmptySelection() {
	return [] as ObjectId[];
}

function cloneEditorState(state: BoardEditorState): BoardEditorState {
	return {
		boardState: cloneSerializable(state.boardState),
		selectedObjectIds: [...state.selectedObjectIds]
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

function normalizeStrokePoint(point: StrokePoint): StrokePoint | null {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return null;
	}

	if (point.pressure !== undefined && !Number.isFinite(point.pressure)) {
		return null;
	}

	return {
		x: point.x,
		y: point.y,
		pressure: point.pressure
	};
}

function normalizeObjectIds(objectIds: readonly ObjectId[], elements: BoardElement[]) {
	const existingObjectIds = new Set(elements.map((element) => element.id));
	const seenObjectIds = new Set<string>();
	const normalizedObjectIds: ObjectId[] = [];

	for (const objectId of objectIds) {
		const normalizedObjectId = objectId.trim();
		if (
			normalizedObjectId === '' ||
			seenObjectIds.has(normalizedObjectId) ||
			!existingObjectIds.has(normalizedObjectId)
		) {
			continue;
		}

		seenObjectIds.add(normalizedObjectId);
		normalizedObjectIds.push(normalizedObjectId);
	}

	return normalizedObjectIds;
}

function transformBoardElement(
	element: BoardElement,
	patch: Omit<TransformUpdateActionData, 'object_id'>,
	updatedAt: ISODateTimeString
): BoardElement | null {
	switch (element.kind) {
		case 'shape':
			return {
				...element,
				x: patch.x,
				y: patch.y,
				width: patch.width ?? element.width,
				height: patch.height ?? element.height,
				rotation: patch.rotation ?? element.rotation,
				updated_at: updatedAt
			};
		case 'text':
			return {
				...element,
				x: patch.x,
				y: patch.y,
				width: patch.width ?? element.width,
				height: patch.height ?? element.height,
				updated_at: updatedAt
			};
		case 'sticky':
			return {
				...element,
				x: patch.x,
				y: patch.y,
				width: patch.width ?? element.width,
				height: patch.height ?? element.height,
				updated_at: updatedAt
			};
		default:
			return null;
	}
}

export class LocalBoardStore {
	snapshotVersion = $state(0);
	actionCursor = $state(0);
	boardState = $state<BoardState>(createEmptyBoardState());
	actionLog = $state<BoardActionLogEntry[]>([]);
	selectedObjectIds = $state<ObjectId[]>(createEmptySelection());
	#activeStrokeId: ObjectId | null = null;
	#undoStack: BoardEditorState[] = [];
	#redoStack: BoardEditorState[] = [];

	get hasSnapshot() {
		return this.snapshotVersion > 0;
	}

	get hasSelection() {
		return this.selectedObjectIds.length > 0;
	}

	get actionCount() {
		return this.actionLog.length;
	}

	get canUndo() {
		return this.#undoStack.length > 0;
	}

	get canRedo() {
		return this.#redoStack.length > 0;
	}

	get undoDepth() {
		return this.#undoStack.length;
	}

	get redoDepth() {
		return this.#redoStack.length;
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
		this.selectedObjectIds = createEmptySelection();
		this.#activeStrokeId = null;
		this.#clearHistory();
	}

	loadSnapshot(snapshot: LocalBoardSnapshot | BoardSnapshotPayload) {
		this.replaceSnapshot(snapshot);
	}

	importFromJson(jsonText: string) {
		const snapshot = importBoardSnapshotFromJson(jsonText);
		this.replaceSnapshot(snapshot);
		return snapshot;
	}

	updateSelection(objectIds: readonly ObjectId[]) {
		this.selectedObjectIds = normalizeObjectIds(objectIds, this.boardState.elements);
		return this.selectedObjectIds;
	}

	applySelectionUpdate(payload: SelectionUpdateActionData) {
		return this.updateSelection(payload.object_ids);
	}

	clearSelection() {
		this.selectedObjectIds = createEmptySelection();
	}

	beginStroke(
		payload: StrokeBeginActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString = new Date()
	) {
		const objectId = payload.object_id.trim();
		const createdById = createdBy.trim();
		const normalizedPoint = normalizeStrokePoint(payload.point);
		if (
			objectId === '' ||
			createdById === '' ||
			normalizedPoint === null ||
			this.#activeStrokeId !== null
		) {
			return false;
		}

		this.#pushUndoCheckpoint();
		this.boardState = {
			...this.boardState,
			elements: [
				...this.boardState.elements,
				{
					id: objectId,
					kind: 'stroke',
					created_by: createdById,
					created_at: toIsoString(receivedAt),
					updated_at: toIsoString(receivedAt),
					stroke: payload.stroke,
					stroke_width: payload.stroke_width,
					points: [normalizedPoint]
				}
			]
		};
		this.#activeStrokeId = objectId;
		this.#clearRedoStack();
		return true;
	}

	appendStrokePoints(payload: StrokeAppendActionData, receivedAt: Date | ISODateTimeString = new Date()) {
		const objectId = payload.object_id.trim();
		const normalizedPoints = payload.points
			.map((point) => normalizeStrokePoint(point))
			.filter((point): point is StrokePoint => point !== null);

		if (objectId === '' || normalizedPoints.length === 0 || this.#activeStrokeId !== objectId) {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		let appended = false;
		const nextElements = this.boardState.elements.map((element) => {
			if (element.id !== objectId || element.kind !== 'stroke') {
				return element;
			}

			appended = true;
			return {
				...element,
				points: [...element.points, ...normalizedPoints],
				updated_at: updatedAt
			};
		});

		if (!appended) {
			return false;
		}

		this.boardState = {
			...this.boardState,
			elements: nextElements
		};
		return true;
	}

	endStroke(payload: StrokeEndActionData, receivedAt: Date | ISODateTimeString = new Date()) {
		const objectId = payload.object_id.trim();
		if (objectId === '' || this.#activeStrokeId !== objectId) {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		this.boardState = {
			...this.boardState,
			elements: this.boardState.elements.map((element) => {
				if (element.id !== objectId || element.kind !== 'stroke') {
					return element;
				}

				return {
					...element,
					updated_at: updatedAt
				};
			})
		};
		this.#activeStrokeId = null;
		return true;
	}

	undo() {
		const previousState = this.#undoStack.pop();
		if (!previousState) {
			return false;
		}

		this.#redoStack.push(this.#captureEditorState());
		this.#restoreEditorState(previousState);
		return true;
	}

	redo() {
		const nextState = this.#redoStack.pop();
		if (!nextState) {
			return false;
		}

		this.#undoStack.push(this.#captureEditorState());
		this.#restoreEditorState(nextState);
		return true;
	}

	transformObject(
		objectId: ObjectId,
		patch: Omit<TransformUpdateActionData, 'object_id'>,
		updatedAt: Date | ISODateTimeString = new Date()
	) {
		const normalizedObjectId = objectId.trim();
		if (normalizedObjectId === '') {
			return false;
		}

		const updatedAtIso = toIsoString(updatedAt);
		let transformed = false;
		const nextElements = this.boardState.elements.map((element) => {
			if (element.id !== normalizedObjectId) {
				return element;
			}

			const updatedElement = transformBoardElement(element, patch, updatedAtIso);
			if (updatedElement === null) {
				return element;
			}

			transformed = true;
			return updatedElement;
		});

		if (!transformed) {
			return false;
		}

		this.#pushUndoCheckpoint();
		this.boardState = {
			...this.boardState,
			elements: nextElements
		};
		this.#clearRedoStack();
		return true;
	}

	applyTransformUpdate(payload: TransformUpdateActionData, updatedAt: Date | ISODateTimeString = new Date()) {
		return this.transformObject(payload.object_id, payload, updatedAt);
	}

	deleteObject(objectId: ObjectId) {
		return this.deleteObjects([objectId]);
	}

	deleteSelectedObjects() {
		return this.deleteObjects(this.selectedObjectIds);
	}

	deleteObjects(objectIds: readonly ObjectId[]) {
		const normalizedObjectIds = normalizeObjectIds(objectIds, this.boardState.elements);
		if (normalizedObjectIds.length === 0) {
			return false;
		}

		const objectIdSet = new Set(normalizedObjectIds);
		const nextElements = this.boardState.elements.filter((element) => !objectIdSet.has(element.id));
		if (nextElements.length === this.boardState.elements.length) {
			return false;
		}

		this.#pushUndoCheckpoint();
		this.boardState = {
			...this.boardState,
			elements: nextElements
		};
		this.selectedObjectIds = this.selectedObjectIds.filter((objectId) => !objectIdSet.has(objectId));
		this.#clearRedoStack();
		return true;
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
	): RestoreCreatorBoardResult {
		const restoredState = restoreCreatorBoardState(boardId, options);
		if (restoredState.snapshot === null) {
			this.clear();
			return {
				restoredFromStorage: false
			};
		}

		this.replaceSnapshot(restoredState.snapshot);
		this.actionLog = restoredState.actionLog;
		return {
			restoredFromStorage: true
		};
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
		this.actionCursor += 1;
		return true;
	}

	clear() {
		this.snapshotVersion = 0;
		this.actionCursor = 0;
		this.boardState = createEmptyBoardState();
		this.actionLog = [];
		this.selectedObjectIds = createEmptySelection();
		this.#activeStrokeId = null;
		this.#clearHistory();
	}

	#captureEditorState(): BoardEditorState {
		return cloneEditorState({
			boardState: this.boardState,
			selectedObjectIds: this.selectedObjectIds
		});
	}

	#restoreEditorState(state: BoardEditorState) {
		this.boardState = cloneSerializable(state.boardState);
		this.selectedObjectIds = [...state.selectedObjectIds];
	}

	#pushUndoCheckpoint() {
		this.#undoStack.push(this.#captureEditorState());
		if (this.#undoStack.length > defaultUndoHistoryLimit) {
			this.#undoStack.shift();
		}
	}

	#clearRedoStack() {
		this.#redoStack = [];
	}

	#clearHistory() {
		this.#undoStack = [];
		this.#redoStack = [];
	}
}

export const localBoardStore = new LocalBoardStore();
