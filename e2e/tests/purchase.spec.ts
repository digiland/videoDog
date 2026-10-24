import { expect, test } from '@playwright/test';
import { API, freshPhone, playlistVerdict, signIn } from '../helpers';

/**
 * Pay-once lesson: paywall for a new viewer → sign in → EcoCash checkout → (dev) settle →
 * the lesson plays and shows up in the library. Needs DEV_SIMULATE_PAYMENTS=true on the
 * API and NEXT_PUBLIC_DEV_SIMULATE_PAYMENTS=true on the web app.
 */
test('buy a pay-once lesson and watch it', async ({ page }) => {
  const course = (
    await (await fetch(`${API}/collections?category=education&kind=course`)).json()
  ).items.find((c: { title: string }) => c.title.startsWith('O-Level Maths'));
  const detail = await (await fetch(`${API}/collections/${course.id}`)).json();
  const lesson = detail.sections
    .flatMap((s: { items: { video: { id: string; access_mode: string } }[] }) => s.items)
    .find((e: { video: { access_mode: string } }) => e.video.access_mode === 'ppv').video;

  const anon = await playlistVerdict(page, lesson.id, () => page.goto(`/v/${lesson.id}`));
  expect(anon.access_denied).toBe(true);
  await expect(page.getByRole('heading', { name: 'Unlock this video' })).toBeVisible();

  await signIn(page, freshPhone(), `/v/${lesson.id}`);
  await expect(page).toHaveURL(new RegExp(`/v/${lesson.id}`));
  await page.getByRole('link', { name: 'Buy' }).click();
  await page.waitForURL(/\/purchase\//);
  await page.getByRole('button', { name: /Pay .*with EcoCash/ }).click();
  await page.getByRole('button', { name: 'Simulate success' }).click();
  await expect(page.getByText('Paid').first()).toBeVisible();

  const after = await playlistVerdict(page, lesson.id, () => page.goto(`/v/${lesson.id}`));
  expect(after.access_denied).toBeUndefined();
  expect(after.url).toBeTruthy();
  await expect(page.locator('video')).toBeAttached();

  await page.goto('/library');
  await expect(
    page
      .getByRole('region', { name: 'Purchased' })
      .getByText(lesson.title ?? 'past paper')
      .first(),
  ).toBeVisible();
});
