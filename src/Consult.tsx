import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Cpu,
  Leaf,
  LoaderCircle,
  Route,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AppState, ChatMessage, Citation } from '../shared/types';
import { api } from './api';
import { sourceUrl } from './sources';
import { useMotionSettings } from './motion';

type PageProps = {
  state: AppState;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  initialQuery?: string;
};

const starters = [
  {
    icon: Cpu,
    label: 'IMDA checks',
    prompt: 'What should I check before importing wireless electronics into Singapore?',
  },
  {
    icon: Leaf,
    label: 'Food imports',
    prompt: 'Which checks should I make for a fresh produce shipment into Singapore?',
  },
  {
    icon: ShieldCheck,
    label: 'Past decisions',
    prompt: 'What lessons from previous manager decisions should I apply when reviewing a permit?',
  },
];

function CitationDetail({
  citation,
  index,
  state,
}: {
  citation: Citation;
  index: number;
  state: AppState;
}) {
  const source = state.knowledge.find((item) => item.id === citation.id);
  return (
    <details className="chat-citation">
      <summary>
        <BookOpen size={14} />
        <span>
          <span className="citation-number">{index + 1}</span>
          {citation.title}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div>
        <p>{citation.excerpt}</p>
        <p className="chat-citation-source">
          {sourceUrl(citation.sourceName, source?.content ?? citation.excerpt) ? (
            <a
              href={sourceUrl(citation.sourceName, source?.content ?? citation.excerpt)}
              target="_blank"
              rel="noreferrer"
            >
              {citation.sourceName}
            </a>
          ) : (
            citation.sourceName
          )}
        </p>
        {source && source.content !== citation.excerpt && (
          <details className="chat-source-full">
            <summary>Full source</summary>
            <div>{source.content}</div>
          </details>
        )}
      </div>
    </details>
  );
}

function Message({
  message,
  state,
  animateIn,
}: {
  message: ChatMessage;
  state: AppState;
  animateIn: boolean;
}) {
  const assistant = message.role === 'assistant';
  const { reveal } = useMotionSettings();
  return (
    <motion.article
      className={`chat-message ${assistant ? 'assistant' : 'user'}`}
      initial={animateIn ? reveal.initial : false}
      animate={reveal.animate}
      transition={reveal.transition}
    >
      <div className={`chat-message-avatar${assistant ? ' agent-avatar' : ' avatar'}`}>
        {assistant ? <Sparkles size={19} /> : state.user.initials}
      </div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <strong
            title={
              assistant ? (message.mode === 'live' ? 'Connected AI' : 'Local advisor') : undefined
            }
          >
            {assistant ? 'Agent' : 'You'}
          </strong>
          {assistant && (
            <span className="badge badge-neutral">{message.mode === 'live' ? 'AI' : 'Local'}</span>
          )}
          <span>
            {new Date(message.createdAt).toLocaleTimeString('en-SG', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Singapore',
            })}
          </span>
        </div>
        {assistant && message.skillNames.length > 0 && (
          <div className="chat-skills">
            <Route size={13} />
            {message.skillNames.map((name) => (
              <span className="tag" key={name}>
                {name}
              </span>
            ))}
          </div>
        )}
        <div className="chat-message-content">{message.content}</div>
        {message.citations.length > 0 && (
          <div className="chat-citations">
            <span className="muted">Sources ({message.citations.length})</span>
            {message.citations.map((citation, index) => (
              <CitationDetail
                key={`${citation.id}-${index}`}
                citation={citation}
                index={index}
                state={state}
              />
            ))}
          </div>
        )}
      </div>
    </motion.article>
  );
}

