const defaultReconnectDelayMs = 250;
const defaultReconnectMultiplier = 2;
const defaultMaxReconnectDelayMs = 5_000;
const webSocketOpenState = 1;
const webSocketClosedState = 3;

export type SocketClientStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface SocketLike {
	readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface ReconnectSchedule {
	attempt: number;
	delayMs: number;
}

export interface SocketClientOptions {
	createSocket?: (url: string) => SocketLike;
	reconnectDelayMs?: number;
	reconnectMultiplier?: number;
	maxReconnectDelayMs?: number;
	setTimeoutFn?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearTimeoutFn?: (timeout: ReturnType<typeof setTimeout>) => void;
	onStatusChange?: (status: SocketClientStatus) => void;
	onMessage?: (message: string) => void;
	onReconnectScheduled?: (schedule: ReconnectSchedule) => void;
}

export class SocketClient {
	#socket: SocketLike | null = null;
	#socketUrl: string | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#reconnectAttempt = 0;
	#queuedMessages: string[] = [];
	#manualDisconnect = false;

	status: SocketClientStatus = 'idle';

	constructor(private readonly options: SocketClientOptions = {}) {}

	connect(url: string) {
		const normalizedUrl = url.trim();
		if (!normalizedUrl) {
			throw new Error('socket url is required');
		}

		if (this.#socketUrl === normalizedUrl && this.#socket && this.#socket.readyState !== webSocketClosedState) {
			return;
		}

		if (this.#socket || this.#reconnectTimer) {
			this.disconnect();
		}

		this.#manualDisconnect = false;
		this.#socketUrl = normalizedUrl;
		this.#reconnectAttempt = 0;
		this.#openSocket(normalizedUrl, 'connecting');
	}

	disconnect() {
		this.#manualDisconnect = true;
		this.#clearReconnectTimer();
		this.#queuedMessages = [];
		this.#socketUrl = null;
		this.#reconnectAttempt = 0;

		const socket = this.#socket;
		this.#socket = null;
		this.#setStatus('stopped');

		if (socket && socket.readyState !== webSocketClosedState) {
			socket.close(1000, 'client disconnected');
		}
	}

	send(message: unknown): boolean {
		if (this.#manualDisconnect || !this.#socketUrl) {
			return false;
		}

		const serializedMessage = this.#serializeMessage(message);
		const socket = this.#socket;

		if (socket && socket.readyState === webSocketOpenState) {
			socket.send(serializedMessage);
			return true;
		}

		this.#queuedMessages.push(serializedMessage);
		return true;
	}

	get pendingMessageCount() {
		return this.#queuedMessages.length;
	}

	#openSocket(url: string, nextStatus: Exclude<SocketClientStatus, 'idle' | 'stopped'>) {
		if (this.#manualDisconnect) {
			return;
		}

		const socket = this.#createSocket(url);
		this.#socket = socket;
		this.#setStatus(nextStatus);

		socket.onopen = () => {
			if (this.#socket !== socket || this.#manualDisconnect) {
				return;
			}

			this.#clearReconnectTimer();
			this.#setStatus('connected');
			this.#flushQueuedMessages(socket);
		};

		socket.onmessage = (event) => {
			if (this.#socket !== socket || this.#manualDisconnect) {
				return;
			}

			this.#optionsOnMessage(event.data);
		};

		socket.onclose = () => {
			if (this.#socket !== socket) {
				return;
			}

			this.#socket = null;
			if (this.#manualDisconnect) {
				return;
			}

			this.#scheduleReconnect();
		};

		socket.onerror = () => {
			// Wait for close events to decide whether to reconnect.
		};
	}

	#scheduleReconnect() {
		if (!this.#socketUrl || this.#manualDisconnect) {
			return;
		}

		const attempt = this.#reconnectAttempt;
		const delayMs = this.#computeReconnectDelay(attempt);
		this.#reconnectAttempt += 1;

		this.#setStatus('reconnecting');
		this.#optionsOnReconnectScheduled({ attempt, delayMs });

		this.#clearReconnectTimer();
		this.#reconnectTimer = this.#setTimeout(() => {
			if (this.#manualDisconnect || !this.#socketUrl) {
				return;
			}

			this.#openSocket(this.#socketUrl, 'reconnecting');
		}, delayMs);
	}

	#flushQueuedMessages(socket: SocketLike) {
		while (this.#queuedMessages.length > 0 && socket.readyState === webSocketOpenState) {
			const message = this.#queuedMessages.shift();
			if (message === undefined) {
				break;
			}

			socket.send(message);
		}
	}

	#computeReconnectDelay(attempt: number) {
		const baseDelayMs = this.#optionsReconnectDelayMs();
		const multiplier = this.#optionsReconnectMultiplier();
		const maxDelayMs = this.#optionsMaxReconnectDelayMs();
		const delayMs = Math.round(baseDelayMs * multiplier ** attempt);

		return Math.min(delayMs, maxDelayMs);
	}

	#serializeMessage(message: unknown) {
		if (typeof message === 'string') {
			return message;
		}

		const serializedMessage = JSON.stringify(message);
		if (serializedMessage === undefined) {
			throw new Error('socket messages must be serializable');
		}

		return serializedMessage;
	}

	#clearReconnectTimer() {
		if (this.#reconnectTimer !== null) {
			this.#clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	#createSocket(url: string) {
		const factory = this.options.createSocket ?? ((socketUrl: string) => new WebSocket(socketUrl) as unknown as SocketLike);
		return factory(url);
	}

	#setStatus(status: SocketClientStatus) {
		if (this.status === status) {
			return;
		}

		this.status = status;
		this.options.onStatusChange?.(status);
	}

	#optionsReconnectDelayMs() {
		return this.options.reconnectDelayMs ?? defaultReconnectDelayMs;
	}

	#optionsReconnectMultiplier() {
		return this.options.reconnectMultiplier ?? defaultReconnectMultiplier;
	}

	#optionsMaxReconnectDelayMs() {
		return this.options.maxReconnectDelayMs ?? defaultMaxReconnectDelayMs;
	}

	#setTimeout(handler: () => void, delayMs: number) {
		const timeoutFn = this.options.setTimeoutFn ?? setTimeout;
		return timeoutFn(handler, delayMs);
	}

	#clearTimeout(timeout: ReturnType<typeof setTimeout>) {
		const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;
		clearTimeoutFn(timeout);
	}

	#optionsOnMessage(message: unknown) {
		const normalizedMessage = typeof message === 'string' ? message : JSON.stringify(message);
		if (normalizedMessage === undefined) {
			return;
		}

		this.options.onMessage?.(normalizedMessage);
	}

	#optionsOnReconnectScheduled(schedule: ReconnectSchedule) {
		this.options.onReconnectScheduled?.(schedule);
	}
}
