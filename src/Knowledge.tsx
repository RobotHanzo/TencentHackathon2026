import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Leaf,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import type { AppState, Category, Knowledge, Skill } from '../shared/types';
import { api } from './api';
import { sourceUrl } from './sources';
import { useMotionSettings } from './motion';
import { Modal } from './Modal';
import { PillPanel, canGovern } from './Pills';

type PageProps = {
  state: AppState;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  initialQuery?: string;
};
const categories: Category[] = ['Electronics', 'Food & produce', 'Automotive', 'General cargo'];
const tabs = ['All knowledge', 'Playbooks', 'Documents', 'Decisions', 'Awaiting approval'] as const;
type Tab = (typeof tabs)[number];
const sourceTypes: Partial<Record<Tab, Knowledge['sourceType']>> = {
  Playbooks: 'Playbook',
  Documents: 'Document',
  Decisions: 'Decision',
};
const adpLabels = {
  pending: 'ADP queued',
  indexing: 'ADP indexing',
  ready: 'ADP awaiting publication',
  publishing: 'ADP publishing',
  synced: 'ADP published',
  failed: 'ADP sync failed',
};

function dateLabel(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? 'Not dated'
    : parsed.toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Singapore',
      });
}

function SkillIcon({ category, size = 21 }: { category: Category; size?: number }) {
  if (category === 'Electronics') return <Cpu size={size} />;
  if (category === 'Food & produce') return <Leaf size={size} />;
  if (category === 'Automotive') return <Truck size={size} />;
  return <Package size={size} />;
}

function categoryClass(category: Category) {
  return category === 'Electronics'
    ? 'electronics'
    : category === 'Food & produce'
      ? 'food'
      : category === 'Automotive'
        ? 'automotive'
        : 'general';
}

function SourceIcon({ type, size = 19 }: { type: Knowledge['sourceType']; size?: number }) {
  return type === 'Playbook' ? (
    <BookOpen size={size} />
  ) : type === 'Decision' ? (
    <CheckCheck size={size} />
  ) : (
    <FileText size={size} />
  );
}

const statusLabel = (item: Knowledge) =>
  item.status === 'Approved'
    ? 'Approved'
    : item.status === 'Pending'
      ? 'Pending approval'
      : item.approvedAt
        ? 'Retired'
        : 'Declined';
const statusTone = (item: Knowledge) =>
  item.status === 'Approved'
    ? 'badge-green'
    : item.status === 'Pending'
      ? 'badge-amber'
      : 'badge-neutral';
const nameOf = (state: AppState, id: string) =>
  state.users.find((user) => user.id === id)?.name ?? id;

