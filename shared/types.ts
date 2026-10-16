export type Category = 'Electronics' | 'Food & produce' | 'Automotive' | 'General cargo';
export type Jurisdiction = 'Singapore';
export type Role = 'employee' | 'manager';
export interface User {
  id: string;
  name: string;
  role: Role;
  initials: string;
}
/** A topic the pill refuses to advise on; matching text is routed to a person instead. */
export interface PillBoundary {
  label: string;
  keywords: string[];
}
/** A condition that must leave the AI-supported process and go to a named person. */
export interface PillEscalation {
  trigger: string;
  route: string;
  /** Words in the document that raise this escalation. */
  keywords: string[];
  /** Also escalate whenever the advisor raises a critical finding for this pill. */
  onCritical?: boolean;
}
/** The governed part of an Intelligence Pill: what a release freezes. */
export interface PillDefinition {
  description: string;
  /** User id of the accountable owner. */
  owner: string;
  /** User id of the person who releases changes proposed by the owner (and vice versa). */
  approver: string;
  inScope: string[];
  outOfScope: PillBoundary[];
  guardrails: string[];
  escalations: PillEscalation[];
}
export interface PillRelease {
  version: number;
  releasedAt: string;
  releasedBy: string;
  approvedBy?: string;
  change: string;
  definition: PillDefinition;
  /** The approved knowledge, and the version of each entry, that this release made live. */
  knowledge: { id: string; version: number }[];
}
export interface PillProposal {
  proposedBy: string;
  proposedById: string;
  proposedAt: string;
  note: string;
  definition: PillDefinition;
}
export interface Skill extends PillDefinition {
  id: string;
  name: string;
  category: Category;
  jurisdiction: Jurisdiction;
  tags: string[];
  status: 'Active' | 'Draft';
  updatedAt: string;
  /** Zero until the first release. */
  version: number;
  /** Newest first. */
  releases: PillRelease[];
  pending?: PillProposal;
}
/** Structured form of a reviewer's reasoning: what makes a one-off answer reusable. */
export interface Rule {
  appliesWhen: string;
  check: string;
  exceptions: string;
  evidence: string;
}
export interface KnowledgeVersion {
  version: number;
  title: string;
  content: string;
  tags: string[];
  changedBy: string;
  changedAt: string;
  approvedBy?: string;
  note: string;
}
export interface KnowledgeRevision {
  title: string;
  content: string;
  note: string;
  proposedBy: string;
  proposedById: string;
  proposedAt: string;
}
export interface Knowledge {
  id: string;
  title: string;
  content: string;
  category: Category;
  jurisdiction: Jurisdiction;
  skillId: string;
  sourceType: 'Playbook' | 'Document' | 'Decision';
  sourceName: string;
  /** Pending entries are candidates: they are never used until a second person approves them. */
  status: 'Approved' | 'Pending' | 'Retired';
  createdAt: string;
  author: string;
  authorId?: string;
  tags: string[];
  decision?: 'accepted' | 'rejected';
  /** True when a senior reviewer added a finding the advisor did not raise. */
  missedByAdvisor?: boolean;
  caseId?: string;
  rule?: Rule;
  /** Current version; legacy entries are version 1. */
  version?: number;
  /** Why the current version differs from the one before it. */
  versionNote?: string;
  /** Earlier versions, newest first. */
  history?: KnowledgeVersion[];
  /** A proposed edit to an approved entry; the current version stays live until it is approved. */
  revision?: KnowledgeRevision;
  approvedBy?: string;
  approvedAt?: string;
  retiredBy?: string;
  retiredAt?: string;
  retiredReason?: string;
  adpStatus?: 'pending' | 'indexing' | 'ready' | 'publishing' | 'synced' | 'failed';
  original?: { storage: 'cos'; key: string; size: number };
}
export interface Citation {
  id: string;
  title: string;
  excerpt: string;
  sourceName: string;
  version?: number;
}
export interface Suggestion {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  action: string;
  citations: Citation[];
  decision: 'pending' | 'accepted' | 'rejected';
  comment: string;
  decidedBy?: string;
  /**
   * Where the finding came from: `rule` a deterministic check, `knowledge` approved knowledge
   * retrieved locally, `model` the connected AI, `manager` a reviewer, `boundary` a pill's
   * scope or escalation rule.
   */
  origin?: 'rule' | 'knowledge' | 'model' | 'manager' | 'boundary';
  rule?: Rule;
}
export interface ReviewPill {
  id: string;
  name: string;
  version: number;
}
export interface Review {
  suggestions: Suggestion[];
  skillIds: string[];
  /** The released pill versions that produced this review. */
  pills?: ReviewPill[];
  summary: string;
  mode: 'local' | 'live';
  /** Why the connected AI was not used, when one was configured. */
  fallbackReason?: string;
  createdAt: string;
}
export interface CaseRecord {
  id: string;
  reference: string;
  title: string;
  customer: string;
  category: Category;
  jurisdiction: Jurisdiction;
  documentType: 'Customs declaration' | 'Customer email' | 'Contract';
  content: string;
  /** Legacy records without a revision are revision zero. */
  contentRevision?: number;
  permitNumber: string;
  permitExpiry: string;
  shipmentDate: string;
  warehouseConfirmed: boolean;
  status: 'Draft' | 'In review' | 'Changes requested' | 'Approved';
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string;
  review: Review | null;
}
export interface Activity {
  id: string;
  type: 'review' | 'decision' | 'import' | 'approval' | 'comment' | 'skill';
  title: string;
  detail: string;
  actor: string;
  createdAt: string;
  caseId?: string;
}
export interface CommentAnchor {
  start: number;
  end: number;
  quote: string;
  revision: number;
}
export interface Comment {
  id: string;
  caseId: string;
  author: string;
  content: string;
  createdAt: string;
  anchor?: CommentAnchor;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  skillNames: string[];
  createdAt: string;
  mode?: 'local' | 'live';
  /** Why the connected AI was not used, when one was configured. */
  fallbackReason?: string;
}
export interface AppState {
  user: User;
  users: User[];
  cases: CaseRecord[];
  skills: Skill[];
  knowledge: Knowledge[];
  activity: Activity[];
  comments: Comment[];
  chats: ChatMessage[];
  aiMode: 'local' | 'live';
  demoMode?: boolean;
  integrations?: IntegrationState;
}
export interface IntegrationState {
  provider: 'local' | 'openai' | 'adp';
  connection: 'local' | 'configured' | 'verified' | 'error';
  checkedAt?: string;
  /** Sanitized reason for the most recent failed call to the provider. */
  lastError?: string;
  /** Duration of the most recent successful call, in milliseconds. */
  latencyMs?: number;
  knowledge?: {
    configured: boolean;
    pending: number;
    synced: number;
    failed: number;
    ready: number;
    autoPublish: boolean;
  };
}
export type CaseInput = Pick<
  CaseRecord,
  | 'title'
  | 'customer'
  | 'category'
  | 'jurisdiction'
  | 'documentType'
  | 'content'
  | 'permitNumber'
  | 'permitExpiry'
  | 'shipmentDate'
  | 'warehouseConfirmed'
>;
