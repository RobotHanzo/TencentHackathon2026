import type {
  Category,
  Knowledge,
  PillDefinition,
  PillRelease,
  Skill,
  User,
} from '../shared/types.ts';
import type { Workspace } from './store.ts';

type Boundaries = Pick<PillDefinition, 'inScope' | 'outOfScope' | 'guardrails' | 'escalations'>;

/** Starting scope, guardrails and escalation rules for each built-in goods category. */
export const categoryDefaults: Record<Category, Boundaries> = {
  Electronics: {
    inScope: [
      'Spot wireless and telecom goods that may need an IMDA route',
      'Check that licence or registration evidence is recorded and in date',
      'Hand cross-category goods, such as vehicle accessories, to the other pill',
    ],
    outOfScope: [
      {
        label: 'Radio-frequency or EMC conformity testing',
        keywords: ['emc test', 'conformity assessment', 'radiated power', 'sar test'],
      },
    ],
    guardrails: [
      'Never state that IMDA has approved or registered a product',
      'Treat a licence number as a claim, not as evidence that it is valid',
      'Recommend only; a senior reviewer decides',
    ],
    escalations: [
      {
        trigger: 'A critical licence or permit finding is raised',
        route: 'The pill owner decides whether the declaration may proceed',
        keywords: [],
        onCritical: true,
      },
      {
        trigger: 'Dual-use or encryption features are mentioned',
        route: 'Group trade-compliance officer, outside Instill',
        keywords: ['dual-use', 'strategic goods', 'military', 'encryption'],
      },
    ],
  },
  'Food & produce': {
    inScope: [
      'Separate fresh produce from processed food before choosing the SFA route',
      'Check importer licence or registration evidence',
      'Confirm receiving and cold-chain arrangements before promising delivery',
    ],
    outOfScope: [
      {
        label: 'Food safety or quality assessment',
        keywords: ['food safety', 'quality inspection', 'pesticide', 'residue', 'lab test'],
      },
      { label: 'Halal or organic certification', keywords: ['halal', 'organic'] },
    ],
    guardrails: [
      'Never promise delivery before receiving arrangements are confirmed',
      'Do not infer the SFA route from the commercial product name alone',
      'Recommend only; a senior reviewer decides',
    ],
    escalations: [
      {
        trigger: 'A critical licence or permit finding is raised',
        route: 'The pill owner decides whether the shipment may proceed',
        keywords: [],
        onCritical: true,
      },
      {
        trigger: 'Meat, poultry, seafood, dairy or eggs are mentioned',
        route: 'Senior reviewer, using SFA guidance outside Instill',
        keywords: ['meat', 'poultry', 'seafood', 'dairy', 'eggs'],
      },
    ],
  },
  Automotive: {
    inScope: [
      'Review vehicle parts and accessories for hidden radio or wireless components',
      'Hand wireless accessories to the electronics pill',
      'Check shipment evidence and the inputs needed for classification',
    ],
    outOfScope: [
      {
        label: 'Vehicle type approval or roadworthiness',
        keywords: ['type approval', 'roadworthiness', 'vehicle registration'],
      },
    ],
    guardrails: [
      'Do not copy a previous HS classification without checking the product facts',
      'Recommend only; a senior reviewer decides',
    ],
    escalations: [
      {
        trigger: 'A critical finding is raised',
        route: 'The pill owner decides whether the declaration may proceed',
        keywords: [],
        onCritical: true,
      },
      {
        trigger: 'Whole or second-hand vehicles are mentioned',
        route: 'Senior reviewer; vehicle imports follow a separate regime',
        keywords: ['used vehicle', 'second-hand vehicle', 'whole vehicle', 'parallel import'],
      },
    ],
  },
  'General cargo': {
    inScope: [
      'Check importer readiness (UEN, Customs Account) and the TradeNet route',
      'Reconcile invoice, packing list and declaration facts',
      'Keep customer wording conditional until clearance is evidenced',
    ],
    outOfScope: [
      {
        label: 'Legal advice or interpretation of the Customs Act',
        keywords: ['legal advice', 'customs act', 'liability'],
      },
      {
        label: 'Duty or GST calculation',
        keywords: ['gst calculation', 'duty calculation', 'duty payable'],
      },
    ],
    guardrails: [
      'Never state that clearance is guaranteed or complete without evidence',
      'Senior approval is internal; it does not submit a declaration or send an email',
      'Recommend only; a senior reviewer decides',
    ],
    escalations: [
      {
        trigger: 'A critical finding is raised',
        route: 'The pill owner decides whether the declaration may proceed',
        keywords: [],
        onCritical: true,
      },
      {
        trigger: 'Sanctioned, restricted or prohibited goods are mentioned',
        route: 'Group trade-compliance officer, outside Instill',
        keywords: ['sanction', 'sanctioned', 'prohibited', 'restricted goods', 'embargo'],
      },
    ],
  },
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const definitionOf = (skill: PillDefinition): PillDefinition => ({
  description: skill.description,
  owner: skill.owner,
  approver: skill.approver,
  inScope: clone(skill.inScope),
  outOfScope: clone(skill.outOfScope),
  guardrails: clone(skill.guardrails),
  escalations: clone(skill.escalations),
});

/** Owners and approvers are the two named people accountable for a pill. */
export const isGovernor = (skill: Skill, user: User) =>
  user.role === 'manager' && (skill.owner === user.id || skill.approver === user.id);

export const userName = (workspace: Workspace, id: string) =>
  workspace.users.find((user) => user.id === id)?.name ?? id;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The first keyword found as a whole word or phrase, or undefined. */
export const mentions = (text: string, keywords: string[]): string | undefined =>
  keywords.find((keyword) =>
    keyword.trim()
      ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword.trim())}($|[^a-z0-9])`, 'i').test(text)
      : false,
  );

export const approvedSnapshot = (workspace: Workspace, skillId: string) =>
  workspace.knowledge
    .filter((item) => item.skillId === skillId && item.status === 'Approved')
    .map((item) => ({ id: item.id, version: item.version ?? 1 }));

/** A release freezes the pill's definition and the exact approved knowledge it makes live. */
export function recordRelease(
  workspace: Workspace,
  skill: Skill,
  now: Date,
  releasedBy: string,
  change: string,
  approvedBy?: string,
): PillRelease {
  const release: PillRelease = {
    version: skill.version + 1,
    releasedAt: now.toISOString(),
    releasedBy,
    ...(approvedBy ? { approvedBy } : {}),
    change,
    definition: definitionOf(skill),
    knowledge: approvedSnapshot(workspace, skill.id),
  };
  skill.version = release.version;
  skill.releases.unshift(release);
  if (skill.releases.length > 60) skill.releases.length = 60;
  skill.status = 'Active';
  skill.updatedAt = release.releasedAt;
  return release;
}

/** Make `version` the live version of an entry, keeping every other version in its history. */
export function setKnowledgeVersion(entry: Knowledge, version: number): boolean {
  const current = entry.version ?? 1;
  if (current === version) return true;
  const target = entry.history?.find((item) => item.version === version);
  if (!target) return false;
  entry.history = [
    {
      version: current,
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      changedBy: entry.approvedBy ?? entry.author,
      changedAt: entry.approvedAt ?? entry.createdAt,
      ...(entry.approvedBy ? { approvedBy: entry.approvedBy } : {}),
      note: entry.versionNote ?? 'Initial version',
    },
    ...(entry.history ?? []).filter((item) => item.version !== version),
  ].sort((a, b) => b.version - a.version);
  entry.title = target.title;
  entry.content = target.content;
  entry.tags = target.tags;
  entry.version = target.version;
  entry.versionNote = target.note;
  return true;
}

/** The next version number is never reused, even after a rollback. */
export const nextKnowledgeVersion = (entry: Knowledge) =>
  Math.max(entry.version ?? 1, ...(entry.history ?? []).map((item) => item.version)) + 1;

/**
 * Restore a previous release: its definition, and for every entry the version that was live then.
 * Entries approved since are retired, and the rollback itself becomes a new release.
 */
export function rollbackPill(
  workspace: Workspace,
  skill: Skill,
  target: PillRelease,
  now: Date,
  actor: string,
) {
  const stamp = now.toISOString();
  Object.assign(skill, definitionOf(target.definition));
  const live = new Map(target.knowledge.map((item) => [item.id, item.version]));
  for (const entry of workspace.knowledge.filter((item) => item.skillId === skill.id)) {
    const version = live.get(entry.id);
    if (version !== undefined) {
      if (!setKnowledgeVersion(entry, version)) continue;
      if (entry.status !== 'Approved') {
        entry.status = 'Approved';
        entry.approvedBy = actor;
        entry.approvedAt = stamp;
        delete entry.retiredBy;
        delete entry.retiredAt;
        delete entry.retiredReason;
      }
      delete entry.revision;
    } else if (entry.status === 'Approved') {
      entry.status = 'Retired';
      entry.retiredBy = actor;
      entry.retiredAt = stamp;
      entry.retiredReason = `Not part of release v${target.version}`;
      delete entry.revision;
    }
  }
  delete skill.pending;
  return recordRelease(workspace, skill, now, actor, `Rolled back to v${target.version}`, actor);
}

/** Fill governance fields for workspaces saved before they existed. Idempotent. */
export function normalizeWorkspace(workspace: Workspace) {
  const managers = workspace.users.filter((user) => user.role === 'manager');
  const owner = managers[0]?.id ?? workspace.users[0]?.id ?? '';
  const approver = managers[1]?.id ?? owner;
  for (const skill of workspace.skills) {
    const defaults = categoryDefaults[skill.category];
    skill.owner ??= owner;
    skill.approver ??= approver;
    skill.inScope ??= skill.status === 'Active' ? clone(defaults.inScope) : [];
    skill.outOfScope ??= skill.status === 'Active' ? clone(defaults.outOfScope) : [];
    skill.guardrails ??=
      skill.status === 'Active'
        ? clone(defaults.guardrails)
        : ['Recommend only; a senior reviewer decides'];
    skill.escalations ??= skill.status === 'Active' ? clone(defaults.escalations) : [];
    skill.releases ??= [];
    skill.version ??= 0;
  }
  for (const item of workspace.knowledge) item.version ??= 1;
  for (const skill of workspace.skills) {
    if (skill.status === 'Active' && skill.version === 0) {
      const at = new Date(Date.parse(skill.updatedAt) || Date.now());
      recordRelease(workspace, skill, at, 'Migration', 'Initial release (existing pill)');
    }
  }
}
