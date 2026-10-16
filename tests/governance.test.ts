import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, type AppOptions } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { seedWorkspace } from '../server/seed.ts';
import type {
  AppState,
  CaseInput,
  CaseRecord,
  ChatMessage,
  IntegrationState,
  Skill,
} from '../shared/types.ts';

const NOW = new Date('2026-10-14T03:00:00Z');

async function start(options: AppOptions = {}) {
  const service = createApp({ dbPath: ':memory:', demoMode: true, now: () => NOW, ...options });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  const call = async <T>(path: string, method = 'GET', body?: unknown, expected = 200) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
    return value as T;
  };
  return {
    ...service,
    call,
    state: () => call<AppState>('/state'),
    as: async (userId: string) => {
      await call('/state');
      await call('/session', 'POST', { userId });
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      service.close();
    },
  };
}

const wireless: CaseInput = {
  title: 'Wireless sensor import',
  customer: 'Demo importer',
  category: 'Electronics',
  jurisdiction: 'Singapore',
  documentType: 'Customs declaration',
  content:
    'Import 50 wireless sensors with Bluetooth transmitters. Invoice and packing list attached.',
  permitNumber: 'DEMO-PERMIT',
  permitExpiry: '2026-10-13',
  shipmentDate: '2026-10-16',
  warehouseConfirmed: false,
};

test('built-in pills have an owner, a different approver, a scope and a numbered release', async () => {
  const app = await start();
  try {
    const { skills } = await app.state();
    assert.equal(skills.length, 4);
    for (const skill of skills) {
      assert.equal(skill.owner, 'manager-sarah');
      assert.equal(skill.approver, 'manager-daniel');
      assert.equal(skill.version, 1);
      assert.equal(skill.releases.length, 1);
      assert.ok(skill.inScope.length > 0 && skill.guardrails.length > 0);
      assert.ok(skill.escalations.some((entry) => entry.onCritical));
      assert.deepEqual(skill.releases[0].definition.guardrails, skill.guardrails);
      assert.ok(skill.releases[0].knowledge.length > 0);
    }
  } finally {
    await app.close();
  }
});

test('a pill change needs a second person, becomes a release, and can be rolled back', async () => {
  const app = await start();
  try {
    const original = (await app.state()).skills.find((skill) => skill.id === 'electronics')!;
    const guardrails = [...original.guardrails, 'Ask for the radio test report'];
    await app.as('employee-amir');
    await app.call('/skills/electronics', 'PUT', { guardrails, note: 'Add report check' }, 403);
    await app.as('manager-sarah');
    await app.call('/skills/electronics', 'PUT', { guardrails }, 400); // a reason is required
    await app.call('/skills/electronics', 'PUT', { description: original.description }, 400);
    await app.call('/skills/electronics', 'PUT', { guardrails, note: 'Add report check' });
    let pill = (await app.state()).skills.find((skill) => skill.id === 'electronics')!;
    assert.equal(pill.version, 1, 'A proposal changes nothing until it is released.');
    assert.deepEqual(pill.guardrails, original.guardrails);
    assert.equal(pill.pending?.proposedBy, 'Sarah Tan');
    await app.call('/skills/electronics/release', 'POST', {}, 403);
    await app.as('manager-daniel');
    await app.call('/skills/electronics/release', 'POST', {});
    pill = (await app.state()).skills.find((skill) => skill.id === 'electronics')!;
    assert.equal(pill.version, 2);
    assert.deepEqual(pill.guardrails, guardrails);
    assert.equal(pill.pending, undefined);
    assert.equal(pill.releases[0].approvedBy, 'Daniel Wong');
    assert.equal(pill.releases[0].change, 'Add report check');
    await app.call('/skills/electronics/rollback', 'POST', { version: 2 }, 409);
    await app.call('/skills/electronics/rollback', 'POST', { version: 9 }, 404);
    await app.as('employee-chloe');
    await app.call('/skills/electronics/rollback', 'POST', { version: 1 }, 403);
    await app.as('manager-sarah');
    await app.call('/skills/electronics/rollback', 'POST', { version: 1 });
    pill = (await app.state()).skills.find((skill) => skill.id === 'electronics')!;
    assert.equal(pill.version, 3);
    assert.deepEqual(pill.guardrails, original.guardrails);
    assert.equal(pill.releases[0].change, 'Rolled back to v1');
    assert.equal(pill.releases.length, 3, 'History is kept; a rollback is a new release.');
    // An owner and approver must be two different senior reviewers.
    await app.call('/skills/electronics', 'PUT', { approver: 'manager-sarah', note: 'x' }, 400);
    await app.call('/skills/electronics', 'PUT', { approver: 'employee-amir', note: 'x' }, 400);
  } finally {
    await app.close();
  }
});

