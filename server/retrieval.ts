import type { Knowledge, Skill } from '../shared/types.ts';
import type { Workspace } from './store.ts';

const stopWords = new Set(
  'the and for with this that have what does please how can could would should will you your about into from before after need check confirm tell give help some there their them then been more which when where why are was were our has had get new not only use using advice'.split(
    ' ',
  ),
);

/** Light suffix stripping; applied identically to documents and queries. */
export function stem(raw: string): string {
  let word = raw.toLowerCase();
  if (word.length > 4 && word.endsWith('ies')) word = `${word.slice(0, -3)}y`;
  else if (word.length > 5 && word.endsWith('sses')) word = word.slice(0, -2);
  else if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) word = word.slice(0, -1);
  for (const suffix of ['ing', 'ed']) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  if (word.length > 4 && word.endsWith('e')) word = word.slice(0, -1);
  return word;
}

// Words a customs reviewer treats as the same idea. Matching happens on these concepts as well as
// on stems, so "lapsed licence" finds guidance written about an "expired permit". This is a small,
// reviewable domain vocabulary, not a learned embedding.
const conceptGroups: string[][] = [
  [
    'expiry',
    'expire',
    'expired',
    'lapse',
    'lapsed',
    'validity',
    'valid',
    'overdue',
    'renew',
    'renewal',
    'outdated',
    'stale',
  ],
  [
    'permit',
    'licence',
    'license',
    'licensing',
    'certificate',
    'authorisation',
    'authorization',
    'registration',
    'registered',
    'approval',
  ],
  [
    'wireless',
    'bluetooth',
    'radio',
    'rf',
    'wifi',
    'telecom',
    'telecoms',
    'transmitter',
    'antenna',
    'imda',
    'remote',
    'iot',
  ],
  [
    'food',
    'produce',
    'fruit',
    'vegetable',
    'mango',
    'berry',
    'fresh',
    'frozen',
    'perishable',
    'sfa',
    'cold',
  ],
  ['vehicle', 'car', 'auto', 'automotive', 'automobile', 'motor', 'truck', 'spare'],
  ['classification', 'classify', 'tariff', 'hs', 'harmonised', 'harmonized', 'heading'],
  [
    'guarantee',
    'promise',
    'assure',
    'unconditional',
    'definitely',
    'certain',
    'cleared',
    'clearance',
  ],
  [
    'invoice',
    'packing',
    'manifest',
    'bill',
    'lading',
    'document',
    'documentation',
    'paperwork',
    'evidence',
    'proof',
  ],
  ['customer', 'buyer', 'client', 'consignee', 'importer', 'recipient'],
  ['warehouse', 'storage', 'receiving', 'delivery', 'handover'],
];
const conceptOf = new Map<string, string>();
conceptGroups.forEach((group, index) => {
  for (const word of group) conceptOf.set(stem(word), `concept:${index}`);
});

/** Words worth matching: three letters or more, plus short domain terms such as "rf" and "hs". */
const words = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter(
    (word) => !stopWords.has(word) && (word.length >= 3 || conceptOf.has(stem(word))),
  );
export const tokens = (text: string): string[] => [...new Set(words(text).map(stem))];
/** Stems plus the concepts they belong to. */
const expand = (stems: string[]) => [
  ...new Set(
    stems.flatMap((word) => (conceptOf.has(word) ? [word, conceptOf.get(word)!] : [word])),
  ),
];

export const overlap = (query: string[], text: string) => {
  const words = new Set(tokens(text));
  return query.filter((word) => words.has(word)).length;
};

export interface Ranked {
  item: Knowledge;
  score: number;
}

/**
 * BM25 over the approved knowledge of the given pills, with concept expansion on both sides.
 * Deterministic and offline, so the same case always retrieves the same sources.
 */
export function rank(workspace: Workspace, text: string, skills: Skill[]): Ranked[] {
  const ids = new Set(skills.map((skill) => skill.id));
  const pool = workspace.knowledge.filter(
    (item) => item.status === 'Approved' && ids.has(item.skillId),
  );
  const stems = tokens(text).slice(0, 60);
  const query = expand(stems);
  if (!pool.length || !query.length) return [];
  // One shared generic word ("explain") is not evidence; ask for two distinct ideas in common.
  const required = Math.min(2, stems.length);
  const docs = pool.map((item) => {
    const bag = new Map<string, number>();
    // Title and tags count double: they say what an entry is about.
    const body = `${item.title} ${item.title} ${item.tags.join(' ')} ${item.tags.join(' ')} ${item.content}`;
    for (const raw of words(body)) {
      const word = stem(raw);
      bag.set(word, (bag.get(word) ?? 0) + 1);
      const concept = conceptOf.get(word);
      if (concept) bag.set(concept, (bag.get(concept) ?? 0) + 1);
    }
    return { item, bag, length: [...bag.values()].reduce((sum, count) => sum + count, 0) };
  });
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const k1 = 1.2;
  const b = 0.75;
  return docs
    .map((doc) => {
      let score = 0;
      const shared = stems.filter(
        (word) => doc.bag.has(word) || (conceptOf.has(word) && doc.bag.has(conceptOf.get(word)!)),
      ).length;
      if (shared < required) return { item: doc.item, score: 0 };
      for (const term of query) {
        const frequency = doc.bag.get(term) ?? 0;
        if (!frequency) continue;
        const containing = docs.filter((other) => other.bag.has(term)).length;
        const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
        score +=
          (idf * frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * doc.length) / average));
      }
      // A senior reviewer's recorded decision is the most specific evidence for a similar case.
      if (doc.item.sourceType === 'Decision') score *= 1.25;
      return { item: doc.item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function retrieve(
  workspace: Workspace,
  text: string,
  skills: Skill[],
  limit = 6,
): Knowledge[] {
  return rank(workspace, text, skills)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/**
 * A wider shortlist for the connected model to judge. Lexical ranking is a recall step: the model
 * decides which of these actually apply, so a precedent no longer needs to share words with a case.
 * Every recorded decision for the routed pills is always offered.
 */
export function candidates(
  workspace: Workspace,
  text: string,
  skills: Skill[],
  limit = 12,
): Knowledge[] {
  const ranked = rank(workspace, text, skills).map((entry) => entry.item);
  const ids = new Set(skills.map((skill) => skill.id));
  const decisions = workspace.knowledge.filter(
    (item) => item.status === 'Approved' && item.sourceType === 'Decision' && ids.has(item.skillId),
  );
  const rest = workspace.knowledge.filter(
    (item) => item.status === 'Approved' && ids.has(item.skillId),
  );
  return [
    ...new Map([...ranked, ...decisions, ...rest].map((item) => [item.id, item])).values(),
  ].slice(0, limit);
}
