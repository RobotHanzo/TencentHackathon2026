import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type {
  Activity,
  AppState,
  CaseInput,
  CaseRecord,
  Category,
  ChatMessage,
  CommentAnchor,
  Knowledge,
  IntegrationState,
  PillBoundary,
  PillDefinition,
  PillEscalation,
  Rule,
  Skill,
  Suggestion,
  User,
} from '../shared/types.ts';
import { Store, type Workspace } from './store.ts';
import { answerQuestion, draftRule, liveConfigured, reviewCase, type AIConfig } from './advisor.ts';
import { ADP_ENDPOINT, AiError } from './adp.ts';
import { probeEndpoint } from './network.ts';
import {
  definitionOf,
  isGovernor,
  nextKnowledgeVersion,
  recordRelease,
  rollbackPill,
  userName,
} from './governance.ts';
import { KnowledgeSync, type KnowledgeClient } from './knowledge-sync.ts';
import { TencentKnowledgeClient } from './tencent-knowledge.ts';
import { OriginalStorage } from './object-storage.ts';
import { accessLog } from './access-log.ts';

const categories: Category[] = ['Electronics', 'Food & produce', 'Automotive', 'General cargo'];
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
const string = (value: unknown, label: string, maximum = 2000, required = false) => {
  if (value === undefined || value === null) {
    if (required) fail(400, `${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(400, `${label} must be text.`);
  const result = (value as string).trim();
  if (result.length > maximum) fail(400, `${label} must be at most ${maximum} characters.`);
  if (required && !result) fail(400, `${label} is required.`);
  return result;
};
const date = (value: unknown, label: string) => {
  const result = string(value, label, 10);
  if (
    result &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(result) ||
      Number.isNaN(Date.parse(result)) ||
      new Date(result).toISOString().slice(0, 10) !== result)
  )
    fail(400, `${label} must be a valid YYYY-MM-DD date.`);
  return result;
};
function caseInput(body: Record<string, unknown>): CaseInput {
  if (body.jurisdiction !== 'Singapore') fail(400, 'This workspace supports Singapore only.');
  if (!categories.includes(body.category as Category))
    fail(400, 'Choose a supported goods category.');
  if (!['Customs declaration', 'Customer email', 'Contract'].includes(body.documentType as string))
    fail(400, 'Choose a supported document type.');
  if (typeof body.warehouseConfirmed !== 'boolean')
    fail(400, 'Warehouse confirmation must be true or false.');
  return {
    title: string(body.title, 'Title', 200, true),
    customer: string(body.customer, 'Customer', 200, true),
    category: body.category as Category,
    jurisdiction: 'Singapore',
    documentType: body.documentType as CaseInput['documentType'],
    content: string(body.content, 'Document content', 120_000, true),
    permitNumber: string(body.permitNumber, 'Permit reference', 150),
    permitExpiry: date(body.permitExpiry, 'Permit expiry'),
    shipmentDate: date(body.shipmentDate, 'Shipment date'),
    warehouseConfirmed: body.warehouseConfirmed as boolean,
  };
}

function commentAnchor(value: unknown, item: CaseRecord): CommentAnchor | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(400, 'The comment selection must be an anchor object.');
  const { start, end, quote, revision } = value as Record<string, unknown>;
  if (
    typeof start !== 'number' ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(end) ||
    end <= start ||
    typeof quote !== 'string' ||
    !quote.trim() ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return fail(400, 'The comment selection needs valid text offsets, quoted text and a revision.');
  // Check the version before comparing against text that may have changed or shortened.
  if (revision !== (item.contentRevision ?? 0))
    return fail(409, 'The document changed. Select text from the current version and try again.');
  if (end > item.content.length || item.content.slice(start, end) !== quote)
    return fail(400, 'The quoted text must exactly match the selected document text.');
  return { start, end, quote, revision };
}

/** A list of short, non-empty strings; blank entries are dropped. */
function textList(value: unknown, label: string, maxItems = 12, maxLength = 300): string[] {
  if (!Array.isArray(value)) return fail(400, `${label} must be a list.`);
  const items = value
    .map((entry) => string(entry, label, maxLength))
    .filter((entry) => entry.length > 0);
  if (items.length > maxItems) fail(400, `${label} can have at most ${maxItems} entries.`);
  return items;
}
const keywordList = (value: unknown, label: string) =>
  textList(value ?? [], label, 12, 40).map((entry) => entry.toLowerCase());
function boundaries(value: unknown): PillBoundary[] {
  if (!Array.isArray(value)) return fail(400, 'Out-of-scope topics must be a list.');
  if (value.length > 12) fail(400, 'Out-of-scope topics can have at most 12 entries.');
  return value
    .map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        label: string(item.label, 'Out-of-scope topic', 200),
        keywords: keywordList(item.keywords, 'Out-of-scope keywords'),
      };
    })
    .filter((entry) => entry.label);
}
function escalations(value: unknown): PillEscalation[] {
  if (!Array.isArray(value)) return fail(400, 'Escalation triggers must be a list.');
  if (value.length > 12) fail(400, 'Escalation triggers can have at most 12 entries.');
  return value
    .map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        trigger: string(item.trigger, 'Escalation trigger', 200),
        route: string(item.route, 'Escalation route', 300),
        keywords: keywordList(item.keywords, 'Escalation keywords'),
        ...(item.onCritical === true ? { onCritical: true } : {}),
      };
    })
    .filter((entry) => entry.trigger);
}
/** Structured reasoning is optional; empty fields are fine, oversized ones are not. */
function ruleInput(value: unknown): Rule | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value))
    return fail(400, 'The rule must be an object.');
  const item = value as Record<string, unknown>;
  const rule = {
    appliesWhen: string(item.appliesWhen, 'Applies when', 600),
    check: string(item.check, 'Check', 600),
    exceptions: string(item.exceptions, 'Exceptions', 600),
    evidence: string(item.evidence, 'Evidence', 600),
  };
  return Object.values(rule).some(Boolean) ? rule : undefined;
}
const ruleLines = (rule?: Rule) =>
  rule
    ? [
        rule.appliesWhen && `Applies when: ${rule.appliesWhen}`,
        rule.check && `Check: ${rule.check}`,
        rule.exceptions && `Does not apply when: ${rule.exceptions}`,
        rule.evidence && `Evidence to attach: ${rule.evidence}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';
const standardEscalation = (): PillEscalation => ({
  trigger: 'A critical finding is raised',
  route: 'The pill owner decides whether the document may proceed',
  keywords: [],
  onCritical: true,
});

export interface AppOptions {
  dbPath?: string;
  demoMode?: boolean;
  accessPassword?: string;
  userId?: string;
  now?: () => Date;
  ai?: AIConfig;
  staticDir?: string;
  cookieSecure?: boolean;
  knowledge?: { client: KnowledgeClient; target: string; autoPublish?: boolean; start?: boolean };
  originals?: Pick<OriginalStorage, 'put'>;
  accessLog?: (line: string) => void;
}

async function extractFile(file: Express.Multer.File): Promise<string> {
  const extension = extname(file.originalname).toLowerCase();
  if (['.txt', '.md', '.eml', '.csv'].includes(extension)) {
    const decoded = file.buffer.toString('utf8');
    if (decoded.includes('\0'))
      fail(400, 'This file is not readable text. Export it as UTF-8 text, PDF or DOCX.');
    return decoded;
  }
  if (extension === '.pdf') {
    try {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(file.buffer), useSystemFonts: true });
      const pdf = await task.promise;
      try {
        if (pdf.numPages > 150)
          fail(400, 'Please split this PDF into documents of 150 pages or fewer.');
        const pages: string[] = [];
        for (let page = 1; page <= pdf.numPages; page++) {
          const content = await (await pdf.getPage(page)).getTextContent();
          pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        return pages.join('\n\n');
      } finally {
        await task.destroy();
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      fail(
        400,
        'The PDF could not be read. Remove password protection or export a readable text PDF. OCR is not available.',
      );
    }
  }
  if (extension === '.docx') {
    try {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } catch {
      fail(400, 'The DOCX could not be read. Export it as a valid DOCX or plain text document.');
    }
  }
  return fail(400, 'Supported files are PDF, DOCX, TXT, MD, EML and CSV.');
}

export function createApp(options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const demoMode =
    options.demoMode ??
    (process.env.DEMO_MODE !== undefined
      ? process.env.DEMO_MODE === 'true'
      : process.env.NODE_ENV !== 'production');
  const accessPassword = options.accessPassword ?? process.env.APP_ACCESS_PASSWORD;
  if (!demoMode && (!accessPassword || accessPassword.length < 12))
    throw new Error('Non-demo mode requires an APP_ACCESS_PASSWORD of at least 12 characters.');
  const timeoutSetting = Number(process.env.AI_TIMEOUT_MS);
  const aiSettings: AIConfig = options.ai ?? {
    provider: (process.env.AI_PROVIDER?.trim() || undefined) as AIConfig['provider'],
    baseUrl: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    adpAppKey: process.env.ADP_APP_KEY,
    adpEndpoint: process.env.ADP_ENDPOINT,
    ...(Number.isFinite(timeoutSetting) && timeoutSetting > 0 ? { timeoutMs: timeoutSetting } : {}),
  };
  if (
    aiSettings.provider !== undefined &&
    !['local', 'openai', 'adp'].includes(aiSettings.provider)
  )
    throw new Error('AI_PROVIDER must be local, openai or adp.');
  if (aiSettings.provider === 'adp' && !aiSettings.adpAppKey?.trim())
    throw new Error('AI_PROVIDER=adp requires ADP_APP_KEY.');
  if (
    aiSettings.provider === 'openai' &&
    !(aiSettings.baseUrl && aiSettings.apiKey && aiSettings.model)
  )
    throw new Error('AI_PROVIDER=openai requires AI_BASE_URL, AI_API_KEY and AI_MODEL.');
  // A public demo can be clicked by anyone, so cap provider calls to protect the Tencent allowance.
  const hourlyBudget = Number(process.env.AI_CALLS_PER_HOUR ?? 120);
  const recentCalls: number[] = [];
  const spendingGuard = () => {
    const cutoff = Date.now() - 3_600_000;
    while (recentCalls.length && recentCalls[0] < cutoff) recentCalls.shift();
    if (Number.isFinite(hourlyBudget) && recentCalls.length >= hourlyBudget)
      throw new AiError(
        `The hourly AI call budget (${hourlyBudget}) is used up; the local advisor answers until it resets.`,
      );
    recentCalls.push(Date.now());
  };
  const ai: AIConfig = { ...aiSettings, beforeCall: aiSettings.beforeCall ?? spendingGuard };
  const provider = ai.provider ?? (ai.adpAppKey ? 'adp' : liveConfigured(ai) ? 'openai' : 'local');
  const connection: IntegrationState = {
    provider,
    connection: provider === 'local' ? 'local' : 'configured',
  };
  const noteConnection = (mode: 'local' | 'live', reason?: string, elapsedMs?: number) => {
    if (provider === 'local') return;
    connection.connection = mode === 'live' ? 'verified' : 'error';
    connection.checkedAt = now().toISOString();
    if (mode === 'live') {
      delete connection.lastError;
      if (elapsedMs !== undefined) connection.latencyMs = elapsedMs;
    } else if (reason) connection.lastError = reason;
  };
  /** The provider URL this deployment talks to, for reachability checks. */
  const aiEndpoint = () =>
    provider === 'adp'
      ? ai.adpEndpoint || ADP_ENDPOINT
      : provider === 'openai'
        ? ai.baseUrl
        : undefined;
  const cookieSecure = options.cookieSecure ?? process.env.APP_COOKIE_SECURE === 'true';
  let knowledgeConfig = options.knowledge;
  const originals =
    options.originals ??
    (process.env.COS_BUCKET
      ? new OriginalStorage({
          bucket: process.env.COS_BUCKET,
          region: process.env.COS_REGION,
          secretId: process.env.TENCENT_SECRET_ID ?? '',
          secretKey: process.env.TENCENT_SECRET_KEY ?? '',
          sessionToken: process.env.TENCENT_TOKEN,
        })
      : undefined);
  if (!knowledgeConfig && process.env.ADP_KNOWLEDGE_SYNC === 'true') {
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    const appBizId = process.env.ADP_APP_BIZ_ID;
    const region = process.env.TENCENT_REGION || 'ap-jakarta';
    if (!secretId || !secretKey || !appBizId)
      throw new Error(
        'ADP knowledge sync requires TENCENT_SECRET_ID, TENCENT_SECRET_KEY and ADP_APP_BIZ_ID.',
      );
    knowledgeConfig = {
      client: new TencentKnowledgeClient({
        secretId,
        secretKey,
        appBizId,
        region,
        sessionToken: process.env.TENCENT_TOKEN,
      }),
      target: createHash('sha256')
        .update(JSON.stringify([region, appBizId]))
        .digest('hex'),
      autoPublish: process.env.ADP_AUTO_PUBLISH === 'true',
    };
  }
  const store = new Store(
    options.dbPath ?? process.env.DATA_PATH ?? resolve('data/clearport.db'),
    now(),
  );
  const fixedUserId = options.userId ?? process.env.APP_USER_ID ?? 'manager-sarah';
  if (!store.read().users.some((user) => user.id === fixedUserId)) {
    store.close();
    throw new Error('APP_USER_ID does not identify a workspace user.');
  }
  const knowledgeSync = knowledgeConfig
    ? new KnowledgeSync(
        store,
        knowledgeConfig.client,
        knowledgeConfig.target,
        knowledgeConfig.autoPublish,
        now,
      )
    : undefined;
  if (knowledgeSync) {
    store.mutate((workspace) => knowledgeSync.enqueue(workspace));
    if (knowledgeConfig?.start !== false) knowledgeSync.start();
  }
  const app = express();
  const sessions = new Map<string, { userId: string; expires: number }>();
  const activeConversations = new Set<string>();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 300_000 },
  });
  app.disable('x-powered-by');
  if (options.accessLog) app.use(accessLog(options.accessLog, now));
  app.use(express.json({ limit: '300kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, demoMode, aiMode: liveConfigured(ai) ? 'live' : 'local' }),
  );
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        const local = ['127.0.0.1', 'localhost', '[::1]'];
        if (
          origin.hostname !== req.hostname &&
          !(local.includes(origin.hostname) && local.includes(req.hostname))
        )
          return next(new ApiError(403, 'Cross-origin requests are not allowed.'));
      } catch {
        return next(new ApiError(403, 'Invalid request origin.'));
      }
    }
    let token = (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('instill_session='))
      ?.slice('instill_session='.length);
    const active = token ? sessions.get(token) : undefined;
    let userId = active && active.expires > Date.now() ? active.userId : undefined;
    if (!userId && !demoMode) {
      const authorization = req.headers.authorization;
      const decoded = authorization?.startsWith('Basic ')
        ? Buffer.from(authorization.slice(6), 'base64').toString('utf8')
        : '';
      const separator = decoded.indexOf(':');
      const username = decoded.slice(0, separator);
      const supplied = Buffer.from(decoded.slice(separator + 1));
      const expected = Buffer.from(accessPassword!);
      if (
        !['instill', 'clearport'].includes(username) ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Instill", charset="UTF-8"');
        return next(new ApiError(401, 'Authentication required.'));
      }
      userId = fixedUserId;
    }
    if (!userId) userId = fixedUserId;
    if (!active || active.expires < Date.now()) {
      token = randomUUID();
      sessions.set(token, { userId, expires: Date.now() + 12 * 60 * 60 * 1000 });
      if (sessions.size > 1000)
        for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
      res.cookie('instill_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: cookieSecure || req.secure,
        maxAge: 12 * 60 * 60 * 1000,
        path: '/',
      });
    }
    res.locals.user = store.read().users.find((user) => user.id === userId)!;
    res.locals.sessionToken = token;
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const user = (res: Response): User => res.locals.user;
  const manager = (res: Response) => {
    if (user(res).role !== 'manager') fail(403, 'Only a senior manager can perform this action.');
  };
  const record = (workspace: Workspace, id: string): CaseRecord =>
    workspace.cases.find((item) => item.id === id) ?? fail(404, 'Case not found.');
  const pillOf = (workspace: Workspace, id: string): Skill =>
    workspace.skills.find((item) => item.id === id) ?? fail(404, 'Intelligence pill not found.');
  const entryOf = (workspace: Workspace, id: string): Knowledge =>
    workspace.knowledge.find((item) => item.id === id) ?? fail(404, 'Knowledge entry not found.');
  /** Only a pill's owner or approver may change what it knows or what it is approved to do. */
  const governor = (workspace: Workspace, skill: Skill, res: Response) => {
    if (!isGovernor(skill, user(res)))
      fail(
        403,
        `Only the pill owner (${userName(workspace, skill.owner)}) or approver (${userName(workspace, skill.approver)}) can do this.`,
      );
  };
  const isAuthor = (item: Knowledge, res: Response) =>
    item.authorId ? item.authorId === user(res).id : item.author === user(res).name;
  const editable = (item: CaseRecord, res: Response) => {
    if (user(res).role !== 'manager' && item.ownerId !== user(res).id)
      fail(403, 'You can edit only cases you own.');
    if (item.status === 'Approved')
      fail(409, 'Approved cases are locked. Create a new case for an amendment.');
  };
  const updated = (item: CaseRecord) => {
    item.updatedAt = new Date(
      Math.max(now().getTime(), Date.parse(item.updatedAt) + 1),
    ).toISOString();
  };
  const activity = (
    workspace: Workspace,
    res: Response,
    type: Activity['type'],
    title: string,
    detail: string,
    caseId?: string,
  ) => {
    workspace.activity.unshift({
      id: randomUUID(),
      type,
      title,
      detail,
      actor: user(res).name,
      createdAt: now().toISOString(),
      ...(caseId ? { caseId } : {}),
    });
  };

  app.get('/api/state', (_req, res) => {
    const {
      chatOwners = {},
      agentConversations: _conversations,
      knowledgeSync: syncJobs = {},
      ...workspace
    } = store.read();
    const state: AppState = {
      ...workspace,
      chats: workspace.chats.filter((message) => chatOwners[message.id] === user(res).id),
      knowledge: workspace.knowledge.map((item) => ({
        ...item,
        ...(knowledgeSync && syncJobs[item.id]?.target === knowledgeSync.target
          ? { adpStatus: syncJobs[item.id].status }
          : {}),
      })),
      user: user(res),
      aiMode: liveConfigured(ai) ? 'live' : 'local',
      demoMode,
      integrations: { ...connection, knowledge: knowledgeSync?.summary() },
    };
    res.json(state);
  });
  app.post('/api/session', (req, res) => {
    if (!demoMode) fail(403, 'Role switching is available only in demo mode.');
    const selected =
      store.read().users.find((entry) => entry.id === req.body?.userId) ??
      fail(400, 'Unknown demo user.');
    sessions.set(res.locals.sessionToken, {
      userId: selected.id,
      expires: Date.now() + 12 * 60 * 60 * 1000,
    });
    res.json(selected);
  });
  app.post('/api/cases', (req, res) => {
    const data = caseInput(req.body ?? {});
    const created = store.mutate((workspace) => {
      const item: CaseRecord = {
        ...data,
        contentRevision: 0,
        id: randomUUID(),
        reference: `CP-SG-${1043 + workspace.cases.length - 6}`,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
        ownerId: user(res).id,
        ownerName: user(res).name,
        status: 'Draft',
        review: null,
      };
      workspace.cases.unshift(item);
      activity(
        workspace,
        res,
        'comment',
        'New case created',
        `${item.reference} · ${item.title}`,
        item.id,
      );
      return item;
    });
    res.status(201).json(created);
  });
  app.put('/api/cases/:id', (req, res) => {
    const data = caseInput(req.body ?? {});
    res.json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        editable(item, res);
        if (item.content !== data.content) item.contentRevision = (item.contentRevision ?? 0) + 1;
        Object.assign(item, data, { review: null, status: 'Draft' });
        updated(item);
        activity(
          workspace,
          res,
          'comment',
          'Case updated',
          'Document changes invalidated the previous review. A new advisor review is required.',
          item.id,
        );
        return item;
      }),
    );
  });
  app.post('/api/cases/:id/review', async (req, res) => {
    const snapshot = store.read();
    const before = record(snapshot, req.params.id);
    editable(before, res);
    const review = await reviewCase(snapshot, before, now(), ai, {
      visitorId: createHash('sha256').update(user(res).id).digest('hex'),
      conversationId: randomUUID(),
      documentMap: knowledgeSync?.documentMap(),
    });
    noteConnection(review.mode, review.fallbackReason);
    res.json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        if (item.updatedAt !== before.updatedAt || item.status !== before.status)
          fail(409, 'The case changed during the review. Review the latest version.');
        editable(item, res);
        item.review = review;
        item.status = 'Draft';
        updated(item);
        activity(
          workspace,
          res,
          'review',
          'Advisor review completed',
          `${item.reference} · ${review.suggestions.length} suggestions · ${review.mode === 'live' ? 'AI-assisted' : 'local checks and retrieval'}`,
          item.id,
        );
        return item;
      }),
    );
  });
  app.post('/api/cases/:id/submit', (req, res) =>
    res.json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        editable(item, res);
        if (!item.review)
          fail(409, 'Run the advisor review before submitting to senior management.');
        if (item.status === 'In review') fail(409, 'This case is already awaiting senior review.');
        item.status = 'In review';
        updated(item);
        activity(
          workspace,
          res,
          'review',
          'Case submitted for senior review',
          `${item.reference} is now in the internal approval queue.`,
          item.id,
        );
        return item;
      }),
    ),
  );
  /** Record a reviewer's reasoning as a candidate; it becomes usable only after a second person approves it. */
  const candidate = (
    workspace: Workspace,
    res: Response,
    item: CaseRecord,
    input: {
      title: string;
      lead: string;
      body: string;
      comment: string;
      decision: 'accepted' | 'rejected';
      missed?: boolean;
      rule?: Rule;
      skillId?: string;
    },
  ) => {
    const skill =
      workspace.skills.find((entry) => entry.id === input.skillId) ??
      workspace.skills.find(
        (entry) => entry.category === item.category && entry.status === 'Active',
      ) ??
      workspace.skills.find((entry) => entry.category === item.category) ??
      workspace.skills[0];
    const knowledge: Knowledge = {
      id: randomUUID(),
      title: input.title,
      content: [
        input.lead,
        input.body,
        ruleLines(input.rule),
        `Reviewer rationale: ${input.comment || 'Accepted by senior reviewer without additional comment.'}`,
        `Case context: ${item.title}; ${item.category}; ${item.documentType}. Internal precedent only; verify applicability to each new shipment.`,
      ]
        .filter(Boolean)
        .join('\n'),
      category: item.category,
      jurisdiction: 'Singapore',
      skillId: skill.id,
      sourceType: 'Decision',
      sourceName: `${user(res).name} · ${item.reference}`,
      status: 'Pending',
      createdAt: now().toISOString(),
      author: user(res).name,
      authorId: user(res).id,
      version: 1,
      tags: [
        input.decision,
        item.category,
        'Senior review',
        ...(input.missed ? ['Missed by advisor'] : []),
      ],
      decision: input.decision,
      caseId: item.id,
      ...(input.missed ? { missedByAdvisor: true } : {}),
      ...(input.rule ? { rule: input.rule } : {}),
    };
    workspace.knowledge.unshift(knowledge);
    return { knowledge, skill };
  };
  /** The other accountable person, who must approve what this user just recorded. */
  const awaiting = (workspace: Workspace, skill: Skill, res: Response) =>
    userName(
      workspace,
      [skill.owner, skill.approver].find((id) => id !== user(res).id) ?? skill.approver,
    );
  app.post('/api/cases/:id/suggestions/:suggestionId', (req, res) => {
    manager(res);
    const decision = req.body?.decision;
    if (!['accepted', 'rejected'].includes(decision)) fail(400, 'Choose accepted or rejected.');
    const comment = string(req.body?.comment, 'Review comment', 4000, decision === 'rejected');
    const rule = ruleInput(req.body?.rule);
    res.json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        if (item.status !== 'In review' || !item.review)
          fail(409, 'Suggestions can be dispositioned only while the case is in senior review.');
        const review = item.review ?? fail(409, 'Run the advisor review first.');
        const suggestion =
          review.suggestions.find((entry) => entry.id === req.params.suggestionId) ??
          fail(404, 'Suggestion not found.');
        if (suggestion.decision !== 'pending')
          fail(
            409,
            'This suggestion already has a recorded decision. Request changes and rerun the review to reconsider it.',
          );
        suggestion.decision = decision;
        suggestion.comment = comment;
        suggestion.decidedBy = user(res).name;
        if (rule) suggestion.rule = rule;
        updated(item);
        const { skill } = candidate(workspace, res, item, {
          title: `${decision === 'accepted' ? 'Accepted' : 'Rejected'}: ${suggestion.title}`,
          lead: `${decision === 'accepted' ? 'Accepted advice' : 'Rejected suggestion — do not treat this as an approved requirement'}: ${suggestion.title}`,
          body: `Original observation: ${suggestion.detail}\nOriginal proposed action: ${suggestion.action}`,
          comment,
          decision,
          rule,
          skillId: review.skillIds.find((id) =>
            suggestion.citations.some(
              (ref) => workspace.knowledge.find((entry) => entry.id === ref.id)?.skillId === id,
            ),
          ),
        });
        activity(
          workspace,
          res,
          'decision',
          `Suggestion ${decision} · candidate knowledge recorded`,
          `${suggestion.title}${comment ? ` — ${comment}` : ''} Awaiting approval by ${awaiting(workspace, skill, res)} before agents use it.`,
          item.id,
        );
        return item;
      }),
    );
  });
  app.post('/api/cases/:id/findings', (req, res) => {
    manager(res);
    const title = string(req.body?.title, 'What the advisor missed', 200, true);
    const action = string(req.body?.action, 'What should be checked', 1500, true);
    const comment = string(req.body?.comment, 'Why it matters', 4000, true);
    const detail = string(req.body?.detail, 'Detail', 2000);
    const severity = ['info', 'warning', 'critical'].includes(req.body?.severity)
      ? (req.body.severity as Suggestion['severity'])
      : 'warning';
    const rule = ruleInput(req.body?.rule);
    res.status(201).json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        if (item.status !== 'In review' || !item.review)
          fail(409, 'Findings can be added only while the case is in senior review.');
        const suggestion: Suggestion = {
          id: randomUUID(),
          severity,
          title,
          detail: detail || comment,
          action,
          citations: [],
          decision: 'accepted',
          comment,
          decidedBy: user(res).name,
          origin: 'manager',
          ...(rule ? { rule } : {}),
        };
        item.review!.suggestions.push(suggestion);
        updated(item);
        const { skill } = candidate(workspace, res, item, {
          title: `Missed by advisor: ${title}`,
          lead: `Finding the advisor did not raise: ${title}`,
          body: `What to check: ${action}${detail ? `\nDetail: ${detail}` : ''}`,
          comment,
          decision: 'accepted',
          missed: true,
          rule,
        });
        activity(
          workspace,
          res,
          'decision',
          'Reviewer added a finding the advisor missed',
          `${title} — ${comment} Awaiting approval by ${awaiting(workspace, skill, res)} before agents use it.`,
          item.id,
        );
        return item;
      }),
    );
  });
  app.post('/api/cases/:id/draft-rule', async (req, res) => {
    manager(res);
    const decision = ['accepted', 'rejected', 'missed'].includes(req.body?.decision)
      ? (req.body.decision as 'accepted' | 'rejected' | 'missed')
      : fail(400, 'Choose accepted, rejected or missed.');
    const note = string(req.body?.note, 'Reviewer note', 4000, true);
    const snapshot = store.read();
    const item = record(snapshot, req.params.id);
    if (item.status !== 'In review' || !item.review)
      fail(409, 'Rules can be drafted only while the case is in senior review.');
    const finding = req.body?.suggestionId
      ? (item.review!.suggestions.find((entry) => entry.id === req.body.suggestionId) ??
        fail(404, 'Suggestion not found.'))
      : undefined;
    const started = Date.now();
    const draft = await draftRule(snapshot, item, finding, note, decision, ai, {
      visitorId: createHash('sha256').update(user(res).id).digest('hex'),
      conversationId: randomUUID(),
    });
    if (provider !== 'local' && liveConfigured(ai))
      noteConnection(draft.mode, draft.fallbackReason, Date.now() - started);
    res.json(draft);
  });
  app.post('/api/cases/:id/decision', (req, res) => {
    manager(res);
    const decision = req.body?.decision;
    if (!['approved', 'changes_requested'].includes(decision))
      fail(400, 'Choose approved or changes_requested.');
    const comment = string(
      req.body?.comment,
      'Decision comment',
      4000,
      decision === 'changes_requested',
    );
    res.json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        if (item.ownerId === user(res).id)
          fail(403, 'A second person must approve or return your own case.');
        if (item.status !== 'In review' || !item.review)
          fail(409, 'The case must be in senior review before a decision.');
        const review = item.review ?? fail(409, 'Run the advisor review first.');
        if (
          decision === 'approved' &&
          review.suggestions.some((suggestion) => suggestion.decision === 'pending')
        )
          fail(409, 'Accept or reject every advisor suggestion before approving.');
        item.status = decision === 'approved' ? 'Approved' : 'Changes requested';
        updated(item);
        if (comment)
          workspace.comments.push({
            id: randomUUID(),
            caseId: item.id,
            author: user(res).name,
            content: comment,
            createdAt: now().toISOString(),
          });
        activity(
          workspace,
          res,
          'approval',
          decision === 'approved' ? 'Case approved internally' : 'Changes requested',
          `${item.reference}${comment ? ` — ${comment}` : ''}. No external declaration or message was sent.`,
          item.id,
        );
        return item;
      }),
    );
  });
  app.post('/api/cases/:id/comments', (req, res) => {
    const content = string(req.body?.content, 'Comment', 4000, true);
    res.status(201).json(
      store.mutate((workspace) => {
        const item = record(workspace, req.params.id);
        const anchor = commentAnchor(req.body?.anchor, item);
        const comment = {
          id: randomUUID(),
          caseId: item.id,
          author: user(res).name,
          content,
          createdAt: now().toISOString(),
          ...(anchor ? { anchor } : {}),
        };
        workspace.comments.push(comment);
        activity(workspace, res, 'comment', 'Comment added', content, item.id);
        return comment;
      }),
    );
  });
  app.post('/api/knowledge/import', upload.single('file'), async (req, res) => {
    const skillId = string(req.body?.skillId, 'Skill', 100, true);
    const skill =
      store.read().skills.find((entry) => entry.id === skillId) ??
      fail(400, 'Choose an existing skill for this document.');
    const title = string(req.body?.title || req.file?.originalname, 'Document title', 200, true);
    const pasted = string(req.body?.content, 'Pasted content', 120_000);
    const extracted = req.file ? await extractFile(req.file) : '';
    if (req.file && extracted.replace(/\s/g, '').length < 12)
      fail(
        400,
        'No readable text was found in this file. Scanned PDFs need OCR before upload; OCR is not available in this workspace.',
      );
    const content = [pasted, extracted].filter(Boolean).join('\n\n').trim();
    if (content.replace(/\s/g, '').length < 12)
      fail(400, 'Provide at least 12 readable characters of document content.');
    if (content.length > 120_000)
      fail(
        400,
        'Extracted text exceeds 120,000 characters. Split the document into smaller sections.',
      );
    const knowledge: Knowledge = {
      id: randomUUID(),
      title,
      content,
      category: skill.category,
      jurisdiction: 'Singapore',
      skillId,
      sourceType: 'Document',
      sourceName: req.file
        ? basename(req.file.originalname).slice(0, 200)
        : 'Pasted internal document',
      status: 'Pending',
      createdAt: now().toISOString(),
      author: user(res).name,
      authorId: user(res).id,
      version: 1,
      tags: ['Imported document', skill.category],
    };
    if (req.file && originals) {
      try {
        knowledge.original = await originals.put(
          knowledge.id,
          extname(req.file.originalname).toLowerCase(),
          req.file.buffer,
        );
      } catch {
        fail(503, 'Original document storage is unavailable. Check COS access and retry.');
      }
    }
    store.mutate((workspace) => {
      workspace.knowledge.unshift(knowledge);
      activity(
        workspace,
        res,
        'import',
        'Document imported for review',
        `${title} was mapped to ${skill.name}. A second person (the pill owner or approver) must approve it before retrieval.`,
      );
    });
    res.status(201).json(knowledge);
  });
  /** Every change to a pill's approved knowledge or definition is a numbered release. */
  const release = (
    workspace: Workspace,
    skill: Skill,
    res: Response,
    change: string,
    approvedBy?: string,
  ) => {
    const result = recordRelease(workspace, skill, now(), user(res).name, change, approvedBy);
    knowledgeSync?.enqueue(workspace);
    return result;
  };
  app.post('/api/knowledge/:id/publish', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        governor(workspace, skill, res);
        if (item.status === 'Approved') fail(409, 'This knowledge entry is already approved.');
        if (item.status === 'Retired')
          fail(
            409,
            'Declined or retired knowledge cannot be approved. Restore it or record it again.',
          );
        if (isAuthor(item, res))
          fail(403, 'A second person must approve what you recorded or imported.');
        item.status = 'Approved';
        item.version ??= 1;
        item.approvedBy = user(res).name;
        item.approvedAt = now().toISOString();
        const released = release(workspace, skill, res, `Approved: ${item.title}`, user(res).name);
        activity(
          workspace,
          res,
          'approval',
          'Knowledge published',
          `${item.title} is now available to the ${skill.name} pill (release v${released.version}).`,
        );
        return item;
      }),
    );
  });
  app.post('/api/knowledge/:id/decline', (req, res) => {
    const reason = string(req.body?.reason, 'Reason', 1000, true);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        if (!isAuthor(item, res)) {
          manager(res);
          governor(workspace, skill, res);
        }
        if (item.status !== 'Pending')
          fail(409, 'Only knowledge awaiting approval can be declined.');
        item.status = 'Retired';
        item.retiredBy = user(res).name;
        item.retiredAt = now().toISOString();
        item.retiredReason = reason;
        activity(
          workspace,
          res,
          'approval',
          'Candidate knowledge declined',
          `${item.title} — ${reason}`,
        );
        return item;
      }),
    );
  });
  app.put('/api/knowledge/:id', (req, res) => {
    const title = string(req.body?.title, 'Title', 200, true);
    const content = string(req.body?.content, 'Content', 120_000, true);
    const note = string(req.body?.note, 'Reason for the change', 1000);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        if (item.status === 'Retired')
          fail(409, 'Retired knowledge cannot be edited. Restore it first.');
        if (item.status === 'Pending') {
          if (!isAuthor(item, res)) {
            manager(res);
            governor(workspace, skill, res);
          }
          item.title = title;
          item.content = content;
          activity(
            workspace,
            res,
            'import',
            'Candidate knowledge edited',
            `${title} was reworded before approval.`,
          );
          return item;
        }
        manager(res);
        governor(workspace, skill, res);
        if (title === item.title && content === item.content) fail(400, 'No changes to propose.');
        if (!note) fail(400, 'Explain why this changes approved knowledge.');
        item.revision = {
          title,
          content,
          note,
          proposedBy: user(res).name,
          proposedById: user(res).id,
          proposedAt: now().toISOString(),
        };
        activity(
          workspace,
          res,
          'import',
          'Revision proposed',
          `${item.title} (v${item.version ?? 1}) — ${note} The current version stays live until a second person approves.`,
        );
        return item;
      }),
    );
  });
  app.post('/api/knowledge/:id/revision/approve', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        governor(workspace, skill, res);
        const revision = item.revision ?? fail(409, 'There is no proposed revision to approve.');
        if (revision.proposedById === user(res).id)
          fail(403, 'A second person must approve a revision you proposed.');
        item.history = [
          {
            version: item.version ?? 1,
            title: item.title,
            content: item.content,
            tags: item.tags,
            changedBy: item.approvedBy ?? item.author,
            changedAt: item.approvedAt ?? item.createdAt,
            ...(item.approvedBy ? { approvedBy: item.approvedBy } : {}),
            note: item.versionNote ?? 'Initial version',
          },
          ...(item.history ?? []),
        ];
        item.title = revision.title;
        item.content = revision.content;
        item.version = nextKnowledgeVersion(item);
        item.versionNote = revision.note;
        item.approvedBy = user(res).name;
        item.approvedAt = now().toISOString();
        delete item.revision;
        const released = release(
          workspace,
          skill,
          res,
          `Revised: ${item.title} (v${item.version})`,
          user(res).name,
        );
        activity(
          workspace,
          res,
          'approval',
          'Knowledge revision approved',
          `${item.title} is now version ${item.version} in release v${released.version}. ${revision.note}`,
        );
        return item;
      }),
    );
  });
  app.delete('/api/knowledge/:id/revision', (req, res) => {
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        const revision = item.revision ?? fail(409, 'There is no proposed revision.');
        if (revision.proposedById !== user(res).id) {
          manager(res);
          governor(workspace, skill, res);
        }
        delete item.revision;
        activity(
          workspace,
          res,
          'import',
          'Revision discarded',
          `${item.title} stays at version ${item.version ?? 1}.`,
        );
        return item;
      }),
    );
  });
  app.post('/api/knowledge/:id/retire', (req, res) => {
    manager(res);
    const reason = string(req.body?.reason, 'Reason', 1000, true);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        governor(workspace, skill, res);
        if (item.status !== 'Approved') fail(409, 'Only approved knowledge can be retired.');
        item.status = 'Retired';
        item.retiredBy = user(res).name;
        item.retiredAt = now().toISOString();
        item.retiredReason = reason;
        delete item.revision;
        const released = release(workspace, skill, res, `Retired: ${item.title}`, user(res).name);
        activity(
          workspace,
          res,
          'approval',
          'Knowledge retired',
          `${item.title} is no longer used (release v${released.version}). ${reason}`,
        );
        return item;
      }),
    );
  });
  app.post('/api/knowledge/:id/restore', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const item = entryOf(workspace, req.params.id);
        const skill = pillOf(workspace, item.skillId);
        governor(workspace, skill, res);
        if (item.status !== 'Retired' || !item.approvedAt)
          fail(409, 'Only knowledge that was once approved can be restored.');
        item.status = 'Approved';
        item.approvedBy = user(res).name;
        item.approvedAt = now().toISOString();
        delete item.retiredBy;
        delete item.retiredAt;
        delete item.retiredReason;
        const released = release(workspace, skill, res, `Restored: ${item.title}`, user(res).name);
        activity(
          workspace,
          res,
          'approval',
          'Knowledge restored',
          `${item.title} is in use again (release v${released.version}).`,
        );
        return item;
      }),
    );
  });
  app.post('/api/skills', (req, res) => {
    const name = string(req.body?.name, 'Skill name', 100, true);
    const description = string(req.body?.description, 'Skill description', 2000, true);
    if (!categories.includes(req.body?.category)) fail(400, 'Choose a supported category.');
    res.status(201).json(
      store.mutate((workspace) => {
        if (workspace.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase()))
          fail(409, 'A skill with this name already exists.');
        const managers = workspace.users.filter((entry) => entry.role === 'manager');
        const owner =
          user(res).role === 'manager' ? user(res).id : (managers[0]?.id ?? user(res).id);
        const approver = managers.find((entry) => entry.id !== owner)?.id ?? owner;
        const skill: Skill = {
          id: randomUUID(),
          name,
          category: req.body.category as Category,
          jurisdiction: 'Singapore',
          description,
          tags: [req.body.category as string],
          status: 'Draft',
          updatedAt: now().toISOString(),
          owner,
          approver,
          version: 0,
          releases: [],
          inScope: [],
          outOfScope: [],
          guardrails: ['Recommend only; a senior reviewer decides'],
          escalations: [standardEscalation()],
        };
        workspace.skills.push(skill);
        activity(
          workspace,
          res,
          'skill',
          'Intelligence pill created',
          `${name} is a draft until ${userName(workspace, approver)} or ${userName(workspace, owner)} approves its first knowledge entry.`,
        );
        return skill;
      }),
    );
  });
  app.put('/api/skills/:id', (req, res) => {
    manager(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      store.mutate((workspace) => {
        const skill = pillOf(workspace, req.params.id);
        governor(workspace, skill, res);
        const managerIds = workspace.users
          .filter((entry) => entry.role === 'manager')
          .map((entry) => entry.id);
        const owner =
          body.owner === undefined ? skill.owner : string(body.owner, 'Owner', 100, true);
        const approver =
          body.approver === undefined
            ? skill.approver
            : string(body.approver, 'Approver', 100, true);
        if (!managerIds.includes(owner) || !managerIds.includes(approver))
          fail(400, 'The owner and approver must be senior reviewers.');
        if (owner === approver && managerIds.length > 1)
          fail(400, 'The owner and approver must be different people.');
        const next: PillDefinition = {
          description:
            body.description === undefined
              ? skill.description
              : string(body.description, 'Description', 2000, true),
          owner,
          approver,
          inScope:
            body.inScope === undefined ? skill.inScope : textList(body.inScope, 'In-scope list'),
          outOfScope:
            body.outOfScope === undefined ? skill.outOfScope : boundaries(body.outOfScope),
          guardrails:
            body.guardrails === undefined
              ? skill.guardrails
              : textList(body.guardrails, 'Guardrails'),
          escalations:
            body.escalations === undefined ? skill.escalations : escalations(body.escalations),
        };
        if (JSON.stringify(next) === JSON.stringify(definitionOf(skill)))
          fail(400, 'No changes to propose.');
        const note = string(body.note, 'Reason for the change', 1000, skill.version > 0);
        if (skill.version === 0) {
          // Nothing is live yet, so there is nothing to protect with a second approval.
          Object.assign(skill, next);
          skill.updatedAt = now().toISOString();
          activity(workspace, res, 'skill', 'Pill definition edited', `${skill.name} (draft).`);
          return skill;
        }
        skill.pending = {
          proposedBy: user(res).name,
          proposedById: user(res).id,
          proposedAt: now().toISOString(),
          note,
          definition: next,
        };
        activity(
          workspace,
          res,
          'skill',
          'Pill change proposed',
          `${skill.name} v${skill.version} — ${note} Awaiting release by ${userName(workspace, [skill.owner, skill.approver].find((id) => id !== user(res).id) ?? skill.approver)}.`,
        );
        return skill;
      }),
    );
  });
  app.post('/api/skills/:id/release', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const skill = pillOf(workspace, req.params.id);
        governor(workspace, skill, res);
        const pending = skill.pending ?? fail(409, 'There is no proposed change to release.');
        if (pending.proposedById === user(res).id)
          fail(403, 'A different person must release a change you proposed.');
        Object.assign(skill, definitionOf(pending.definition));
        delete skill.pending;
        const released = recordRelease(
          workspace,
          skill,
          now(),
          pending.proposedBy,
          pending.note || 'Definition updated',
          user(res).name,
        );
        knowledgeSync?.enqueue(workspace);
        activity(
          workspace,
          res,
          'approval',
          'Pill released',
          `${skill.name} is now v${released.version}. ${pending.note}`,
        );
        return skill;
      }),
    );
  });
  app.delete('/api/skills/:id/pending', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const skill = pillOf(workspace, req.params.id);
        governor(workspace, skill, res);
        if (!skill.pending) fail(409, 'There is no proposed change.');
        delete skill.pending;
        activity(
          workspace,
          res,
          'skill',
          'Pill change discarded',
          `${skill.name} stays at v${skill.version}.`,
        );
        return skill;
      }),
    );
  });
  app.post('/api/skills/:id/rollback', (req, res) => {
    manager(res);
    const version = Number(req.body?.version);
    res.json(
      store.mutate((workspace) => {
        const skill = pillOf(workspace, req.params.id);
        governor(workspace, skill, res);
        const target =
          skill.releases.find((entry) => entry.version === version) ??
          fail(404, 'That release does not exist.');
        if (target.version === skill.version)
          fail(409, 'That release is already the current version.');
        const released = rollbackPill(workspace, skill, target, now(), user(res).name);
        knowledgeSync?.enqueue(workspace);
        activity(
          workspace,
          res,
          'approval',
          'Pill rolled back',
          `${skill.name} now matches v${target.version}, released as v${released.version}.`,
        );
        return skill;
      }),
    );
  });
  app.post('/api/chat', async (req, res) => {
    const message = string(req.body?.message, 'Message', 6000, true);
    const category = req.body?.category as Category | undefined;
    if (category && !categories.includes(category)) fail(400, 'Choose a supported category.');
    const skillId = string(req.body?.skillId, 'Skill', 100) || undefined;
    const snapshot = store.read();
    if (skillId && !snapshot.skills.some((skill) => skill.id === skillId))
      fail(400, 'Unknown agent skill.');
    const scope = JSON.stringify([user(res).id, skillId ?? '', category ?? '']);
    if (activeConversations.has(scope)) fail(409, 'An answer is already in progress.');
    const conversationId = store.mutate((workspace) => {
      workspace.agentConversations ??= {};
      return (workspace.agentConversations[scope] ??= randomUUID());
    });
    activeConversations.add(scope);
    let answer: Awaited<ReturnType<typeof answerQuestion>>;
    try {
      answer = await answerQuestion(snapshot, message, category, skillId, ai, {
        visitorId: createHash('sha256').update(user(res).id).digest('hex'),
        conversationId,
        documentMap: knowledgeSync?.documentMap(),
      });
    } finally {
      activeConversations.delete(scope);
    }
    if (liveConfigured(ai) && (answer.mode === 'live' || provider === 'adp'))
      noteConnection(answer.mode, answer.fallbackReason);
    const messages: ChatMessage[] = [
      {
        id: randomUUID(),
        role: 'user',
        content: message,
        citations: [],
        skillNames: [],
        createdAt: now().toISOString(),
      },
      { id: randomUUID(), role: 'assistant', ...answer, createdAt: now().toISOString() },
    ];
    store.mutate((workspace) => {
      workspace.chats.push(...messages);
      workspace.chatOwners ??= {};
      for (const message of messages) workspace.chatOwners[message.id] = user(res).id;
    });
    res.json(messages);
  });
  app.post('/api/integrations/check', async (_req, res) => {
    manager(res);
    if (!liveConfigured(ai)) fail(409, 'Configure an AI provider on the server first.');
    // First ask whether this host can reach the provider at all. It costs no allowance, and it
    // tells a broken network path apart from a rejected key or an unusable answer.
    const target = aiEndpoint();
    const network = target ? await probeEndpoint(target).catch(() => undefined) : undefined;
    if (network && !network.ok) {
      noteConnection('local', network.reason);
      res.status(502).json({
        ...connection,
        error: `The provider could not be reached. Reason: ${network.reason}`,
      });
      return;
    }
    const started = Date.now();
    const answer = await answerQuestion(
      store.read(),
      'What should I check about permit validity before a Singapore shipment? Cite an approved source.',
      'General cargo',
      undefined,
      ai,
      {
        visitorId: createHash('sha256').update(user(res).id).digest('hex'),
        conversationId: randomUUID(),
        documentMap: knowledgeSync?.documentMap(),
      },
    );
    noteConnection(answer.mode, answer.fallbackReason, Date.now() - started);
    res.status(answer.mode === 'live' ? 200 : 502).json({
      ...connection,
      ...(answer.mode === 'live'
        ? {}
        : {
            error: `The provider did not return a usable, grounded answer.${answer.fallbackReason ? ` Reason: ${answer.fallbackReason}` : ''} Check its published application and credentials.`,
          }),
    });
  });
  app.get('/api/integrations/knowledge', (_req, res) => {
    manager(res);
    res.json({
      ...(knowledgeSync?.summary() ?? { configured: false }),
      jobs: Object.values(store.read().knowledgeSync ?? {}).filter(
        (job) => job.target === knowledgeSync?.target,
      ),
    });
  });
  app.post('/api/integrations/knowledge/retry', (_req, res) => {
    manager(res);
    if (!knowledgeSync) fail(409, 'Knowledge synchronization is not configured.');
    knowledgeSync!.retry();
    res.json(knowledgeSync!.summary());
  });
  app.get('/api/export', (_req, res) => {
    manager(res);
    res.attachment(`instill-workspace-${now().toISOString().slice(0, 10)}.json`);
    res.json({
      schemaVersion: 1,
      exportedAt: now().toISOString(),
      jurisdiction: 'Singapore',
      workspace: store.read(),
    });
  });
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API endpoint not found.')));
  const staticDir = options.staticDir ?? resolve('dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Files must be 10 MB or smaller.'
            : 'The upload exceeds the allowed file or field limits.',
      });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
      res.status(413).json({ error: 'The request is too large.' });
      return;
    }
    console.error('Instill request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'The request could not be completed. Please try again.' });
  });
  return {
    app,
    store,
    knowledgeSync,
    provider,
    aiEndpoint,
    close: () => {
      knowledgeSync?.stop();
      store.close();
    },
  };
}