test('approved knowledge is edited as a proposed revision, versioned, retired, restored and rolled back', async () => {
  const app = await start();
  try {
    const find = async (id: string) =>
      (await app.state()).knowledge.find((item) => item.id === id)!;
    const before = await find('kb-imda');
    assert.equal(before.version, 1);
    await app.as('manager-sarah');
    const edit = { title: before.title, content: `${before.content} Ask for the test report.` };
    await app.call('/knowledge/kb-imda', 'PUT', { ...edit, note: '' }, 400);
    await app.call('/knowledge/kb-imda', 'PUT', { ...edit, note: 'Add the report check' });
    let entry = await find('kb-imda');
    assert.equal(
      entry.content,
      before.content,
      'The approved version stays live while a revision waits.',
    );
    assert.equal(entry.revision?.proposedBy, 'Sarah Tan');
    await app.call('/knowledge/kb-imda/revision/approve', 'POST', {}, 403);
    await app.as('manager-daniel');
    await app.call('/knowledge/kb-imda/revision/approve', 'POST', {});
    entry = await find('kb-imda');
    assert.equal(entry.version, 2);
    assert.match(entry.content, /test report/);
    assert.equal(entry.history?.[0].version, 1);
    assert.equal(entry.history?.[0].content, before.content);
    assert.equal(entry.revision, undefined);
    assert.equal(
      (await app.state()).skills.find((skill) => skill.id === 'electronics')!.version,
      2,
    );

    await app.call('/knowledge/kb-imda/retire', 'POST', { reason: '' }, 400);
    await app.call('/knowledge/kb-imda/retire', 'POST', { reason: 'Superseded by IMDA notice' });
    assert.equal((await find('kb-imda')).status, 'Retired');
    const review = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'IMDA telecoms scope for wireless equipment',
      skillId: 'electronics',
    });
    assert.ok(
      !review.at(-1)!.citations.some((ref) => ref.id === 'kb-imda'),
      'Retired is not used.',
    );
    await app.call('/knowledge/kb-imda/restore', 'POST', {});
    assert.equal((await find('kb-imda')).status, 'Approved');
    assert.equal(
      (await app.state()).skills.find((skill) => skill.id === 'electronics')!.version,
      4,
    );

    // Releases: v1 initial, v2 revision, v3 retire, v4 restore. Roll back to the original text.
    await app.call('/skills/electronics/rollback', 'POST', { version: 1 });
    entry = await find('kb-imda');
    assert.equal(entry.version, 1);
    assert.equal(entry.content, before.content);
    assert.equal(entry.status, 'Approved');
    assert.ok(
      entry.history?.some((item) => item.version === 2),
      'The rolled-back version is kept.',
    );
    // A later revision never reuses a version number.
    await app.as('manager-sarah');
    await app.call('/knowledge/kb-imda', 'PUT', {
      ...edit,
      content: 'Third wording.',
      note: 'Reword',
    });
    await app.as('manager-daniel');
    await app.call('/knowledge/kb-imda/revision/approve', 'POST', {});
    assert.equal((await find('kb-imda')).version, 3);
  } finally {
    await app.close();
  }
});

test('decision candidates need a second approver, can be declined, and rolled-back pills drop later knowledge', async () => {
  const app = await start();
  try {
    await app.as('manager-sarah');
    const state = await app.state();
    const target = state.cases.find((item) => item.id === 'case-wireless')!;
    const suggestion = target.review!.suggestions.find((item) => item.severity === 'critical')!;
    await app.call(`/cases/${target.id}/suggestions/${suggestion.id}`, 'POST', {
      decision: 'accepted',
      comment: 'Permit expiry matters for wireless goods.',
    });
    let candidate = (await app.state()).knowledge.find((item) => item.caseId === target.id)!;
    assert.equal(candidate.status, 'Pending');
    assert.equal(candidate.authorId, 'manager-sarah');
    await app.call(`/knowledge/${candidate.id}/publish`, 'POST', {}, 403);
    await app.call(`/knowledge/${candidate.id}/decline`, 'POST', { reason: '' }, 400);
    await app.as('employee-amir');
    await app.call(`/knowledge/${candidate.id}/publish`, 'POST', {}, 403);
    await app.as('manager-daniel');
    await app.call(`/knowledge/${candidate.id}/publish`, 'POST', {});
    candidate = (await app.state()).knowledge.find((item) => item.id === candidate.id)!;
    assert.equal(candidate.status, 'Approved');
    assert.equal(candidate.approvedBy, 'Daniel Wong');
    const released = (await app.state()).skills.find((skill) => skill.id === candidate.skillId)!;
    assert.equal(released.version, 2);
    // Rolling back to v1 retires what was approved afterwards.
    await app.call(`/skills/${candidate.skillId}/rollback`, 'POST', { version: 1 });
    assert.equal(
      (await app.state()).knowledge.find((item) => item.id === candidate.id)!.status,
      'Retired',
    );
    // A declined candidate can never be approved.
    const second = target.review!.suggestions.find((item) => item.id !== suggestion.id)!;
    await app.as('manager-sarah');
    await app.call(`/cases/${target.id}/suggestions/${second.id}`, 'POST', {
      decision: 'rejected',
      comment: 'Duplicate of the finding above.',
    });
    const other = (await app.state()).knowledge.find(
      (item) => item.caseId === target.id && item.decision === 'rejected',
    )!;
    await app.call(`/knowledge/${other.id}/decline`, 'POST', { reason: 'Too vague to reuse' });
    await app.as('manager-daniel');
    await app.call(`/knowledge/${other.id}/publish`, 'POST', {}, 409);
    await app.call(`/knowledge/${other.id}/restore`, 'POST', {}, 409);
  } finally {
    await app.close();
  }
});

