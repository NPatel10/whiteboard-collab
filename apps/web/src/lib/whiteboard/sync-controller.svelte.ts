import type { AppConnectionState } from './connection-state.svelte.js';
import { appConnectionState } from './connection-state.svelte.js';
import type { CreatorBoardStorage } from './board-persistence.svelte.js';
import type { BoardActionIdentityStore } from './action-identity.svelte.js';
import { boardActionIdentityStore } from './action-identity.svelte.js';
import type { LocalBoardStore, LocalBoardSnapshot } from './board-store.svelte.js';
import { localBoardStore } from './board-store.svelte.js';
import type { AppSessionState } from './session-state.svelte.js';
import { appSessionState } from './session-state.svelte.js';
import { SocketClient, type SocketClientOptions } from './socket-client.js';
import type {
	ActorId,
	BoardActionPayload,
	BoardSnapshotPayload,
	ClientSocketMessage,
	ErrorPayload,
	ParticipantJoinedPayload,
	ParticipantLeftPayload,
	ParticipantSummary,
	PresenceUpdatePayload,
	RequestId,
	ServerSocketMessage,
	SessionCreateMessage,
	SessionCreatedMessage,
	SessionJoinMessage,
	SessionJoinedMessage,
	SessionJoinRejectedMessage,
	SocketEnvelope
} from './types.js';

export type SyncPhase = 'idle' | 'connecting' | 'awaiting_snapshot' | 'ready' | 'reconnecting' | 'error';

export interface CreateBoardSessionInput {
	nickname: string;
	deviceId: string;
}

export interface JoinBoardSessionInput extends CreateBoardSessionInput {
	joinCode: string;
}

export interface WhiteboardSyncControllerOptions
	extends Pick<
		SocketClientOptions,
		| 'clearTimeoutFn'
		| 'createSocket'
		| 'maxReconnectDelayMs'
		| 'reconnectDelayMs'
		| 'reconnectMultiplier'
		| 'setTimeoutFn'
	> {
	relayWsUrl: string;
	boardStore?: LocalBoardStore;
	connectionState?: AppConnectionState;
	identityStore?: BoardActionIdentityStore;
	isBrowser?: boolean;
	requestIdFactory?: () => RequestId;
	sessionState?: AppSessionState;
	storage?: CreatorBoardStorage;
}

type SessionIntent =
	| { kind: 'owner'; nickname: string; deviceId: string }
	| { kind: 'guest'; joinCode: string; nickname: string; deviceId: string };

type PendingRealtimeMessage =
	| {
			kind: 'board.action';
			message: SocketEnvelope<'board.action', BoardActionPayload>;
	  }
	| {
			kind: 'presence.update';
			message: SocketEnvelope<'presence.update', PresenceUpdatePayload>;
	  };

