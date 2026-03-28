import type {
	BoardActionKind,
	BoardActionPayload,
	BoardElement,
	BoardSnapshotPayload,
	BoardState,
	EraserApplyActionData,
	ISODateTimeString,
	ActorId,
	ObjectId,
	RedoApplyActionData,
	ShapeCreateActionData,
	ShapeUpdateActionData,
	SelectionUpdateActionData,
	StrokeAppendActionData,
	StrokeBeginActionData,
	StrokeEndActionData,
	StrokePoint,
	StickyCreateActionData,
	StickyUpdateActionData,
	UndoApplyActionData,
	TextCreateActionData,
	TextUpdateActionData,
	TransformUpdateActionData,
	ViewportUpdateActionData
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

export interface ApplyRemoteActionOptions {
	actorId: ActorId;
	receivedAt?: Date | ISODateTimeString;
}

interface BoardEditorState {
	boardState: BoardState;
	selectedObjectIds: ObjectId[];
	objectVersions: Map<ObjectId, number>;
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
		selectedObjectIds: [...state.selectedObjectIds],
		objectVersions: new Map(state.objectVersions)
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
	#remoteActiveStrokeIdsByActor = new Map<ActorId, ObjectId>();
	#undoStack: BoardEditorState[] = [];
	#redoStack: BoardEditorState[] = [];
	#lastClientSequenceByActor = new Map<ActorId, number>();
	#objectVersions = new Map<ObjectId, number>();

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
		this.#resetActionTracking();
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

	applyRemoteAction(action: BoardActionPayload, options: ApplyRemoteActionOptions) {
		return this.#applyIncomingAction(action, options);
	}

	beginStroke(
		payload: StrokeBeginActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString = new Date(),
		options: { recordHistory?: boolean } = {}
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

		if (options.recordHistory ?? true) {
			this.#pushUndoCheckpoint();
		}
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
		this.#advanceObjectVersion(objectId);
		if (options.recordHistory ?? true) {
			this.#clearRedoStack();
		}
		return true;
	}

	appendStrokePoints(
		payload: StrokeAppendActionData,
		receivedAt: Date | ISODateTimeString = new Date(),
		options: { recordHistory?: boolean } = {}
	) {
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
		this.#advanceObjectVersion(objectId);
		return true;
	}

	endStroke(
		payload: StrokeEndActionData,
		receivedAt: Date | ISODateTimeString = new Date(),
		options: { recordHistory?: boolean } = {}
	) {
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
		this.#advanceObjectVersion(objectId);
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
		updatedAt: Date | ISODateTimeString = new Date(),
		options: { recordHistory?: boolean } = {}
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

		if (options.recordHistory ?? true) {
			this.#pushUndoCheckpoint();
		}
		this.boardState = {
			...this.boardState,
			elements: nextElements
		};
		this.#advanceObjectVersion(normalizedObjectId);
		if (options.recordHistory ?? true) {
			this.#clearRedoStack();
		}
		return true;
	}

	applyTransformUpdate(payload: TransformUpdateActionData, updatedAt: Date | ISODateTimeString = new Date()) {
		return this.transformObject(payload.object_id, payload, updatedAt);
	}

	deleteObject(objectId: ObjectId, options: { recordHistory?: boolean } = {}) {
		return this.deleteObjects([objectId], options);
	}

	deleteSelectedObjects(options: { recordHistory?: boolean } = {}) {
		return this.deleteObjects(this.selectedObjectIds, options);
	}

	deleteObjects(objectIds: readonly ObjectId[], options: { recordHistory?: boolean } = {}) {
		const normalizedObjectIds = normalizeObjectIds(objectIds, this.boardState.elements);
		if (normalizedObjectIds.length === 0) {
			return false;
		}

		const objectIdSet = new Set(normalizedObjectIds);
		const nextElements = this.boardState.elements.filter((element) => !objectIdSet.has(element.id));
		if (nextElements.length === this.boardState.elements.length) {
			return false;
		}

		if (options.recordHistory ?? true) {
			this.#pushUndoCheckpoint();
		}
		this.boardState = {
			...this.boardState,
			elements: nextElements
		};
		this.selectedObjectIds = this.selectedObjectIds.filter((objectId) => !objectIdSet.has(objectId));
		this.#removeObjectVersions(normalizedObjectIds);
		if (options.recordHistory ?? true) {
			this.#clearRedoStack();
		}
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
		this.#resetActionTracking();
		this.#clearHistory();
	}

	#applyIncomingAction(action: BoardActionPayload, options: ApplyRemoteActionOptions) {
		const actorId = options.actorId.trim();
		const receivedAt = options.receivedAt ?? new Date();
		const normalizedActionId = action.action_id.trim();
		const normalizedObjectId = this.#resolveActionObjectId(action);
		if (actorId === '' || normalizedActionId === '' || action.client_sequence <= 0) {
			return false;
		}

		if (this.actionLog.some((existingEntry) => existingEntry.action.action_id === normalizedActionId)) {
			return false;
		}

		const lastClientSequence = this.#lastClientSequenceByActor.get(actorId) ?? 0;
		if (action.client_sequence <= lastClientSequence) {
			return false;
		}

		if (
			normalizedObjectId !== null &&
			action.object_version !== undefined &&
			this.#currentObjectVersion(normalizedObjectId) >= action.object_version
		) {
			return false;
		}

		const applied = this.#applyActionMutation(action, actorId, receivedAt);
		if (!applied) {
			return false;
		}

		this.appendAction(action, receivedAt);
		this.#lastClientSequenceByActor.set(actorId, action.client_sequence);

		return true;
	}

	#applyActionMutation(action: BoardActionPayload, actorId: ActorId, receivedAt: Date | ISODateTimeString) {
		switch (action.action_kind) {
			case 'stroke.begin': {
				const data = action.data as StrokeBeginActionData;
				return this.#beginRemoteStroke(data, actorId, receivedAt);
			}
			case 'stroke.append': {
				const data = action.data as StrokeAppendActionData;
				return this.#appendRemoteStrokePoints(data, actorId, receivedAt);
			}
			case 'stroke.end': {
				const data = action.data as StrokeEndActionData;
				return this.#endRemoteStroke(data, actorId, receivedAt);
			}
			case 'eraser.apply': {
				const data = action.data as EraserApplyActionData;
				return this.deleteObjects(data.object_ids, { recordHistory: false });
			}
			case 'shape.create': {
				const data = action.data as ShapeCreateActionData;
				return this.#createShape(data, actorId, receivedAt, action.object_id);
			}
			case 'shape.update': {
				const data = action.data as ShapeUpdateActionData;
				return this.#updateShape(data, receivedAt);
			}
			case 'shape.delete': {
				const data = action.data as { object_id: ObjectId };
				return this.deleteObject(data.object_id, { recordHistory: false });
			}
			case 'text.create': {
				const data = action.data as TextCreateActionData;
				return this.#createText(data, actorId, receivedAt, action.object_id);
			}
			case 'text.update': {
				const data = action.data as TextUpdateActionData;
				return this.#updateText(data, receivedAt);
			}
			case 'text.delete': {
				const data = action.data as { object_id: ObjectId };
				return this.deleteObject(data.object_id, { recordHistory: false });
			}
			case 'sticky.create': {
				const data = action.data as StickyCreateActionData;
				return this.#createSticky(data, actorId, receivedAt, action.object_id);
			}
			case 'sticky.update': {
				const data = action.data as StickyUpdateActionData;
				return this.#updateSticky(data, receivedAt);
			}
			case 'sticky.delete': {
				const data = action.data as { object_id: ObjectId };
				return this.deleteObject(data.object_id, { recordHistory: false });
			}
			case 'selection.update': {
				const data = action.data as SelectionUpdateActionData;
				this.applySelectionUpdate(data);
				return true;
			}
			case 'transform.update': {
				const data = action.data as TransformUpdateActionData;
				return this.transformObject(data.object_id, data, receivedAt, {
					recordHistory: false
				});
			}
			case 'viewport.update': {
				const data = action.data as ViewportUpdateActionData;
				return this.#updateViewport(data);
			}
			case 'undo.apply': {
				const data = action.data as UndoApplyActionData;
				return this.#applyUndo(data);
			}
			case 'redo.apply': {
				const data = action.data as RedoApplyActionData;
				return this.#applyRedo(data);
			}
			default:
				return false;
		}
	}

	#createShape(
		data: ShapeCreateActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString,
		objectId?: ObjectId
	) {
		const normalizedObjectId = objectId?.trim();
		if (normalizedObjectId === '' || normalizedObjectId === undefined || this.#hasElement(normalizedObjectId)) {
			return false;
		}

		const createdAt = toIsoString(receivedAt);
		this.boardState = {
			...this.boardState,
			elements: [
				...this.boardState.elements,
				{
					id: normalizedObjectId,
					kind: 'shape',
					created_by: createdBy,
					created_at: createdAt,
					updated_at: createdAt,
					shape: data.shape,
					x: data.x,
					y: data.y,
					width: data.width,
					height: data.height,
					rotation: 0,
					stroke: data.stroke,
					fill: data.fill,
					stroke_width: data.stroke_width ?? 2
				}
			]
		};
		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#createText(
		data: TextCreateActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString,
		objectId?: ObjectId
	) {
		const normalizedObjectId = objectId?.trim();
		if (normalizedObjectId === '' || normalizedObjectId === undefined || this.#hasElement(normalizedObjectId)) {
			return false;
		}

		const createdAt = toIsoString(receivedAt);
		this.boardState = {
			...this.boardState,
			elements: [
				...this.boardState.elements,
				{
					id: normalizedObjectId,
					kind: 'text',
					created_by: createdBy,
					created_at: createdAt,
					updated_at: createdAt,
					x: data.x,
					y: data.y,
					width: data.width,
					height: data.height,
					text: data.text,
					font_size: data.font_size,
					color: data.color,
					align: data.align
				}
			]
		};
		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#createSticky(
		data: StickyCreateActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString,
		objectId?: ObjectId
	) {
		const normalizedObjectId = objectId?.trim();
		if (normalizedObjectId === '' || normalizedObjectId === undefined || this.#hasElement(normalizedObjectId)) {
			return false;
		}

		const createdAt = toIsoString(receivedAt);
		this.boardState = {
			...this.boardState,
			elements: [
				...this.boardState.elements,
				{
					id: normalizedObjectId,
					kind: 'sticky',
					created_by: createdBy,
					created_at: createdAt,
					updated_at: createdAt,
					x: data.x,
					y: data.y,
					width: data.width,
					height: data.height,
					text: data.text,
					background: data.background,
					color: data.color
				}
			]
		};
		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#updateShape(data: ShapeUpdateActionData, receivedAt: Date | ISODateTimeString) {
		return this.#updateShapeElement(data.object_id, data.patch, receivedAt);
	}

	#updateText(data: TextUpdateActionData, receivedAt: Date | ISODateTimeString) {
		return this.#updateTextElement(data.object_id, data.patch, receivedAt);
	}

	#updateSticky(data: StickyUpdateActionData, receivedAt: Date | ISODateTimeString) {
		return this.#updateStickyElement(data.object_id, data.patch, receivedAt);
	}

	#updateViewport(data: ViewportUpdateActionData) {
		this.boardState = {
			...this.boardState,
			viewport: cloneSerializable(data.viewport)
		};
		return true;
	}

	#applyUndo(data: UndoApplyActionData) {
		const count = Math.max(1, data.count ?? 1);
		let applied = false;
		for (let index = 0; index < count; index += 1) {
			applied = this.undo() || applied;
		}

		return applied;
	}

	#applyRedo(data: RedoApplyActionData) {
		const count = Math.max(1, data.count ?? 1);
		let applied = false;
		for (let index = 0; index < count; index += 1) {
			applied = this.redo() || applied;
		}

		return applied;
	}

	#updateShapeElement(
		objectId: ObjectId,
		patch: ShapeUpdateActionData['patch'],
		receivedAt: Date | ISODateTimeString
	) {
		const normalizedObjectId = objectId.trim();
		if (normalizedObjectId === '') {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		let updated = false;
		this.boardState = {
			...this.boardState,
			elements: this.boardState.elements.map((element) => {
				if (element.id !== normalizedObjectId || element.kind !== 'shape') {
					return element;
				}

				updated = true;
				return {
					...element,
					x: patch.x ?? element.x,
					y: patch.y ?? element.y,
					width: patch.width ?? element.width,
					height: patch.height ?? element.height,
					rotation: patch.rotation ?? element.rotation,
					stroke: patch.stroke ?? element.stroke,
					fill: patch.fill ?? element.fill,
					stroke_width: patch.stroke_width ?? element.stroke_width,
					updated_at: updatedAt
				};
			})
		};

		if (!updated) {
			return false;
		}

		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#updateTextElement(
		objectId: ObjectId,
		patch: TextUpdateActionData['patch'],
		receivedAt: Date | ISODateTimeString
	) {
		const normalizedObjectId = objectId.trim();
		if (normalizedObjectId === '') {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		let updated = false;
		this.boardState = {
			...this.boardState,
			elements: this.boardState.elements.map((element) => {
				if (element.id !== normalizedObjectId || element.kind !== 'text') {
					return element;
				}

				updated = true;
				return {
					...element,
					x: patch.x ?? element.x,
					y: patch.y ?? element.y,
					width: patch.width ?? element.width,
					height: patch.height ?? element.height,
					text: patch.text ?? element.text,
					font_size: patch.font_size ?? element.font_size,
					color: patch.color ?? element.color,
					align: patch.align ?? element.align,
					updated_at: updatedAt
				};
			})
		};

		if (!updated) {
			return false;
		}

		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#updateStickyElement(
		objectId: ObjectId,
		patch: StickyUpdateActionData['patch'],
		receivedAt: Date | ISODateTimeString
	) {
		const normalizedObjectId = objectId.trim();
		if (normalizedObjectId === '') {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		let updated = false;
		this.boardState = {
			...this.boardState,
			elements: this.boardState.elements.map((element) => {
				if (element.id !== normalizedObjectId || element.kind !== 'sticky') {
					return element;
				}

				updated = true;
				return {
					...element,
					x: patch.x ?? element.x,
					y: patch.y ?? element.y,
					width: patch.width ?? element.width,
					height: patch.height ?? element.height,
					text: patch.text ?? element.text,
					background: patch.background ?? element.background,
					color: patch.color ?? element.color,
					updated_at: updatedAt
				};
			})
		};

		if (!updated) {
			return false;
		}

		this.#advanceObjectVersion(normalizedObjectId);
		return true;
	}

	#beginRemoteStroke(
		payload: StrokeBeginActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString
	) {
		const actorId = createdBy.trim();
		const objectId = payload.object_id.trim();
		const normalizedPoint = normalizeStrokePoint(payload.point);
		if (
			actorId === '' ||
			objectId === '' ||
			normalizedPoint === null ||
			this.#remoteActiveStrokeIdsByActor.has(actorId) ||
			this.#hasElement(objectId)
		) {
			return false;
		}

		const createdAt = toIsoString(receivedAt);
		this.boardState = {
			...this.boardState,
			elements: [
				...this.boardState.elements,
				{
					id: objectId,
					kind: 'stroke',
					created_by: actorId,
					created_at: createdAt,
					updated_at: createdAt,
					stroke: payload.stroke,
					stroke_width: payload.stroke_width,
					points: [normalizedPoint]
				}
			]
		};
		this.#remoteActiveStrokeIdsByActor.set(actorId, objectId);
		this.#advanceObjectVersion(objectId);
		return true;
	}

	#appendRemoteStrokePoints(
		payload: StrokeAppendActionData,
		createdBy: ActorId,
		receivedAt: Date | ISODateTimeString
	) {
		const actorId = createdBy.trim();
		const objectId = payload.object_id.trim();
		const activeStrokeId = this.#remoteActiveStrokeIdsByActor.get(actorId);
		const normalizedPoints = payload.points
			.map((point) => normalizeStrokePoint(point))
			.filter((point): point is StrokePoint => point !== null);

		if (actorId === '' || objectId === '' || normalizedPoints.length === 0 || activeStrokeId !== objectId) {
			return false;
		}

		const updatedAt = toIsoString(receivedAt);
		let appended = false;
		this.boardState = {
			...this.boardState,
			elements: this.boardState.elements.map((element) => {
				if (element.id !== objectId || element.kind !== 'stroke') {
					return element;
				}

				appended = true;
				return {
					...element,
					points: [...element.points, ...normalizedPoints],
					updated_at: updatedAt
				};
			})
		};

		if (!appended) {
			return false;
		}

		this.#advanceObjectVersion(objectId);
		return true;
	}

	#endRemoteStroke(payload: StrokeEndActionData, createdBy: ActorId, receivedAt: Date | ISODateTimeString) {
		const actorId = createdBy.trim();
		const objectId = payload.object_id.trim();
		const activeStrokeId = this.#remoteActiveStrokeIdsByActor.get(actorId);
		if (actorId === '' || objectId === '' || activeStrokeId !== objectId) {
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
		this.#remoteActiveStrokeIdsByActor.delete(actorId);
		this.#advanceObjectVersion(objectId);
		return true;
	}

	#resolveActionObjectId(action: BoardActionPayload) {
		const explicitObjectId = action.object_id?.trim();
		if (explicitObjectId) {
			return explicitObjectId;
		}

		switch (action.action_kind) {
			case 'stroke.begin':
			case 'stroke.append':
			case 'stroke.end': {
				const data = action.data as StrokeBeginActionData | StrokeAppendActionData | StrokeEndActionData;
				return data.object_id.trim();
			}
			case 'shape.update':
			case 'shape.delete': {
				const data = action.data as ShapeUpdateActionData | { object_id: ObjectId };
				return data.object_id.trim();
			}
			case 'text.update':
			case 'text.delete': {
				const data = action.data as TextUpdateActionData | { object_id: ObjectId };
				return data.object_id.trim();
			}
			case 'sticky.update':
			case 'sticky.delete': {
				const data = action.data as StickyUpdateActionData | { object_id: ObjectId };
				return data.object_id.trim();
			}
			case 'transform.update': {
				const data = action.data as TransformUpdateActionData;
				return data.object_id.trim();
			}
			default:
				return null;
		}
	}

	#currentObjectVersion(objectId: ObjectId) {
		return this.#objectVersions.get(objectId) ?? 0;
	}

	#advanceObjectVersion(objectId: ObjectId, minimumVersion?: number) {
		const currentVersion = this.#currentObjectVersion(objectId);
		const nextVersion = Math.max(currentVersion + 1, minimumVersion ?? 0);
		this.#objectVersions.set(objectId, nextVersion);
		return nextVersion;
	}

	#removeObjectVersions(objectIds: readonly ObjectId[]) {
		for (const objectId of objectIds) {
			this.#objectVersions.delete(objectId);
		}
	}

	#hasElement(objectId: ObjectId) {
		return this.boardState.elements.some((element) => element.id === objectId);
	}

	#resetActionTracking() {
		this.#lastClientSequenceByActor = new Map<ActorId, number>();
		this.#objectVersions = new Map<ObjectId, number>();
		this.#remoteActiveStrokeIdsByActor = new Map<ActorId, ObjectId>();
		for (const element of this.boardState.elements) {
			this.#objectVersions.set(element.id, 0);
		}
	}

	#captureEditorState(): BoardEditorState {
		return cloneEditorState({
			boardState: this.boardState,
			selectedObjectIds: this.selectedObjectIds,
			objectVersions: this.#objectVersions
		});
	}

	#restoreEditorState(state: BoardEditorState) {
		this.boardState = cloneSerializable(state.boardState);
		this.selectedObjectIds = [...state.selectedObjectIds];
		this.#objectVersions = new Map(state.objectVersions);
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