export function KnowledgeDetailDialog({
  knowledge,
  state,
  refresh,
  toast,
  onClose,
}: Pick<PageProps, 'state' | 'refresh' | 'toast'> & {
  knowledge: Knowledge;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'view' | 'edit' | 'decline' | 'retire'>('view');
  const [title, setTitle] = useState(knowledge.title);
  const [content, setContent] = useState(knowledge.content);
  const [note, setNote] = useState('');
  const pill = state.skills.find((skill) => skill.id === knowledge.skillId);
  const governs = pill ? canGovern(state, pill) : false;
  const isAuthor = knowledge.authorId
    ? knowledge.authorId === state.user.id
    : knowledge.author === state.user.name;
  const second = pill
    ? nameOf(state, [pill.owner, pill.approver].find((id) => id !== state.user.id) ?? pill.approver)
    : 'a senior reviewer';
  const revision = knowledge.revision;
  const proposedByMe = revision?.proposedById === state.user.id;

  async function run(path: string, method: string, body: object | undefined, message: string) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method, body: body ? JSON.stringify(body) : undefined });
      await refresh();
      setMode('view');
      setNote('');
      toast(message);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'That could not be completed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const base = `/knowledge/${encodeURIComponent(knowledge.id)}`;

  return (
    <Modal title="Knowledge detail" onClose={onClose} busy={busy} wide>
      <div className="modal-body">
        <div className="knowledge-detail-meta">
          <span className={`badge ${statusTone(knowledge)}`}>{statusLabel(knowledge)}</span>
          <span className="tag">{knowledge.sourceType}</span>
          <span className="tag">Singapore</span>
          <span className="tag">Version {knowledge.version ?? 1}</span>
          {knowledge.missedByAdvisor && <span className="tag tag-accent">Added by a reviewer</span>}
        </div>
        <h2>{knowledge.title}</h2>
        <p className="muted">
          {pill?.name ?? knowledge.category} · {knowledge.author} · {dateLabel(knowledge.createdAt)}
        </p>
        <div className="knowledge-detail-content">{knowledge.content}</div>
        {knowledge.rule && (
          <dl className="rule-card" aria-label="Structured rule">
            {knowledge.rule.appliesWhen && (
              <div>
                <dt>Applies when</dt>
                <dd>{knowledge.rule.appliesWhen}</dd>
              </div>
            )}
            {knowledge.rule.check && (
              <div>
                <dt>Check</dt>
                <dd>{knowledge.rule.check}</dd>
              </div>
            )}
            {knowledge.rule.exceptions && (
              <div>
                <dt>Does not apply when</dt>
                <dd>{knowledge.rule.exceptions}</dd>
              </div>
            )}
            {knowledge.rule.evidence && (
              <div>
                <dt>Evidence to attach</dt>
                <dd>{knowledge.rule.evidence}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="knowledge-tags">
          {knowledge.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="knowledge-source">
          <strong>Source</strong>
          {sourceUrl(knowledge.sourceName, knowledge.content) ? (
            <a
              href={sourceUrl(knowledge.sourceName, knowledge.content)}
              target="_blank"
              rel="noreferrer"
            >
              {knowledge.sourceName} <ExternalLink size={13} />
            </a>
          ) : (
            <span>{knowledge.sourceName}</span>
          )}
        </div>
        {(knowledge.approvedBy || knowledge.retiredBy) && (
          <p className="knowledge-provenance">
            {knowledge.status === 'Retired'
              ? `${knowledge.approvedAt ? 'Retired' : 'Declined'} by ${knowledge.retiredBy}${knowledge.retiredReason ? `: ${knowledge.retiredReason}` : ''}`
              : `Approved by ${knowledge.approvedBy}${knowledge.approvedAt ? ` on ${dateLabel(knowledge.approvedAt)}` : ''}`}
            {knowledge.versionNote &&
            knowledge.status === 'Approved' &&
            (knowledge.version ?? 1) > 1
              ? ` · Changed because: ${knowledge.versionNote}`
              : ''}
          </p>
        )}

        {revision && (
          <div className="revision-box" role="status">
            <strong>Revision proposed by {revision.proposedBy}</strong>
            <p>{revision.note}</p>
            <div className="knowledge-detail-content revision-text">
              {revision.title !== knowledge.title && (
                <p>
                  <b>Title:</b> {revision.title}
                </p>
              )}
              {revision.content}
            </div>
            <p className="muted">The current version stays live until a second person approves.</p>
            <div className="pill-actions">
              {governs && (
                <button
                  className="btn btn-primary btn-small"
                  disabled={busy || proposedByMe}
                  title={proposedByMe ? 'A second person must approve a revision you proposed' : ''}
                  onClick={() => run(`${base}/revision/approve`, 'POST', {}, 'Revision approved.')}
                >
                  <Check size={14} />
                  Approve revision
                </button>
              )}
              {(governs || proposedByMe) && (
                <button
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() =>
                    run(`${base}/revision`, 'DELETE', undefined, 'Revision discarded.')
                  }
                >
                  <X size={14} />
                  Discard revision
                </button>
              )}
            </div>
          </div>
        )}

        {knowledge.history && knowledge.history.length > 0 && (
          <details className="pill-history">
            <summary>
              <History size={15} /> Earlier versions{' '}
              <span className="section-count">{knowledge.history.length}</span>
            </summary>
            <ol>
              {knowledge.history.map((item) => (
                <li key={item.version}>
                  <div>
                    <strong>Version {item.version}</strong>
                    <span>{item.note}</span>
                    <small>
                      {item.changedBy} · {dateLabel(item.changedAt)}
                    </small>
                    <div className="knowledge-detail-content revision-text">{item.content}</div>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}

        {knowledge.status === 'Pending' && (
          <p className="form-hint">
            <ShieldCheck size={15} />
            {isAuthor
              ? `A second person must approve this before agents use it: ${second}.`
              : 'The pill owner or approver must approve this before agents use it.'}
          </p>
        )}

        {mode === 'edit' && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                base,
                'PUT',
                { title, content, note },
                knowledge.status === 'Approved'
                  ? 'Revision proposed. A second person must approve it.'
                  : 'Candidate updated.',
              );
            }}
          >
            <label className="field">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                disabled={busy}
              />
            </label>
            <label className="field">
              Content
              <textarea
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            {knowledge.status === 'Approved' && (
              <label className="field">
                Why is this changing?
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            )}
            <div className="inline-form-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setMode('view')}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn btn-primary btn-small" type="submit" disabled={busy}>
                {knowledge.status === 'Approved' ? 'Propose revision' : 'Save'}
              </button>
            </div>
          </form>
        )}
        {(mode === 'decline' || mode === 'retire') && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                `${base}/${mode}`,
                'POST',
                { reason: note },
                mode === 'retire' ? 'Knowledge retired.' : 'Candidate declined.',
              );
            }}
          >
            <label className="field">
              {mode === 'retire' ? 'Why is this being retired?' : 'Why is this being declined?'}
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <div className="inline-form-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setMode('view')}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-small"
                type="submit"
                disabled={busy || !note.trim()}
              >
                {mode === 'retire' ? 'Retire' : 'Decline'}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Close
        </button>
        {mode === 'view' && knowledge.status === 'Pending' && (
          <>
            {(isAuthor || governs) && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => setMode('edit')}>
                <Pencil size={15} />
                Edit
              </button>
            )}
            {(isAuthor || governs) && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setMode('decline')}
              >
                <X size={15} />
                {isAuthor && !governs ? 'Withdraw' : 'Decline'}
              </button>
            )}
            {governs && state.user.role === 'manager' && (
              <button
                className="btn btn-primary"
                disabled={busy || isAuthor}
                title={isAuthor ? `A second person must approve this: ${second}` : ''}
                onClick={() => run(`${base}/publish`, 'POST', undefined, 'Knowledge approved.')}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
                Approve knowledge
              </button>
            )}
          </>
        )}
        {mode === 'view' && knowledge.status === 'Approved' && governs && (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setMode('retire')}>
              <Trash2 size={15} />
              Retire
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => setMode('edit')}>
              <Pencil size={15} />
              Propose edit
            </button>
          </>
        )}
        {mode === 'view' && knowledge.status === 'Retired' && knowledge.approvedAt && governs && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => run(`${base}/restore`, 'POST', undefined, 'Knowledge restored.')}
          >
            <RotateCcw size={15} />
            Restore
          </button>
        )}
      </div>
    </Modal>
  );
}

