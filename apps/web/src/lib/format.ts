export function formatMoney(amountMinor: number | string | bigint, currency: string): string {
  const major = Number(BigInt(amountMinor.toString())) / 100;
  const fmt = (n: number) =>
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  switch (currency) {
    case 'USD':
      return `$${fmt(major)}`;
    case 'ZWG':
      return `ZWG ${fmt(major)}`;
    case 'ZAR':
      return `R ${fmt(major)}`;
    case 'EUR':
      return `€${fmt(major)}`;
    case 'GBP':
      return `£${fmt(major)}`;
    default:
      return `${currency} ${fmt(major)}`;
  }
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
