export type Category = 'Electronics' | 'Food & produce' | 'Automotive' | 'General cargo';
export type Jurisdiction = 'Singapore';
export type Role = 'employee' | 'manager';
export interface User {
  id: string;
  name: string;
  role: Role;
  initials: string;
}
export interface Skill {
  id: string;
  name: string;
  category: Category;
  jurisdiction: Jurisdiction;
  description: string;
  tags: string[];
  status: 'Active' | 'Draft';
  updatedAt: string;
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
  status: 'Approved' | 'Pending';
  createdAt: string;
  author: string;
  tags: string[];
  decision?: 'accepted' | 'rejected';
  caseId?: string;
  adpStatus?: 'pending' | 'indexing' | 'ready' | 'publishing' | 'synced' | 'failed';
  original?: { storage: 'cos'; key: string; size: number };
}
export interface Citation {
  id: string;
  title: string;
  excerpt: string;
  sourceName: string;
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
}
export interface Review {
  suggestions: Suggestion[];
  skillIds: string[];
  summary: string;
  mode: 'local' | 'live';
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
  integrations?: IntegrationState;
}
export interface IntegrationState {
  provider: 'local' | 'openai' | 'adp';
  connection: 'local' | 'configured' | 'verified' | 'error';
  checkedAt?: string;
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
