export type TeamSide = 'home' | 'away';

export type RallyEventLike = {
	id: string;
	eventType: string;
	athleteId?: string | null;
};

export type ServeState = {
	servingTeam: TeamSide;
	lineup: string[];
	currentServerId: string | null;
};

const labels: Record<string, string> = {
	serve_attempt: 'Serve', ace: 'Ace', serve_error: 'Service Error',
	reception_attempt: 'Receive', reception_error: 'Reception Error',
	dig: 'Dig', pass: 'Pass', set: 'Set', setting_error: 'Setting Error',
	attack_attempt: 'Attack', kill: 'Kill', attack_error: 'Attack Error',
	attack_in_play: 'Attack In Play', attack_blocked: 'Blocked',
	solo_block: 'Solo Block', block_assist: 'Block Assist', block_error: 'Block Error',
	joust: 'Joust', point_for: 'Point For', point_against: 'Point Against',
	substitution: 'Substitution',
};

export function humanEventLabel(eventType: string): string {
	return labels[eventType] ?? eventType;
}

export function nextInferredEventType(events: ReadonlyArray<RallyEventLike>, servingTeam: TeamSide): string {
	if (events.length === 0) return servingTeam === 'away' ? 'reception_attempt' : 'select_server';
	switch (events[events.length - 1].eventType) {
		case 'serve_attempt': return 'dig';
		case 'reception_attempt':
		case 'dig':
		case 'pass': return 'set';
		case 'set': return 'attack_attempt';
		default: return 'dig';
	}
}

export function deriveAssistEventIds(events: ReadonlyArray<RallyEventLike>): Set<string> {
	const assists = new Set<string>();
	let setId: string | null = null;
	for (const event of events) {
		if (event.eventType === 'set') setId = event.id;
		else if (event.eventType === 'kill') {
			if (setId) assists.add(setId);
			setId = null;
		} else if (['attack_error', 'attack_blocked', 'attack_in_play'].includes(event.eventType)) setId = null;
	}
	return assists;
}

export function rotateLineup(lineup: ReadonlyArray<string>): string[] {
	return lineup.length ? [...lineup.slice(1), lineup[0]] : [];
}

export function resolveServeStateAfterPoint(before: ServeState, winner: TeamSide): ServeState {
	if (before.servingTeam === winner) return { ...before, lineup: [...before.lineup] };
	if (winner === 'home') {
		const lineup = rotateLineup(before.lineup);
		return { servingTeam: 'home', lineup, currentServerId: lineup[0] ?? null };
	}
	return { servingTeam: 'away', lineup: [...before.lineup], currentServerId: null };
}
