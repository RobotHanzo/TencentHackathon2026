import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Leaf,
  LoaderCircle,
  Package,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import type { AppState, Category, Knowledge, Skill } from '../shared/types';
import { api } from './api';
import { sourceUrl } from './sources';
import { useMotionSettings } from './motion';

type PageProps = {
  state: AppState;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  initialQuery?: string;
};
const categories: Category[] = ['Electronics', 'Food & produce', 'Automotive', 'General cargo'];
const tabs = ['All knowledge', 'Playbooks', 'Documents', 'Decisions'] as const;
type Tab = (typeof tabs)[number];
const sourceTypes: Partial<Record<Tab, Knowledge['sourceType']>> = {
  Playbooks: 'Playbook',
  Documents: 'Document',
  Decisions: 'Decision',
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

function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const titleId = useId();
  const { reduced, transition, popover } = useMotionSettings();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? []),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKey);
      previousFocus?.focus();
    };
  }, []);
  return (
    <motion.div
      className="modal-backdrop"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.div
        className={`modal${wide ? ' modal-wide' : ''}`}
        initial={popover.initial}
        animate={popover.animate}
        transition={popover.transition}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = state.knowledge.find((item) => item.id === selectedId);
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const visible = useMemo(
    () =>
      state.knowledge
        .filter((item) => {
          const search = query.trim().toLowerCase();
          return (
            (!sourceTypes[tab] || item.sourceType === sourceTypes[tab]) &&
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

  async function publish(item: Knowledge) {
    setBusy(true);
    setError('');
    try {
      await api(`/knowledge/${encodeURIComponent(item.id)}/publish`, { method: 'POST' });
      await refresh();
      toast('Knowledge approved.');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not approve this source. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <h1>Knowledge base</h1>
        <div className="heading-actions">
          <button className="btn btn-secondary" onClick={() => setSkillOpen(true)}>
            <Plus size={15} />
            New skill
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
          Skills <span className="section-count">{state.skills.length}</span>
        </h2>
      </div>
      <div className="skill-grid">
        {state.skills.map((skill) => {
          const count = state.knowledge.filter((item) => item.skillId === skill.id).length;
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
              </div>
            </motion.button>
          );
        })}
        {!state.skills.length && (
          <div className="panel empty-state">
            <Sparkles size={28} />
            <h3>No skills yet</h3>
            <button className="btn btn-secondary" onClick={() => setSkillOpen(true)}>
              New skill
            </button>
          </div>
        )}
      </div>

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
              onClick={() => setTab(item)}
            >
              {item}
              <span className="tab-count">
                {
                  state.knowledge.filter(
                    (entry) => !sourceTypes[item] || entry.sourceType === sourceTypes[item],
                  ).length
                }
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
              onClick={() => {
                setSelectedId(item.id);
                setError('');
              }}
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
                  </span>
                </span>
              </span>
              <span className="knowledge-type">
                <span className={`category-dot ${categoryClass(item.category)}`} />
                {item.category}
              </span>
              <span>
                <span
                  className={`badge ${item.status === 'Approved' ? 'badge-green' : 'badge-amber'}`}
                >
                  {item.status === 'Approved' && <Check size={11} />}
                  {item.status === 'Approved' ? 'Approved' : 'Pending approval'}
                </span>
              </span>
              <span className="knowledge-date">{dateLabel(item.createdAt)}</span>
              <ChevronRight size={16} className="muted" />
            </button>
          ))}
          {!visible.length && (
            <div className="empty-state">
              <FolderOpen size={30} />
              <h3>{state.knowledge.length ? 'No matching knowledge' : 'No knowledge yet'}</h3>
              <p>
                {state.knowledge.length
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
        <Modal title="Knowledge detail" onClose={() => setSelectedId(null)} busy={busy} wide>
          <div className="modal-body">
            <div className="knowledge-detail-meta">
              <span
                className={`badge ${selected.status === 'Approved' ? 'badge-green' : 'badge-amber'}`}
              >
                {selected.status === 'Approved' ? 'Approved' : 'Pending approval'}
              </span>
              <span className="tag">{selected.sourceType}</span>
              <span className="tag">Singapore</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="muted">
              {state.skills.find((skill) => skill.id === selected.skillId)?.name ??
                selected.category}{' '}
              · {selected.author} · {dateLabel(selected.createdAt)}
            </p>
            <div className="knowledge-detail-content">{selected.content}</div>
            <div className="knowledge-tags">
              {selected.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <div className="knowledge-source">
              <strong>Source</strong>
              {sourceUrl(selected.sourceName, selected.content) ? (
                <a
                  href={sourceUrl(selected.sourceName, selected.content)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.sourceName} <ExternalLink size={13} />
                </a>
              ) : (
                <span>{selected.sourceName}</span>
              )}
            </div>
            {selected.status === 'Pending' && (
              <p className="form-hint">
                <ShieldCheck size={15} />
                Manager approval is required before agents use this source.
              </p>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="btn btn-secondary"
              onClick={() => setSelectedId(null)}
              disabled={busy}
            >
              Close
            </button>
            {selected.status === 'Pending' && state.user.role === 'manager' && (
              <button className="btn btn-primary" disabled={busy} onClick={() => publish(selected)}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
                Approve knowledge
              </button>
            )}
          </div>
        </Modal>
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
            toast('Skill created.');
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
      setError('Add a title, select a skill, and provide a document or notes.');
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
            Skill
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
            <ShieldCheck size={16} />
            Manager approval is required before agents use this source.
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
        failure instanceof Error
          ? failure.message
          : 'Could not create the skill. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="New skill" onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="field">
            Skill name
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
          <p className="form-hint">Add and approve knowledge to activate this Singapore skill.</p>
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
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Create skill
          </button>
        </div>
      </form>
    </Modal>
  );
}
