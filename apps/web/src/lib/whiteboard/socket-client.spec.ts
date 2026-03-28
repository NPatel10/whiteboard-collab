import { describe, expect, it } from 'vitest';

import { SocketClient, type SocketClientOptions, type SocketLike } from './socket-client.js';

const openState = 1;
const closedState = 3;

class FakeSocket implements SocketLike {
	readyState = 0;
	sent: string[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(public readonly url: string) {}

	send(data: string) {
		if (this.readyState !== openState) {
			throw new Error('socket must be open to send');
		}

		this.sent.push(data);
	}

	close(code = 1000, reason = 'closed') {
		if (this.readyState === closedState) {
			return;
		}

		this.readyState = closedState;
		this.onclose?.({ code, reason, wasClean: code === 1000 });
	}

	open() {
		this.readyState = openState;
		this.onopen?.({});
	}

	receive(message: unknown) {
		this.onmessage?.({ data: message });
	}
}

function createHarness(overrides: Partial<SocketClientOptions> = {}) {
	const sockets: FakeSocket[] = [];
	const scheduled: Array<{ delayMs: number; handler: () => void; cancelled: boolean; executed: boolean }> = [];
	const client = new SocketClient({
		createSocket: (url) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		setTimeoutFn: (handler: () => void, delayMs: number) => {
			scheduled.push({ delayMs, handler, cancelled: false, executed: false });
			return (scheduled.length - 1) as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimeoutFn: (timeout: ReturnType<typeof setTimeout>) => {
			const scheduledTask = scheduled[timeout as number];
			if (scheduledTask) {
				scheduledTask.cancelled = true;
			}
		},
		...overrides
	});

	return {
		client,
		sockets,
		scheduled,
		runScheduled(index: number) {
			const task = scheduled[index];
			if (!task || task.cancelled || task.executed) {
				throw new Error(`scheduled task ${index} is not runnable`);
			}

			task.executed = true;
			task.handler();
		}
	};
}

describe('SocketClient', () => {
	it('connects and reports connection state transitions', () => {
		const { client, sockets } = createHarness();

		client.connect('ws://example.test/socket');

		expect(client.status).toBe('connecting');
		expect(sockets).toHaveLength(1);
		expect(sockets[0].url).toBe('ws://example.test/socket');

		sockets[0].open();

		expect(client.status).toBe('connected');
		expect(client.pendingMessageCount).toBe(0);
	});

	it('queues messages until the socket opens and then flushes them', () => {
		const { client, sockets } = createHarness();

		client.connect('ws://example.test/socket');
		expect(client.send('hello world')).toBe(true);
		expect(client.send({ type: 'ping', count: 1 })).toBe(true);
		expect(sockets[0].sent).toEqual([]);
		expect(client.pendingMessageCount).toBe(2);

		sockets[0].open();

		expect(sockets[0].sent).toEqual(['hello world', '{"type":"ping","count":1}']);
		expect(client.pendingMessageCount).toBe(0);
	});

	it('schedules reconnects with backoff after an unexpected close', () => {
		const { client, scheduled, sockets, runScheduled } = createHarness();

		client.connect('ws://example.test/socket');
		sockets[0].open();
		sockets[0].close(1006, 'network error');

		expect(client.status).toBe('reconnecting');
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0].delayMs).toBe(250);

		runScheduled(0);
		expect(sockets).toHaveLength(2);
		expect(client.status).toBe('reconnecting');

		sockets[1].open();
		sockets[1].close(1006, 'network error again');

		expect(scheduled).toHaveLength(2);
		expect(scheduled[1].delayMs).toBe(500);
	});

	it('flushes queued messages after reconnecting to a replacement socket', () => {
		const { client, scheduled, sockets, runScheduled } = createHarness();

		client.connect('ws://example.test/socket');
		sockets[0].open();
		expect(client.send({ type: 'sync', step: 1 })).toBe(true);
		expect(sockets[0].sent).toEqual(['{"type":"sync","step":1}']);

		sockets[0].close(1006, 'network error');

		expect(client.status).toBe('reconnecting');
		expect(scheduled).toHaveLength(1);
		expect(client.send({ type: 'sync', step: 2 })).toBe(true);
		expect(client.pendingMessageCount).toBe(1);

		runScheduled(0);
		expect(sockets).toHaveLength(2);

		sockets[1].open();

		expect(sockets[1].sent).toEqual(['{"type":"sync","step":2}']);
		expect(client.pendingMessageCount).toBe(0);
		expect(client.status).toBe('connected');
	});

	it('stops reconnecting after disconnect', () => {
		const { client, scheduled, sockets, runScheduled } = createHarness();

		client.connect('ws://example.test/socket');
		sockets[0].open();
		sockets[0].close(1006, 'network error');

		expect(scheduled).toHaveLength(1);

		client.disconnect();
		expect(client.status).toBe('stopped');
		expect(client.send('after disconnect')).toBe(false);
		expect(scheduled[0].cancelled).toBe(true);
		expect(() => runScheduled(0)).toThrowError('scheduled task 0 is not runnable');
		expect(sockets).toHaveLength(1);
		expect(client.pendingMessageCount).toBe(0);
	});
});
