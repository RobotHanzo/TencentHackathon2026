import type { Knowledge } from '../shared/types.ts';
import type { Store, Workspace } from './store.ts';
import { knowledgeDigest } from './tencent-knowledge.ts';

export interface KnowledgeSyncJob {
  knowledgeId: string;
  target: string;
  fingerprint: string;
  status: NonNullable<Knowledge['adpStatus']>;
  documentId?: string;
  releaseId?: string;
  attempts: number;
  updatedAt: string;
  nextAttemptAt?: string;
  error?: string;
}

export interface KnowledgeClient {
  putDocument(knowledge: Knowledge): Promise<{ docId: string }>;
  getDocument(id: string): Promise<{ status: 'processing' | 'ready' | 'published' | 'failed' }>;
  createRelease(description: string): Promise<{ releaseId: string }>;
  getRelease(id: string): Promise<{ status: 'processing' | 'published' | 'failed' }>;
}

const fingerprint = knowledgeDigest;

// Called in the same transaction as a manager's publication or decision.
export function enqueueApproved(workspace: Workspace, target: string, now: Date) {
  workspace.knowledgeSync ??= {};
  for (const item of workspace.knowledge) {
    if (item.status !== 'Approved' || item.jurisdiction !== 'Singapore') continue;
    const hash = fingerprint(item);
    const existing = workspace.knowledgeSync[item.id];
    if (existing?.target === target && existing.fingerprint === hash) continue;
    workspace.knowledgeSync[item.id] = {
      knowledgeId: item.id,
      target,
      fingerprint: hash,
      status: 'pending',
      attempts: 0,
      updatedAt: now.toISOString(),
    };
  }
}

