import type { ParticipantRole, ParticipantSummary } from './types.js';

export type SessionSnapshot = {
	actorId: string;
	boardId: string;
	joinCode: string;
	role: ParticipantRole;
	participants: ParticipantSummary[];
};

export class AppSessionState {
	actorId = $state<string>('');
	boardId = $state<string>('');
	joinCode = $state<string>('');
	role = $state<ParticipantRole | null>(null);
	participants = $state<ParticipantSummary[]>([]);

	get hasSession() {
		return this.boardId.length > 0;
	}

	setSession(snapshot: SessionSnapshot) {
		this.actorId = snapshot.actorId;
		this.boardId = snapshot.boardId;
		this.joinCode = snapshot.joinCode;
		this.role = snapshot.role;
		this.participants = snapshot.participants;
	}

	setActorId(actorId: string) {
		this.actorId = actorId;
	}

	setBoardId(boardId: string) {
		this.boardId = boardId;
	}

	setJoinCode(joinCode: string) {
		this.joinCode = joinCode;
	}

	setRole(role: ParticipantRole | null) {
		this.role = role;
	}

	setParticipants(participants: ParticipantSummary[]) {
		this.participants = participants;
	}

	clearSession() {
		this.actorId = '';
		this.boardId = '';
		this.joinCode = '';
		this.role = null;
		this.participants = [];
	}
}

export const appSessionState = new AppSessionState();
