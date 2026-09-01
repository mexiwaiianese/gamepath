export type AthleteSeed = {
  id: string;
  name: string;
  jersey: number;
  position: string;
};

export type MatchSeed = {
  matchId: string;
  team: string;
  opponent: string;
  date: string;
  sets: number[];
  lineup: string[];
};

export const athletes: AthleteSeed[] = [
  { id: 'a1', name: 'Maya Chen', jersey: 1, position: 'Libero' },
  { id: 'a2', name: 'Jasmine Ortiz', jersey: 3, position: 'Outside Hitter' },
  { id: 'a3', name: 'Ava Brooks', jersey: 5, position: 'Middle Blocker' },
  { id: 'a4', name: 'Sofia Reed', jersey: 7, position: 'Setter' },
  { id: 'a5', name: 'Nia Patel', jersey: 9, position: 'Opposite' },
  { id: 'a6', name: 'Lena Foster', jersey: 11, position: 'Outside Hitter' },
  { id: 'a7', name: 'Ella Nguyen', jersey: 15, position: 'Middle Blocker' },
  { id: 'a8', name: 'Harper Singh', jersey: 18, position: 'Defensive Specialist' },
];

export const fictionalMatch: MatchSeed = {
  matchId: 'match-2026-08-18-vs-riverton',
  team: 'North Valley High',
  opponent: 'Riverton Prep',
  date: '2026-08-18',
  sets: [25, 22, 25],
  lineup: ['a4', 'a2', 'a3', 'a5', 'a6', 'a7'],
};

export const rosterSummary = {
  organization: 'North Valley Athletics',
  program: 'Varsity Volleyball',
  team: 'North Valley High',
  season: '2026 Fall',
  athleteCount: athletes.length,
};
