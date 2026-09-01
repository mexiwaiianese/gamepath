export type VolleyballEvent = {
  eventType: string;
  team: string;
  athleteId?: string;
  success?: boolean;
  rating?: number;
};

export type PlayerStatSummary = {
  attackAttempts: number;
  kills: number;
  attackErrors: number;
  hittingPercentage: number;
  killPercentage: number;
  attackErrorPercentage: number;
  serveAttempts: number;
  aces: number;
  acePercentage: number;
  receptionAttempts: number;
  averageReceptionRating: number;
  receptionErrors: number;
  receptionErrorRate: number;
  digs: number;
  digsPerSet: number;
  assists: number;
  assistsPerSet: number;
};

export type TeamStatSummary = {
  serveAttempts: number;
  successfulServes: number;
  aces: number;
  acePercentage: number;
  serveInPercentage: number;
  receptionAttempts: number;
  averageReceptionRating: number;
  receptionErrors: number;
  receptionErrorRate: number;
  digs: number;
  digsPerSet: number;
  assists: number;
  assistsPerSet: number;
  sideOutPercentage: number;
  teamErrorRate: number;
};

export function calculatePlayerStats(
  events: ReadonlyArray<VolleyballEvent>,
  athleteId: string,
): PlayerStatSummary {
  const attackAttempts = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'attack_attempt',
  ).length;
  const kills = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'kill',
  ).length;
  const attackErrors = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'attack_error',
  ).length;

  const serveAttempts = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'serve_attempt',
  ).length;
  const aces = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'ace',
  ).length;

  const receptionAttempts = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'reception_attempt',
  ).length;
  const receptionRatings = events
    .filter((event) => event.athleteId === athleteId && event.eventType === 'reception_attempt')
    .map((event) => event.rating ?? 0);
  const receptionErrors = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'reception_error',
  ).length;

  const digs = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'dig',
  ).length;
  const assists = events.filter(
    (event) => event.athleteId === athleteId && event.eventType === 'assist',
  ).length;

  const hittingPercentage = attackAttempts === 0 ? 0 : ((kills + 0 - attackErrors) / attackAttempts) * 100;
  const killPercentage = attackAttempts === 0 ? 0 : (kills / attackAttempts) * 100;
  const attackErrorPercentage = attackAttempts === 0 ? 0 : (attackErrors / attackAttempts) * 100;
  const acePercentage = serveAttempts === 0 ? 0 : (aces / serveAttempts) * 100;
  const averageReceptionRating = receptionAttempts === 0 ? 0 : receptionRatings.reduce((sum, rating) => sum + rating, 0) / receptionAttempts;
  const receptionErrorRate = receptionAttempts === 0 ? 0 : (receptionErrors / receptionAttempts) * 100;

  return {
    attackAttempts,
    kills,
    attackErrors,
    hittingPercentage,
    killPercentage,
    attackErrorPercentage,
    serveAttempts,
    aces,
    acePercentage,
    receptionAttempts,
    averageReceptionRating,
    receptionErrors,
    receptionErrorRate,
    digs,
    digsPerSet: digs,
    assists,
    assistsPerSet: assists,
  };
}

export function calculateTeamStats(events: ReadonlyArray<VolleyballEvent>): TeamStatSummary {
  const serveAttempts = events.filter((event) => event.eventType === 'serve_attempt').length;
  const successfulServes = events.filter((event) => event.eventType === 'successful_serve').length;
  const aces = events.filter((event) => event.eventType === 'ace').length;
  const receptionAttempts = events.filter((event) => event.eventType === 'reception_attempt').length;
  const receptionRatings = events
    .filter((event) => event.eventType === 'reception_attempt')
    .map((event) => event.rating ?? 0);
  const receptionErrors = events.filter((event) => event.eventType === 'reception_error').length;
  const digs = events.filter((event) => event.eventType === 'dig').length;
  const assists = events.filter((event) => event.eventType === 'assist').length;
  const attackErrors = events.filter((event) => event.eventType === 'attack_error').length;
  const totalTeamActions = events.length;

  const acePercentage = serveAttempts === 0 ? 0 : (aces / serveAttempts) * 100;
  const serveInPercentage = serveAttempts === 0 ? 0 : (successfulServes / serveAttempts) * 100;
  const averageReceptionRating = receptionAttempts === 0 ? 0 : receptionRatings.reduce((sum, rating) => sum + rating, 0) / receptionAttempts;
  const receptionErrorRate = receptionAttempts === 0 ? 0 : (receptionErrors / receptionAttempts) * 100;
  const digsPerSet = digs;
  const assistsPerSet = assists;
  const sideOutPercentage = 0;
  const teamErrorRate = totalTeamActions === 0 ? 0 : (attackErrors + receptionErrors) / totalTeamActions * 100;

  return {
    serveAttempts,
    successfulServes,
    aces,
    acePercentage,
    serveInPercentage,
    receptionAttempts,
    averageReceptionRating,
    receptionErrors,
    receptionErrorRate,
    digs,
    digsPerSet,
    assists,
    assistsPerSet,
    sideOutPercentage,
    teamErrorRate,
  };
}
