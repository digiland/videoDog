import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = ReturnType<typeof drizzle<typeof schema>>;
/** A Drizzle transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the pool or an open transaction. */
export type DbOrTx = Db | Tx;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is required');
        const client = postgres(url, { max: 10 });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
