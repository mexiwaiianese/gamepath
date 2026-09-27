export type TeamLevel = 'grade' | 'freshman' | 'jv' | 'varsity';
export type ScoringType = 'rally' | 'side-out';

export type Athlete = {
  id: string;
  jersey: number;
  firstName: string;
  lastName: string;
  positions: string[];
  libero?: boolean;
};

export type Coach = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
};

export type TeamProfile = {
  district: string;
  schoolName: string;
  level: TeamLevel;
  grade: string;
};

export type Season = {
  id: string;
  name: string;
  starters: string[];
};

export type MatchSetup = {
  opponent: string;
  numberOfSets: number;
  scoringType: ScoringType;
  pointsToWin: number;
  liberoIds: string[];
};

export function isLibero(athlete: Athlete): boolean {
  return athlete.libero === true || athlete.positions.includes('Libero');
}

export function normalizeSeasonStarters(season: Season, availablePlayers: Athlete[]): Season {
  const eligible = availablePlayers.filter((athlete) => !isLibero(athlete));
  const validIds = new Set(eligible.map((athlete) => athlete.id));
  const starters = [...new Set(season.starters.filter((id) => validIds.has(id)))].slice(0, 6);
  for (const athlete of eligible) {
    if (starters.length === 6) break;
    if (!starters.includes(athlete.id)) starters.push(athlete.id);
  }
  return { ...season, starters };
}

export function pointAwardedTo(
  scoringType: ScoringType,
  servingTeam: 'home' | 'away',
  rallyWinner: 'home' | 'away',
): 'home' | 'away' | null {
  if (scoringType === 'rally' || servingTeam === rallyWinner) return rallyWinner;
  return null;
}

export const positionOptions = [
  'Setter',
  'Outside Hitter',
  'Opposite',
  'Middle Blocker',
  'Libero',
  'Defensive Specialist',
] as const;

type LegacyAthlete = Partial<Athlete> & {
  name?: string;
  position?: string;
};

export function migrateAthlete(value: LegacyAthlete): Athlete {
  const [firstName = '', ...lastNames] = (value.name ?? '').trim().split(/\s+/);
  const positions = Array.isArray(value.positions)
    ? value.positions
    : value.position
      ? [value.position]
      : [];

  return {
    id: value.id ?? `athlete-${Math.random().toString(36).slice(2, 9)}`,
    jersey: Number(value.jersey ?? 0),
    firstName: value.firstName ?? firstName,
    lastName: value.lastName ?? lastNames.join(' '),
    positions,
    libero: value.libero ?? positions.includes('Libero'),
  };
}
