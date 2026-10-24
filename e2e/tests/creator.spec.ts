import { expect, test } from '@playwright/test';
import { API, signIn } from '../helpers';

/** A creator builds a course from their videos, publishes it, and viewers can find it. */
test('creator publishes a course with a section', async ({ page }) => {
  const title = `Stand-up masterclass ${Date.now().toString(36)}`;
  await signIn(page, { e164: '+263771100003', local: '0771100003' }, '/studio/collections');
  await page.goto('/studio/collections', { waitUntil: 'networkidle' });

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Category').selectOption('comedy');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.waitForURL(/\/studio\/collections\/[0-9a-f-]{36}/);

  await page.getByLabel('New section').fill('Writing jokes');
  await page.getByRole('button', { name: 'Add section' }).click();
  await expect(page.getByLabel('Section title')).toHaveValue('Writing jokes');
  await page.getByLabel('Add to').selectOption({ label: 'Writing jokes' });
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  await page.getByRole('button', { name: 'Move down' }).first().click();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published').first()).toBeVisible();

  // Viewers can open it (listings are cached for about a minute, so go via the View link).
  await page.getByRole('link', { name: 'View', exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Writing jokes' })).toBeVisible();
  const listed = await (await fetch(`${API}/collections?category=comedy&kind=course`)).json();
  expect(listed.items.map((c: { title: string }) => c.title)).toContain(title);
});