test('a reviewer can add a finding the advisor missed, and approved it informs later work', async () => {
  const app = await start();
  try {
    const finding = {
      title: 'Check the antenna gain declaration',
      action: 'Ask the customer for the antenna gain figure.',
      comment:
        'Gain above the limit needs a different licence class, and the advisor did not raise it.',
      severity: 'warning',
    };
    await app.as('employee-amir');
    await app.call('/cases/case-wireless/findings', 'POST', finding, 403);
    await app.as('manager-sarah');
    await app.call('/cases/case-auto/findings', 'POST', finding, 409); // a draft is not in review
    await app.call('/cases/case-wireless/findings', 'POST', { ...finding, comment: '' }, 400);
    const updated = await app.call<CaseRecord>(
      '/cases/case-wireless/findings',
      'POST',
      finding,
      201,
    );
    const added = updated.review!.suggestions.find((item) => item.origin === 'manager')!;
    assert.equal(added.decision, 'accepted');
    assert.equal(added.decidedBy, 'Sarah Tan');
    assert.deepEqual(added.citations, []);
    const candidate = (await app.state()).knowledge.find((item) => item.missedByAdvisor)!;
    assert.equal(candidate.status, 'Pending');
    assert.match(candidate.title, /^Missed by advisor/);
    const ask = () =>
      app.call<ChatMessage[]>('/chat', 'POST', {
        message: 'antenna gain declaration for a wireless sensor',
        skillId: 'electronics',
      });
    assert.ok(!(await ask()).at(-1)!.citations.some((ref) => ref.id === candidate.id));
    await app.as('manager-daniel');
    await app.call(`/knowledge/${candidate.id}/publish`, 'POST', {});
    assert.ok((await ask()).at(-1)!.citations.some((ref) => ref.id === candidate.id));
  } finally {
    await app.close();
  }
});

test('pill boundaries send out-of-scope and escalation topics to people, each with a traceable source', async () => {
  const app = await start();
  try {
    await app.as('employee-amir');
    const created = await app.call<CaseRecord>(
      '/cases',
      'POST',
      {
        ...wireless,
        content:
          'Import 40 sensors with encryption modules. The customer asks us to attach an EMC test certificate.',
      },
      201,
    );
    const reviewed = await app.call<CaseRecord>(`/cases/${created.id}/review`, 'POST', {});
    const titles = reviewed.review!.suggestions.map((item) => item.title);
    assert.ok(titles.includes('Outside approved scope: Radio-frequency or EMC conformity testing'));
    assert.ok(titles.includes('Escalate: Dual-use or encryption features are mentioned'));
    assert.equal(
      titles.filter((title) => title === 'Escalate: A critical licence or permit finding is raised')
        .length,
      1,
      'A critical finding is escalated once per review.',
    );
    for (const item of reviewed.review!.suggestions.filter(
      (entry) => entry.origin === 'boundary',
    )) {
      assert.match(item.citations[0].id, /^pill:[a-z]+:v1$/);
      assert.ok(item.action.length > 0);
    }
    assert.deepEqual(
      reviewed.review!.pills?.map((pill) => [pill.id, pill.version]),
      [
        ['electronics', 1],
        ['general', 1],
      ],
    );
    const clean = await app.call<CaseRecord>(
      '/cases',
      'POST',
      { ...wireless, permitExpiry: '2026-12-01', content: 'Import 50 wireless sensors.' },
      201,
    );
    const calm = await app.call<CaseRecord>(`/cases/${clean.id}/review`, 'POST', {});
    assert.ok(!calm.review!.suggestions.some((item) => item.origin === 'boundary'));
  } finally {
    await app.close();
  }
});

