import { expect, test, type Page } from '@playwright/test';

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
  await citation.locator('summary').first().click();
  await expect(citation.locator('p').first()).not.toBeEmpty();
  await expect(page.getByRole('button', { name: 'Send question', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Select advisor skill' }).selectOption('food');
  await page
    .getByRole('textbox', { name: 'Your question for the advisor' })
    .fill('Which SFA licensing route applies to fresh produce?');
  await page.getByRole('textbox', { name: 'Your question for the advisor' }).press('Enter');
  await expect(page.locator('.chat-message.assistant')).toHaveCount(initialAnswers + 2);
  await expect(page.locator('.chat-message.assistant').last()).toContainText(
    'Food & fresh produce',
  );
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
