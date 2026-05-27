/**
 * Seed test videos for local dev.
 *
 * Inserts ~6 published video rows owned by `demo_creator` (+263771000002) with
 * publicly hosted MP4 URLs as the playlist target and image-CDN URLs as the
 * thumbnail. The API now passes full HTTPS URLs through both endpoints, and
 * the Player falls back to native HTML5 playback when the URL isn't .m3u8 —
 * so these tiles are immediately playable without our transcode pipeline
 * being wired up.
 *
 * The sample MP4s are CC-licensed public test files; thumbnails come from
 * Pexels' public photo CDN (no auth needed for direct image GETs).
 *
 * Usage: pnpm --filter api seed:videos
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';

interface Sample {
  title: string;
  description: string;
  duration_seconds: number;
  access_mode: 'free' | 'ppv' | 'premium' | 'premium_buyable';
  ppv_price_minor_units?: number;
  ppv_price_currency?: string;
  hls_playlist_key: string; // full https URL or storage key
  thumbnail_key: string; // full https URL or storage key
}

const SAMPLES: Sample[] = [
  {
    title: 'Sunrise over Lake Kariba',
    description:
      'A slow drift across the lake as morning light crosses the water — shot on a calm Sunday.',
    duration_seconds: 596,
    access_mode: 'free',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/1133957/pexels-photo-1133957.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  {
    title: 'Mbare Market, 5am',
    description:
      'Before the rush. Forklifts unload tomatoes by the crate while vendors set up under the floodlights.',
    duration_seconds: 653,
    access_mode: 'free',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/375889/pexels-photo-375889.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  {
    title: 'Highlands Sessions · Episode 1',
    description: 'Studio recording with a Harare jazz trio. First episode of an ongoing series.',
    duration_seconds: 888,
    access_mode: 'premium',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/164693/pexels-photo-164693.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  {
    title: 'Victoria Falls in 4K',
    description: 'Twelve minutes of the falls at full flow, captured in October.',
    duration_seconds: 720,
    access_mode: 'ppv',
    ppv_price_minor_units: 99,
    ppv_price_currency: 'USD',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/2104882/pexels-photo-2104882.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  {
    title: 'Bulawayo by Tram',
    description: 'A short city portrait. Original music by the creator.',
    duration_seconds: 420,
    access_mode: 'premium_buyable',
    ppv_price_minor_units: 149,
    ppv_price_currency: 'USD',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/240526/pexels-photo-240526.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  {
    title: 'Workshop · Animating in Blender',
    description: 'A 14-minute walkthrough of a complete short. Practical pacing, no fluff.',
    duration_seconds: 888,
    access_mode: 'free',
    hls_playlist_key:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    thumbnail_key:
      'https://images.pexels.com/photos/1779487/pexels-photo-1779487.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  // Resolve demo_creator
  const [creator] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.phoneE164, '+263771000002'))
    .limit(1);
  if (!creator) {
    console.error('demo_creator (+263771000002) not found. Run `pnpm --filter api seed` first.');
    process.exit(1);
  }
  console.log(`creator: ${creator.id} (${creator.handle})`);

  // Wipe existing test videos so re-runs are idempotent
  const deleted = await db
    .delete(schema.videos)
    .where(eq(schema.videos.ownerId, creator.id))
    .returning({ id: schema.videos.id });
  if (deleted.length) console.log(`removed ${deleted.length} prior video(s) for this creator`);

  const now = new Date();
  for (const s of SAMPLES) {
    await db.insert(schema.videos).values({
      ownerId: creator.id,
      title: s.title,
      description: s.description,
      accessMode: s.access_mode,
      ppvPriceMinorUnits: s.ppv_price_minor_units != null ? String(s.ppv_price_minor_units) : null,
      ppvPriceCurrency: s.ppv_price_currency ?? null,
      state: 'published',
      durationSeconds: s.duration_seconds,
      hlsPlaylistKey: s.hls_playlist_key,
      thumbnailKey: s.thumbnail_key,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`+ ${s.access_mode.padEnd(15)}  ${s.title}`);
  }

  await client.end();
  console.log(`\nseeded ${SAMPLES.length} videos. Visit http://localhost:3030 to browse.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
