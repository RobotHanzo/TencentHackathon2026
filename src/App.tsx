import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileText,
  Globe2,
  LayoutDashboard,
  Leaf,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
  AlertTriangle,
  Cpu,
  Package,
  CornerDownRight,
  CircleDot,
} from 'lucide-react';
import type { AppState, CaseInput, CaseRecord, Category, Suggestion } from '../shared/types';
import { api } from './api';
import { KnowledgePage } from './Knowledge';
import { ConsultPage } from './Consult';
import { useMotionSettings } from './motion';

type Page = 'overview' | 'knowledge' | 'reviews' | 'consult' | 'activity' | 'team' | 'settings';
const pageNames: Record<Page, string> = {
  overview: 'Overview',
  knowledge: 'Knowledge base',
  reviews: 'Review queue',
  consult: 'Ask an agent',
  activity: 'Activity',
  team: 'Team',
  settings: 'Settings',
};
const categories: Category[] = ['Electronics', 'Food & produce', 'Automotive', 'General cargo'];
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}
function timeLabel(value: string) {
  return new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}
function CategoryIcon({ category, size = 18 }: { category: string; size?: number }) {
  const Icon =
    category === 'Electronics'
      ? Cpu
      : category === 'Food & produce'
        ? Leaf
        : category === 'Automotive'
          ? Truck
          : Package;
  return <Icon size={size} />;
}
function Status({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === 'Approved' ? 'badge-green' : status === 'In review' ? 'badge-amber' : status === 'Changes requested' ? 'badge-red' : 'badge-neutral'}`}
    >
      <span className="status-dot" />
      {status}
    </span>
  );
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M24 8H15a8 8 0 0 0 0 16h9M18 12l6 4-6 4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {!small && (
        <span>
          clearport<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const present = useIsPresent();
  const { reduced, transition } = useMotionSettings();
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select, textarea, a[href], [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handle);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [present]);
  return (
    <motion.div
      className="modal-backdrop"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
      inert={!present}
      aria-hidden={!present || undefined}
      onClick={(e) => {
        if (present && e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        initial={reduced ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
        transition={transition}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function NavigationHighlight() {
  const { reduced, transition } = useMotionSettings();
  return (
    <motion.span
      className="nav-highlight"
      layoutId={reduced ? undefined : 'active-navigation'}
      transition={transition}
      aria-hidden="true"
    />
  );
}

function ProfilePopover({ children }: { children: ReactNode }) {
  const { popover } = useMotionSettings();
  const present = useIsPresent();
  return (
    <motion.div
      className="profile-menu"
      {...popover}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {children}
    </motion.div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const { reduced, transition } = useMotionSettings();
  const present = useIsPresent();
  return (
    <motion.div
      className="toast"
      role="status"
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={transition}
      style={{ x: '-50%' }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      <CheckCircle2 size={19} />
      <span>{message}</span>
      <button aria-label="Dismiss notification" onClick={onClose}>
        <X size={16} />
      </button>
    </motion.div>
  );
}

export default function App() {
  const { reduced, transition } = useMotionSettings();
  const initialPage = location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(initialPage in pageNames ? initialPage : 'overview');
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [editingCase, setEditingCase] = useState<CaseRecord | 'new' | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const refresh = useCallback(async () => {
    const next = await api<AppState>('/state');
    setState(next);
    setError('');
  }, []);
  const toast = useCallback((message: string) => setToastMessage(message), []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 780px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !compact) return;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector<HTMLElement>('.nav-link.active')?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
      if (event.key !== 'Tab') return;
      const controls = sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (sidebar?.contains(document.activeElement)) navigationTriggerRef.current?.focus();
    };
  }, [mobileNav, compact]);
  useEffect(() => {
    if (!profileOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      profileRef.current?.querySelector<HTMLButtonElement>('.avatar-profile')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);
  const navigate = (next: Page) => {
    setPage(next);
    location.hash = next;
    setMobileNav(false);
    setProfileOpen(false);
  };
  useEffect(() => {
    const handler = () => {
      const next = location.hash.slice(1) as Page;
      if (next in pageNames) setPage(next);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const currentCase = state?.cases.find((c) => c.id === selectedCase);
  if (!state)
    return (
      <div className="startup">
        <Logo />
        <div className="startup-card">
          {error ? (
            <>
              <AlertTriangle size={28} />
              <h2>Workspace unavailable</h2>
              <p>{error}</p>
              <button
                className="btn btn-primary"
                onClick={() => refresh().catch((e) => setError(e.message))}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <Loader2 className="spin" size={28} />
              <p>Loading…</p>
            </>
          )}
        </div>
      </div>
    );
  const reviewCount = state.cases.filter((c) => c.status === 'In review').length;
  const navItems = [
    { id: 'overview' as Page, icon: LayoutDashboard },
    { id: 'knowledge' as Page, icon: BookOpen },
    { id: 'reviews' as Page, icon: ClipboardCheck },
    { id: 'consult' as Page, icon: Sparkles },
  ];
  return (
    <div className="app-shell">
      <AnimatePresence initial={false}>
        {mobileNav && compact && (
          <motion.button
            className="nav-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
        )}
      </AnimatePresence>
      <motion.aside
        className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}
        ref={sidebarRef}
        initial={false}
        animate={{ x: compact && !mobileNav ? '-100%' : 0 }}
        transition={transition}
        inert={compact && !mobileNav}
        aria-hidden={(compact && !mobileNav) || undefined}
        layoutRoot
        layoutScroll
      >
        <div className="sidebar-brand">
          <Logo />
        </div>
        <button className="workspace-switch" onClick={() => navigate('settings')}>
          <span className="workspace-avatar">M</span>
          <span>
            <strong>Meridian Customs</strong>
            <small>Singapore</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={`nav-link ${page === id ? 'active' : ''}`}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{pageNames[id]}</span>
              {id === 'reviews' && reviewCount > 0 && (
                <span className="nav-count">{reviewCount}</span>
              )}
              {id === 'consult' && <span className="nav-ai">AI</span>}
              {page === id && <NavigationHighlight />}
            </button>
          ))}
        </nav>
        <div className="nav-label nav-label-second">MANAGE</div>
        <nav aria-label="Management navigation">
          <button
            className={`nav-link ${page === 'activity' ? 'active' : ''}`}
            aria-current={page === 'activity' ? 'page' : undefined}
            onClick={() => navigate('activity')}
          >
            <ActivityIcon size={19} />
            <span>Activity</span>
            {page === 'activity' && <NavigationHighlight />}
          </button>
          <button
            className={`nav-link ${page === 'team' ? 'active' : ''}`}
            aria-current={page === 'team' ? 'page' : undefined}
            onClick={() => navigate('team')}
          >
            <Users size={19} />
            <span>Team</span>
            {page === 'team' && <NavigationHighlight />}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-link ${page === 'settings' ? 'active' : ''}`}
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>Settings</span>
            {page === 'settings' && <NavigationHighlight />}
          </button>
          <div className="sidebar-footer">
            <span className="system-dot" />
            Singapore · SGT<span>v1.0</span>
          </div>
        </div>
      </motion.aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              ref={navigationTriggerRef}
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                setKnowledgeSearch(search);
                navigate('knowledge');
              }}
            >
              <Search size={16} />
              <input
                aria-label="Search workspace knowledge"
                placeholder="Search knowledge…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <span className="demo-label">Demo</span>
            <button
              className="icon-button notification-button"
              aria-label="View recent activity"
              onClick={() => navigate('activity')}
            >
              <Bell size={19} />
              <i />
            </button>
            <div className="profile-wrap" ref={profileRef}>
              <button
                className="avatar avatar-profile"
                aria-label="Switch demo user"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen(!profileOpen)}
              >
                {state.user.initials}
              </button>
              <AnimatePresence initial={false}>
                {profileOpen && (
                  <ProfilePopover>
                    <div className="profile-menu-heading">
                      <strong>Switch demo user</strong>
                    </div>
                    {state.users.map((user) => (
                      <button
                        key={user.id}
                        onClick={async () => {
                          try {
                            await api('/session', {
                              method: 'POST',
                              body: JSON.stringify({ userId: user.id }),
                            });
                            await refresh();
                            setProfileOpen(false);
                            toast(`Switched to ${user.name}`);
                          } catch (e) {
                            toast((e as Error).message);
                          }
                        }}
                      >
                        <span className="avatar">{user.initials}</span>
                        <span>
                          <strong>{user.name}</strong>
                          <small>
                            {user.role === 'manager' ? 'Senior reviewer' : 'Operations executive'}
                          </small>
                        </span>
                        {user.id === state.user.id && <Check size={16} />}
                      </button>
                    ))}
                  </ProfilePopover>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>
        <motion.main
          key={page}
          className={`main-content ${page === 'consult' ? 'main-consult' : ''}`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition}
        >
          {page === 'overview' && (
            <Overview
              state={state}
              navigate={navigate}
              openCase={setSelectedCase}
              newCase={() => setEditingCase('new')}
            />
          )}
          {page === 'knowledge' && (
            <KnowledgePage
              state={state}
              refresh={refresh}
              toast={toast}
              initialQuery={knowledgeSearch}
            />
          )}
          {page === 'reviews' && (
            <Reviews
              state={state}
              openCase={setSelectedCase}
              newCase={() => setEditingCase('new')}
            />
          )}
          {page === 'consult' && <ConsultPage state={state} refresh={refresh} toast={toast} />}
          {page === 'activity' && <ActivityPage state={state} openCase={setSelectedCase} />}
          {page === 'team' && <TeamPage state={state} />}
          {page === 'settings' && <SettingsPage state={state} />}
        </motion.main>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {toastMessage && (
          <Toast key={toastMessage} message={toastMessage} onClose={() => setToastMessage('')} />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="wait">
        {currentCase && !editingCase && (
          <CaseDetail
            key={`case-${currentCase.id}`}
            record={currentCase}
            state={state}
            onClose={() => setSelectedCase(null)}
            onEdit={() => setEditingCase(currentCase)}
            refresh={refresh}
            toast={toast}
          />
        )}
        {editingCase && (
          <CaseEditor
            key="case-editor"
            record={editingCase === 'new' ? null : editingCase}
            onClose={() => setEditingCase(null)}
            onSaved={async (id) => {
              await refresh();
              setEditingCase(null);
              setSelectedCase(id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Overview({
  state,
  navigate,
  openCase,
  newCase,
}: {
  state: AppState;
  navigate: (page: Page) => void;
  openCase: (id: string) => void;
  newCase: () => void;
}) {
  const { reduced, transition } = useMotionSettings();
  const pending = state.cases.filter((c) => c.status === 'In review');
  const published = state.knowledge.filter((k) => k.status === 'Approved').length;
  const decisions = state.knowledge.filter((k) => k.sourceType === 'Decision').length;
  const urgent = pending.filter((c) =>
    c.review?.suggestions.some((s) => s.severity === 'critical' && s.decision === 'pending'),
  ).length;
  const today = new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(new Date());
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
          <p className="muted">{today}</p>
        </div>
        <motion.button
          className="btn btn-primary"
          onClick={newCase}
          whileHover={reduced ? undefined : { y: -1 }}
          whileTap={reduced ? undefined : { scale: 0.98 }}
          transition={transition}
        >
          <Plus size={17} />
          New document
        </motion.button>
      </div>
      <div className="stats-grid">
        <Stat
          icon={<ClipboardCheck size={20} />}
          label="In review"
          value={pending.length}
          tone="green"
        />
        <Stat
          icon={<AlertTriangle size={20} />}
          label="Priority cases"
          value={urgent}
          tone="amber"
          order={1}
        />
        <Stat
          icon={<BookOpen size={20} />}
          label="Published sources"
          value={published}
          tone="blue"
          order={2}
        />
        <Stat
          icon={<CheckCheck size={20} />}
          label="Recorded decisions"
          value={decisions}
          tone="purple"
          order={3}
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel review-panel">
          <div className="section-heading">
            <h2>
              Review queue <span className="count-pill">{pending.length}</span>
            </h2>
            <button className="text-button" onClick={() => navigate('reviews')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <CaseTable cases={pending.slice(0, 5)} openCase={openCase} compact />
        </section>
        <section className="panel activity-panel">
          <div className="section-heading">
            <h2>Recent activity</h2>
            <button className="text-button" onClick={() => navigate('activity')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="activity-list">
            {state.activity.slice(0, 4).map((activity) => (
              <div className="activity-item" key={activity.id}>
                <div className={'activity-symbol activity-' + activity.type}>
                  {activity.type === 'decision' || activity.type === 'approval' ? (
                    <Check size={15} />
                  ) : activity.type === 'import' ? (
                    <BookOpen size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                </div>
                <div>
                  <p>{activity.title}</p>
                  <span>
                    {activity.actor} · {dateLabel(activity.createdAt)}
                  </span>
                </div>
              </div>
            ))}
            {!state.activity.length && <p className="muted">No activity yet.</p>}
          </div>
        </section>
      </div>
      <section className="specialist-section">
        <div className="section-heading">
          <h2>
            Skills <span className="count-pill">{state.skills.length}</span>
          </h2>
          <button className="text-button" onClick={() => navigate('knowledge')}>
            Manage <ArrowRight size={14} />
          </button>
        </div>
        <div className="specialist-grid">
          {state.skills.slice(0, 4).map((skill) => (
            <motion.button
              className="specialist-card"
              whileHover={reduced ? undefined : { y: -3 }}
              whileTap={reduced ? undefined : { scale: 0.985 }}
              transition={transition}
              key={skill.id}
              onClick={() => navigate('knowledge')}
            >
              <span
                className={
                  'specialist-icon cat-' +
                  (skill.category === 'Food & produce'
                    ? 'food'
                    : skill.category === 'Electronics'
                      ? 'electronics'
                      : skill.category === 'Automotive'
                        ? 'auto'
                        : 'cargo')
                }
              >
                <CategoryIcon category={skill.category} size={21} />
              </span>
              <strong>{skill.category}</strong>
              <div>
                {
                  state.knowledge.filter((k) => k.skillId === skill.id && k.status === 'Approved')
                    .length
                }{' '}
                {state.knowledge.filter((k) => k.skillId === skill.id && k.status === 'Approved')
                  .length === 1
                  ? 'source'
                  : 'sources'}
                <ChevronRight size={15} />
              </div>
            </motion.button>
          ))}
        </div>
      </section>
    </>
  );
}
function Stat({
  icon,
  label,
  value,
  tone,
  order = 0,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: string;
  order?: number;
}) {
  const { reduced, reveal, transition } = useMotionSettings();
  return (
    <motion.div
      className="stat-card"
      {...reveal}
      transition={{ ...transition, delay: reduced ? 0 : order * 0.035 }}
    >
      <div className="stat-top">
        <span>{label}</span>
        <span className={'stat-icon ' + tone}>{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
    </motion.div>
  );
}
function CaseTable({
  cases,
  openCase,
  compact = false,
}: {
  cases: CaseRecord[];
  openCase: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="case-table">
        <thead>
          <tr>
            <th>Document</th>
            {!compact && <th>Category</th>}
            <th>Status</th>
            <th>Findings</th>
            <th aria-label="Open document" />
          </tr>
        </thead>
        <tbody>
          {cases.map((record) => {
            const findings =
              record.review?.suggestions.filter((s) => s.decision === 'pending') || [];
            return (
              <tr key={record.id} onClick={() => openCase(record.id)}>
                <td>
                  <button
                    className="document-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCase(record.id);
                    }}
                  >
                    <span
                      className={`document-icon ${record.documentType === 'Customer email' ? 'email-icon' : ''}`}
                    >
                      {record.documentType === 'Customer email' ? (
                        <MessageSquare size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{record.title}</strong>
                      <small>
                        {record.customer} <span>·</span> {record.reference}
                      </small>
                    </span>
                  </button>
                </td>
                {!compact && (
                  <td>
                    <span className="category-cell">
                      <CategoryIcon category={record.category} size={14} />
                      {record.category}
                    </span>
                  </td>
                )}
                <td>
                  <Status status={record.status} />
                </td>
                <td>
                  {record.review ? (
                    <span
                      className={`finding-count ${findings.some((s) => s.severity === 'critical') ? 'finding-critical' : ''}`}
                    >
                      <span />
                      {findings.length ? `${findings.length} to review` : 'Reviewed'}
                    </span>
                  ) : (
                    <span className="muted">Not reviewed</span>
                  )}
                </td>
                <td>
                  <ChevronRight size={15} className="muted" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!cases.length && (
        <div className="empty-state">
          <CheckCircle2 size={30} />
          <h3>No documents</h3>
        </div>
      )}
    </div>
  );
}
function Reviews({
  state,
  openCase,
  newCase,
}: {
  state: AppState;
  openCase: (id: string) => void;
  newCase: () => void;
}) {
  const { reduced, transition } = useMotionSettings();
  const [filter, setFilter] = useState('All documents');
  const [query, setQuery] = useState('');
  const filtered = state.cases.filter(
    (c) =>
      (filter === 'All documents' || c.status === filter) &&
      `${c.title} ${c.customer} ${c.reference}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Review queue</h1>
        </div>
        <button className="btn btn-primary" onClick={newCase}>
          <Plus size={17} />
          New document
        </button>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs tabs-motion" aria-label="Document status">
            {['All documents', 'In review', 'Draft', 'Changes requested', 'Approved'].map(
              (status) => (
                <button
                  key={status}
                  className={filter === status ? 'selected' : ''}
                  onClick={() => setFilter(status)}
                  aria-pressed={filter === status}
                >
                  {status}
                  {status === 'In review' && (
                    <span>{state.cases.filter((c) => c.status === status).length}</span>
                  )}
                  {filter === status && (
                    <motion.span
                      className="motion-tab-indicator"
                      layoutId={reduced ? undefined : 'document-status-tab'}
                      transition={transition}
                      aria-hidden="true"
                    />
                  )}
                </button>
              ),
            )}
          </div>
          <div className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a document…"
              aria-label="Search documents"
            />
          </div>
        </div>
        <CaseTable cases={filtered} openCase={openCase} />
        <div className="table-footer">{filtered.length} documents</div>
      </section>
    </>
  );
}

function CaseEditor({
  record,
  onClose,
  onSaved,
}: {
  record: CaseRecord | null;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [values, setValues] = useState<CaseInput>(
    record || {
      title: '',
      customer: '',
      category: 'Electronics',
      jurisdiction: 'Singapore',
      documentType: 'Customs declaration',
      content: '',
      permitNumber: '',
      permitExpiry: '',
      shipmentDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }),
      warehouseConfirmed: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = <K extends keyof CaseInput>(key: K, value: CaseInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const expired =
    !!values.permitExpiry &&
    (values.permitExpiry < values.shipmentDate || values.permitExpiry < today);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<CaseRecord>(record ? `/cases/${record.id}` : '/cases', {
        method: record ? 'PUT' : 'POST',
        body: JSON.stringify(values),
      });
      await onSaved(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={record ? 'Edit document' : 'New document'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="editor-layout">
          <div className="editor-form">
            <div className="form-row">
              <label className="field">
                Document title
                <input
                  required
                  maxLength={160}
                  value={values.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="e.g. Wireless router import declaration"
                />
              </label>
              <label className="field">
                Customer
                <input
                  required
                  maxLength={120}
                  value={values.customer}
                  onChange={(e) => update('customer', e.target.value)}
                  placeholder="Company name"
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                Document type
                <select
                  value={values.documentType}
                  onChange={(e) =>
                    update('documentType', e.target.value as CaseInput['documentType'])
                  }
                >
                  <option>Customs declaration</option>
                  <option>Customer email</option>
                  <option>Contract</option>
                </select>
              </label>
              <label className="field">
                Goods category
                <select
                  value={values.category}
                  onChange={(e) => update('category', e.target.value as Category)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Document content
              <textarea
                required
                rows={9}
                maxLength={40000}
                value={values.content}
                onChange={(e) => update('content', e.target.value)}
                placeholder="Paste the document and shipment details."
              />
            </label>
            <div className="form-row">
              <label className="field">
                Supporting licence / permit number
                <input
                  value={values.permitNumber}
                  onChange={(e) => update('permitNumber', e.target.value)}
                  placeholder="If applicable"
                  maxLength={100}
                />
              </label>
              <label className="field">
                Documented valid-until date
                <input
                  type="date"
                  value={values.permitExpiry}
                  onChange={(e) => update('permitExpiry', e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              Expected shipment date
              <input
                type="date"
                required
                value={values.shipmentDate}
                onChange={(e) => update('shipmentDate', e.target.value)}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={values.warehouseConfirmed}
                onChange={(e) => update('warehouseConfirmed', e.target.checked)}
              />
              <span>
                Cargo arrival / warehouse receipt confirmed <small>Internal checkpoint only.</small>
              </span>
            </label>
          </div>
          <aside className="editor-assist">
            <div className="assist-heading">
              <Sparkles size={19} />
              <strong>Live checks</strong>
              <span className="live-badge">
                <span />
                LIVE
              </span>
            </div>
            <div className="assist-skill">
              <CategoryIcon category={values.category} />
              <span>
                {values.category}
                <small>Singapore specialist</small>
              </span>
              <CheckCircle2 size={16} />
            </div>
            {expired ? (
              <div className="inline-finding critical">
                <AlertTriangle size={18} />
                <div>
                  <strong>
                    {values.permitExpiry < values.shipmentDate
                      ? 'Validity ends before shipment'
                      : 'Recorded validity has expired'}
                  </strong>
                  <p>Valid until {values.permitExpiry}. Obtain updated evidence.</p>
                </div>
              </div>
            ) : values.permitExpiry ? (
              <div className="inline-finding success">
                <CheckCircle2 size={18} />
                <div>
                  <strong>Date covers this shipment</strong>
                  <p>Verify the reference, holder, scope, and current status.</p>
                </div>
              </div>
            ) : (
              <div className="inline-finding">
                <CircleHelp size={18} />
                <div>
                  <strong>Check supporting authorisations</strong>
                  <p>Record validity from the supporting document, if applicable.</p>
                </div>
              </div>
            )}
            <p className="assist-footnote">Changes require a new review.</p>
          </aside>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}Save document
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CaseDetail({
  record,
  state,
  onClose,
  onEdit,
  refresh,
  toast,
}: {
  record: CaseRecord;
  state: AppState;
  onClose: () => void;
  onEdit: () => void;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [finalComment, setFinalComment] = useState('');
  const [tab, setTab] = useState('Document');
  const manager = state.user.role === 'manager';
  const canEdit = manager || record.ownerId === state.user.id;
  const allDecided =
    !!record.review && record.review.suggestions.every((s) => s.decision !== 'pending');
  async function act(path: string, body?: object, message?: string) {
    setBusy(path);
    setError('');
    try {
      await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      await refresh();
      if (message) toast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const caseComments = state.comments.filter((c) => c.caseId === record.id);
  return (
    <Modal
      title={record.title}
      subtitle={`${record.reference} · ${record.customer} · ${record.documentType}`}
      onClose={onClose}
      wide
    >
      <div className="case-meta">
        <Status status={record.status} />
        <span>
          <CategoryIcon category={record.category} size={15} />
          {record.category}
        </span>
        <span>
          <Globe2 size={14} />
          Singapore
        </span>
        <span className="case-owner">Prepared by {record.ownerName}</span>
      </div>
      <div className="detail-layout">
        <section className="document-pane">
          <div className="tabs">
            <button
              className={tab === 'Document' ? 'selected' : ''}
              onClick={() => setTab('Document')}
            >
              Document
            </button>
            <button
              className={tab === 'Discussion' ? 'selected' : ''}
              onClick={() => setTab('Discussion')}
            >
              Discussion <span>{caseComments.length}</span>
            </button>
            <button
              className={tab === 'History' ? 'selected' : ''}
              onClick={() => setTab('History')}
            >
              History
            </button>
          </div>
          {tab === 'Document' && (
            <>
              <div className="document-paper">
                <div className="paper-topline">
                  <Logo small />
                  <span>INTERNAL REVIEW COPY</span>
                </div>
                <h3>{record.title}</h3>
                <div className="paper-metadata">
                  <span>
                    Customer<strong>{record.customer}</strong>
                  </span>
                  <span>
                    Expected shipment<strong>{record.shipmentDate}</strong>
                  </span>
                  <span>
                    Supporting authorisation<strong>{record.permitNumber || 'Not supplied'}</strong>
                  </span>
                  <span>
                    Documented valid until<strong>{record.permitExpiry || 'Not supplied'}</strong>
                  </span>
                </div>
                <div className="document-content">{record.content}</div>
                <div className="paper-footer">
                  <span>Singapore operations</span>
                  <span>{record.reference}</span>
                </div>
              </div>
              {canEdit && record.status !== 'Approved' && record.status !== 'In review' && (
                <button className="btn btn-secondary edit-document" onClick={onEdit}>
                  <FileText size={15} />
                  Edit document
                </button>
              )}
              <p className="document-disclaimer">
                Internal approval only. Nothing is sent externally.
              </p>
            </>
          )}
          {tab === 'Discussion' && (
            <div className="discussion">
              <h3>Discussion</h3>
              {caseComments.map((c) => (
                <div className="comment" key={c.id}>
                  <span className="avatar">
                    {c.author
                      .split(' ')
                      .map((s) => s[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <div>
                    <strong>{c.author}</strong>
                    <small>{timeLabel(c.createdAt)}</small>
                    <p>{c.content}</p>
                  </div>
                </div>
              ))}
              {!caseComments.length && (
                <div className="empty-state">
                  <MessageSquare size={25} />
                  <p>No comments yet.</p>
                </div>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await act(`/cases/${record.id}/comments`, { content: comment }, 'Comment added');
                  setComment('');
                }}
              >
                <label className="field">
                  Add a comment
                  <textarea
                    required
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Add a note…"
                  />
                </label>
                <button className="btn btn-primary" disabled={!!busy || !comment.trim()}>
                  <Send size={15} />
                  Post comment
                </button>
              </form>
            </div>
          )}
          {tab === 'History' && (
            <div className="case-history">
              {state.activity
                .filter((a) => a.caseId === record.id)
                .map((a) => (
                  <div className="history-item" key={a.id}>
                    <CircleDot size={17} />
                    <div>
                      <strong>{a.title}</strong>
                      <p>{a.detail}</p>
                      <small>
                        {a.actor} · {timeLabel(a.createdAt)}
                      </small>
                    </div>
                  </div>
                ))}
              <div className="history-item">
                <CircleDot size={17} />
                <div>
                  <strong>Document created</strong>
                  <small>
                    {record.ownerName} · {timeLabel(record.createdAt)}
                  </small>
                </div>
              </div>
            </div>
          )}
        </section>
        <aside className="review-pane">
          <div className="review-pane-title">
            <span className="agent-small-icon">
              <Sparkles size={19} />
            </span>
            <div>
              <h3>Agent pre-review</h3>
              <p>{record.review?.mode === 'live' ? 'Connected AI' : 'Local checks'}</p>
            </div>
          </div>
          {record.review ? (
            <>
              <div className="review-summary">
                <span>
                  {record.review.suggestions.length} findings · {record.review.skillIds.length}{' '}
                  skills
                </span>
                <details>
                  <summary>Review summary</summary>
                  <p>{record.review.summary}</p>
                </details>
              </div>
              <div className="suggestion-list">
                {record.review.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    editable={manager && record.status === 'In review'}
                    busy={!!busy}
                    onDecision={(decision, reason) =>
                      act(
                        `/cases/${record.id}/suggestions/${suggestion.id}`,
                        { decision, comment: reason },
                        'Decision saved',
                      )
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="review-empty">
              <span className="agent-large-icon">
                <Sparkles size={30} />
              </span>
              <h3>Ready to review</h3>
              <p>Check this document against approved knowledge.</p>
            </div>
          )}
          {canEdit && (record.status === 'Draft' || record.status === 'Changes requested') && (
            <div className="review-actions">
              <button
                className="btn btn-primary full-width"
                disabled={!!busy}
                onClick={() =>
                  act(`/cases/${record.id}/review`, undefined, 'Agent review complete')
                }
              >
                {busy.endsWith('/review') ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {record.review ? 'Run review again' : 'Run agent review'}
              </button>
              {record.review && (
                <button
                  className="btn btn-secondary full-width"
                  disabled={!!busy}
                  onClick={() =>
                    act(`/cases/${record.id}/submit`, undefined, 'Submitted for senior approval')
                  }
                >
                  <Send size={16} />
                  Submit for approval
                </button>
              )}
            </div>
          )}
          {record.status === 'In review' && manager && (
            <div className="final-approval">
              <h4>
                <ShieldCheck size={17} />
                Final decision
              </h4>
              <p className="muted">
                {allDecided ? 'All suggestions reviewed.' : 'Review all suggestions to approve.'}
              </p>
              <label className="field">
                Note (required for changes)
                <textarea
                  aria-label="Final review note"
                  value={finalComment}
                  onChange={(e) => setFinalComment(e.target.value)}
                  rows={2}
                  placeholder="Review note…"
                />
              </label>
              <div className="final-buttons">
                <button
                  className="btn btn-secondary"
                  disabled={!!busy || !finalComment.trim()}
                  onClick={() =>
                    act(
                      `/cases/${record.id}/decision`,
                      { decision: 'changes_requested', comment: finalComment },
                      'Document returned for revision',
                    )
                  }
                >
                  Request changes
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!!busy || !allDecided || record.ownerId === state.user.id}
                  title={
                    record.ownerId === state.user.id
                      ? 'Another senior reviewer must approve your document'
                      : ''
                  }
                  onClick={() =>
                    act(
                      `/cases/${record.id}/decision`,
                      { decision: 'approved', comment: finalComment },
                      'Document approved',
                    )
                  }
                >
                  <Check size={16} />
                  Approve
                </button>
              </div>
              {record.ownerId === state.user.id && (
                <small className="muted">Another reviewer must approve this document.</small>
              )}
            </div>
          )}
          {record.status === 'In review' && !manager && (
            <div className="info-note">
              <Clock3 size={17} />
              Awaiting senior review.
            </div>
          )}
          {record.status === 'Approved' && (
            <div className="approved-note">
              <ShieldCheck size={23} />
              <div>
                <strong>Approved</strong>
              </div>
            </div>
          )}
        </aside>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer detail-footer">
        <button className="btn btn-secondary" onClick={onClose}>
          Close document
        </button>
      </div>
    </Modal>
  );
}
function SuggestionCard({
  suggestion: s,
  editable,
  busy,
  onDecision,
}: {
  suggestion: Suggestion;
  editable: boolean;
  busy: boolean;
  onDecision: (decision: 'accepted' | 'rejected', reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const { reduced, transition } = useMotionSettings();
  return (
    <article className={`suggestion-card severity-${s.severity}`}>
      <div className="suggestion-title">
        <span>
          {s.severity === 'critical' ? (
            <AlertTriangle size={16} />
          ) : s.severity === 'warning' ? (
            <CircleHelp size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          {s.severity === 'critical'
            ? 'Priority'
            : s.severity === 'warning'
              ? 'Check'
              : 'Reference'}
        </span>
        {s.decision !== 'pending' && (
          <motion.span
            key={s.decision}
            className={`badge ${s.decision === 'accepted' ? 'badge-green' : 'badge-neutral'}`}
            initial={reduced ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={transition}
          >
            {s.decision === 'accepted' ? 'Accepted' : 'Rejected'}
          </motion.span>
        )}
      </div>
      <h4>{s.title}</h4>
      <p>{s.detail}</p>
      <div className="suggestion-action">
        <CornerDownRight size={15} />
        <span>{s.action}</span>
      </div>
      {s.citations.length > 0 && (
        <details className="source-details">
          <summary>
            <BookOpen size={13} />
            {s.citations.length} {s.citations.length === 1 ? 'source' : 'sources'}
          </summary>
          {s.citations.map((c) => (
            <div key={c.id}>
              <strong>{c.title}</strong>
              <p>{c.excerpt}</p>
              <small>{c.sourceName}</small>
            </div>
          ))}
        </details>
      )}
      {s.decision === 'pending' && editable && (
        <div className="suggestion-feedback">
          <textarea
            rows={2}
            aria-label={`Reason for ${s.title}`}
            placeholder="Reason (required to reject)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div>
            <button
              className="btn btn-secondary btn-small"
              disabled={busy || !reason.trim()}
              onClick={() => onDecision('rejected', reason)}
            >
              <X size={14} />
              Reject advice
            </button>
            <button
              className="btn btn-primary btn-small"
              disabled={busy}
              onClick={() => onDecision('accepted', reason)}
            >
              <Check size={14} />
              Accept advice
            </button>
          </div>
        </div>
      )}
      {s.decision !== 'pending' && (
        <div className="decision-note">
          <span>{s.decidedBy || 'Senior reviewer'}</span>
          <p>{s.comment || 'Suggestion accepted.'}</p>
          <small>
            <BookOpen size={11} />
            Saved to knowledge
          </small>
        </div>
      )}
    </article>
  );
}

function ActivityPage({ state, openCase }: { state: AppState; openCase: (id: string) => void }) {
  const [filter, setFilter] = useState('All activity');
  const filtered = state.activity.filter(
    (a) =>
      filter === 'All activity' ||
      (filter === 'Decisions'
        ? a.type === 'decision' || a.type === 'approval'
        : filter === 'Knowledge'
          ? a.type === 'import' || a.type === 'skill'
          : a.type === 'comment' || a.type === 'review'),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Activity</h1>
        </div>
        {state.user.role === 'manager' && (
          <a className="btn btn-secondary" href="/api/export" download>
            <ArrowDownToLine size={16} />
            Export workspace
          </a>
        )}
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs">
            {['All activity', 'Decisions', 'Knowledge', 'Reviews & comments'].map((f) => (
              <button
                key={f}
                className={f === filter ? 'selected' : ''}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="audit-list">
          {filtered.map((a) => (
            <div className="audit-row" key={a.id}>
              <span className={`activity-symbol activity-${a.type}`}>
                {a.type === 'decision' || a.type === 'approval' ? (
                  <Check size={18} />
                ) : a.type === 'comment' ? (
                  <MessageSquare size={18} />
                ) : (
                  <BookOpen size={18} />
                )}
              </span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.detail}</p>
                <small>
                  {a.actor} · {timeLabel(a.createdAt)}
                </small>
              </div>
              {a.caseId && (
                <button
                  className="icon-button"
                  aria-label={`Open case for ${a.title}`}
                  onClick={() => openCase(a.caseId!)}
                >
                  <ArrowRight size={17} />
                </button>
              )}
            </div>
          ))}
          {!filtered.length && (
            <div className="empty-state">
              <ActivityIcon size={28} />
              <p>No activity.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function TeamPage({ state }: { state: AppState }) {
  return (
    <>
      <div className="page-heading">
        <h1>Team</h1>
        <span className="badge badge-neutral">{state.users.length} members</span>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="team-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Documents</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((user) => {
                const cases = state.cases.filter((c) => c.ownerId === user.id);
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="team-member">
                        <span className="avatar">{user.initials}</span>
                        <strong>{user.name}</strong>
                        {state.user.id === user.id && <span className="tag">You</span>}
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          'badge ' + (user.role === 'manager' ? 'badge-green' : 'badge-neutral')
                        }
                      >
                        {user.role === 'manager' ? 'Senior reviewer' : 'Operations'}
                      </span>
                    </td>
                    <td>{cases.length}</td>
                    <td>{cases.filter((c) => c.status === 'Approved').length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="policy-note">
        <ShieldCheck size={15} />
        Documents require approval by a different senior reviewer.
      </p>
    </>
  );
}
function SettingsPage({ state }: { state: AppState }) {
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="section-heading">
            <h2>Workspace</h2>
          </div>
          <dl>
            <div>
              <dt>Organisation</dt>
              <dd>
                Meridian Customs <span className="badge badge-neutral">Demo</span>
              </dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>Singapore</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>SGT (UTC+8)</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Local</dd>
            </div>
            <div>
              <dt>Approvals</dt>
              <dd>Senior review required</dd>
            </div>
          </dl>
        </section>
        <section className="panel settings-panel">
          <div className="section-heading">
            <h2>Advisor</h2>
            <Sparkles size={19} />
          </div>
          <div className="connection-status">
            <span className="system-dot" />
            <strong>{state.aiMode === 'live' ? 'Connected AI' : 'Local advisor'}</strong>
          </div>
          <p>
            {state.aiMode === 'live'
              ? 'Uses approved knowledge. Falls back to local checks if unavailable.'
              : 'Rule-based checks and knowledge search. No model connected.'}
          </p>
          <details className="settings-details">
            <summary>AI setup</summary>
            <p>
              Configure the provider in .env using .env.example. Credentials stay on the server.
            </p>
          </details>
        </section>
        <section className="panel settings-panel">
          <div className="section-heading">
            <h2>Export</h2>
          </div>
          <p>Download workspace records as JSON.</p>
          {state.user.role === 'manager' ? (
            <a className="btn btn-secondary" href="/api/export" download>
              <ArrowDownToLine size={16} />
              Export workspace
            </a>
          ) : (
            <p className="muted">Senior reviewer access required.</p>
          )}
        </section>
        <section className="panel settings-panel">
          <div className="section-heading">
            <h2>Integrations</h2>
          </div>
          <div className="integration-row">
            <span className="integration-logo">SG</span>
            <strong>TradeNet</strong>
            <span className="badge badge-neutral">Not connected</span>
          </div>
          <div className="integration-row">
            <span className="integration-logo">
              <MessageSquare size={18} />
            </span>
            <strong>Email</strong>
            <span className="badge badge-neutral">Not connected</span>
          </div>
        </section>
      </div>
    </>
  );
}
