export function relativeTime(unixMs: number): string {
  const diff = Math.floor((Date.now() - unixMs) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(unixMs);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dateGroup(unixMs: number): string {
  const now = new Date();
  const d = new Date(unixMs);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400_000;
  const startOfWeek = startOfToday - now.getDay() * 86400_000;
  const ts = d.getTime();

  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'This Week';
  if (ts >= startOfWeek - 7 * 86400_000) return 'Last Week';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
