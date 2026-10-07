/** Historical stat-keeper accuracy, split by match so a recompute replaces that match instead of counting it twice. */

export const STAT_ACCURACY_SCHEMA = 'gamepath.stat_accuracy.v1';

export type AccuracySlice = { confirmed: number; total: number };

export type AccuracyFile = {
  schema: typeof STAT_ACCURACY_SCHEMA;
  keepers: Record<string, { matches: Record<string, AccuracySlice> }>;
};

export function emptyAccuracyFile(): AccuracyFile {
  return { schema: STAT_ACCURACY_SCHEMA, keepers: {} };
}

export function historicalAccuracy(file: AccuracyFile, excludeMatchId: string) {
  const accuracy: Record<string, number> = {};
  for (const [mac, keeper] of Object.entries(file.keepers)) {
    let confirmed = 0;
    let total = 0;
    for (const [matchId, slice] of Object.entries(keeper.matches)) {
      if (matchId === excludeMatchId) continue;
      confirmed += slice.confirmed;
      total += slice.total;
    }
    if (total > 0) accuracy[mac] = confirmed / total;
  }
  return accuracy;
}

export function withMatchSlices(file: AccuracyFile, matchId: string, slices: Record<string, AccuracySlice>): AccuracyFile {
  const keepers = Object.fromEntries(Object.entries(file.keepers).map(([mac, keeper]) => {
    const matches = { ...keeper.matches };
    delete matches[matchId];
    return [mac, { matches }];
  }));
  for (const [mac, slice] of Object.entries(slices)) {
    if (slice.total <= 0) continue;
    const keeper = keepers[mac] ?? { matches: {} };
    keepers[mac] = { matches: { ...keeper.matches, [matchId]: slice } };
  }
  return { schema: STAT_ACCURACY_SCHEMA, keepers };
}
