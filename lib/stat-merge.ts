/** Merge independent stat books. The master label is committed; other keepers do not replace it. */

export type StatTouch = { eventType: string; athleteId: string | null };
export type StatRally = { number: number; events: StatTouch[] };

export type StatBook = {
  deviceId: string;
  mac: string;
  label: string;
  master: boolean;
  rallies: StatRally[];
  current: StatTouch[];
};

export type PendingStat = {
  deviceId: string;
  keeper: string;
  mac: string;
  rallyNumber: number;
  events: StatTouch[];
};

export type CommittedTouch = {
  key: string;
  status: 'confirmed' | 'accepted';
  weight: number;
  mac: string;
};

export type MergeResult = {
  touches: CommittedTouch[];
  confidence: number;
  confirmed: number;
  accepted: number;
  pending: PendingStat[];
  slices: Record<string, { confirmed: number; total: number }>;
};

export function touchLabel(touch: StatTouch) {
  return `${touch.eventType}|${touch.athleteId ?? ''}`;
}

export function bookFromMatch(deviceId: string, mac: string, label: string, master: boolean, match: Record<string, unknown>): StatBook {
  const rallies = Array.isArray(match.rallies) ? match.rallies : [];
  return {
    deviceId,
    mac,
    label,
    master,
    rallies: rallies.flatMap((rally) => {
      if (!rally || typeof rally !== 'object' || !('number' in rally) || typeof rally.number !== 'number') return [];
      const events = 'events' in rally && Array.isArray(rally.events) ? rally.events.flatMap(readTouch) : [];
      return [{ number: rally.number, events }];
    }),
    current: Array.isArray(match.current) ? match.current.flatMap(readTouch) : [],
  };
}

export function mergeStatBooks(books: StatBook[], accuracyByMac: Record<string, number>): MergeResult {
  const master = books.find((book) => book.master) ?? null;
  if (!master) {
    return { touches: [], confidence: 0, confirmed: 0, accepted: 0, pending: books.flatMap(pendingBook), slices: {} };
  }
  const masterRallies = new Set(master.rallies.map((rally) => rally.number));
  const currentNumber = nextRallyNumber(master.rallies);
  const touches: CommittedTouch[] = [];
  const slices: Record<string, { confirmed: number; total: number }> = {};
  const credit = (mac: string, confirmed: boolean) => {
    const slice = slices[mac] ?? { confirmed: 0, total: 0 };
    slice.total += 1;
    if (confirmed) slice.confirmed += 1;
    slices[mac] = slice;
  };
  const commit = (rallyNumber: number, index: number, touch: StatTouch) => {
    const key = `${rallyNumber}:${index}`;
    const label = touchLabel(touch);
    const recorded = books.flatMap((book) => {
      const theirs = touchAt(book, rallyNumber, index, currentNumber);
      return theirs ? [{ book, label: touchLabel(theirs) }] : [];
    });
    const agreed = recorded.filter((item) => item.label === label).length;
    const confirmed = agreed >= 2;
    const weight = confirmed ? 1 : accuracyByMac[master.mac] ?? 0;
    touches.push({ key, status: confirmed ? 'confirmed' : 'accepted', weight, mac: master.mac });
    for (const item of recorded) credit(item.book.mac, confirmed && item.label === label);
  };
  for (const rally of master.rallies) rally.events.forEach((touch, index) => commit(rally.number, index, touch));
  master.current.forEach((touch, index) => commit(currentNumber, index, touch));
  const pending = books.filter((book) => book.deviceId !== master.deviceId).flatMap((book) => pendingAgainst(book, master, masterRallies, currentNumber));
  const confirmedCount = touches.filter((touch) => touch.status === 'confirmed').length;
  const confidence = touches.length ? touches.reduce((sum, touch) => sum + touch.weight, 0) / touches.length : 0;
  return { touches, confidence, confirmed: confirmedCount, accepted: touches.length - confirmedCount, pending, slices };
}

function pendingBook(book: StatBook): PendingStat[] {
  const currentNumber = nextRallyNumber(book.rallies);
  return [
    ...book.rallies.filter((rally) => rally.events.length).map((rally) => pendingStat(book, rally.number, rally.events)),
    ...(book.current.length ? [pendingStat(book, currentNumber, book.current)] : []),
  ];
}

function pendingAgainst(book: StatBook, master: StatBook, masterRallies: Set<number>, masterCurrentNumber: number): PendingStat[] {
  const rows: PendingStat[] = [];
  for (const rally of book.rallies) {
    if (!rally.events.length) continue;
    if (!masterRallies.has(rally.number)) {
      rows.push(pendingStat(book, rally.number, rally.events));
      continue;
    }
    const masterRally = master.rallies.find((item) => item.number === rally.number);
    const extra = rally.events.slice(masterRally?.events.length ?? 0);
    if (extra.length) rows.push(pendingStat(book, rally.number, extra));
  }
  if (book.current.length) {
    const bookCurrentNumber = nextRallyNumber(book.rallies);
    const events = bookCurrentNumber === masterCurrentNumber ? book.current.slice(master.current.length) : book.current;
    if (events.length) rows.push(pendingStat(book, bookCurrentNumber, events));
  }
  return rows;
}

function pendingStat(book: StatBook, rallyNumber: number, events: StatTouch[]): PendingStat {
  return { deviceId: book.deviceId, keeper: book.label, mac: book.mac, rallyNumber, events };
}

function touchAt(book: StatBook, rallyNumber: number, index: number, currentNumber: number) {
  if (rallyNumber === currentNumber) return book.current[index] ?? null;
  return book.rallies.find((rally) => rally.number === rallyNumber)?.events[index] ?? null;
}

function nextRallyNumber(rallies: StatRally[]) {
  return rallies.reduce((highest, rally) => Math.max(highest, rally.number), 0) + 1;
}

function readTouch(value: unknown): StatTouch[] {
  if (!value || typeof value !== 'object' || !('eventType' in value) || typeof value.eventType !== 'string' || !value.eventType) return [];
  const athleteId = 'athleteId' in value && typeof value.athleteId === 'string' ? value.athleteId : null;
  return [{ eventType: value.eventType, athleteId }];
}
