import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react';

export const TOUR_KEY = 'instill.tour.v1';

export interface TourStep {
  id: string;
  title: string;
  body: ReactNode;
  /** What Tencent ADP does in this step; the step shows an ADP callout when present. */
  adp?: string;
  /** The `data-tour` value of the element to spotlight. */
  target?: string;
  page?: 'overview' | 'knowledge' | 'reviews' | 'consult' | 'settings';
  openCase?: boolean;
  closeCase?: boolean;
  pill?: string;
  tab?: string;
}

export interface AdpStatus {
  tone: 'ok' | 'warn' | 'off';
  text: string;
}

export const tourSeen = () => {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return true;
  }
};
export const markTourSeen = () => {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch {
    // Private browsing: the tour simply offers itself again next time.
  }
};

export function tourSteps(): TourStep[] {
  return [
    {
      id: 'welcome',
      title: 'Welcome to Instill',
      body: (
        <>
          <p>
            Instill turns the approvals senior reviewers already do into governed, reusable
            expertise. This short tour uses fictional customs-brokerage data and shows where people
            decide and where AI helps.
          </p>
          <p>
            You are Sarah Tan, a senior reviewer. Steps marked <strong>Tencent ADP</strong> use the
            model on Tencent Cloud&apos;s Agent Development Platform. Everything else is rules or
            people.
          </p>
        </>
      ),
      adp: 'Adds observations the rules miss, judges which past decisions apply, drafts reusable rules and answers questions. Every answer must cite an approved source.',
    },
    {
      id: 'queue',
      page: 'overview',
      closeCase: true,
      target: 'overview-stats',
      title: 'Your queue',
      body: (
        <p>
          Staff prepare documents; they wait here for a senior decision. Instill never sends a
          declaration or an email: approval is an internal step.
        </p>
      ),
    },
    {
      id: 'review',
      page: 'reviews',
      openCase: true,
      target: 'review-pane',
      title: 'Specialist pills pre-review the document',
      body: (
        <p>
          Before you see it, the relevant Intelligence pills have checked the case. Each finding
          shows its severity, a suggested action, its source, and which pill release produced it.
        </p>
      ),
      adp: 'Rule checks run locally. Tencent ADP adds observations the rules do not cover and judges which recorded decisions truly apply. A finding without an approved source is discarded.',
    },
    {
      id: 'bounded',
      target: 'boundary',
      title: 'Bounded: when a person must take over',
      body: (
        <p>
          A pill lists what it will not advise on and when to escalate. Here the critical finding
          escalates to the pill owner instead of producing more automated advice.
        </p>
      ),
    },
    {
      id: 'decide',
      target: 'decision',
      title: 'You decide, and say why',
      body: (
        <p>
          Accept or reject each finding with a reason. Open <em>Make this a reusable rule</em> to
          turn that one line into a structured rule: applies when, check, does not apply when,
          evidence to attach.
        </p>
      ),
      adp: 'Drafts those fields from your reason and asks the follow-up questions a careful interviewer would. You edit and confirm; nothing is saved without you.',
    },
    {
      id: 'missed',
      target: 'missed-finding',
      title: 'Add what the AI missed',
      body: (
        <p>
          Spotted something the advisor did not? Add it. A senior reviewer&apos;s own corrections
          are the undocumented know-how an organisation most needs to keep.
        </p>
      ),
    },
    {
      id: 'approval',
      page: 'knowledge',
      closeCase: true,
      tab: 'Awaiting approval',
      target: 'approval-tab',
      title: 'Decisions are candidates, not guidance',
      body: (
        <p>
          Every decision lands in <em>Awaiting approval</em>. A second person, the pill&apos;s
          approver, must approve it before any agent can use it. Switch persona with the avatar at
          the top right to try this as Daniel Wong.
        </p>
      ),
    },
    {
      id: 'pill',
      page: 'knowledge',
      pill: 'electronics',
      target: 'pill-panel',
      title: 'An Intelligence pill has an owner, scope and versions',
      body: (
        <p>
          Each pill names an owner and a different approver, what is in and out of scope, guardrails
          and escalation triggers. Every approved change is a numbered release you can roll back.
        </p>
      ),
    },
    {
      id: 'consult',
      page: 'consult',
      target: 'consult',
      title: 'Ask an agent',
      body: (
        <p>
          Employees can ask in plain language. Answers cite approved knowledge, and say what
          evidence is still missing.
        </p>
      ),
      adp: 'Writes the answer from approved knowledge only. If it cites anything unknown, Instill rejects the answer, falls back to local retrieval, and says why.',
    },
    {
      id: 'settings',
      page: 'settings',
      target: 'adp-panel',
      title: 'See exactly how Tencent ADP is connected',
      body: (
        <p>
          <em>Check connection</em> makes a real call and reports its latency, or the precise reason
          it failed. An hourly call budget protects the Tencent allowance on this public demo.
        </p>
      ),
      adp: 'The application key stays on the server. Instill sends only the case text and approved knowledge it needs.',
    },
    {
      id: 'done',
      page: 'overview',
      title: 'Your turn',
      body: (
        <p>
          Open <strong>CP-SG-1042</strong>, accept the expiry finding with a reason, then switch to
          Daniel Wong to approve it. Replay this tour any time from the <strong>?</strong> button.
        </p>
      ),
    },
  ];
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

export function Tour({
  steps,
  status,
  onStep,
  onFinish,
}: {
  steps: TourStep[];
  status: AdpStatus;
  /** Navigate the app to what the step shows. */
  onStep: (step: TourStep) => void;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [position, setPosition] = useState({ top: 80, left: 80 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    onStep(step);
    // The step identity is what matters; onStep changes on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  // Find and follow the spotlight target. The page or dialog may still be animating in.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    let follow = 0;
    setRect(null);
    const locate = () => {
      if (cancelled) return;
      const element = step.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null;
      if (element) {
        // A tall target (the review pane) is read from its top, not its middle.
        const tall = element.getBoundingClientRect().height > window.innerHeight * 0.6;
        element.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'auto' });
        const update = () => {
          const box = element.getBoundingClientRect();
          setRect((previous) =>
            previous &&
            previous.top === box.top &&
            previous.left === box.left &&
            previous.width === box.width &&
            previous.height === box.height
              ? previous
              : { top: box.top, left: box.left, width: box.width, height: box.height },
          );
        };
        update();
        follow = window.setInterval(update, 200);
      } else if (step.target && tries++ < 20) timer = window.setTimeout(locate, 150);
    };
    timer = window.setTimeout(locate, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(follow);
    };
  }, [step.id, step.target]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const gap = 16;
    if (!rect || vw < 760) {
      setPosition({
        left: clamp((vw - width) / 2, pad, vw - width - pad),
        top:
          rect && vw < 760 ? vh - height - pad : clamp((vh - height) / 2, pad, vh - height - pad),
      });
      return;
    }
    const right = vw - (rect.left + rect.width);
    const below = vh - (rect.top + rect.height);
    if (right >= width + gap + pad)
      setPosition({
        left: rect.left + rect.width + gap,
        top: clamp(rect.top, pad, vh - height - pad),
      });
    else if (rect.left >= width + gap + pad)
      setPosition({ left: rect.left - width - gap, top: clamp(rect.top, pad, vh - height - pad) });
    else if (below >= height + gap + pad)
      setPosition({
        top: rect.top + rect.height + gap,
        left: clamp(rect.left, pad, vw - width - pad),
      });
    else if (rect.top >= height + gap + pad)
      setPosition({ top: rect.top - height - gap, left: clamp(rect.left, pad, vw - width - pad) });
    else setPosition({ top: vh - height - pad, left: clamp(rect.left, pad, vw - width - pad) });
  }, [rect, index]);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const go = (next: number) => setIndex((value) => clamp(value + next, 0, steps.length - 1));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onFinish();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      } else if (event.key === 'Tab') {
        // Keep focus inside the tour card while it is open.
        const controls = [
          ...(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
        ];
        if (!controls.length) return;
        event.stopPropagation();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (current <= 0 ? controls.length : current) - 1
          : (current + 1) % controls.length;
        event.preventDefault();
        controls[next].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [steps.length, onFinish]);

  const spot = rect && {
    top: rect.top - 8,
    left: rect.left - 8,
    width: rect.width + 16,
    height: rect.height + 16,
  };
  return (
    <div className="tour" data-testid="tour">
      <div className="tour-blocker" onClick={(event) => event.stopPropagation()} />
      {spot ? (
        <div className="tour-spot" style={spot} aria-hidden="true" />
      ) : (
        <div className="tour-scrim" aria-hidden="true" />
      )}
      <div
        className="tour-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={position}
      >
        <button className="tour-close icon-button" aria-label="Skip the tour" onClick={onFinish}>
          <X size={18} />
        </button>
        <p className="tour-step">
          Step {index + 1} of {steps.length}
        </p>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((item, position) => (
            <i key={item.id} className={position <= index ? 'done' : ''} />
          ))}
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <div className="tour-body" aria-live="polite">
          {step.body}
        </div>
        {step.adp && (
          <div className={`tour-adp tour-adp-${status.tone}`}>
            <span className="origin-chip origin-adp">
              <Sparkles size={12} /> Tencent ADP
            </span>
            <p>{step.adp}</p>
            <small>{status.text}</small>
          </div>
        )}
        <div className="tour-actions">
          <button className="text-button" onClick={onFinish}>
            Skip tour
          </button>
          <span>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setIndex(index - 1)}
              disabled={index === 0}
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              ref={nextRef}
              className="btn btn-primary btn-small"
              onClick={() => (last ? onFinish() : setIndex(index + 1))}
            >
              {last ? <Check size={14} /> : null}
              {last ? 'Finish' : 'Next'}
              {last ? null : <ArrowRight size={14} />}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