export function KnowledgePage({ state, refresh, toast, initialQuery = '' }: PageProps) {
  const { reduced, transition } = useMotionSettings();
  const tabIndicatorId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState<Tab>('All knowledge');
  const [category, setCategory] = useState<Category | ''>('');
  const [selectedSkill, setSelectedSkill] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const selected = state.knowledge.find((item) => item.id === selectedId);
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
  // The guided tour asks the page to show a pill or a tab without simulating clicks.
  useEffect(() => {
    const select = (event: Event) => setSelectedSkill((event as CustomEvent<string>).detail ?? '');
    const open = (event: Event) => setTab((event as CustomEvent<Tab>).detail ?? 'All knowledge');
    window.addEventListener('instill:select-pill', select);
    window.addEventListener('instill:select-tab', open);
    return () => {
      window.removeEventListener('instill:select-pill', select);
      window.removeEventListener('instill:select-tab', open);
    };
  }, []);

  const visible = useMemo(
    () =>
      state.knowledge
        .filter((item) => {
          const search = query.trim().toLowerCase();
          return (
            (tab === 'Awaiting approval'
              ? item.status === 'Pending' || Boolean(item.revision)
              : !sourceTypes[tab] || item.sourceType === sourceTypes[tab]) &&
            (!category || item.category === category) &&
            (!selectedSkill || item.skillId === selectedSkill) &&
            (!search ||
              `${item.title} ${item.content} ${item.sourceName} ${item.tags.join(' ')}`
                .toLowerCase()
                .includes(search))
          );
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.knowledge, query, tab, category, selectedSkill],
  );
  const activeSkill = state.skills.find((skill) => skill.id === selectedSkill);
  const tabCount = (item: Tab) =>
    item === 'Awaiting approval'
      ? state.knowledge.filter((entry) => entry.status === 'Pending' || entry.revision).length
      : state.knowledge.filter(
          (entry) => !sourceTypes[item] || entry.sourceType === sourceTypes[item],
        ).length;

  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <h1>Knowledge base</h1>
        <div className="heading-actions">
          <button className="btn btn-secondary" onClick={() => setSkillOpen(true)}>
            <Plus size={15} />
            New pill
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setImportOpen(true)}
            disabled={!state.skills.length}
          >
            <Upload size={17} />
            Import
          </button>
        </div>
      </div>

      <div className="section-heading">
        <h2>
          Intelligence pills <span className="section-count">{state.skills.length}</span>
        </h2>
      </div>
      <div className="skill-grid" data-tour="pill-grid">
        {state.skills.map((skill) => {
          const count = state.knowledge.filter(
            (item) => item.skillId === skill.id && item.status !== 'Retired',
          ).length;
          return (
            <motion.button
              className={`skill-card${selectedSkill === skill.id ? ' selected' : ''}`}
              initial={false}
              whileHover={reduced ? undefined : { y: -2 }}
              whileTap={reduced ? undefined : { scale: 0.99 }}
              transition={transition}
              key={skill.id}
              title={skill.description}
              aria-pressed={selectedSkill === skill.id}
              onClick={() => setSelectedSkill((value) => (value === skill.id ? '' : skill.id))}
            >
              <div className="skill-card-top">
                <span className={`skill-icon ${categoryClass(skill.category)}`}>
                  <SkillIcon category={skill.category} />
                </span>
                <span
                  className={`badge ${skill.status === 'Active' ? 'badge-green' : 'badge-amber'}`}
                >
                  {skill.status === 'Active' && <span className="status-dot" />}
                  {skill.status}
                </span>
              </div>
              <h3>{skill.name}</h3>
              <div className="skill-card-footer">
                <span>
                  {count} {count === 1 ? 'entry' : 'entries'}
                </span>
                <span className="skill-version">
                  {skill.version ? `v${skill.version}` : 'Unreleased'} ·{' '}
                  {nameOf(state, skill.owner).split(' ')[0]}
                </span>
              </div>
            </motion.button>
          );
        })}
        {!state.skills.length && (
          <div className="panel empty-state">
            <Sparkles size={28} />
            <h3>No pills yet</h3>
            <button className="btn btn-secondary" onClick={() => setSkillOpen(true)}>
              New pill
            </button>
          </div>
        )}
      </div>
      {activeSkill && (
        <PillPanel
          key={activeSkill.id}
          state={state}
          pill={activeSkill}
          refresh={refresh}
          toast={toast}
        />
      )}

      <div className="section-heading knowledge-library-heading">
        <h2>Library</h2>
      </div>
      <div className="panel knowledge-panel">
        <div className="knowledge-tabs" role="group" aria-label="Knowledge type">
          {tabs.map((item) => (
            <button
              key={item}
              className={`knowledge-tab${item === tab ? ' active' : ''}`}
              aria-pressed={item === tab}
              data-tour={item === 'Awaiting approval' ? 'approval-tab' : undefined}
              onClick={() => setTab(item)}
            >
              {item}
              <span
                className={`tab-count${item === 'Awaiting approval' && tabCount(item) ? ' tab-count-alert' : ''}`}
              >
                {tabCount(item)}
              </span>
              {item === tab && (
                <motion.span
                  className="motion-tab-indicator"
                  layoutId={reduced ? undefined : `${tabIndicatorId}-knowledge-tab`}
                  initial={false}
                  transition={transition}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
        <div className="knowledge-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge"
              aria-label="Search knowledge"
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <label className="knowledge-filter">
            <SlidersHorizontal size={15} />
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category | '')}
            >
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        {activeSkill && (
          <div className="knowledge-scope">
            <span className="tag">
              {activeSkill.name}
              <button
                className="icon-button"
                onClick={() => setSelectedSkill('')}
                aria-label="Clear skill filter"
              >
                <X size={13} />
              </button>
            </span>
          </div>
        )}
        <div className="knowledge-table">
          <div className="knowledge-table-head" aria-hidden="true">
            <span>NAME</span>
            <span>CATEGORY</span>
            <span>STATUS</span>
            <span>ADDED</span>
            <span />
          </div>
          {visible.map((item) => (
            <button
              className="knowledge-row"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              aria-label={`View ${item.title}`}
            >
              <span className="knowledge-title-cell">
                <span className={`knowledge-file-icon ${item.sourceType.toLowerCase()}`}>
                  <SourceIcon type={item.sourceType} />
                </span>
                <span>
                  <span className="knowledge-title">{item.title}</span>
                  <span className="knowledge-subtitle">
                    {item.sourceType}
                    {item.decision ? ` · Suggestion ${item.decision}` : ''}
                    {item.missedByAdvisor ? ' · Added by a reviewer' : ''}
                    {(item.version ?? 1) > 1 ? ` · v${item.version}` : ''}
                    {item.revision ? ' · Revision proposed' : ''}
                    {item.adpStatus ? ` · ${adpLabels[item.adpStatus]}` : ''}
                  </span>
                </span>
              </span>
              <span className="knowledge-type">
                <span className={`category-dot ${categoryClass(item.category)}`} />
                {item.category}
              </span>
              <span>
                <span className={`badge ${statusTone(item)}`}>
                  {item.status === 'Approved' && <Check size={11} />}
                  {statusLabel(item)}
                </span>
              </span>
              <span className="knowledge-date">{dateLabel(item.createdAt)}</span>
              <ChevronRight size={16} className="muted" />
            </button>
          ))}
          {!visible.length && (
            <div className="empty-state">
              <FolderOpen size={30} />
              <h3>
                {tab === 'Awaiting approval'
                  ? 'Nothing is waiting for approval'
                  : state.knowledge.length
                    ? 'No matching knowledge'
                    : 'No knowledge yet'}
              </h3>
              <p>
                {tab === 'Awaiting approval'
                  ? 'Reviewer decisions and imports appear here until a second person approves them.'
                  : state.knowledge.length
                    ? 'Try a different search or category.'
                    : 'Import a document or notes to get started.'}
              </p>
              {state.knowledge.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setQuery('');
                    setCategory('');
                    setSelectedSkill('');
                    setTab('All knowledge');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
        <div className="knowledge-footer">
          <span>
            {visible.length} of {state.knowledge.length} entries
          </span>
        </div>
      </div>

      {selected && (
        <KnowledgeDetailDialog
          key={selected.id}
          knowledge={selected}
          state={state}
          refresh={refresh}
          toast={toast}
          onClose={() => setSelectedId(null)}
        />
      )}
      {importOpen && (
        <ImportModal
          skills={state.skills}
          selectedSkill={selectedSkill}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await refresh();
            setImportOpen(false);
            toast('Imported. Pending approval.');
          }}
        />
      )}
      {skillOpen && (
        <NewSkillModal
          onClose={() => setSkillOpen(false)}
          onCreated={async () => {
            await refresh();
            setSkillOpen(false);
            toast('Pill created.');
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  skills,
  selectedSkill,
  onClose,
  onImported,
}: {
  skills: Skill[];
  selectedSkill: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'file' | 'notes'>('file');
  const [title, setTitle] = useState('');
  const [skillId, setSkillId] = useState(selectedSkill || skills[0]?.id || '');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  function pickFile(next: File | null) {
    setFile(next);
    setError('');
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !skillId || (mode === 'file' ? !file : !content.trim())) {
      setError('Add a title, select a pill, and provide a document or notes.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.set('title', title.trim());
      data.set('skillId', skillId);
      if (mode === 'file' && file) data.set('file', file);
      else data.set('content', content.trim());
      await api('/knowledge/import', { method: 'POST', body: data });
      await onImported();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Import failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Import knowledge" onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <div className="import-tabs" role="group" aria-label="Import method">
            <button
              type="button"
              className={`btn ${mode === 'file' ? 'btn-secondary active' : 'btn-ghost'}`}
              onClick={() => setMode('file')}
              disabled={busy}
            >
              <Upload size={15} />
              Upload file
            </button>
            <button
              type="button"
              className={`btn ${mode === 'notes' ? 'btn-secondary active' : 'btn-ghost'}`}
              onClick={() => setMode('notes')}
              disabled={busy}
            >
              <FileText size={15} />
              Paste notes
            </button>
          </div>
          {mode === 'file' ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.eml,.csv"
                onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                hidden
                disabled={busy}
              />
              <button
                type="button"
                className={`import-dropzone${file ? ' has-file' : ''}`}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!busy) pickFile(event.dataTransfer.files[0] ?? null);
                }}
              >
                <span className="skill-icon general">
                  {file ? <FileText size={24} /> : <Upload size={24} />}
                </span>
                <strong>{file ? file.name : 'Choose or drop a file'}</strong>
                <span className="muted">
                  {file
                    ? `${(file.size / 1024).toFixed(0)} KB · Click to replace`
                    : 'PDF, DOCX, TXT, MD, EML or CSV · Up to 10 MB'}
                </span>
              </button>
              <p className="form-hint">Scanned PDFs need text recognition (OCR) before import.</p>
            </>
          ) : (
            <label className="field">
              Notes or email
              <textarea
                rows={7}
                placeholder="Paste notes, procedures or an email"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                required
                disabled={busy}
              />
            </label>
          )}
          <label className="field">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Wireless equipment checklist"
              required
              maxLength={200}
              disabled={busy}
            />
          </label>
          <label className="field">
            Pill
            <select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
              required
              disabled={busy}
            >
              {skills.map((skill) => (
                <option value={skill.id} key={skill.id}>
                  {skill.name} · {skill.category}
                </option>
              ))}
            </select>
          </label>
          <p className="form-hint">
            <ShieldCheck size={16} />A second person (the pill owner or approver) must approve this
            before agents use it.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !skillId}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('Electronics');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/skills', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), category, description: description.trim() }),
      });
      await onCreated();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not create the pill. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New pill" onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="field">
            Pill name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              placeholder="Cold-chain food imports"
              disabled={busy}
            />
          </label>
          <label className="field">
            Cargo category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
              disabled={busy}
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              maxLength={1000}
              placeholder="Cargo and procedures covered"
              disabled={busy}
            />
          </label>
          <p className="form-hint">
            A senior reviewer owns the pill and a second one approves it. Add and approve knowledge
            to release v1.
          </p>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !name.trim() || !description.trim()}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Create pill
          </button>
        </div>
      </form>
    </Modal>
  );
}