export function ConsultPage({ state, refresh, initialQuery = '' }: PageProps) {
  const { reduced, transition, reveal } = useMotionSettings();
  const initialMessageIds = useRef(new Set(state.chats.map((message) => message.id)));
  const [draft, setDraft] = useState(initialQuery);
  const [skillId, setSkillId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const activeSkills = state.skills.filter((skill) => skill.status === 'Active');
  const hasMessages = state.chats.length > 0 || !!pending;
  const responseMode =
    state.chats.findLast((message) => message.role === 'assistant')?.mode ?? state.aiMode;
  useEffect(() => {
    if (initialQuery) setDraft(initialQuery);
  }, [initialQuery]);
  useEffect(() => {
    if (hasMessages) {
      endRef.current?.scrollIntoView({
        behavior:
          reduced || state.chats.length === initialMessageIds.current.size ? 'auto' : 'smooth',
        block: 'end',
      });
    }
  }, [state.chats.length, busy, hasMessages, reduced]);

  async function send(text = draft) {
    const message = text.trim();
    if (!message || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPending(message);
    setDraft('');
    try {
      await api('/chat', {
        method: 'POST',
        body: JSON.stringify({ message, ...(skillId ? { skillId } : {}) }),
      });
      await refresh();
      setPending('');
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Your advisor could not respond. Please try again.',
      );
      setDraft(message);
      setPending('');
    } finally {
      setBusy(false);
      inFlight.current = false;
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  return (
    <div className="consult-page">
      <div className="page-heading consult-heading">
        <h1>Ask an agent</h1>
        <span className="badge badge-green consult-mode" title="Latest response mode">
          <span className="status-dot" />
          {responseMode === 'live' ? 'Connected AI' : 'Local advisor'}
        </span>
      </div>
      <div className={`consult-shell${hasMessages ? ' has-messages' : ''}`}>
        {!hasMessages ? (
          <div className="consult-empty">
            <h2>How can I help?</h2>
            <div className="consult-starters">
              {starters.map((starter) => (
                <motion.button
                  key={starter.label}
                  className="consult-starter"
                  initial={false}
                  whileHover={reduced || busy ? undefined : { y: -2 }}
                  whileTap={reduced || busy ? undefined : { scale: 0.98 }}
                  transition={transition}
                  title={starter.prompt}
                  onClick={() => send(starter.prompt)}
                  disabled={busy}
                >
                  <starter.icon size={20} />
                  <strong>{starter.label}</strong>
                  <ArrowRight size={16} />
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="consult-messages"
            role="log"
            aria-label="Conversation with your advisor"
            aria-live="polite"
          >
            {state.chats.map((message) => (
              <Message
                key={message.id}
                message={message}
                state={state}
                animateIn={
                  message.role === 'assistant' && !initialMessageIds.current.has(message.id)
                }
              />
            ))}
            {pending && (
              <motion.article className="chat-message user" {...reveal}>
                <div className="chat-message-avatar avatar">{state.user.initials}</div>
                <div className="chat-message-body">
                  <div className="chat-message-meta">
                    <strong>You</strong>
                  </div>
                  <div className="chat-message-content">{pending}</div>
                </div>
              </motion.article>
            )}
            <AnimatePresence initial={false}>
              {busy && (
                <motion.div
                  key="checking-sources"
                  className="chat-pending"
                  role="status"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                >
                  <span className="chat-message-avatar agent-avatar">
                    <Sparkles size={18} />
                  </span>
                  <LoaderCircle size={16} className="spin" />
                  <span>Checking sources…</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={endRef} />
          </div>
        )}
        <div className="consult-compose-wrap">
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <form
            className="consult-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder="Ask about a shipment or regulation"
              aria-label="Your question for the advisor"
              title="Enter to send. Shift + Enter for a new line."
              maxLength={6000}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-controls">
              <label className="composer-skill">
                <Route size={15} />
                <select
                  aria-label="Select advisor skill"
                  value={skillId}
                  onChange={(event) => setSkillId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Auto-select skill</option>
                  {activeSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </label>
              <motion.button
                type="submit"
                className="btn btn-primary composer-send"
                whileTap={reduced || busy || !draft.trim() ? undefined : { scale: 0.94 }}
                transition={transition}
                aria-label="Send question"
                disabled={busy || !draft.trim()}
              >
                {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={20} />}
              </motion.button>
            </div>
          </form>
          <p className="composer-footnote">
            <ShieldCheck size={12} />
            Outgoing documents need manager approval.
          </p>
        </div>
      </div>
    </div>
  );
}
