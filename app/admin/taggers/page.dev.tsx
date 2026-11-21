import { taggerRosterStore } from '@/lib/tagger-roster-store';

import TaggerRoster from './tagger-roster';

export default async function TaggersPage() {
  const taggers = await taggerRosterStore().list();
  return <TaggerRoster initialTaggers={taggers} />;
}
