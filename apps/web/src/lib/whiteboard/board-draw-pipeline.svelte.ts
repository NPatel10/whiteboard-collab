import { boardActionIdentityStore, type BoardActionIdentityStore } from './action-identity.svelte.js';
import { type LocalBoardStore } from './board-store.svelte.js';
import type {
	ActorId,
	ObjectId,
	StrokePoint,
	StrokeAppendActionData,
	StrokeBeginActionData,
	StrokeEndActionData
} from './types.js';

export interface StrokeDrawPipelineOptions {
	createdByActorId: ActorId;
	createObjectId?: () => ObjectId;
	identityStore?: BoardActionIdentityStore;
	batchSize?: number;
}

export interface BeginStrokeInput {
	point: StrokePoint;
	stroke: string;
	strokeWidth: number;
}

const defaultStrokeBatchSize = 8;

export class StrokeDrawPipeline {
	#store: LocalBoardStore;
	#identityStore: BoardActionIdentityStore;
	#createdByActorId: ActorId;
	#createObjectId: () => ObjectId;
	#batchSize: number;
	#activeStrokeId: ObjectId | null = null;
	#pendingPoints: StrokePoint[] = [];

	constructor(store: LocalBoardStore, options: StrokeDrawPipelineOptions) {
		this.#store = store;
		this.#identityStore = options.identityStore ?? boardActionIdentityStore;
		this.#createdByActorId = options.createdByActorId.trim();
		this.#createObjectId =
			options.createObjectId ??
			(() => {
				if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
					return `stroke_${crypto.randomUUID()}`;
				}

				return `stroke_${Math.random().toString(36).slice(2, 10)}`;
			});
		this.#batchSize = Math.max(1, options.batchSize ?? defaultStrokeBatchSize);
	}

	get activeStrokeId() {
		return this.#activeStrokeId;
	}

	get pendingPointCount() {
		return this.#pendingPoints.length;
	}

	beginStroke(input: BeginStrokeInput, receivedAt: Date | string = new Date()) {
		if (this.#activeStrokeId !== null) {
			return null;
		}

		const objectId = this.#createObjectId().trim();
		if (objectId === '' || this.#createdByActorId === '') {
			return null;
		}

		const strokeBeginActionData: StrokeBeginActionData = {
			object_id: objectId,
			stroke: input.stroke,
			stroke_width: input.strokeWidth,
			point: input.point
		};

		const created = this.#store.beginStroke(strokeBeginActionData, this.#createdByActorId, receivedAt);
		if (!created) {
			return null;
		}

		const action = this.#identityStore.createActionPayload(
			'stroke.begin',
			strokeBeginActionData,
			{ object_id: objectId }
		);
		this.#store.appendAction(action, receivedAt);
		this.#activeStrokeId = objectId;
		this.#pendingPoints = [];
		return objectId;
	}

	appendPoint(point: StrokePoint, receivedAt: Date | string = new Date()) {
		if (this.#activeStrokeId === null) {
			return false;
		}

		const appended = this.#store.appendStrokePoints(
			{
				object_id: this.#activeStrokeId,
				points: [point]
			},
			receivedAt
		);
		if (!appended) {
			return false;
		}

		this.#pendingPoints.push(point);
		if (this.#pendingPoints.length >= this.#batchSize) {
			return this.flushPendingPoints(receivedAt);
		}

		return true;
	}

	flushPendingPoints(receivedAt: Date | string = new Date()) {
		if (this.#activeStrokeId === null || this.#pendingPoints.length === 0) {
			return false;
		}

		const strokeAppendActionData: StrokeAppendActionData = {
			object_id: this.#activeStrokeId,
			points: [...this.#pendingPoints]
		};
		const action = this.#identityStore.createActionPayload(
			'stroke.append',
			strokeAppendActionData,
			{ object_id: this.#activeStrokeId }
		);

		this.#store.appendAction(action, receivedAt);
		this.#pendingPoints = [];
		return true;
	}

	endStroke(receivedAt: Date | string = new Date()) {
		if (this.#activeStrokeId === null) {
			return false;
		}

		this.flushPendingPoints(receivedAt);

		const strokeEndActionData: StrokeEndActionData = {
			object_id: this.#activeStrokeId
		};
		const action = this.#identityStore.createActionPayload(
			'stroke.end',
			strokeEndActionData,
			{ object_id: this.#activeStrokeId }
		);

		const ended = this.#store.endStroke(strokeEndActionData, receivedAt);
		if (!ended) {
			return false;
		}

		this.#store.appendAction(action, receivedAt);
		this.#activeStrokeId = null;
		this.#pendingPoints = [];
		return true;
	}
}
