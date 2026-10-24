import { expect, test } from '@playwright/test';
import { API } from '../helpers';

const NICHES = [
  ['education', 'Education'],
  ['comedy', 'Comedy'],
  ['drama', 'Film & drama'],
  ['music', 'Music'],
  ['faith', 'Gospel & faith'],
  ['sports', 'Sports'],
  ['lifestyle', 'Lifestyle'],
] as const;

test.describe('browse every niche', () => {
  for (const [key, label] of NICHES) {
    test(`${label}: chip, videos and a course or playlist`, async ({ page }) => {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Filters' })
        .getByRole('link', { name: label })
        .click();
      await expect(page).toHaveURL(new RegExp(`category=${key}`));
      const videos = page.getByRole('list', { name: 'Videos' }).getByRole('article');
      await expect(videos.first()).toBeVisible();
      // Every card shows its price before the tap.
      await expect(
        videos
          .first()
          .getByText(/Free|Premium|\$\d/)
          .first(),
      ).toBeVisible();
      // The topic's courses/playlists shelf (home is cached ~60s, so check the shelf, not a title).
      const collections = await (await fetch(`${API}/collections?category=${key}`)).json();
      expect(collections.items.length).toBeGreaterThan(0);
      await expect(
        page
          .getByRole('region', { name: /Courses|collections/ })
          .getByRole('article')
          .first(),
      ).toBeVisible();
    });
  }

  test('search finds a channel, a course and videos', async ({ page }) => {
    await page.goto('/search?q=maths');
    await expect(
      page.getByRole('region', { name: 'Channels' }).getByText('Mr Moyo Maths'),
    ).toBeVisible();
    await expect(page.getByText('O-Level Maths: Paper 1 revision').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Videos' })).toBeVisible();
  });

  test('channel page lists videos and courses', async ({ page }) => {
    await page.goto('/c/mrmoyo_maths');
    await expect(page.getByRole('heading', { name: 'Mr Moyo Maths' })).toBeVisible();
    await page.getByRole('link', { name: 'Courses & playlists' }).click();
    await expect(page.getByText('O-Level Maths: Paper 1 revision')).toBeVisible();
  });
});
