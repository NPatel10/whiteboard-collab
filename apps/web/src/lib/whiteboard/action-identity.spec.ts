import { describe, expect, it } from 'vitest';

import { BoardActionIdentityStore } from './action-identity.svelte.js';

describe('BoardActionIdentityStore', () => {
	it('generates monotonically increasing client sequences', () => {
		const store = new BoardActionIdentityStore({ initialClientSequence: 3 });

		expect(store.clientSequence).toBe(3);
		expect(store.nextClientSequence()).toBe(4);
		expect(store.nextClientSequence()).toBe(5);
		expect(store.clientSequence).toBe(5);
	});

	it('creates action payloads with generated action ids and sequence numbers', () => {
		const ids = ['action_1', 'action_2'];
		const store = new BoardActionIdentityStore({
			actionIdFactory: () => {
				const next = ids.shift();
				if (!next) {
					throw new Error('expected an action id');
				}

				return next;
			}
		});

		const first = store.createActionPayload('shape.create', {
			shape: 'rectangle',
			x: 10,
			y: 20,
			width: 120,
			height: 80,
			stroke: '#111827',
			fill: '#fef3c7',
			stroke_width: 2
		});

		const second = store.createActionPayload(
			'viewport.update',
			{
				viewport: {
					x: 12,
					y: 24,
					zoom: 1.25
				}
			},
			{
				object_version: 8
			}
		);

		expect(first).toEqual({
			action_id: 'action_1',
			client_sequence: 1,
			action_kind: 'shape.create',
			data: {
				shape: 'rectangle',
				x: 10,
				y: 20,
				width: 120,
				height: 80,
				stroke: '#111827',
				fill: '#fef3c7',
				stroke_width: 2
			}
		});
		expect(second).toEqual({
			action_id: 'action_2',
			client_sequence: 2,
			action_kind: 'viewport.update',
			object_version: 8,
			data: {
				viewport: {
					x: 12,
					y: 24,
					zoom: 1.25
				}
			}
		});
	});

	it('resets the client sequence counter', () => {
		const store = new BoardActionIdentityStore();

		store.nextClientSequence();
		store.nextClientSequence();
		store.resetClientSequence();

		expect(store.clientSequence).toBe(0);
		expect(store.nextClientSequence()).toBe(1);
	});
});
