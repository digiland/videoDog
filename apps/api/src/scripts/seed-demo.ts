/**
 * Demo catalogue for local dev, staging and screenshots: one or two fictional creators per
 * niche (education, comedy, drama, music, faith, sports, lifestyle), with courses,
 * playlists and a mix of free / pay-per-view / premium videos.
 *
 * Every video plays for real: one short clip is generated with ffmpeg, transcoded with the
 * production HLS ladder, and uploaded under each video's own keys. Displayed durations are
 * illustrative (the clip itself is short). Thumbnails are generated title cards. View
 * counts come from synthetic anonymous watch sessions with no minutes, so they never feed
 * the premium pool.
 *
 * Idempotent: a creator whose handle already exists is skipped.
 *
 * Usage: pnpm --filter api seed:demo   (needs Postgres, the buckets and ffmpeg)
 */
import { config } from 'dotenv';
import { resolve, join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { masterPlaylistKey, thumbnailKey, type ContentCategory } from '@streamzw/shared';
import * as schema from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { ladderFor, listFiles, transcodeToHls } from '../workers/transcode';

config({ path: resolve(__dirname, '..', '..', '..', '..', '.env') });

type Mode = 'free' | 'ppv' | 'premium' | 'premium_buyable';
interface V {
  title: string;
  description: string;
  minutes: number;
  mode: Mode;
  cents?: number;
}
interface Group {
  kind: 'course' | 'playlist';
  title: string;
  description: string;
  /** Course sections; a playlist has one unnamed list. */
  sections: { title: string | null; videos: V[] }[];
}
interface Creator {
  phone: string;
  handle: string;
  name: string;
  category: ContentCategory;
  colour: string;
  groups: Group[];
  singles: V[];
}

const free = (title: string, minutes: number, description: string): V => ({
  title,
  minutes,
  description,
  mode: 'free',
});
const ppv = (title: string, minutes: number, cents: number, description: string): V => ({
  title,
  minutes,
  description,
  mode: 'ppv',
  cents,
});
const premium = (title: string, minutes: number, description: string): V => ({
  title,
  minutes,
  description,
  mode: 'premium',
});
const buyable = (title: string, minutes: number, cents: number, description: string): V => ({
  title,
  minutes,
  description,
  mode: 'premium_buyable',
  cents,
});

const CREATORS: Creator[] = [
  {
    phone: '+263771100001',
    handle: 'mrmoyo_maths',
    name: 'Mr Moyo Maths',
    category: 'education',
    colour: '0x1f4e5f',
    groups: [
      {
        kind: 'course',
        title: 'O-Level Maths: Paper 1 revision',
        description:
          'The whole Paper 1 syllabus in short lessons, with worked past-paper questions. Start with the free lessons, then unlock the rest with Premium or one lesson at a time.',
        sections: [
          {
            title: 'Algebra',
            videos: [
              free('Algebra 1: Simplifying expressions', 14, 'Like terms, brackets and signs.'),
              buyable('Algebra 2: Simultaneous equations', 18, 50, 'Elimination and substitution.'),
              buyable('Algebra 3: Quadratics', 21, 50, 'Factorising and the formula.'),
            ],
          },
          {
            title: 'Geometry',
            videos: [
              free('Geometry 1: Angles and parallel lines', 12, 'The angle facts you must know.'),
              buyable('Geometry 2: Circle theorems', 19, 50, 'All eight theorems with examples.'),
            ],
          },
          {
            title: 'Past papers',
            videos: [
              ppv('November past paper, worked through', 42, 30, 'Every question, step by step.'),
              ppv('June past paper, worked through', 39, 30, 'Every question, step by step.'),
            ],
          },
        ],
      },
    ],
    singles: [free('How to revise maths in 4 weeks', 8, 'A plan you can stick to.')],
  },
  {
    phone: '+263771100002',
    handle: 'tendai_science',
    name: 'Science with Tendai',
    category: 'education',
    colour: '0x2d5a3d',
    groups: [
      {
        kind: 'course',
        title: 'Combined Science crash course',
        description: 'Biology, Chemistry and Physics for O-Level, one topic per lesson.',
        sections: [
          {
            title: 'Biology',
            videos: [
              free('Cells and microscopes', 11, 'Plant and animal cells.'),
              premium('Photosynthesis', 13, 'Light, chlorophyll and starch tests.'),
            ],
          },
          {
            title: 'Chemistry',
            videos: [
              premium('Acids, bases and salts', 15, 'Indicators and neutralisation.'),
              premium('The periodic table', 12, 'Groups, periods and trends.'),
            ],
          },
          {
            title: 'Physics',
            videos: [
              premium('Forces and motion', 16, 'Speed, velocity and acceleration.'),
              premium('Electricity basics', 14, 'Current, voltage and resistance.'),
            ],
          },
        ],
      },
    ],
    singles: [],
  },
  {
    phone: '+263771100003',
    handle: 'kopje_comedy',
    name: 'Kopje Comedy',
    category: 'comedy',
    colour: '0x8a3b12',
    groups: [
      {
        kind: 'playlist',
        title: 'Kombi Chronicles',
        description: 'Everything that happens between Mbare and Chitungwiza.',
        sections: [
          {
            title: null,
            videos: [
              free('Kombi Chronicles: The conductor', 4, 'Change? What change?'),
              free('Kombi Chronicles: The preacher', 5, 'Sermon on route 4.'),
              free('Kombi Chronicles: Rank marshal', 4, 'Nobody leaves until it is full.'),
              free('Kombi Chronicles: Rainy day', 6, 'One umbrella, twenty passengers.'),
            ],
          },
        ],
      },
    ],
    singles: [ppv('Live in Bulawayo: the full show', 58, 100, 'Our first full stand-up special.')],
  },
  {
    phone: '+263771100004',
    handle: 'sunset_films',
    name: 'Sunset Films ZW',
    category: 'drama',
    colour: '0x4a2a5c',
    groups: [
      {
        kind: 'playlist',
        title: 'Chiredzi Nights — season 1',
        description: 'A family drama set in the Lowveld sugar estates.',
        sections: [
          {
            title: null,
            videos: [
              free('Chiredzi Nights, episode 1', 24, 'The return.'),
              buyable('Chiredzi Nights, episode 2', 26, 50, 'Old debts.'),
              buyable('Chiredzi Nights, episode 3', 25, 50, 'The harvest.'),
            ],
          },
        ],
      },
    ],
    singles: [ppv('Mvura — a short film', 32, 150, 'Premiere: a drought, a well, two brothers.')],
  },
  {
    phone: '+263771100005',
    handle: 'highlands_sessions',
    name: 'Highlands Sessions',
    category: 'music',
    colour: '0x5c4a1f',
    groups: [
      {
        kind: 'playlist',
        title: 'Highlands Sessions: season 1',
        description: 'Live studio recordings with Harare musicians.',
        sections: [
          {
            title: null,
            videos: [
              premium('Session 1: jazz trio', 15, 'Standards and originals.'),
              premium('Session 2: mbira and guitar', 18, 'Old songs, new arrangements.'),
              premium('Session 3: sungura night', 21, 'Bring your dancing shoes.'),
            ],
          },
        ],
      },
    ],
    singles: [free('Official video: "Kumusha"', 4, 'Our new single.')],
  },
  {
    phone: '+263771100006',
    handle: 'grace_fellowship',
    name: 'Grace Fellowship Harare',
    category: 'faith',
    colour: '0x1f3a5c',
    groups: [
      {
        kind: 'playlist',
        title: 'Sunday sermons',
        description: 'Recorded every Sunday, posted the same evening.',
        sections: [
          {
            title: null,
            videos: [
              free('Sermon: Faith in dry seasons', 38, 'Pastor N. Dube.'),
              free('Sermon: Building on rock', 41, 'Pastor N. Dube.'),
              free('Sermon: Generosity', 35, 'Guest speaker.'),
            ],
          },
        ],
      },
    ],
    singles: [ppv('Gospel night 2026 (full concert)', 95, 50, 'Choirs from across Harare.')],
  },
  {
    phone: '+263771100007',
    handle: 'township_football',
    name: 'Township Football',
    category: 'sports',
    colour: '0x24572a',
    groups: [
      {
        kind: 'playlist',
        title: 'Weekend highlights',
        description: 'Every goal from the weekend’s community league games.',
        sections: [
          {
            title: null,
            videos: [
              free('Highlights: Mbare vs Highfield', 6, 'Five goals and a red card.'),
              free('Highlights: Sakubva derby', 7, 'Late winner.'),
              free('Highlights: Cup quarter-finals', 9, 'Four games, one video.'),
            ],
          },
        ],
      },
    ],
    singles: [premium('Season review: the title race', 28, 'How the league was won.')],
  },
  {
    phone: '+263771100008',
    handle: 'mai_rufaro_kitchen',
    name: "Mai Rufaro's Kitchen",
    category: 'lifestyle',
    colour: '0x7a2f2f',
    groups: [
      {
        kind: 'playlist',
        title: 'Cook like Mai Rufaro',
        description: 'Home cooking on a budget.',
        sections: [
          {
            title: null,
            videos: [
              free('Sadza, three ways', 9, 'Soft, firm and for the braai.'),
              free('Muriwo une dovi', 7, 'Greens in peanut butter.'),
              buyable('Sunday chicken stew', 12, 30, 'The family recipe.'),
            ],
          },
        ],
      },
    ],
    singles: [],
  },
];

function ffmpeg(args: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString()}`);
}

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

/** Wrap a title to lines of ~22 characters for the title card. */
function wrap(text: string, width = 22): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join('\n');
}

function titleCard(dir: string, out: string, title: string, by: string, colour: string) {
  const titleFile = join(dir, 'title.txt');
  const byFile = join(dir, 'by.txt');
  writeFileSync(titleFile, wrap(title));
  writeFileSync(byFile, by);
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=${colour}:s=640x360`,
    '-frames:v',
    '1',
    '-vf',
    [
      `drawtext=fontfile=${FONT}:textfile=${titleFile}:fontcolor=white:fontsize=34:line_spacing=8:x=36:y=(h-text_h)/2-12`,
      `drawtext=fontfile=${FONT}:textfile=${byFile}:fontcolor=white@0.75:fontsize=20:x=36:y=h-56`,
    ].join(','),
    '-q:v',
    '3',
    out,
  ]);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const storage = new StorageService();
  const work = mkdtempSync(join(tmpdir(), 'streamzw-demo-'));

  try {
    // One playable clip, transcoded once with the production ladder.
    const clip = join(work, 'clip.mp4');
    const label = join(work, 'label.txt');
    writeFileSync(label, 'StreamZW demo clip');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=25:duration=16',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:duration=16',
      '-vf',
      `drawtext=fontfile=${FONT}:textfile=${label}:fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:boxborderw=16:x=(w-text_w)/2:y=h-120`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      clip,
    ]);
    const hlsDir = join(work, 'hls');
    await transcodeToHls(clip, hlsDir, ladderFor(720), true);
    const hlsFiles = listFiles(hlsDir);

    let day = 0;
    for (const c of CREATORS) {
      const [existing] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.handle, c.handle))
        .limit(1);
      if (existing) {
        console.log(`skip   @${c.handle} (exists)`);
        continue;
      }
      const [creator] = await db
        .insert(schema.users)
        .values({
          phoneE164: c.phone,
          handle: c.handle,
          displayName: c.name,
          role: 'creator',
          kycState: 'phone_verified',
          canonicalPricingCurrency: 'USD',
          payoutMsisdn: c.phone,
        })
        .returning();

      const makeVideo = async (v: V) => {
        day += 1;
        const publishedAt = new Date(Date.now() - day * 9 * 3600 * 1000);
        const [row] = await db
          .insert(schema.videos)
          .values({
            ownerId: creator!.id,
            title: v.title,
            description: v.description,
            accessMode: v.mode,
            category: c.category,
            ppvPriceMinorUnits: v.cents ? String(v.cents) : null,
            ppvPriceCurrency: v.cents ? 'USD' : null,
            state: 'published',
            durationSeconds: v.minutes * 60,
            publishedAt,
          })
          .returning();
        const id = row!.id;
        for (const f of hlsFiles) {
          await storage.uploadFile(
            storage.videoBucketName,
            `videos/${id}/${f}`,
            join(hlsDir, f),
            f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
          );
        }
        const thumb = join(work, `${id}.jpg`);
        titleCard(work, thumb, v.title, c.name, c.colour);
        await storage.uploadFile(storage.thumbBucketName, thumbnailKey(id), thumb, 'image/jpeg');
        await db
          .update(schema.videos)
          .set({ hlsPlaylistKey: masterPlaylistKey(id), thumbnailKey: thumbnailKey(id) })
          .where(eq(schema.videos.id, id));
        const views = 20 + ((id.charCodeAt(0) * 37 + id.charCodeAt(1) * 11) % 900);
        await db.insert(schema.watchSessions).values(
          Array.from({ length: views }, () => ({
            videoId: id,
            userId: null,
            heartbeatCount: 2,
            ended: true,
            startedAt: publishedAt,
            lastHeartbeat: publishedAt,
          })),
        );
        return id;
      };

      for (const g of c.groups) {
        const [col] = await db
          .insert(schema.collections)
          .values({
            ownerId: creator!.id,
            kind: g.kind,
            category: c.category,
            title: g.title,
            description: g.description,
          })
          .returning();
        for (const [sPos, s] of g.sections.entries()) {
          const sectionId = s.title
            ? (
                await db
                  .insert(schema.collectionSections)
                  .values({ collectionId: col!.id, title: s.title, position: sPos })
                  .returning()
              )[0]!.id
            : null;
          for (const [iPos, v] of s.videos.entries()) {
            const videoId = await makeVideo(v);
            await db.insert(schema.collectionItems).values({
              collectionId: col!.id,
              ownerId: creator!.id,
              videoId,
              sectionId,
              position: iPos,
            });
          }
        }
        await db
          .update(schema.collections)
          .set({ state: 'published', publishedAt: new Date(Date.now() - day * 9 * 3600 * 1000) })
          .where(eq(schema.collections.id, col!.id));
      }
      for (const v of c.singles) await makeVideo(v);
      console.log(`seeded @${c.handle}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
