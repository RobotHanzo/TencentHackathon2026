import { expect, test, type Locator, type Page } from '@playwright/test';

async function switchUser(page: Page, name: 'Amir Rahman' | 'Sarah Tan') {
  await page.getByRole('button', { name: 'Switch demo user' }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('button', { name: 'Switch demo user' })).toHaveText(
    name === 'Amir Rahman' ? 'AR' : 'ST',
  );
}

async function navigate(page: Page, name: RegExp) {
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible())
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.sidebar').getByRole('button', { name }).click();
}

function singaporeDate(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Singapore',
  });
}

async function selectDocumentText(document: Locator, start: number, end: number) {
  await document.evaluate(
    (root, offsets) => {
      const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = window.document.createRange();
      let position = 0;
      let started = false;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const length = node.textContent?.length ?? 0;
        if (!started && offsets.start < position + length) {
          range.setStart(node, offsets.start - position);
          started = true;
        }
        if (started && offsets.end <= position + length) {
          range.setEnd(node, offsets.end - position);
          break;
        }
        position += length;
      }
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      window.document.dispatchEvent(new Event('selectionchange'));
    },
    { start, end },
  );
}

test('every workspace page opens and knowledge filters show real source details', async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  await page.screenshot({
    path: testInfo.outputPath('overview-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await navigate(page, /^Knowledge base$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Knowledge base');
  await page.screenshot({
    path: testInfo.outputPath('knowledge-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('textbox', { name: 'Search knowledge', exact: true }).fill('IMDA');
  await page.getByRole('combobox', { name: 'Filter by category' }).selectOption('Electronics');
  await expect(
    page.getByRole('button', {
      name: 'View Check telecoms scope before requesting IMDA evidence',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'View Check telecoms scope before requesting IMDA evidence',
      exact: true,
    })
    .click();
  const detail = page.getByRole('dialog', { name: 'Knowledge detail' });
  await expect(detail).toContainText('IMDA provides dealer licensing routes');
  await expect(detail).toContainText('Singapore');
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search knowledge', exact: true })
    .fill('no matching knowledge phrase 8399');
  await expect(page.getByText('No matching knowledge', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('button', { name: 'View Singapore import readiness', exact: true }),
  ).toBeVisible();
  for (const [link, heading] of [
    [/^Review queue/, 'Review queue'],
    [/^Ask an agent/, 'Ask an agent'],
    [/^Activity$/, 'Activity'],
    [/^Team$/, 'Team'],
    [/^Settings$/, 'Settings'],
  ] as const) {
    await navigate(page, link);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
  expect(failures).toEqual([]);
});

test('employee creates a skill and imports notes; manager publication makes the source available', async ({
  page,
}) => {
  await page.goto('/#knowledge');
  await switchUser(page, 'Amir Rahman');
  await page.getByRole('button', { name: 'New skill', exact: true }).click();
  const skillDialog = page.getByRole('dialog', { name: 'New skill' });
  await skillDialog.getByLabel('Skill name').fill('ORCHID customer procedures');
  await skillDialog.getByLabel('Cargo category').selectOption('Electronics');
  await skillDialog
    .getByLabel('Description')
    .fill(
      'Customer-specific receiving and handover procedures for Singapore wireless sensor shipments.',
    );
  await skillDialog.getByRole('button', { name: 'Create skill', exact: true }).click();
  await expect(skillDialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: /ORCHID customer procedures/ })).toContainText(
    'Draft',
  );
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import knowledge' });
  await importDialog.getByRole('button', { name: 'Paste notes', exact: true }).click();
  await importDialog
    .getByLabel('Notes or email')
    .fill(
      'ORCHID wireless sensor shipments use an amber carton label. Confirm the receiving supervisor has acknowledged the handover sheet before scheduling delivery. This is a customer-specific internal procedure.',
    );
  await importDialog.getByLabel('Title', { exact: true }).fill('ORCHID amber carton handover');
  await importDialog
    .getByRole('combobox', { name: 'Skill', exact: true })
    .selectOption({ label: 'ORCHID customer procedures · Electronics' });
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importDialog).not.toBeVisible();
  const row = page.getByRole('button', { name: 'View ORCHID amber carton handover', exact: true });
  await expect(row).toContainText('Pending approval');
  await row.click();
  const detail = page.getByRole('dialog', { name: 'Knowledge detail' });
  await expect(detail.getByRole('button', { name: 'Approve knowledge' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await switchUser(page, 'Sarah Tan');
  await row.click();
  await detail.getByRole('button', { name: 'Approve knowledge', exact: true }).click();
  await expect(detail.getByText('Approved', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row).toContainText('Approved');
  await expect(page.getByRole('button', { name: /ORCHID customer procedures/ })).toContainText(
    'Active',
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'View ORCHID amber carton handover', exact: true }),
  ).toContainText('Approved');
});

test('expired evidence is caught before approval and reviewer decisions become reusable knowledge', async ({
  page,
}) => {
  const title = 'E2E wireless sensor declaration';
  await page.goto('/#reviews');
  await switchUser(page, 'Amir Rahman');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'New document' });
  await editor.getByLabel('Document title', { exact: true }).fill(title);
  await editor.getByLabel('Customer', { exact: true }).fill('ORCHID Systems Pte Ltd');
  await editor
    .getByLabel('Document content', { exact: true })
    .fill(
      'Import 50 wireless Bluetooth sensors into Singapore. Commercial invoice and packing list are reconciled. Confirm the applicable IMDA route against technical radio specifications.',
    );
  await editor.getByLabel('Supporting licence / permit number').fill('DEMO-ORCHID-123');
  await editor.getByLabel('Documented valid-until date').fill(singaporeDate(-2));
  await editor.getByLabel('Expected shipment date').fill(singaporeDate(2));
  await expect(editor.getByText('Validity ends before shipment', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Save document' }).click();
  let detail = page.getByRole('dialog', { name: title, exact: true });
  await detail.getByRole('button', { name: 'Run agent review', exact: true }).click();
  await expect(detail.getByRole('heading', { name: /expir/i })).toBeVisible();
  await detail.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(detail.getByText('Awaiting senior review.', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Accept advice', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: /^Discussion/ }).click();
  await detail
    .getByLabel('Add a comment')
    .fill('Please verify the replacement evidence with the customer before release.');
  await detail.getByRole('button', { name: 'Post comment' }).click();
  await expect(
    detail.getByText('Please verify the replacement evidence with the customer before release.', {
      exact: true,
    }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Close document' }).click();

  await switchUser(page, 'Sarah Tan');
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  detail = page.getByRole('dialog', { name: title, exact: true });
  await expect(detail.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  const expiry = detail
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: /expir/i }) });
  await expiry
    .getByRole('textbox')
    .fill(
      'ORCHID renewal check: the supplied authorisation expired; obtain a current document before release.',
    );
  await expiry.getByRole('button', { name: 'Accept advice', exact: true }).click();
  await expect(expiry.getByText('Accepted', { exact: true })).toBeVisible();
  await detail
    .getByLabel('Final review note')
    .fill('Replace expired evidence and verify receiving arrangements, then resubmit.');
  await detail.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(detail.locator('.case-meta')).toContainText('Changes requested');
  await detail.getByRole('button', { name: 'Close document' }).click();

  await switchUser(page, 'Amir Rahman');
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await page
    .getByRole('dialog', { name: title, exact: true })
    .getByRole('button', { name: 'Edit document' })
    .click();
  editor = page.getByRole('dialog', { name: 'Edit document', exact: true });
  await editor.getByLabel('Documented valid-until date').fill(singaporeDate(30));
  await editor.getByRole('checkbox').check();
  await editor.getByRole('button', { name: 'Save document' }).click();
  detail = page.getByRole('dialog', { name: title, exact: true });
  await expect(
    detail.getByRole('button', { name: 'Submit for approval', exact: true }),
  ).toHaveCount(0);
  await detail.getByRole('button', { name: 'Run agent review', exact: true }).click();
  await detail.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await detail.getByRole('button', { name: 'Close document' }).click();

  await switchUser(page, 'Sarah Tan');
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  detail = page.getByRole('dialog', { name: title, exact: true });
  const pendingCount = await detail
    .getByRole('button', { name: 'Accept advice', exact: true })
    .count();
  const firstPending = detail
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name: 'Reject advice', exact: true }) })
    .first();
  await expect(
    firstPending.getByRole('button', { name: 'Reject advice', exact: true }),
  ).toBeDisabled();
  await firstPending
    .getByRole('textbox')
    .fill(
      'ORCHID scope exception: the reviewer verified the equipment specification and supporting evidence; this additional request is already satisfied for this shipment.',
    );
  await firstPending.getByRole('button', { name: 'Reject advice', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'Accept advice', exact: true })).toHaveCount(
    pendingCount - 1,
  );
  while (await detail.getByRole('button', { name: 'Accept advice', exact: true }).count()) {
    const remaining = await detail
      .getByRole('button', { name: 'Accept advice', exact: true })
      .count();
    const accept = detail.getByRole('button', { name: 'Accept advice', exact: true }).first();
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(detail.getByRole('button', { name: 'Accept advice', exact: true })).toHaveCount(
      remaining - 1,
    );
  }
  await expect(detail.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await detail
    .getByLabel('Final review note')
    .fill('Current evidence and cargo readiness verified. Approved for the internal handover.');
  await detail.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(
    detail.locator('.approved-note').getByText('Approved', { exact: true }),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Close document' }).click();
  await navigate(page, /^Knowledge base$/);
  await page.getByRole('button', { name: /^Decisions/ }).click();
  await page
    .getByRole('textbox', { name: 'Search knowledge', exact: true })
    .fill('ORCHID scope exception');
  const decisionRow = page.locator('.knowledge-row');
  await expect(decisionRow).toHaveCount(1);
  await expect(decisionRow).toContainText('Suggestion rejected');
  await decisionRow.click();
  await expect(page.getByRole('dialog', { name: 'Knowledge detail' })).toContainText(
    'ORCHID scope exception',
  );
});

test('advisor selects relevant knowledge and exposes evidence citations', async ({ page }) => {
  await page.goto('/#consult');
  await expect(page.getByRole('heading', { name: 'Ask an agent', exact: true })).toBeVisible();
  const initialAnswers = await page.locator('.chat-message.assistant').count();
  await page
    .getByRole('textbox', { name: 'Your question for the advisor' })
    .fill('What IMDA checks should I make for a wireless Bluetooth sensor shipment in Singapore?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(initialAnswers + 1);
  const answer = page.locator('.chat-message.assistant').last();
  await expect(page.getByText('Local advisor', { exact: true })).toBeVisible();
  await expect(answer).toContainText('Electronics');
  const citation = answer.locator('.chat-citation').first();
  await expect(citation).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send question', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Select advisor skill' }).selectOption('food');
  const question = page.getByRole('textbox', { name: 'Your question for the advisor' });
  const followUp = 'Which SFA licensing route applies to fresh produce?';
  await question.fill(followUp);
  await citation.click();
  const detail = page.getByRole('dialog', { name: 'Knowledge detail' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Approved', { exact: true })).toBeVisible();
  const sourceTitle = await detail.locator('.modal-body > h2').innerText();
  const sourceContent = await detail.locator('.knowledge-detail-content').innerText();
  expect(sourceContent.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/#consult$/);
  await page.keyboard.press('Escape');
  await expect(detail).not.toBeVisible();
  await expect(citation).toBeFocused();
  await expect(question).toHaveValue(followUp);
  await expect(page.getByRole('combobox', { name: 'Select advisor skill' })).toHaveValue('food');
  await citation.press('Enter');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(detail).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Your question for the advisor' }).press('Enter');
  await expect(page.locator('.chat-message.assistant')).toHaveCount(initialAnswers + 2);
  await expect(page.locator('.chat-message.assistant').last()).toContainText(
    'Food & fresh produce',
  );
  await navigate(page, /^Knowledge base$/);
  // Reviewer decisions can have the same title; identify the entry by its full content.
  const entries = page.getByRole('button', { name: `View ${sourceTitle}`, exact: true });
  await expect(entries.first()).toBeVisible();
  for (let index = 0; index < (await entries.count()); index++) {
    await entries.nth(index).click();
    if ((await detail.locator('.knowledge-detail-content').innerText()) === sourceContent) break;
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await expect(detail.locator('.knowledge-detail-content')).toHaveText(sourceContent);
});

test('mobile navigation, knowledge and dialogs stay within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const link of [
    /^Overview$/,
    /^Knowledge base$/,
    /^Review queue/,
    /^Ask an agent/,
    /^Activity$/,
    /^Team$/,
    /^Settings$/,
  ]) {
    await navigate(page, link);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const sizes = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(sizes.width, `Horizontal overflow on ${link}`).toBeLessThanOrEqual(sizes.viewport + 1);
  }
  await navigate(page, /^Knowledge base$/);
  await page.screenshot({
    path: testInfo.outputPath('knowledge-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import knowledge' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('selected document passages retain comments, overlapping highlights and earlier-version quotes', async ({
  page,
}, testInfo) => {
  const title = 'E2E passage comments';
  const quote = 'Check permit 🧾';
  const content = 'Check permit 🧾 before release.\nCheck permit 🧾 before release.';
  await page.goto('/#reviews');
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New document' });
  await editor.getByLabel('Document title', { exact: true }).fill(title);
  await editor.getByLabel('Customer', { exact: true }).fill('Passage Test Pte Ltd');
  await editor.getByLabel('Document content', { exact: true }).fill(content);
  await editor.getByRole('button', { name: 'Save document' }).click();
  const detail = page.getByRole('dialog', { name: title, exact: true });
  const document = detail.getByRole('document', { name: 'Document text' });
  const secondStart = content.lastIndexOf(quote);
  await selectDocumentText(document, secondStart, secondStart + quote.length);
  await detail.getByRole('button', { name: 'Comment on selection', exact: true }).click();
  const composer = detail.locator('.annotation-composer');
  const input = composer.getByLabel('Comment on selected text');
  await expect(input).toBeFocused();
  await expect(composer.locator('blockquote')).toHaveText(quote);
  await input.fill('Verify the renewed authorisation.');
  await detail.getByRole('button', { name: /^Discussion/ }).click();
  await detail.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(input).toHaveValue('Verify the renewed authorisation.');
  await expect(composer.locator('blockquote')).toHaveText(quote);

  // A failed save must leave the passage and typed comment available for retry.
  await page.route(
    '**/api/cases/*/comments',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary comment failure.' }),
      }),
    { times: 1 },
  );
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(composer.getByRole('alert')).toContainText('Temporary comment failure.');
  await expect(input).toHaveValue('Verify the renewed authorisation.');
  // Once the POST succeeds, a failed workspace refresh must not offer another POST.
  await page.route(
    '**/api/state',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary refresh failure.' }),
      }),
    { times: 1 },
  );
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(composer).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Comment saved. Refresh to update the workspace.',
  );
  await expect(document.locator('mark')).toHaveText(quote);
  const actualStart = await document.locator('mark').evaluate((mark) => {
    const range = window.document.createRange();
    range.selectNodeContents(mark.parentElement!);
    range.setEndBefore(mark);
    return range.toString().length;
  });
  expect(actualStart).toBe(secondStart);
  await expect(document).toHaveText(content);

  // Select across an existing highlight and the adjacent text node.
  const overlapStart = secondStart + 'Check '.length;
  await selectDocumentText(document, overlapStart, content.length);
  await detail.getByRole('button', { name: 'Comment on selection', exact: true }).click();
  await expect(composer.locator('blockquote')).toHaveText(content.slice(overlapStart));
  await composer.getByLabel('Comment on selected text').fill('Confirm the release timing too.');
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(composer).not.toBeVisible();
  await expect(document.locator('mark')).toHaveCount(3);
  await expect(document).toHaveText(content);

  await detail.getByRole('button', { name: 'Close document' }).click();
  await page.reload();
  await page.getByRole('button', { name: new RegExp('^' + title) }).click();
  await expect(document.locator('mark')).toHaveCount(3);
  await document.locator('mark').first().press('Enter');
  const saved = detail.locator('.comment').filter({ hasText: 'Verify the renewed authorisation.' });
  await expect(saved).toHaveCount(1);
  await expect(saved.locator('blockquote')).toHaveText(quote);
  await expect(saved).toBeFocused();
  await saved.getByRole('button', { name: 'View passage' }).click();
  await expect(document.locator('mark').first()).toBeFocused();

  await detail.getByRole('button', { name: 'Edit document' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit document', exact: true });
  await edit
    .getByRole('textbox', { name: 'Document content', exact: true })
    .fill('Revised: ' + content);
  await edit.getByRole('button', { name: 'Save document' }).click();
  await expect(document.locator('mark')).toHaveCount(0);
  await detail.getByRole('button', { name: /^Discussion/ }).click();
  await expect(saved.locator('blockquote')).toHaveText(quote);
  await expect(saved.getByText('Earlier version', { exact: true })).toBeVisible();
  await expect(saved.getByRole('button', { name: 'View passage' })).toHaveCount(0);

  // A concurrent edit rejects the old selection but retains the draft for reselection.
  await detail.getByRole('button', { name: 'Document', exact: true }).click();
  const revised = 'Revised: ' + content;
  await selectDocumentText(
    document,
    revised.lastIndexOf(quote),
    revised.lastIndexOf(quote) + quote.length,
  );
  await detail.getByRole('button', { name: 'Comment on selection', exact: true }).click();
  await input.fill('Keep this draft after another reviewer edits the text.');
  const latest = 'Latest: ' + revised;
  await page.evaluate(
    async ({ title, content }) => {
      const stateResponse = await fetch('/api/state');
      const state = await stateResponse.json();
      const record = state.cases.find((item: { title: string }) => item.title === title);
      const response = await fetch('/api/cases/' + record.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record, content }),
      });
      if (!response.ok) throw new Error('Concurrent edit failed');
    },
    { title, content: latest },
  );
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(
    composer.getByText('Document changed. Select the passage again.', { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('Keep this draft after another reviewer edits the text.');
  await expect(composer.getByRole('button', { name: 'Post comment', exact: true })).toBeDisabled();
  await selectDocumentText(
    document,
    latest.lastIndexOf(quote),
    latest.lastIndexOf(quote) + quote.length,
  );
  await detail.getByRole('button', { name: 'Use selected text', exact: true }).click();
  await expect(input).toHaveValue('Keep this draft after another reviewer edits the text.');
  await page.setViewportSize({ width: 390, height: 844 });
  await composer.scrollIntoViewIfNeeded();
  expect((await detail.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('text-comment-mobile.png'),
    animations: 'disabled',
  });
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(composer).not.toBeVisible();
  await expect(document.locator('mark')).toHaveText(quote);
});