export class KnowledgeSync {
  private busy = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private store: Store,
    private client: KnowledgeClient,
    readonly target: string,
    readonly autoPublish = false,
    private now = () => new Date(),
  ) {}

  enqueue(workspace: Workspace) {
    enqueueApproved(workspace, this.target, this.now());
  }

  summary() {
    const jobs = this.jobs();
    return {
      configured: true,
      autoPublish: this.autoPublish,
      pending: jobs.filter((job) => ['pending', 'indexing', 'publishing'].includes(job.status))
        .length,
      ready: jobs.filter((job) => job.status === 'ready').length,
      synced: jobs.filter((job) => job.status === 'synced').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
    };
  }

  documentMap() {
    return Object.fromEntries(
      this.jobs()
        .filter((job) => job.documentId && this.currentSource(job) && job.status === 'synced')
        .map((job) => [job.documentId!, job.knowledgeId]),
    );
  }

  private currentSource(job: KnowledgeSyncJob) {
    const item = this.store.read().knowledge.find((item) => item.id === job.knowledgeId);
    return item &&
      item.status === 'Approved' &&
      item.jurisdiction === 'Singapore' &&
      fingerprint(item) === job.fingerprint
      ? item
      : undefined;
  }

  private jobs() {
    return Object.values(this.store.read().knowledgeSync ?? {}).filter(
      (job) => job.target === this.target,
    );
  }

  private update(id: string, patch: Partial<KnowledgeSyncJob>, expectedFingerprint?: string) {
    if (this.stopped) return;
    this.store.mutate((workspace) => {
      const job = workspace.knowledgeSync?.[id];
      if (
        job?.target !== this.target ||
        (expectedFingerprint && job.fingerprint !== expectedFingerprint)
      )
        return;
      const source = workspace.knowledge.find((item) => item.id === id);
      if (
        patch.status !== 'failed' &&
        (!source ||
          source.status !== 'Approved' ||
          source.jurisdiction !== 'Singapore' ||
          fingerprint(source) !== job.fingerprint)
      ) {
        Object.assign(job, {
          status: 'failed',
          attempts: 5,
          error: 'Approved source changed; reconcile the ADP application before publishing.',
          updatedAt: this.now().toISOString(),
        });
        return;
      }
      Object.assign(job, patch, { updatedAt: this.now().toISOString() });
    });
  }

  retry() {
    this.store.mutate((workspace) => {
      this.enqueue(workspace);
      for (const job of Object.values(workspace.knowledgeSync ?? {})) {
        if (job.target !== this.target || job.status !== 'failed') continue;
        job.status = job.releaseId ? 'publishing' : job.documentId ? 'indexing' : 'pending';
        job.attempts = 0;
        delete job.error;
        delete job.nextAttemptAt;
      }
    });
    this.start();
  }

  start() {
    if (this.stopped || this.timer || this.busy) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => {
        if (!this.stopped) this.schedule();
      });
    }, 0);
    this.timer.unref();
  }

  private schedule() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, 5000);
    this.timer.unref();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  // Each tick makes bounded remote calls, outside every SQLite transaction.
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let current: KnowledgeSyncJob | undefined;
    let releaseFailed = false;
    try {
      const jobs = this.jobs();
      const due = (job: KnowledgeSyncJob) =>
        !job.nextAttemptAt || job.nextAttemptAt <= this.now().toISOString();
      current =
        jobs.find((job) => job.status === 'publishing' && due(job)) ??
        jobs.find((job) => ['pending', 'indexing'].includes(job.status) && due(job)) ??
        jobs.find((job) => job.status === 'failed' && job.attempts < 5 && due(job));
      if (current?.releaseId) {
        const result = await this.client.getRelease(current.releaseId);
        if (result.status === 'failed') {
          releaseFailed = true;
          throw new Error('ADP release failed.');
        }
        for (const job of jobs.filter((job) => job.releaseId === current!.releaseId)) {
          this.update(
            job.knowledgeId,
            {
              // A completed release still needs per-document publication confirmation.
              status: result.status === 'published' ? 'indexing' : 'publishing',
              releaseId: result.status === 'published' ? undefined : job.releaseId,
              nextAttemptAt: new Date(this.now().getTime() + 5000).toISOString(),
              error: undefined,
            },
            job.fingerprint,
          );
        }
        return;
      }
      if (current) {
        const item = this.currentSource(current);
        if (!item) {
          this.update(
            current.knowledgeId,
            {
              status: 'failed',
              attempts: 5,
              error: 'Approved source changed; queue a fresh synchronization.',
            },
            current.fingerprint,
          );
          return;
        }
        if (!current.documentId) {
          const result = await this.client.putDocument(item);
          this.update(
            item.id,
            { documentId: result.docId, status: 'indexing', attempts: 0, error: undefined },
            current.fingerprint,
          );
        } else {
          const result = await this.client.getDocument(current.documentId);
          if (result.status === 'failed') throw new Error('ADP document indexing failed.');
          this.update(
            item.id,
            {
              status:
                result.status === 'published'
                  ? 'synced'
                  : result.status === 'ready'
                    ? 'ready'
                    : 'indexing',
              attempts: result.status === 'published' ? 0 : current.attempts,
              error: undefined,
              nextAttemptAt: new Date(this.now().getTime() + 5000).toISOString(),
            },
            current.fingerprint,
          );
        }
        return;
      }
      const ready = jobs.filter((job) => job.status === 'ready');
      if (!ready.length) return;
      const changed = ready.filter((job) => !this.currentSource(job));
      if (changed.length) {
        for (const job of changed)
          this.update(
            job.knowledgeId,
            {
              status: 'failed',
              attempts: 5,
              error: 'Source changed. Reconcile the ADP application before publishing.',
            },
            job.fingerprint,
          );
        return;
      }
      // Releasing the whole app is unsafe while any source has an unresolved failure.
      if (this.autoPublish && jobs.some((job) => job.status === 'failed')) return;
      if (
        this.autoPublish &&
        !jobs.some((job) => ['pending', 'indexing', 'publishing'].includes(job.status))
      ) {
        current = ready[0];
        const result = await this.client.createRelease(
          'Publish Clearport manager-approved knowledge.',
        );
        if (this.stopped) return;
        // One atomic write records a shared release for this entire batch.
        this.store.mutate((workspace) => {
          for (const readyJob of ready) {
            const job = workspace.knowledgeSync?.[readyJob.knowledgeId];
            if (
              job?.target === this.target &&
              job.status === 'ready' &&
              job.fingerprint === readyJob.fingerprint
            ) {
              job.status = 'publishing';
              job.releaseId = result.releaseId;
              job.updatedAt = this.now().toISOString();
            }
          }
        });
      } else {
        // Detect publication performed by an operator in the ADP console.
        current = ready.find(due);
        if (!current?.documentId) return;
        const result = await this.client.getDocument(current.documentId);
        if (result.status === 'failed') throw new Error('ADP document indexing failed.');
        this.update(
          current.knowledgeId,
          {
            status:
              result.status === 'published'
                ? 'synced'
                : result.status === 'ready'
                  ? 'ready'
                  : 'indexing',
            nextAttemptAt: new Date(this.now().getTime() + 30_000).toISOString(),
          },
          current.fingerprint,
        );
      }
    } catch {
      if (this.stopped) return;
      if (current) {
        const attempts = current.attempts + 1;
        const affected = current.releaseId
          ? this.jobs().filter((job) => job.releaseId === current!.releaseId)
          : [current];
        for (const job of affected)
          this.update(
            job.knowledgeId,
            {
              status: 'failed',
              releaseId: releaseFailed ? undefined : job.releaseId,
              attempts,
              nextAttemptAt: new Date(
                this.now().getTime() + Math.min(300_000, 5000 * 2 ** attempts),
              ).toISOString(),
              // Provider errors can contain credentials or document text. Never persist raw errors.
              error:
                'ADP synchronization failed. Check access, quota and document status, then retry.',
            },
            job.fingerprint,
          );
      }
    } finally {
      this.busy = false;
    }
  }
}
