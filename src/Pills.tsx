import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  History,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  Siren,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type {
  AppState,
  PillBoundary,
  PillDefinition,
  PillEscalation,
  Skill,
} from '../shared/types';
import { api } from './api';
import { Modal } from './Modal';

const nameOf = (state: AppState, id: string) =>
  state.users.find((user) => user.id === id)?.name ?? id;
const when = (value: string) =>
  new Date(value).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });

export const canGovern = (state: AppState, pill: Skill) =>
  state.user.role === 'manager' &&
  (pill.owner === state.user.id || pill.approver === state.user.id);

const definitionOf = (pill: Skill): PillDefinition => ({
  description: pill.description,
  owner: pill.owner,
  approver: pill.approver,
  inScope: pill.inScope,
  outOfScope: pill.outOfScope,
  guardrails: pill.guardrails,
  escalations: pill.escalations,
});
const fieldLabels: Record<keyof PillDefinition, string> = {
  description: 'Description',
  owner: 'Owner',
  approver: 'Approver',
  inScope: 'In scope',
  outOfScope: 'Out of scope',
  guardrails: 'Guardrails',
  escalations: 'Escalation triggers',
};
/** Which parts of a definition differ, so a reviewer sees what a release would change. */
function changedFields(from: PillDefinition, to: PillDefinition) {
  return (Object.keys(fieldLabels) as (keyof PillDefinition)[]).filter(
    (key) => JSON.stringify(from[key]) !== JSON.stringify(to[key]),
  );
}

/** How the advisor has fared on reviewed cases that used this pill, from recorded decisions. */
function advisorRecord(state: AppState, pill: Skill) {
  let accepted = 0;
  let rejected = 0;
  let added = 0;
  for (const item of state.cases)
    if (item.review?.skillIds.includes(pill.id))
      for (const suggestion of item.review.suggestions) {
        if (suggestion.origin === 'manager') added++;
        else if (suggestion.decision === 'accepted') accepted++;
        else if (suggestion.decision === 'rejected') rejected++;
      }
  return { accepted, rejected, added };
}

