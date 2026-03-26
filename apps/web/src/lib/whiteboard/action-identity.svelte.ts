import type { BoardActionKind, BoardActionPayload, BoardActionDataMap, ActionId } from './types.js';

export interface BoardActionIdentity {
	action_id: ActionId;
	client_sequence: number;
}

export interface BoardActionPayloadExtras<TKind extends BoardActionKind>
	extends Omit<BoardActionPayload<TKind>, 'action_id' | 'client_sequence' | 'action_kind' | 'data'> {}

export interface BoardActionIdentityOptions {
	actionIdFactory?: () => ActionId;
	initialClientSequence?: number;
}

function createActionId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `action_${Math.random().toString(36).slice(2, 10)}`;
}

export class BoardActionIdentityStore {
	clientSequence = $state(0);

	#actionIdFactory: () => ActionId;

	constructor(options: BoardActionIdentityOptions = {}) {
		this.#actionIdFactory = options.actionIdFactory ?? createActionId;
		this.clientSequence = options.initialClientSequence ?? 0;
	}

	nextClientSequence() {
		this.clientSequence += 1;
		return this.clientSequence;
	}

	nextActionId() {
		return this.#actionIdFactory();
	}

	nextIdentity(): BoardActionIdentity {
		return {
			action_id: this.nextActionId(),
			client_sequence: this.nextClientSequence()
		};
	}

	createActionPayload<TKind extends BoardActionKind>(
		action_kind: TKind,
		data: BoardActionDataMap[TKind],
		extras: BoardActionPayloadExtras<TKind> = {}
	): BoardActionPayload<TKind> {
		return {
			...extras,
			...this.nextIdentity(),
			action_kind,
			data
		};
	}

	resetClientSequence(initialClientSequence = 0) {
		this.clientSequence = initialClientSequence;
	}
}

export const boardActionIdentityStore = new BoardActionIdentityStore();
