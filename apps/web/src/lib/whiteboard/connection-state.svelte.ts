export type AppConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class AppConnectionState {
	status = $state<AppConnectionStatus>('disconnected');
	lastTransitionAt = $state<Date | null>(null);

	get isReconnecting() {
		return this.status === 'reconnecting';
	}

	get statusLabel() {
		switch (this.status) {
			case 'connecting':
				return 'Connecting';
			case 'connected':
				return 'Connected';
			case 'reconnecting':
				return 'Reconnecting';
			default:
				return 'Disconnected';
		}
	}

	#transition(status: AppConnectionStatus) {
		this.status = status;
		this.lastTransitionAt = new Date();
	}

	setConnecting() {
		this.#transition('connecting');
	}

	setConnected() {
		this.#transition('connected');
	}

	setReconnecting() {
		this.#transition('reconnecting');
	}

	setDisconnected() {
		this.#transition('disconnected');
	}
}

export const appConnectionState = new AppConnectionState();
