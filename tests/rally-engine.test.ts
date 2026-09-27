import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAssistEventIds } from '../lib/rally-engine';

test('deriveAssistEventIds credits the setter when an attack ends in a kill', () => {
	const assistIds = deriveAssistEventIds([
		{ id: 'set-1', eventType: 'set', athleteId: 'setter' },
		{ id: 'attack-1', eventType: 'attack_attempt', athleteId: 'hitter' },
		{ id: 'kill-1', eventType: 'kill', athleteId: 'hitter' },
	]);

	assert.deepEqual([...assistIds], ['set-1']);
});
