import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/index.ts',
  out: '../../infra/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://streamzw:streamzw@localhost:5432/streamzw',
  },
} satisfies Config;
