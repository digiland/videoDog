import { Money } from '@streamzw/shared';

export default function HomePage() {
  const usd = Money.of(149n, 'USD');
  const zwg = Money.of(4470n, 'ZWG');
  const zar = Money.of(2780n, 'ZAR');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">StreamZW</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Creator-led video platform for Zimbabwe. Multi-currency from day one.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm">
        <div className="font-mono text-xs uppercase tracking-wider text-neutral-500">
          @streamzw/shared · Money
        </div>
        <div className="mt-3 flex items-center gap-4 font-mono">
          <span>{usd.format()}</span>
          <span className="text-neutral-700">·</span>
          <span>{zwg.format()}</span>
          <span className="text-neutral-700">·</span>
          <span>{zar.format()}</span>
        </div>
      </div>

      <div className="text-xs text-neutral-600">
        M1 — Scaffold. API at <span className="font-mono">:3001</span>.
      </div>
    </main>
  );
}
