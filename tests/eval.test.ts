import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../server/seed.ts';
import { routeSkills } from '../server/advisor.ts';
import { rank } from '../server/retrieval.ts';

/**
 * A small labelled set for the local advisor. The cases were written by the team after the
 * retrieval code, so this checks for regressions and compares methods; it is not an independent
 * accuracy claim. The concept vocabulary in server/retrieval.ts is hand-written for this domain.
 */
const workspace = seedWorkspace(new Date('2026-10-14T03:00:00Z'));

const stop = new Set(
  'the and for with this that have what does please how can could would should will you your about into from before after need check confirm tell give help some there their them then been more which when where why are was were our has had get new not only use using advice'.split(
    ' ',
  ),
);
// The word-overlap method the advisor used before concept-aware ranking.
const words = (text: string) => [
  ...new Set(
    (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
      .filter((word) => !stop.has(word))
      .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)),
  ),
];
const overlapRanking = (query: string) => {
  const wanted = words(query);
  return workspace.knowledge
    .map((item) => {
      const own = new Set(words(`${item.title} ${item.content} ${item.tags.join(' ')}`));
      return { id: item.id, hits: wanted.filter((word) => own.has(word)).length };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => entry.id);
};

const retrievalSet: { query: string; accept: string[] }[] = [
  { query: 'the authorisation lapsed before the vessel sailed', accept: ['kb-expiry'] },
  { query: 'overdue paperwork for the transmitter', accept: ['kb-expiry', 'kb-imda'] },
  {
    query: 'will the buyer be told it is certain to arrive tomorrow',
    accept: ['kb-communication'],
  },
  { query: 'handover of perishable goods at the dock', accept: ['kb-warehouse'] },
  { query: 'tariff heading for an automobile spare', accept: ['kb-auto'] },
  { query: 'an rf module inside a key fob', accept: ['kb-auto', 'kb-imda'] },
  { query: 'importer registration and customs login', accept: ['kb-customs'] },
  {
    query: 'is the fruit fresh or has it been through a factory',
    accept: ['kb-processed', 'kb-food'],
  },
  { query: 'is the permit still valid on the shipping date', accept: ['kb-expiry'] },
  { query: 'bluetooth transmitter radio approval needed', accept: ['kb-imda'] },
];

test('concept-aware ranking finds the right source for paraphrased questions far more often than word overlap', () => {
  let ranked = 0;
  let overlap = 0;
  for (const { query, accept } of retrievalSet) {
    const top = rank(workspace, query, workspace.skills)
      .slice(0, 3)
      .map((entry) => entry.item.id);
    const baseline = overlapRanking(query).slice(0, 3);
    const found = accept.some((id) => top.includes(id));
    if (found) ranked++;
    if (accept.some((id) => baseline.includes(id))) overlap++;
    assert.ok(
      found,
      `"${query}" should retrieve one of ${accept.join(', ')} in the top 3, got ${top.join(', ')}`,
    );
  }
  console.log(
    `[eval] recall@3 on ${retrievalSet.length} paraphrased questions: concept-aware ${ranked}, word overlap ${overlap}`,
  );
  assert.ok(ranked >= retrievalSet.length - 1);
  assert.ok(ranked > overlap, 'The new ranking must beat the method it replaced.');
});

test('questions unrelated to the pills retrieve nothing, so the advisor abstains', () => {
  for (const query of [
    'explain quantum entanglement in a vacuum',
    'how do I bake sourdough bread',
    'best hiking trails near the reservoir',
  ])
    assert.deepEqual(rank(workspace, query, workspace.skills), [], query);
});

const routingSet: {
  text: string;
  category?: 'Electronics' | 'Food & produce' | 'Automotive' | 'General cargo';
  expect: string[];
}[] = [
  {
    text: 'Shipment of 240 Bluetooth environmental sensors from Shenzhen',
    expect: ['electronics', 'general'],
  },
  {
    text: 'Fresh mango shipment arriving at Changi Airfreight Centre',
    expect: ['food', 'general'],
  },
  {
    text: 'Wireless car remote controls for Singapore',
    category: 'Automotive',
    expect: ['automotive', 'electronics', 'general'],
  },
  { text: 'Commercial invoice and packing list for office chairs', expect: ['general'] },
  { text: 'Frozen berries importer licence', expect: ['food', 'general'] },
  { text: 'Explain quantum entanglement', expect: [] },
];

test('routing selects exactly the pills a case needs', () => {
  for (const item of routingSet) {
    const chosen = routeSkills(workspace, item.text, item.category)
      .map((skill) => skill.id)
      .sort();
    assert.deepEqual(chosen, [...item.expect].sort(), item.text);
  }
});

test('a recorded senior decision is retrieved for a case that describes the same issue in other words', () => {
  const precedent = workspace.knowledge.find((item) => item.id === 'kb-previous-decision')!;
  const skills = workspace.skills.filter((skill) => skill.id === precedent.skillId);
  const top = rank(
    workspace,
    'The customer says the sensor module with a radio transmitter is only an electronic accessory',
    skills,
  );
  assert.equal(top[0]?.item.id, precedent.id);
});