test('workspaces saved before governance existed are completed without changing their content', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'instill-legacy-'));
  const path = join(folder, 'legacy.db');
  try {
    new Store(path, NOW).close();
    const raw = new DatabaseSync(path);
    const legacy = JSON.parse(
      (raw.prepare('SELECT payload FROM workspace WHERE id = 1').get() as { payload: string })
        .payload,
    );
    for (const skill of legacy.skills)
      for (const key of [
        'owner',
        'approver',
        'version',
        'releases',
        'inScope',
        'outOfScope',
        'guardrails',
        'escalations',
      ])
        delete skill[key];
    for (const item of legacy.knowledge)
      for (const key of ['version', 'authorId', 'approvedBy', 'approvedAt']) delete item[key];
    legacy.skills.push({
      id: 'phones',
      name: 'Phones',
      category: 'Electronics',
      jurisdiction: 'Singapore',
      description: 'Draft pill from before governance',
      tags: [],
      status: 'Draft',
      updatedAt: NOW.toISOString(),
    });
    raw.prepare('UPDATE workspace SET payload = ? WHERE id = 1').run(JSON.stringify(legacy));
    raw.close();
    const store = new Store(path, NOW);
    const workspace = store.read();
    const electronics = workspace.skills.find((skill) => skill.id === 'electronics') as Skill;
    assert.equal(electronics.version, 1);
    assert.equal(electronics.releases.length, 1);
    assert.equal(electronics.owner, 'manager-sarah');
    assert.equal(electronics.approver, 'manager-daniel');
    assert.ok(electronics.inScope.length > 0);
    assert.equal(workspace.knowledge.find((item) => item.id === 'kb-imda')!.version, 1);
    const draft = workspace.skills.find((skill) => skill.id === 'phones')!;
    assert.equal(draft.version, 0);
    assert.deepEqual(draft.releases, []);
    assert.ok(draft.guardrails.length > 0);
    assert.deepEqual(
      workspace.knowledge.map((item) => item.content),
      seedWorkspace(NOW).knowledge.map((item) => item.content),
    );
    store.mutate(() => undefined);
    assert.equal(
      store.read().skills.find((skill) => skill.id === 'electronics')!.releases.length,
      1,
    );
    store.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** An OpenAI-compatible provider whose behaviour each test scripts. */
async function provider(
  respond: (task: string, payload: Record<string, unknown>) => unknown | undefined,
  failures = { code: 0 },
) {
  const requests: { task: string; payload: Record<string, unknown> }[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (failures.code) {
      response.writeHead(failures.code);
      response.end();
      return;
    }
    const parsed = JSON.parse(body) as { messages: { content: string }[] };
    const task = parsed.messages[0].content;
    const payload = JSON.parse(parsed.messages[1].content) as Record<string, unknown>;
    requests.push({ task, payload });
    const content = respond(task, payload);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return {
    requests,
    ai: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: 'fictional-test-key',
      model: 'test-model',
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('the connected AI drafts a reusable rule that the reviewer confirms, with an honest template when it is down', async () => {
  const failures = { code: 0 };
  const mock = await provider(
    (task) =>
      task.includes('"appliesWhen"')
        ? {
            appliesWhen: 'Wireless goods whose permit expires before the shipment date',
            check: 'Obtain a renewed licence before declaring',
            exceptions: 'Goods shipped under an exemption already on file',
            evidence: 'Renewed IMDA licence',
            questions: ['Does the exemption ever apply to Bluetooth modules?'],
          }
        : { summary: 'ok', suggestions: [] },
    failures,
  );
  const app = await start({ ai: mock.ai });
  try {
    await app.as('manager-sarah');
    const target = (await app.state()).cases.find((item) => item.id === 'case-wireless')!;
    const suggestion = target.review!.suggestions.find((item) => item.severity === 'critical')!;
    await app.as('employee-amir');
    await app.call(
      `/cases/${target.id}/draft-rule`,
      'POST',
      { note: 'x', decision: 'accepted' },
      403,
    );
    await app.as('manager-sarah');
    await app.call(
      `/cases/${target.id}/draft-rule`,
      'POST',
      { note: '', decision: 'accepted' },
      400,
    );
    const draft = await app.call<{
      rule: Record<string, string>;
      questions: string[];
      mode: string;
    }>(`/cases/${target.id}/draft-rule`, 'POST', {
      suggestionId: suggestion.id,
      note: 'Expired permits block wireless imports.',
      decision: 'accepted',
    });
    assert.equal(draft.mode, 'live');
    assert.match(draft.rule.appliesWhen, /permit expires/);
    assert.deepEqual(draft.questions, ['Does the exemption ever apply to Bluetooth modules?']);
    const sent = mock.requests.at(-1)!;
    assert.equal(sent.payload.reviewerNote, 'Expired permits block wireless imports.');
    assert.match(sent.task, /never as a requirement/);
    assert.match(sent.task, /Respond in English only/);
    // The reviewer edits the draft, then confirms the decision with the rule attached.
    await app.call(`/cases/${target.id}/suggestions/${suggestion.id}`, 'POST', {
      decision: 'accepted',
      comment: 'Expired permits block wireless imports.',
      rule: { ...draft.rule, evidence: 'Renewed IMDA licence and cover email' },
    });
    const saved = (await app.state()).knowledge.find((item) => item.caseId === target.id)!;
    assert.match(saved.content, /Applies when: Wireless goods whose permit expires/);
    assert.match(saved.content, /Does not apply when: Goods shipped under an exemption/);
    assert.match(saved.content, /Evidence to attach: Renewed IMDA licence and cover email/);
    assert.equal(saved.rule?.check, 'Obtain a renewed licence before declaring');
    await app.call(
      `/cases/${target.id}/suggestions/${(await app.state()).cases.find((item) => item.id === target.id)!.review!.suggestions[1].id}`,
      'POST',
      { decision: 'accepted', rule: 'not an object' },
      400,
    );
    failures.code = 503;
    const fallback = await app.call<{
      rule: Record<string, string>;
      questions: string[];
      mode: string;
      fallbackReason?: string;
    }>(`/cases/${target.id}/draft-rule`, 'POST', {
      note: 'Duplicate of another finding.',
      decision: 'rejected',
    });
    assert.equal(fallback.mode, 'local');
    assert.match(fallback.fallbackReason!, /HTTP 503/);
    assert.equal(
      fallback.rule.exceptions,
      'Duplicate of another finding.',
      'A rejection is an exception, never a requirement.',
    );
    assert.equal(fallback.rule.check, '');
    assert.equal(fallback.questions.length, 3);
  } finally {
    await app.close();
    await mock.close();
  }
});

test('the connected AI judges which precedents apply: it can endorse, drop or abstain, but never add an unrouted source', async () => {
  let applicable: unknown = [
    {
      sourceId: 'kb-previous-decision',
      why: 'The same wireless scope question was settled before.',
    },
    { sourceId: 'kb-auto', why: 'Belongs to a pill that is not routed for this case.' },
    { sourceId: 'not-a-source', why: 'invented' },
  ];
  const mock = await provider((task) =>
    task.includes('"applicable"')
      ? {
          summary: 'Reviewed.',
          ...(applicable === undefined ? {} : { applicable }),
          suggestions: [],
        }
      : {},
  );
  const app = await start({ ai: mock.ai });
  try {
    await app.as('employee-amir');
    const created = await app.call<CaseRecord>('/cases', 'POST', wireless, 201);
    const review = async () =>
      (await app.call<CaseRecord>(`/cases/${created.id}/review`, 'POST', {})).review!;
    const byOrigin = (origin: string, value: Awaited<ReturnType<typeof review>>) =>
      value.suggestions.filter((item) => item.origin === origin);

    let result = await review();
    assert.equal(result.mode, 'live');
    const judged = byOrigin('model', result);
    assert.equal(judged.length, 1, 'Only the endorsed, routed source is shown.');
    assert.equal(judged[0].citations[0].id, 'kb-previous-decision');
    assert.match(judged[0].detail, /settled before/);
    assert.equal(byOrigin('knowledge', result).length, 0);
    assert.ok(
      byOrigin('rule', result).length > 0,
      'Deterministic checks are never removed by the model.',
    );
    const sent = mock.requests.at(-1)!;
    assert.ok(
      (sent.payload.knowledge as { id: string }[]).some(
        (item) => item.id === 'kb-previous-decision',
      ),
    );
    assert.ok(!(sent.payload.knowledge as { id: string }[]).some((item) => item.id === 'kb-auto'));
    assert.ok(Array.isArray(sent.payload.pills));
    assert.ok(
      (sent.payload.knowledge as { content: string }[]).every(
        (item) => item.content.length <= 1500,
      ),
    );

    applicable = [];
    result = await review();
    assert.equal(byOrigin('model', result).length + byOrigin('knowledge', result).length, 0);
    assert.ok(byOrigin('rule', result).length > 0);

    applicable = undefined;
    result = await review();
    assert.ok(
      byOrigin('knowledge', result).length > 0,
      'Without a judgement the lexical precedent stays.',
    );
  } finally {
    await app.close();
    await mock.close();
  }
});

/** A minimal ADP server speaking the SSE contract. */
async function adpServer(handler: (response: ServerResponse) => void) {
  const server = createServer((_request, response) => handler(response)).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/adp/v2/chat`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
const answer = (text: string) =>
  `event: response.completed\ndata: ${JSON.stringify({
    Type: 'response.completed',
    Response: {
      Role: 'assistant',
      Status: 'success',
      Messages: [
        {
          Type: 'reply',
          MessageId: 'r1',
          Status: 'success',
          Contents: [{ Type: 'text', Text: text }],
        },
      ],
    },
  })}\n\nevent: done\ndata: [DONE]\n\n`;

test('a failing ADP check says why, never exposes the key, and recovers; slightly untidy citations still pass', async () => {
  const key = 'fictional-private-app-key-9f3a';
  let mode: 'unauthorised' | 'down' | 'untidy' | 'invented' | 'multi' | 'labelled' = 'unauthorised';
  const adp = await adpServer((response) => {
    if (mode === 'unauthorised') {
      response.writeHead(401);
      response.end('secret detail that must not be shown');
      return;
    }
    response.setHeader('Content-Type', 'text/event-stream');
    response.end(
      mode === 'untidy'
        ? answer(
            'Compare the expiry with today and the shipment date [kb-expiry] and the plan [2].',
          )
        : mode === 'labelled'
          ? answer('Compare the expiry with today [Source: kb-expiry - Internal SOP].')
          : mode === 'multi'
            ? answer(
                'Check validity [kb-expiry, kb-customs] and [Verify the date, not just the permit number].',
              )
            : mode === 'invented'
              ? answer('Customs Act section 12 applies [Customs Act s.12].')
              : answer(''),
    );
  });
  const app = await start({
    ai: { provider: 'adp', adpAppKey: key, adpEndpoint: adp.endpoint },
  });
  try {
    await app.as('manager-sarah');
    const failed = await app.call<IntegrationState & { error: string }>(
      '/integrations/check',
      'POST',
      {},
      502,
    );
    assert.match(failed.error, /rejected the application key \(HTTP 401\)/);
    assert.ok(!JSON.stringify(failed).includes(key));
    assert.ok(!JSON.stringify(failed).includes('secret detail'));
    let integrations = (await app.state()).integrations!;
    assert.equal(integrations.connection, 'error');
    assert.match(integrations.lastError!, /HTTP 401/);

    mode = 'invented';
    const invented = await app.call<IntegrationState & { error: string }>(
      '/integrations/check',
      'POST',
      {},
      502,
    );
    assert.match(invented.error, /unknown source "Customs Act s\.12"/);

    mode = 'down';
    const empty = await app.call<IntegrationState & { error: string }>(
      '/integrations/check',
      'POST',
      {},
      502,
    );
    assert.match(empty.error, /empty|did not cite|Reason/);

    mode = 'untidy';
    const ok = await app.call<IntegrationState>('/integrations/check', 'POST', {});
    assert.equal(ok.connection, 'verified');
    integrations = (await app.state()).integrations!;
    assert.equal(integrations.lastError, undefined, 'A success clears the previous failure.');
    assert.equal(typeof integrations.latencyMs, 'number');
    const untidy = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'permit validity before a shipment',
      skillId: 'general',
    });
    assert.equal(untidy.at(-1)!.mode, 'live');
    assert.ok(
      !untidy.at(-1)!.content.includes('[2]'),
      'An unmapped numeric marker carries no source.',
    );

    mode = 'labelled';
    const labelled = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'permit validity before a shipment',
      skillId: 'general',
    });
    assert.equal(labelled.at(-1)!.mode, 'live', 'A known id inside a label is still that source.');
    assert.deepEqual(
      labelled.at(-1)!.citations.map((ref) => ref.id),
      ['kb-expiry'],
    );
    assert.match(labelled.at(-1)!.content, /[kb-expiry]/);
    assert.ok(!labelled.at(-1)!.content.includes('Internal SOP'));
    assert.equal(
      (await app.call<IntegrationState>('/integrations/check', 'POST', {})).connection,
      'verified',
    );

    mode = 'multi';
    const multi = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'permit validity before a shipment',
      skillId: 'general',
    });
    assert.equal(multi.at(-1)!.mode, 'live');
    assert.deepEqual(
      multi
        .at(-1)!
        .citations.map((ref) => ref.id)
        .sort(),
      ['kb-customs', 'kb-expiry'],
    );
    assert.match(multi.at(-1)!.content, /\[kb-expiry\] \[kb-customs\]/);
  } finally {
    await app.close();
    await adp.close();
  }
});

test('an unreachable ADP endpoint is reported as a network problem, not as a bad answer', async () => {
  const app = await start({
    ai: {
      provider: 'adp',
      adpAppKey: 'fictional-key',
      adpEndpoint: 'https://127.0.0.1:9/adp/v2/chat',
    },
  });
  try {
    await app.as('manager-sarah');
    const failed = await app.call<{ error: string }>('/integrations/check', 'POST', {}, 502);
    assert.match(failed.error, /could not be reached/);
    assert.match(failed.error, /Could not connect to 127\.0\.0\.1 over HTTPS \(ECONNREFUSED\)/);
  } finally {
    await app.close();
  }
});

test('the hourly AI call budget protects the Tencent allowance and falls back with a reason', async () => {
  const previous = process.env.AI_CALLS_PER_HOUR;
  process.env.AI_CALLS_PER_HOUR = '1';
  const mock = await provider(() => ({ summary: 'ok', suggestions: [] }));
  const app = await start({ ai: mock.ai });
  try {
    await app.as('employee-amir');
    const first = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'Wireless sensors IMDA route',
      skillId: 'electronics',
    });
    assert.equal(mock.requests.length, 1);
    assert.ok(first.length === 2);
    const second = await app.call<ChatMessage[]>('/chat', 'POST', {
      message: 'Wireless sensors IMDA route again',
      skillId: 'electronics',
    });
    assert.equal(mock.requests.length, 1, 'The budget refuses the second provider call.');
    assert.equal(second.at(-1)!.mode, 'local');
    assert.match(second.at(-1)!.fallbackReason!, /hourly AI call budget/);
    assert.ok(second.at(-1)!.citations.length > 0, 'The local advisor still answers with sources.');
  } finally {
    if (previous === undefined) delete process.env.AI_CALLS_PER_HOUR;
    else process.env.AI_CALLS_PER_HOUR = previous;
    await app.close();
    await mock.close();
  }
});

test('a new pill is owned and approved by two different people, and a draft is edited directly because nothing is live', async () => {
  const app = await start();
  try {
    await app.as('employee-amir');
    const proposed = await app.call<Skill>(
      '/skills',
      'POST',
      {
        name: 'Cold-chain handover',
        category: 'Food & produce',
        description: 'Receiving requirements.',
      },
      201,
    );
    assert.equal(proposed.version, 0);
    assert.equal(proposed.status, 'Draft');
    assert.equal(
      proposed.owner,
      'manager-sarah',
      'An employee proposes; a senior reviewer owns it.',
    );
    assert.equal(proposed.approver, 'manager-daniel');
    assert.ok(proposed.escalations.some((entry) => entry.onCritical));
    await app.as('manager-daniel');
    await app.call(`/skills/${proposed.id}`, 'PUT', { guardrails: ['Never promise delivery'] });
    const draft = (await app.state()).skills.find((skill) => skill.id === proposed.id)!;
    assert.deepEqual(draft.guardrails, ['Never promise delivery']);
    assert.equal(draft.pending, undefined, 'Nothing is live, so there is nothing to approve.');
    assert.equal(draft.version, 0);
  } finally {
    await app.close();
  }
});

test('a model observation that only restates a rule finding is dropped, a genuinely new one is kept', async () => {
  const mock = await provider((task) =>
    task.includes('"applicable"')
      ? {
          summary: 'Reviewed.',
          applicable: [],
          suggestions: [
            {
              title: 'Permit validity has expired, obtain current evidence',
              detail: 'The permit is out of date.',
              action: 'Obtain current supporting evidence and correct the case before clearance',
              severity: 'critical',
              sourceIds: ['kb-expiry'],
            },
            {
              title: 'Ask about antenna gain',
              detail: 'Gain affects the licence class.',
              action: 'Request the antenna gain figure from the supplier',
              severity: 'warning',
              sourceIds: ['kb-imda'],
            },
          ],
        }
      : {},
  );
  const app = await start({ ai: mock.ai });
  try {
    await app.as('employee-amir');
    const created = await app.call<CaseRecord>('/cases', 'POST', wireless, 201);
    const reviewed = await app.call<CaseRecord>(`/cases/${created.id}/review`, 'POST', {});
    const model = reviewed.review!.suggestions.filter((item) => item.origin === 'model');
    assert.deepEqual(
      model.map((item) => item.title),
      ['Ask about antenna gain'],
    );
    assert.match(mock.requests.at(-1)!.task, /never restate, rephrase or re-rank/);
  } finally {
    await app.close();
    await mock.close();
  }
});

test('an answer without citations gets one correction before the local fallback', async () => {
  const mock = await provider((_task, payload) =>
    payload.correction
      ? 'Check the applicable IMDA route for wireless equipment [kb-imda].'
      : 'You should check the IMDA route for wireless equipment.',
  );
  const app = await start({ ai: mock.ai });
  try {
    await app.as('employee-amir');
    const ask = () =>
      app.call<ChatMessage[]>('/chat', 'POST', {
        message: 'Wireless sensors IMDA route',
        skillId: 'electronics',
      });
    const corrected = (await ask()).at(-1)!;
    assert.equal(corrected.mode, 'live');
    assert.deepEqual(
      corrected.citations.map((ref) => ref.id),
      ['kb-imda'],
    );
    assert.equal(mock.requests.length, 2, 'One original request and one correction.');
    assert.match(String(mock.requests[1].payload.correction), /did not cite any approved source/);

    // A model that never cites is still refused, after exactly one retry.
    mock.requests.length = 0;
    const never = await provider(() => 'You should check the IMDA route.');
    const other = await start({ ai: never.ai });
    try {
      await other.as('employee-amir');
      const refused = (
        await other.call<ChatMessage[]>('/chat', 'POST', {
          message: 'Wireless sensors IMDA route',
          skillId: 'electronics',
        })
      ).at(-1)!;
      assert.equal(refused.mode, 'local');
      assert.match(refused.fallbackReason!, /did not cite any approved source/);
      assert.equal(never.requests.length, 2);
    } finally {
      await other.close();
      await never.close();
    }
  } finally {
    await app.close();
    await mock.close();
  }
});

test('the demo loop: one reviewer decides, a second approves, and the next employee sees it on a different case', async () => {
  const app = await start();
  try {
    await app.as('manager-sarah');
    const state = await app.state();
    const source = state.cases.find((item) => item.id === 'case-wireless')!;
    const expiry = source.review!.suggestions.find((item) => item.title.includes('expired'))!;
    await app.call(`/cases/${source.id}/suggestions/${expiry.id}`, 'POST', {
      decision: 'accepted',
      comment:
        'Permit expiry is two days before today. Wireless goods need a current IMDA licence; ask the customer for the renewed licence before declaring.',
    });

    // The vehicle remote-controls draft, edited so its permit also lapses before shipment.
    await app.as('employee-amir');
    const draft = state.cases.find((item) => item.id === 'case-auto')!;
    await app.call(`/cases/${draft.id}`, 'PUT', {
      ...draft,
      permitNumber: 'DEMO-IMDA-5520',
      permitExpiry: '2026-10-10',
      shipmentDate: '2026-10-25',
    });
    const candidate = (await app.state()).knowledge.find((item) => item.caseId === source.id)!;
    const before = (await app.call<CaseRecord>(`/cases/${draft.id}/review`, 'POST', {})).review!;
    assert.ok(
      !before.suggestions.some((item) => item.citations.some((ref) => ref.id === candidate.id)),
      'A decision nobody has approved yet is not offered as precedent.',
    );

    await app.as('manager-daniel');
    await app.call(`/knowledge/${candidate.id}/publish`, 'POST', {});

    await app.as('employee-amir');
    const after = (await app.call<CaseRecord>(`/cases/${draft.id}/review`, 'POST', {})).review!;
    const precedent = after.suggestions.find((item) =>
      item.citations.some((ref) => ref.id === candidate.id),
    );
    assert.ok(precedent, 'The approved decision comes back on a different case.');
    assert.equal(precedent!.title, 'Relevant senior-review precedent');
    assert.deepEqual(after.pills?.map((pill) => pill.id).sort(), [
      'automotive',
      'electronics',
      'general',
    ]);
  } finally {
    await app.close();
  }
});

test('a bare bracketed word is formatting and is removed, but anything shaped like a reference is refused', async () => {
  let reply = '';
  const adp = await adpServer((response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.end(answer(reply));
  });
  const app = await start({
    ai: { provider: 'adp', adpAppKey: 'fictional-key', adpEndpoint: adp.endpoint },
  });
  try {
    await app.as('employee-amir');
    const ask = async (text: string) => {
      reply = text;
      return (
        await app.call<ChatMessage[]>('/chat', 'POST', {
          message: 'Wireless sensors IMDA route',
          skillId: 'electronics',
        })
      ).at(-1)!;
    };
    const tidy = await ask('Check the IMDA route for wireless goods [electronics] [kb-imda].');
    assert.equal(tidy.mode, 'live');
    assert.ok(!tidy.content.includes('[electronics]'));
    assert.deepEqual(
      tidy.citations.map((ref) => ref.id),
      ['kb-imda'],
    );
    for (const refused of [
      'Check the route [electronics].',
      'Check the route [kb-imda] and [kb-made-up-1].',
      'Check the route [kb-imda] and [Customs Act].',
      'Check the route [kb-imda] and [Section 12].',
      'Check the route [kb-imda] and [kb_made_up].',
    ]) {
      const result = await ask(refused);
      assert.equal(result.mode, 'local', refused);
      assert.ok(result.fallbackReason, refused);
    }
  } finally {
    await app.close();
    await adp.close();
  }
});
