import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { CaseRecord, Comment, CommentAnchor } from '../shared/types';

export function isCurrentAnchor(
  record: CaseRecord,
  anchor?: CommentAnchor,
): anchor is CommentAnchor {
  return (
    !!anchor &&
    anchor.revision === (record.contentRevision ?? 0) &&
    Number.isSafeInteger(anchor.start) &&
    Number.isSafeInteger(anchor.end) &&
    anchor.start >= 0 &&
    anchor.end > anchor.start &&
    anchor.end <= record.content.length &&
    record.content.slice(anchor.start, anchor.end) === anchor.quote
  );
}

export function AnnotatedDocument({
  record,
  comments,
  active,
  busy,
  activeCommentId,
  onPost,
  onOpenComment,
}: {
  record: CaseRecord;
  comments: Comment[];
  active: boolean;
  busy: boolean;
  activeCommentId: string | null;
  onPost: (content: string, anchor: CommentAnchor) => Promise<void>;
  onOpenComment: (id: string) => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<CommentAnchor | null>(null);
  const [anchor, setAnchor] = useState<CommentAnchor | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || posting;
  const current = comments.filter((comment) => isCurrentAnchor(record, comment.anchor));
  const boundaries = [
    ...new Set([
      0,
      record.content.length,
      ...current.flatMap((comment) => [comment.anchor!.start, comment.anchor!.end]),
    ]),
  ].sort((a, b) => a - b);

  useEffect(() => {
    setSelection(null);
    if (!active) return;
    const readSelection = () => {
      const clearSelection = () => {
        // Focusing an action must not discard the passage it is about to capture.
        if (
          toolbarRef.current?.contains(document.activeElement) ||
          controlsRef.current?.contains(document.activeElement)
        )
          return;
        setSelection(null);
      };
      const root = textRef.current;
      const selected = window.getSelection();
      if (!root || !selected || selected.rangeCount !== 1 || selected.isCollapsed) {
        clearSelection();
        return;
      }
      const range = selected.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        clearSelection();
        return;
      }
      const prefix = range.cloneRange();
      prefix.selectNodeContents(root);
      prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      const quote = range.toString();
      const end = start + quote.length;
      if (!quote.trim() || record.content.slice(start, end) !== quote) {
        setSelection(null);
        return;
      }
      setSelection({ start, end, quote, revision: record.contentRevision ?? 0 });
    };
    // Handles mouse, touch selection handles and keyboard selection alike.
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, [record.content, record.contentRevision, active]);

  useEffect(() => {
    if (!active || !activeCommentId) return;
    const target = [
      ...(textRef.current?.querySelectorAll<HTMLElement>('[data-comment-ids]') ?? []),
    ].find((element) => element.dataset.commentIds?.split(' ').includes(activeCommentId));
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  }, [activeCommentId, record.contentRevision, active]);

  function beginComment() {
    if (!selection || locked) return;
    setAnchor(selection);
    setSelection(null);
    setError('');
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function post() {
    if (!anchor || !draft.trim() || locked || inFlight.current || !isCurrentAnchor(record, anchor))
      return;
    inFlight.current = true;
    setPosting(true);
    setError('');
    try {
      await onPost(draft, anchor);
      setDraft('');
      setAnchor(null);
      textRef.current?.focus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not add comment. Try again.');
    } finally {
      inFlight.current = false;
      setPosting(false);
    }
  }

  return (
    <div className="annotated-document">
      <div className="annotation-toolbar" ref={toolbarRef}>
        <span className="muted">Select text to comment.</span>
        {selection && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onPointerDown={(event) => event.preventDefault()}
            onClick={beginComment}
          >
            <MessageSquare size={15} />
            {anchor ? 'Use selected text' : 'Comment on selection'}
          </button>
        )}
      </div>
      <div
        className="document-content"
        role="document"
        aria-label="Document text"
        tabIndex={0}
        ref={textRef}
      >
        {boundaries.slice(0, -1).map((start, index) => {
          const end = boundaries[index + 1];
          const text = record.content.slice(start, end);
          const matching = current.filter(
            (comment) => comment.anchor!.start < end && comment.anchor!.end > start,
          );
          if (!matching.length) return <span key={start}>{text}</span>;
          return (
            <mark
              key={start}
              className={`document-annotation${matching.some((comment) => comment.id === activeCommentId) ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              data-comment-ids={matching.map((comment) => comment.id).join(' ')}
              aria-label={`View ${matching.length === 1 ? 'comment' : 'comments'} on ${text}`}
              title={matching.map((comment) => `${comment.author}: ${comment.content}`).join('\n')}
              onClick={() => {
                if (window.getSelection()?.toString()) return;
                onOpenComment(matching[0].id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenComment(matching[0].id);
                }
              }}
            >
              {text}
            </mark>
          );
        })}
      </div>
      <div className="annotation-controls" ref={controlsRef}>
        {anchor && (
          <form
            className="annotation-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void post();
            }}
          >
            <blockquote className="comment-quote">{anchor.quote}</blockquote>
            {!isCurrentAnchor(record, anchor) && (
              <p className="inline-error" role="alert">
                Document changed. Select the passage again.
              </p>
            )}
            <label className="field">
              Comment on selected text
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                maxLength={4000}
                required
                disabled={locked}
                placeholder="Add a note…"
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="annotation-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={locked || !draft.trim() || !isCurrentAnchor(record, anchor)}
              >
                <Send size={15} />
                {posting ? 'Posting…' : 'Post comment'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={locked}
                onClick={() => {
                  setAnchor(null);
                  setDraft('');
                  setError('');
                  textRef.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