function createRequestId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return `req_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRequestId(requestIdFactory: () => RequestId) {
	const requestId = requestIdFactory().trim();
	if (requestId !== '') {
		return requestId;
	}

	return createRequestId();
}

function parseServerMessage(rawMessage: string): ServerSocketMessage | null {
	try {
		return JSON.parse(rawMessage) as ServerSocketMessage;
	} catch {
		return null;
	}
}

function cloneValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

function createProtocolSnapshot(snapshot: LocalBoardSnapshot): BoardSnapshotPayload {
	return {
		target_actor_id: '',
		snapshot_version: Math.max(1, snapshot.snapshotVersion),
		action_cursor: Math.max(0, snapshot.actionCursor),
		board_state: cloneValue(snapshot.boardState)
	};
}

export class WhiteboardSyncController {
	phase = $state<SyncPhase>('idle');
	editingLocked = $state(false);
	lastError = $state<ErrorPayload | null>(null);
	ownerActorId = $state<ActorId>('');
	pendingSnapshotTargetIds = $state<ActorId[]>([]);

	#boardStore: LocalBoardStore;
	#connectionState: AppConnectionState;
	#identityStore: BoardActionIdentityStore;
	#isBrowser: boolean;
	#relayWsUrl: string;
	#requestIdFactory: () => RequestId;
	#sessionState: AppSessionState;
	#socketClient: SocketClient;
	#storage?: CreatorBoardStorage;
	#sessionIntent: SessionIntent | null = null;
	#pendingRealtimeMessages: PendingRealtimeMessage[] = [];
	#ownerBoardIdBeforeReconnect = '';
	#queuedReconnectHandshake = false;

	constructor(options: WhiteboardSyncControllerOptions) {
		this.#boardStore = options.boardStore ?? localBoardStore;
		this.#connectionState = options.connectionState ?? appConnectionState;
		this.#identityStore = options.identityStore ?? boardActionIdentityStore;
		this.#isBrowser = options.isBrowser ?? typeof window !== 'undefined';
		this.#relayWsUrl = options.relayWsUrl.trim();
		this.#requestIdFactory = options.requestIdFactory ?? createRequestId;
		this.#sessionState = options.sessionState ?? appSessionState;
		this.#storage = options.storage;
		this.#socketClient = new SocketClient({
			clearTimeoutFn: options.clearTimeoutFn,
			createSocket: options.createSocket,
			maxReconnectDelayMs: options.maxReconnectDelayMs,
			onMessage: (message) => this.#handleRawMessage(message),
			onStatusChange: (status) => this.#handleSocketStatusChange(status),
			reconnectDelayMs: options.reconnectDelayMs,
			reconnectMultiplier: options.reconnectMultiplier,
			setTimeoutFn: options.setTimeoutFn
		});
	}

	get pendingOutboundCount() {
		return this.#pendingRealtimeMessages.length + this.#socketClient.pendingMessageCount;
	}

	connectOwnerSession(input: CreateBoardSessionInput) {
		const nickname = input.nickname.trim();
		const deviceId = input.deviceId.trim();
		if (nickname === '' || deviceId === '' || this.#relayWsUrl === '') {
			return false;
		}

		this.#sessionIntent = {
			kind: 'owner',
			nickname,
			deviceId
		};
		this.#ownerBoardIdBeforeReconnect = '';
		this.editingLocked = false;
		this.lastError = null;
		this.phase = 'connecting';
		this.#connectionState.setConnecting();
		this.#socketClient.connect(this.#relayWsUrl);
		return this.#socketClient.send(this.#buildSessionCreateMessage(nickname, deviceId));
	}

	connectGuestSession(input: JoinBoardSessionInput) {
		const joinCode = input.joinCode.trim().toUpperCase();
		const nickname = input.nickname.trim();
		const deviceId = input.deviceId.trim();
		if (joinCode === '' || nickname === '' || deviceId === '' || this.#relayWsUrl === '') {
			return false;
		}

		this.#sessionIntent = {
			kind: 'guest',
			joinCode,
			nickname,
			deviceId
		};
		this.editingLocked = true;
		this.lastError = null;
		this.phase = 'connecting';
		this.#connectionState.setConnecting();
		this.#socketClient.connect(this.#relayWsUrl);
		return this.#socketClient.send(this.#buildSessionJoinMessage(joinCode, nickname, deviceId));
	}

	disconnect() {
		this.#socketClient.disconnect();
		this.phase = 'idle';
		this.editingLocked = false;
		this.pendingSnapshotTargetIds = [];
		this.#pendingRealtimeMessages = [];
		this.#queuedReconnectHandshake = false;
		this.#connectionState.setDisconnected();
	}

	persistOwnerBoardState() {
		if (this.#sessionState.role !== 'owner' || this.#sessionState.boardId.trim() === '') {
			return false;
		}

		return this.#boardStore.persistCreatorBoardState(this.#sessionState.boardId, {
			isBrowser: this.#isBrowser,
			role: 'owner',
			storage: this.#storage
		});
	}

	sendBoardAction(action: BoardActionPayload) {
		if (this.#sessionState.role === 'guest' && this.editingLocked) {
			return false;
		}

		const message: SocketEnvelope<'board.action', BoardActionPayload> = {
			type: 'board.action',
			request_id: normalizeRequestId(this.#requestIdFactory),
			payload: action
		};

		if (!this.#canSendRealtimeMessages()) {
			this.#pendingRealtimeMessages = [
				...this.#pendingRealtimeMessages,
				{
					kind: 'board.action',
					message
				}
			];
			this.persistOwnerBoardState();
			return true;
		}

		const didSend = this.#socketClient.send(message);
		if (didSend) {
			this.persistOwnerBoardState();
		}
		return didSend;
	}

	sendPresenceUpdate(payload: PresenceUpdatePayload) {
		if (this.#sessionState.role === 'guest' && this.editingLocked) {
			return false;
		}

		const message: SocketEnvelope<'presence.update', PresenceUpdatePayload> = {
			type: 'presence.update',
			request_id: normalizeRequestId(this.#requestIdFactory),
			payload
		};

		if (!this.#canSendRealtimeMessages()) {
			this.#pendingRealtimeMessages = [
				...this.#pendingRealtimeMessages,
				{
					kind: 'presence.update',
					message
				}
			];
			return true;
		}

		return this.#socketClient.send(message);
	}

	#handleSocketStatusChange(status: SocketClient['status']) {
		switch (status) {
			case 'connecting':
				this.phase = 'connecting';
				this.#connectionState.setConnecting();
				return;
			case 'connected':
				this.#connectionState.setConnected();
				if (this.phase === 'reconnecting') {
					this.phase = this.#sessionIntent?.kind === 'guest' ? 'awaiting_snapshot' : 'connecting';
				}
				return;
			case 'reconnecting':
				this.phase = 'reconnecting';
				this.#connectionState.setReconnecting();
				this.#handleReconnectStart();
				return;
			case 'stopped':
				this.#connectionState.setDisconnected();
				if (this.phase !== 'error') {
					this.phase = 'idle';
				}
				return;
			default:
				return;
		}
	}

	#handleReconnectStart() {
		if (this.#queuedReconnectHandshake || this.#sessionIntent === null) {
			return;
		}

		if (this.#sessionState.role === 'owner' && this.#sessionState.boardId.trim() !== '') {
			this.persistOwnerBoardState();
			this.#ownerBoardIdBeforeReconnect = this.#sessionState.boardId;
		}

		if (this.#sessionState.role === 'guest') {
			this.editingLocked = true;
		}

		this.#queuedReconnectHandshake = true;
		if (this.#sessionIntent.kind === 'owner') {
			this.#socketClient.send(
				this.#buildSessionCreateMessage(this.#sessionIntent.nickname, this.#sessionIntent.deviceId)
			);
			return;
		}

		this.#socketClient.send(
			this.#buildSessionJoinMessage(
				this.#sessionIntent.joinCode,
				this.#sessionIntent.nickname,
				this.#sessionIntent.deviceId
			)
		);
	}

	#handleRawMessage(rawMessage: string) {
		const message = parseServerMessage(rawMessage);
		if (message === null) {
			return;
		}

		switch (message.type) {
			case 'session.created':
				this.#handleSessionCreated(message);
				return;
			case 'session.joined':
				this.#handleSessionJoined(message);
				return;
			case 'session.join_rejected':
				this.#handleSessionJoinRejected(message);
				return;
			case 'board.snapshot.request':
				this.#handleBoardSnapshotRequest(message);
				return;
			case 'board.snapshot':
				this.#handleBoardSnapshot(message);
				return;
			case 'board.snapshot.ack':
				this.#handleBoardSnapshotAck(message);
				return;
			case 'board.action':
				this.#handleBoardAction(message);
				return;
			case 'participant.joined':
				this.#handleParticipantJoined(message.payload);
				return;
			case 'participant.left':
				this.#handleParticipantLeft(message.payload);
				return;
			case 'error':
				this.#handleError(message.payload);
				return;
			default:
				return;
		}
	}

	#handleSessionCreated(message: SessionCreatedMessage) {
		if (!message.board_id || !message.actor_id || this.#sessionIntent?.kind !== 'owner') {
			return;
		}

		const previousBoardId = this.#ownerBoardIdBeforeReconnect;
		this.#queuedReconnectHandshake = false;
		this.ownerActorId = message.actor_id;
		this.#sessionState.setSession({
			actorId: message.actor_id,
			boardId: message.board_id,
			joinCode: message.payload.join_code,
			role: 'owner',
			participants: [
				{
					actor_id: message.actor_id,
					nickname: this.#sessionIntent.nickname,
					role: 'owner',
					color: this.#resolveParticipantColor(message.actor_id, 'owner')
				}
			]
		});

		if (previousBoardId !== '' && previousBoardId !== message.board_id) {
			const restored = this.#boardStore.restoreCreatorBoard(previousBoardId, {
				isBrowser: this.#isBrowser,
				storage: this.#storage
			});
			if (restored.restoredFromStorage) {
				this.persistOwnerBoardState();
			}
		}

		this.editingLocked = false;
		this.lastError = null;
		this.phase = 'ready';
		this.#flushPendingRealtimeMessages();
	}

	#handleSessionJoined(message: SessionJoinedMessage) {
		if (!message.board_id || !message.actor_id) {
			return;
		}

		this.#queuedReconnectHandshake = false;
		this.ownerActorId = message.payload.owner_actor_id;
		this.#sessionState.setSession({
			actorId: message.actor_id,
			boardId: message.board_id,
			joinCode: this.#sessionIntent?.kind === 'guest' ? this.#sessionIntent.joinCode : '',
			role: 'guest',
			participants: cloneValue(message.payload.participants)
		});
		this.editingLocked = true;
		this.lastError = null;
		this.phase = 'awaiting_snapshot';
	}

	#handleSessionJoinRejected(message: SessionJoinRejectedMessage) {
		this.editingLocked = true;
		this.phase = 'error';
		this.lastError = {
			code: message.payload.reason,
			message: `session join rejected: ${message.payload.reason}`
		};
	}

	#handleBoardSnapshotRequest(
		message: SocketEnvelope<'board.snapshot.request', { target_actor_id: ActorId }>
	) {
		if (this.#sessionState.role !== 'owner' || this.phase !== 'ready') {
			return;
		}

		const targetActorId = message.payload.target_actor_id.trim();
		if (targetActorId === '') {
			return;
		}

		this.pendingSnapshotTargetIds = [...this.pendingSnapshotTargetIds, targetActorId];
		const snapshot = createProtocolSnapshot(this.#boardStore.getSnapshot());
		snapshot.target_actor_id = targetActorId;
		this.#socketClient.send({
			type: 'board.snapshot',
			request_id: message.request_id ?? normalizeRequestId(this.#requestIdFactory),
			payload: snapshot
		});
	}

	#handleBoardSnapshot(message: SocketEnvelope<'board.snapshot', BoardSnapshotPayload>) {
		if (this.#sessionState.role !== 'guest' || !this.#sessionState.actorId) {
			return;
		}

		if (message.payload.target_actor_id !== this.#sessionState.actorId) {
			return;
		}

		this.#boardStore.replaceSnapshot(message.payload);
		this.#socketClient.send({
			type: 'board.snapshot.ack',
			request_id: message.request_id ?? normalizeRequestId(this.#requestIdFactory),
			payload: {
				snapshot_version: Math.max(1, message.payload.snapshot_version)
			}
		});
		this.editingLocked = false;
		this.lastError = null;
		this.phase = 'ready';
		this.#flushPendingRealtimeMessages();
	}

	#handleBoardSnapshotAck(
		message: SocketEnvelope<'board.snapshot.ack', { snapshot_version: number }>
	) {
		const actorId = message.actor_id?.trim();
		if (!actorId) {
			return;
		}

		this.pendingSnapshotTargetIds = this.pendingSnapshotTargetIds.filter(
			(targetActorId) => targetActorId !== actorId
		);
	}

	#handleBoardAction(message: SocketEnvelope<'board.action', BoardActionPayload>) {
		if (!message.actor_id || message.actor_id === this.#sessionState.actorId) {
			return;
		}

		this.#boardStore.applyRemoteAction(message.payload, {
			actorId: message.actor_id,
			receivedAt: message.sent_at ?? new Date().toISOString()
		});
	}

	#handleParticipantJoined(payload: ParticipantJoinedPayload) {
		this.#sessionState.setParticipants(this.#mergeParticipant(payload));
	}

	#handleParticipantLeft(payload: ParticipantLeftPayload) {
		this.#sessionState.setParticipants(
			this.#sessionState.participants.filter((participant) => participant.actor_id !== payload.actor_id)
		);
	}

	#handleError(payload: ErrorPayload) {
		this.lastError = cloneValue(payload);
		if (payload.code === 'snapshot_timeout') {
			this.editingLocked = true;
		}
		this.phase = 'error';
	}

	#mergeParticipant(participant: ParticipantSummary) {
		const nextParticipants = this.#sessionState.participants.filter(
			(existingParticipant) => existingParticipant.actor_id !== participant.actor_id
		);
		nextParticipants.push(cloneValue(participant));
		return nextParticipants;
	}

	#canSendRealtimeMessages() {
		return (
			this.phase === 'ready' &&
			this.#socketClient.status === 'connected' &&
			this.#sessionState.boardId.trim() !== '' &&
			this.#sessionState.actorId.trim() !== ''
		);
	}

	#flushPendingRealtimeMessages() {
		if (!this.#canSendRealtimeMessages() || this.#pendingRealtimeMessages.length === 0) {
			return;
		}

		const pendingMessages = [...this.#pendingRealtimeMessages];
		this.#pendingRealtimeMessages = [];

		for (const pendingMessage of pendingMessages) {
			this.#socketClient.send(pendingMessage.message);
		}
	}

	#buildSessionCreateMessage(nickname: string, deviceId: string): SessionCreateMessage {
		return {
			type: 'session.create',
			request_id: normalizeRequestId(this.#requestIdFactory),
			payload: {
				nickname,
				device_id: deviceId
			}
		};
	}

	#buildSessionJoinMessage(joinCode: string, nickname: string, deviceId: string): SessionJoinMessage {
		return {
			type: 'session.join',
			request_id: normalizeRequestId(this.#requestIdFactory),
			payload: {
				join_code: joinCode,
				nickname,
				device_id: deviceId
			}
		};
	}

	#resolveParticipantColor(actorId: string, role: 'owner' | 'guest') {
		const palette = role === 'owner'
			? ['#f97316', '#fb7185', '#f59e0b']
			: ['#0ea5e9', '#10b981', '#8b5cf6', '#f43f5e'];
		const seed = [...actorId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
		return palette[seed % palette.length];
	}
}

export function createWhiteboardSyncController(options: WhiteboardSyncControllerOptions) {
	return new WhiteboardSyncController(options);
}
