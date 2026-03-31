/** Themes that use a light background — used to pick githubLight vs githubDark CM theme
 *  and to detect system appearance. Keep in sync with SchemeSwitcher SCHEMES. */
export const LIGHT_THEMES = new Set([
  'light', 'catppuccin-latte', 'solarized-light', 'gruvbox-light', 'rose-pine-dawn',
  'ayu-light', 'everforest-light', 'one-light', 'tokyo-night-light',
]);

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

// ─── Frontmatter helpers ──────────────────────────────────────────────────────

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** Strip YAML frontmatter block from the start of content. */
export function stripFrontmatter(content: string): string {
  const m = content.match(FM_RE);
  return m ? content.slice(m[0].length) : content;
}

/** Extract the `color` value from YAML frontmatter, or null. */
export function parseFrontmatterColor(content: string): string | null {
  const m = content.match(FM_RE);
  if (!m) return null;
  const cm = m[1].match(/^color:\s*(.+)$/m);
  return cm ? cm[1].trim() : null;
}

/** Set (or remove) the `color` field in YAML frontmatter. */
export function setFrontmatterColor(content: string, color: string | null): string {
  const m = content.match(FM_RE);
  if (color === null) {
    // Remove color from frontmatter; remove block entirely if nothing else remains
    if (!m) return content;
    const others = m[1].split('\n').filter((l) => !l.startsWith('color:') && l.trim() !== '');
    if (others.length === 0) return content.slice(m[0].length);
    return `---\n${others.join('\n')}\n---\n${content.slice(m[0].length)}`;
  }
  if (m) {
    const lines = m[1].split('\n');
    const idx = lines.findIndex((l) => l.startsWith('color:'));
    if (idx >= 0) lines[idx] = `color: ${color}`;
    else lines.push(`color: ${color}`);
    return `---\n${lines.join('\n')}\n---\n${content.slice(m[0].length)}`;
  }
  return `---\ncolor: ${color}\n---\n${content}`;
}
