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
  User,
} from '../shared/types.ts';
import { Store, type Workspace } from './store.ts';
import { answerQuestion, liveConfigured, reviewCase, type AIConfig } from './advisor.ts';
import { KnowledgeSync, type KnowledgeClient } from './knowledge-sync.ts';
import { TencentKnowledgeClient } from './tencent-knowledge.ts';
import { OriginalStorage } from './object-storage.ts';

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
  if (process.env.NODE_ENV === 'production' && demoMode)
    throw new Error('Production requires DEMO_MODE=false and an access password.');
  if (!demoMode && (!accessPassword || accessPassword.length < 12))
    throw new Error('Non-demo mode requires an APP_ACCESS_PASSWORD of at least 12 characters.');
  const ai = options.ai ?? {
    provider: (process.env.AI_PROVIDER?.trim() || undefined) as AIConfig['provider'],
    baseUrl: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    adpAppKey: process.env.ADP_APP_KEY,
    adpEndpoint: process.env.ADP_ENDPOINT,
  };
  if (ai.provider !== undefined && !['local', 'openai', 'adp'].includes(ai.provider))
    throw new Error('AI_PROVIDER must be local, openai or adp.');
  if (ai.provider === 'adp' && !ai.adpAppKey?.trim())
    throw new Error('AI_PROVIDER=adp requires ADP_APP_KEY.');
  if (ai.provider === 'openai' && !(ai.baseUrl && ai.apiKey && ai.model))
    throw new Error('AI_PROVIDER=openai requires AI_BASE_URL, AI_API_KEY and AI_MODEL.');
  const provider = ai.provider ?? (ai.adpAppKey ? 'adp' : liveConfigured(ai) ? 'openai' : 'local');
  const connection: IntegrationState = {
    provider,
    connection: provider === 'local' ? 'local' : 'configured',
  };
  const noteConnection = (mode: 'local' | 'live') => {
    if (provider === 'local') return;
    connection.connection = mode === 'live' ? 'verified' : 'error';
    connection.checkedAt = now().toISOString();
  };
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
      integrations: { ...connection, knowledge: knowledgeSync?.summary() },
    };
    res.json(state);
  });
  app.post('/api/session', (req, res) => {
    if (!demoMode) fail(403, 'Role switching is available only in local demo mode.');
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
    noteConnection(review.mode);
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
  app.post('/api/cases/:id/suggestions/:suggestionId', (req, res) => {
    manager(res);
    const decision = req.body?.decision;
    if (!['accepted', 'rejected'].includes(decision)) fail(400, 'Choose accepted or rejected.');
    const comment = string(req.body?.comment, 'Review comment', 4000, decision === 'rejected');
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
        updated(item);
        const skill = workspace.skills.find((entry) => entry.category === item.category)!;
        const knowledge: Knowledge = {
          id: randomUUID(),
          title: `${decision === 'accepted' ? 'Accepted' : 'Rejected'}: ${suggestion.title}`,
          content: `${decision === 'accepted' ? 'Accepted advice' : 'Rejected suggestion — do not treat this as an approved requirement'}: ${suggestion.title}\nOriginal observation: ${suggestion.detail}\nOriginal proposed action: ${suggestion.action}\nReviewer rationale: ${comment || 'Accepted by senior reviewer without additional comment.'}\nCase context: ${item.title}; ${item.category}; ${item.documentType}. Internal precedent only; verify applicability to each new shipment.`,
          category: item.category,
          jurisdiction: 'Singapore',
          skillId: skill.id,
          sourceType: 'Decision',
          sourceName: `${user(res).name} · ${item.reference}`,
          status: 'Approved',
          createdAt: now().toISOString(),
          author: user(res).name,
          tags: [decision, item.category, 'Senior review'],
          decision,
          caseId: item.id,
        };
        workspace.knowledge.unshift(knowledge);
        knowledgeSync?.enqueue(workspace);
        skill.status = 'Active';
        skill.updatedAt = now().toISOString();
        activity(
          workspace,
          res,
          'decision',
          `Suggestion ${decision} · knowledge captured`,
          `${suggestion.title}${comment ? ` — ${comment}` : ''}`,
          item.id,
        );
        return item;
      }),
    );
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
        `${title} was mapped to ${skill.name}. Manager publication is required before retrieval.`,
      );
    });
    res.status(201).json(knowledge);
  });
  app.post('/api/knowledge/:id/publish', (req, res) => {
    manager(res);
    res.json(
      store.mutate((workspace) => {
        const item =
          workspace.knowledge.find((entry) => entry.id === req.params.id) ??
          fail(404, 'Knowledge entry not found.');
        if (item.status === 'Approved') fail(409, 'This knowledge entry is already approved.');
        item.status = 'Approved';
        knowledgeSync?.enqueue(workspace);
        const skill = workspace.skills.find((entry) => entry.id === item.skillId)!;
        skill.status = 'Active';
        skill.updatedAt = now().toISOString();
        activity(
          workspace,
          res,
          'approval',
          'Knowledge published',
          `${item.title} is now available to the ${skill.name} skill.`,
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
        const skill = {
          id: randomUUID(),
          name,
          category: req.body.category as Category,
          jurisdiction: 'Singapore' as const,
          description,
          tags: [req.body.category as string],
          status: 'Draft' as const,
          updatedAt: now().toISOString(),
        };
        workspace.skills.push(skill);
        activity(
          workspace,
          res,
          'skill',
          'Agent skill created',
          `${name} is a draft until a manager publishes its first knowledge entry.`,
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
      noteConnection(answer.mode);
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
    noteConnection(answer.mode);
    res.status(answer.mode === 'live' ? 200 : 502).json({
      ...connection,
      ...(answer.mode === 'live'
        ? {}
        : {
            error:
              'The provider did not return a usable, grounded answer. Check its published application and credentials.',
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
    close: () => {
      knowledgeSync?.stop();
      store.close();
    },
  };
}
