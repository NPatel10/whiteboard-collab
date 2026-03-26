import { env } from '$env/dynamic/public';

const defaultRelayHttpUrl = 'http://localhost:8080';
const defaultNickname = 'Guest';

export interface PublicRuntimeConfig {
	defaultNickname: string;
	relayHttpUrl: string;
	relayWsUrl: string;
}

export function deriveRelayWebSocketUrl(httpUrl: string): string {
	const url = new URL('/api/v1/ws', httpUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

export const publicRuntimeConfig: PublicRuntimeConfig = {
	defaultNickname: env.PUBLIC_DEFAULT_NICKNAME || defaultNickname,
	relayHttpUrl: env.PUBLIC_RELAY_HTTP_URL || defaultRelayHttpUrl,
	relayWsUrl:
		env.PUBLIC_RELAY_WS_URL ||
		deriveRelayWebSocketUrl(env.PUBLIC_RELAY_HTTP_URL || defaultRelayHttpUrl)
};
