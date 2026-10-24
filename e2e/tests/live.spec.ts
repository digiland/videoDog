import { expect, test } from '@playwright/test';
import { API, signIn } from '../helpers';

/**
 * A creator schedules a pay-once live stream, gets OBS settings with the key, and viewers
 * find it under Coming up with its price (pre-buy). Publishing video itself is covered by
 * the live pipeline check in docs/DEPLOY.md (needs MediaMTX + ffmpeg).
 */
test('creator schedules a live stream that viewers can find and pre-buy', async ({ page }) => {
  const title = `Gospel night rehearsal ${Date.now().toString(36)}`;
  await signIn(page, { e164: '+263771100006', local: '0771100006' }, '/studio/live');
  await page.goto('/studio/live', { waitUntil: 'networkidle' });

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Category').selectOption('faith');
  await page.getByRole('radio', { name: /^Pay once/ }).check({ force: true });
  await page.getByLabel(/Price/).fill('1.00');
  const start = new Date(Date.now() + 2 * 86_400_000);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel('Starts (optional)').fill(local);
  await page.getByRole('button', { name: 'Create stream' }).click();

  await expect(page.getByText(`“${title}” is ready`)).toBeVisible();
  await expect(page.getByText('rtmp://', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Save this key now/)).toBeVisible();

  const upcoming = await (await fetch(`${API}/live?state=upcoming`)).json();
  const item = upcoming.items.find((v: { title: string }) => v.title === title);
  expect(item?.live?.state).toBe('scheduled');
  expect(item?.access_mode).toBe('ppv');

  // A viewer (signed out) gets the paywall for the upcoming stream: it can be bought ahead.
  await page.context().clearCookies();
  await page.goto(`/v/${item.id}`);
  await expect(page.getByRole('heading', { name: 'Unlock this video' })).toBeVisible();
});
