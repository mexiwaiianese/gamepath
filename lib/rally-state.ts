import type { RallyEventLike, TeamSide } from './rally-engine';

export function nextActionGuidance(
	events: ReadonlyArray<RallyEventLike>,
	servingTeam: TeamSide,
	serverJersey: number | null,
	pendingServer: boolean,
): string {
	if (events.length === 0) {
		if (servingTeam === 'away') return 'Select Receiver';
		if (pendingServer) return `#${serverJersey ?? '?'} Selected • Tap Serve`;
		return serverJersey ? `#${serverJersey}` : 'Select Server';
	}

	switch (events[events.length - 1].eventType) {
		case 'serve_attempt': return 'Rally In Progress';
		case 'reception_attempt':
		case 'dig':
		case 'pass': return 'Select Setter';
		case 'set': return 'Select Attacker';
		case 'attack_attempt': return 'Choose Result';
		default: return 'Select Player';
	}
}
