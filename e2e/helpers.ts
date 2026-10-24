import { readFileSync, statSync } from 'node:fs';
import { type Page, expect } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:3001';
const API_LOG = process.env.E2E_API_LOG;

/** A fresh Zimbabwe mobile number, so every run is a brand-new viewer. */
export function freshPhone(): { e164: string; local: string } {
  const n = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  return { e164: `+26378${n}`, local: `078${n}` };
}

/** The latest dev-logged OTP for `phone` written after byte offset `from`. */
function readOtp(from: number, phone: string): string | undefined {
  const log = readFileSync(API_LOG as string)
    .subarray(from)
    .toString('utf8');
  return [...log.matchAll(/OTP\s+(\+\d+)\s+→\s+(\d{6})/g)]
    .filter((m) => m[1] === phone)
    .at(-1)?.[2];
}

/**
 * Sign in with phone + OTP. The API must run with DEV_LOG_OTP=true and its output in
 * E2E_API_LOG: the code is read from there, as a person would read WhatsApp.
 */
export async function signIn(page: Page, phone: { e164: string; local: string }, returnTo = '/') {
  if (!API_LOG) throw new Error('Set E2E_API_LOG to the API log file (DEV_LOG_OTP=true)');
  const from = statSync(API_LOG).size;
  await page.goto(`/sign-in?return_to=${encodeURIComponent(returnTo)}`, {
    waitUntil: 'networkidle',
  });
  await page.getByLabel('Phone number').fill(phone.local);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.waitForURL(/\/verify/);
  let code: string | undefined;
  await expect.poll(() => (code = readOtp(from, phone.e164)), { timeout: 15_000 }).toBeTruthy();
  await page.locator('#otp').fill(code as string);
  await page.waitForURL((u) => !u.pathname.startsWith('/verify'));
}

/**
 * Wait for the watch page to decide access. Returns the playlist response body: either a
 * playable grant `{ url, kind }` or `{ access_denied, paywall }`.
 */
export async function playlistVerdict(page: Page, videoId: string, open: () => Promise<unknown>) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/videos/${videoId}/playlist`) && r.ok()),
    open(),
  ]);
  return (await res.json()) as { url?: string; kind?: string; access_denied?: boolean };
}