export function PillPanel({
  state,
  pill,
  refresh,
  toast,
}: {
  state: AppState;
  pill: Skill;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const governs = canGovern(state, pill);
  const record = useMemo(() => advisorRecord(state, pill), [state, pill]);
  const pending = pill.pending;
  const awaiting = state.knowledge.filter(
    (item) => item.skillId === pill.id && item.status === 'Pending',
  ).length;
  async function run(key: string, path: string, method: string, body?: object, message?: string) {
    setBusy(key);
    setError('');
    try {
      await api(path, { method, body: body ? JSON.stringify(body) : undefined });
      await refresh();
      if (message) toast(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That could not be completed.');
    } finally {
      setBusy('');
    }
  }
  return (
    <section
      className="panel pill-panel"
      data-tour="pill-panel"
      aria-label={`${pill.name} governance`}
    >
      <header className="pill-panel-head">
        <div>
          <h3>{pill.name}</h3>
          <p className="muted">{pill.description}</p>
        </div>
        <div className="pill-versions">
          <span className={`badge ${pill.version ? 'badge-green' : 'badge-amber'}`}>
            {pill.version ? `Release v${pill.version}` : 'Not yet released'}
          </span>
          {awaiting > 0 && <span className="badge badge-amber">{awaiting} awaiting approval</span>}
        </div>
      </header>
      <dl className="pill-people">
        <div>
          <dt>
            <UserRound size={14} /> Owner
          </dt>
          <dd>{nameOf(state, pill.owner)}</dd>
        </div>
        <div>
          <dt>
            <ShieldCheck size={14} /> Approver
          </dt>
          <dd>{nameOf(state, pill.approver)}</dd>
        </div>
        <div>
          <dt>Changes need</dt>
          <dd>A second person: the owner and approver release each other&apos;s changes</dd>
        </div>
        <div>
          <dt>Advisor record</dt>
          <dd>
            {record.accepted} accepted · {record.rejected} rejected · {record.added} added by
            reviewers
          </dd>
        </div>
      </dl>

      {pending && (
        <div className="pill-pending" role="status">
          <CircleAlert size={18} />
          <div>
            <strong>Change proposed by {pending.proposedBy}</strong>
            <p>{pending.note}</p>
            <p className="muted">
              Changes:{' '}
              {changedFields(definitionOf(pill), pending.definition)
                .map((key) => fieldLabels[key])
                .join(', ')}
              . The current release stays live until a second person releases it.
            </p>
            {governs && (
              <div className="pill-actions">
                <button
                  className="btn btn-primary btn-small"
                  disabled={!!busy || pending.proposedById === state.user.id}
                  title={
                    pending.proposedById === state.user.id
                      ? 'A different person must release a change you proposed'
                      : ''
                  }
                  onClick={() =>
                    run('release', `/skills/${pill.id}/release`, 'POST', {}, 'Pill released.')
                  }
                >
                  {busy === 'release' ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Release change
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      'discard',
                      `/skills/${pill.id}/pending`,
                      'DELETE',
                      undefined,
                      'Proposal discarded.',
                    )
                  }
                >
                  <X size={14} />
                  Discard
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pill-columns">
        <div>
          <h4>
            <Check size={15} /> In scope
          </h4>
          <ul>
            {pill.inScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {!pill.inScope.length && <li className="muted">Not defined yet.</li>}
          </ul>
          <h4>
            <X size={15} /> Out of scope
          </h4>
          <ul>
            {pill.outOfScope.map((item) => (
              <li key={item.label}>
                {item.label}
                {item.keywords.length > 0 && (
                  <small>Triggered by: {item.keywords.join(', ')}</small>
                )}
              </li>
            ))}
            {!pill.outOfScope.length && <li className="muted">Nothing excluded yet.</li>}
          </ul>
        </div>
        <div>
          <h4>
            <ShieldCheck size={15} /> Guardrails
          </h4>
          <ul>
            {pill.guardrails.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>
            <Siren size={15} /> Escalate to a person when
          </h4>
          <ul>
            {pill.escalations.map((item) => (
              <li key={item.trigger}>
                {item.trigger}
                <small>
                  <ArrowUpRight size={12} /> {item.route}
                </small>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="pill-history" open={false}>
        <summary>
          <History size={15} /> Release history{' '}
          <span className="section-count">{pill.releases.length}</span>
        </summary>
        <ol>
          {pill.releases.map((release, index) => (
            <li key={release.version}>
              <div>
                <strong>v{release.version}</strong>
                <span>{release.change}</span>
                <small>
                  {release.releasedBy}
                  {release.approvedBy ? ` · approved by ${release.approvedBy}` : ''} ·{' '}
                  {when(release.releasedAt)} · {release.knowledge.length} approved{' '}
                  {release.knowledge.length === 1 ? 'entry' : 'entries'}
                </small>
              </div>
              {index > 0 && governs && (
                <button
                  className="btn btn-secondary btn-small"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      `rollback-${release.version}`,
                      `/skills/${pill.id}/rollback`,
                      'POST',
                      { version: release.version },
                      `Rolled back to v${release.version}.`,
                    )
                  }
                >
                  {busy === `rollback-${release.version}` ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  Roll back
                </button>
              )}
              {index === 0 && <span className="badge badge-green">Current</span>}
            </li>
          ))}
          {!pill.releases.length && (
            <li className="muted">Approve the first knowledge entry to make release v1.</li>
          )}
        </ol>
        <p className="form-hint">
          A rollback restores that release&apos;s definition and the exact knowledge versions that
          were live, retires anything approved since, and is itself recorded as a new release.
        </p>
      </details>

      {error && (
        <p role="alert" className="inline-error pill-error">
          {error}
        </p>
      )}
      {governs ? (
        <div className="pill-footer">
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>
            {pill.version ? 'Propose a change' : 'Edit definition'}
          </button>
        </div>
      ) : (
        <p className="form-hint pill-footer">
          <ShieldCheck size={15} />
          Only {nameOf(state, pill.owner)} or {nameOf(state, pill.approver)} can change this pill.
        </p>
      )}
      {editing && (
        <PillEditDialog
          state={state}
          pill={pill}
          onClose={() => setEditing(false)}
          onSaved={async (message) => {
            await refresh();
            setEditing(false);
            toast(message);
          }}
        />
      )}
    </section>
  );
}

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const words = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

function PillEditDialog({
  state,
  pill,
  onClose,
  onSaved,
}: {
  state: AppState;
  pill: Skill;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const managers = state.users.filter((user) => user.role === 'manager');
  const [description, setDescription] = useState(pill.description);
  const [owner, setOwner] = useState(pill.owner);
  const [approver, setApprover] = useState(pill.approver);
  const [inScope, setInScope] = useState(pill.inScope.join('\n'));
  const [guardrails, setGuardrails] = useState(pill.guardrails.join('\n'));
  const [outOfScope, setOutOfScope] = useState<{ label: string; keywords: string }[]>(
    pill.outOfScope.map((item) => ({ label: item.label, keywords: item.keywords.join(', ') })),
  );
  const [escalations, setEscalations] = useState<
    { trigger: string; route: string; keywords: string; onCritical: boolean }[]
  >(
    pill.escalations.map((item) => ({
      trigger: item.trigger,
      route: item.route,
      keywords: item.keywords.join(', '),
      onCritical: Boolean(item.onCritical),
    })),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const boundaries: PillBoundary[] = outOfScope
        .filter((item) => item.label.trim())
        .map((item) => ({ label: item.label.trim(), keywords: words(item.keywords) }));
      const triggers: PillEscalation[] = escalations
        .filter((item) => item.trigger.trim())
        .map((item) => ({
          trigger: item.trigger.trim(),
          route: item.route.trim(),
          keywords: words(item.keywords),
          ...(item.onCritical ? { onCritical: true } : {}),
        }));
      await api(`/skills/${encodeURIComponent(pill.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          description: description.trim(),
          owner,
          approver,
          inScope: lines(inScope),
          guardrails: lines(guardrails),
          outOfScope: boundaries,
          escalations: triggers,
          note: note.trim(),
        }),
      });
      await onSaved(
        pill.version ? 'Change proposed. A second person must release it.' : 'Definition saved.',
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The change could not be saved.');
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${pill.version ? 'Propose a change to' : 'Edit'} ${pill.name}`}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack pill-form">
          <label className="field">
            Description
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="form-row">
            <label className="field">
              Owner
              <select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={busy}>
                {managers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Approver
              <select
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                disabled={busy}
              >
                {managers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            In scope (one per line)
            <textarea
              rows={3}
              value={inScope}
              onChange={(e) => setInScope(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            Guardrails (one per line)
            <textarea
              rows={3}
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
              disabled={busy}
            />
          </label>
          <fieldset className="pill-rows">
            <legend>Out of scope: the pill will not advise on these</legend>
            {outOfScope.map((item, index) => (
              <div className="pill-row" key={index}>
                <input
                  aria-label={`Out-of-scope topic ${index + 1}`}
                  placeholder="Topic"
                  value={item.label}
                  disabled={busy}
                  onChange={(e) =>
                    setOutOfScope(
                      outOfScope.map((row, i) =>
                        i === index ? { ...row, label: e.target.value } : row,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Out-of-scope keywords ${index + 1}`}
                  placeholder="Words that trigger it, comma separated"
                  value={item.keywords}
                  disabled={busy}
                  onChange={(e) =>
                    setOutOfScope(
                      outOfScope.map((row, i) =>
                        i === index ? { ...row, keywords: e.target.value } : row,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove out-of-scope topic ${index + 1}`}
                  onClick={() => setOutOfScope(outOfScope.filter((_, i) => i !== index))}
                  disabled={busy}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setOutOfScope([...outOfScope, { label: '', keywords: '' }])}
              disabled={busy || outOfScope.length >= 12}
            >
              <Plus size={14} />
              Add topic
            </button>
          </fieldset>
          <fieldset className="pill-rows">
            <legend>Escalate to a person when</legend>
            {escalations.map((item, index) => (
              <div className="pill-row pill-row-wide" key={index}>
                <input
                  aria-label={`Escalation trigger ${index + 1}`}
                  placeholder="Trigger"
                  value={item.trigger}
                  disabled={busy}
                  onChange={(e) =>
                    setEscalations(
                      escalations.map((row, i) =>
                        i === index ? { ...row, trigger: e.target.value } : row,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Escalation route ${index + 1}`}
                  placeholder="Who takes over"
                  value={item.route}
                  disabled={busy}
                  onChange={(e) =>
                    setEscalations(
                      escalations.map((row, i) =>
                        i === index ? { ...row, route: e.target.value } : row,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Escalation keywords ${index + 1}`}
                  placeholder="Trigger words, comma separated"
                  value={item.keywords}
                  disabled={busy}
                  onChange={(e) =>
                    setEscalations(
                      escalations.map((row, i) =>
                        i === index ? { ...row, keywords: e.target.value } : row,
                      ),
                    )
                  }
                />
                <label className="pill-check">
                  <input
                    type="checkbox"
                    checked={item.onCritical}
                    disabled={busy}
                    onChange={(e) =>
                      setEscalations(
                        escalations.map((row, i) =>
                          i === index ? { ...row, onCritical: e.target.checked } : row,
                        ),
                      )
                    }
                  />
                  On a critical finding
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove escalation ${index + 1}`}
                  onClick={() => setEscalations(escalations.filter((_, i) => i !== index))}
                  disabled={busy}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() =>
                setEscalations([
                  ...escalations,
                  { trigger: '', route: '', keywords: '', onCritical: false },
                ])
              }
              disabled={busy || escalations.length >= 12}
            >
              <Plus size={14} />
              Add escalation
            </button>
          </fieldset>
          {pill.version > 0 && (
            <label className="field">
              Why is this changing?
              <textarea
                rows={2}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Recorded in the release history"
                disabled={busy}
              />
            </label>
          )}
          <p className="form-hint">
            <ShieldCheck size={15} />
            {pill.version > 0
              ? 'The current release stays live until a second person releases this change.'
              : 'Nothing is released yet, so this applies directly.'}
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
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy && <LoaderCircle size={16} className="spin" />}
            {pill.version ? 'Propose change' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
