import { expect, test } from '@playwright/test';
import { playlistVerdict } from '../helpers';

test('a course plays its free lesson end to end (HLS served)', async ({ page, request }) => {
  await page.goto('/courses?category=education');
  await page.getByRole('link', { name: 'O-Level Maths: Paper 1 revision' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'O-Level Maths: Paper 1 revision' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Algebra', exact: true })).toBeVisible();

  const start = page.getByRole('link', { name: 'Start the course' });
  const href = (await start.getAttribute('href')) ?? '';
  const videoId = href.match(/\/v\/([0-9a-f-]{36})/)?.[1] ?? '';
  const verdict = await playlistVerdict(page, videoId, () => start.click());

  // The first lesson is free: a playback grant, not a paywall.
  expect(verdict.access_denied).toBeUndefined();
  expect(verdict.kind).toBe('hls');
  await expect(page.locator('video')).toBeAttached();
  await expect(page.getByRole('region', { name: 'O-Level Maths: Paper 1 revision' })).toContainText(
    '1/7',
  );

  // The grant really streams: master → rendition → first segment.
  const master = await request.get(verdict.url as string);
  expect(master.ok()).toBeTruthy();
  const masterText = await master.text();
  expect(masterText).toContain('#EXTM3U');
  const rendition = masterText.split('\n').find((l) => l.trim() && !l.startsWith('#')) as string;
  const renditionUrl = new URL(rendition, verdict.url).toString();
  const playlist = await (await request.get(renditionUrl)).text();
  const segment = playlist.split('\n').find((l) => l.trim() && !l.startsWith('#')) as string;
  const seg = await request.get(new URL(segment, renditionUrl).toString());
  expect(seg.ok()).toBeTruthy();
  expect((await seg.body()).length).toBeGreaterThan(1000);
});
