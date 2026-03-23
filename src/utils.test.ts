import { describe, test, expect } from 'vitest';
import {
  relativeTime,
  dateGroup,
  stripFrontmatter,
  parseFrontmatterColor,
  setFrontmatterColor,
} from './utils';

// ─── relativeTime ────────────────────────────────────────────────────────────

describe('relativeTime', () => {
  test('returns "just now" for timestamps < 60s ago', () => {
    expect(relativeTime(Date.now() - 3_000)).toBe('just now');
    expect(relativeTime(Date.now() - 59_000)).toBe('just now');
  });

  test('returns minutes for timestamps < 1h ago', () => {
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(relativeTime(Date.now() - 59 * 60_000)).toBe('59m ago');
  });

  test('returns hours for timestamps < 24h ago', () => {
    expect(relativeTime(Date.now() - 2 * 3600_000)).toBe('2h ago');
    expect(relativeTime(Date.now() - 23 * 3600_000)).toBe('23h ago');
  });

  test('returns days for timestamps < 7d ago', () => {
    expect(relativeTime(Date.now() - 3 * 86400_000)).toBe('3d ago');
  });

  test('returns formatted date for older timestamps', () => {
    // Jan 1 2024
    const old = new Date(2024, 0, 1).getTime();
    const result = relativeTime(old);
    expect(result).toContain('Jan');
    expect(result).toContain('1');
  });
});

// ─── dateGroup ───────────────────────────────────────────────────────────────

describe('dateGroup', () => {
  test('returns "Today" for current timestamp', () => {
    expect(dateGroup(Date.now())).toBe('Today');
  });

  test('returns "Yesterday" for yesterday', () => {
    const yesterday = Date.now() - 25 * 3600_000; // 25h ago to be safe
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday.getTime() - 86400_000;
    // Use a timestamp in the middle of yesterday
    expect(dateGroup(startOfYesterday + 12 * 3600_000)).toBe('Yesterday');
  });
});

// ─── stripFrontmatter ────────────────────────────────────────────────────────

describe('stripFrontmatter', () => {
  test('strips YAML frontmatter block', () => {
    const input = '---\ncolor: red\n---\nHello world';
    expect(stripFrontmatter(input)).toBe('Hello world');
  });

  test('returns content unchanged when no frontmatter', () => {
    expect(stripFrontmatter('Just text')).toBe('Just text');
  });

  test('handles empty frontmatter', () => {
    // Frontmatter needs at least one line between ---
    const input = '---\n \n---\nContent';
    expect(stripFrontmatter(input)).toBe('Content');
  });

  test('handles multi-field frontmatter', () => {
    const input = '---\ncolor: red\ntags: foo\n---\nBody';
    expect(stripFrontmatter(input)).toBe('Body');
  });

  test('does not strip --- that is not frontmatter', () => {
    const input = 'Some text\n---\nMore text';
    expect(stripFrontmatter(input)).toBe('Some text\n---\nMore text');
  });
});

// ─── parseFrontmatterColor ───────────────────────────────────────────────────

describe('parseFrontmatterColor', () => {
  test('extracts color from frontmatter', () => {
    expect(parseFrontmatterColor('---\ncolor: red\n---\nBody')).toBe('red');
    expect(parseFrontmatterColor('---\ncolor: purple\n---\nBody')).toBe('purple');
  });

  test('returns null when no frontmatter', () => {
    expect(parseFrontmatterColor('Just text')).toBeNull();
  });

  test('returns null when frontmatter has no color', () => {
    expect(parseFrontmatterColor('---\ntags: foo\n---\nBody')).toBeNull();
  });

  test('handles extra whitespace in color value', () => {
    expect(parseFrontmatterColor('---\ncolor:   blue  \n---\nBody')).toBe('blue');
  });

  test('extracts color among other fields', () => {
    expect(parseFrontmatterColor('---\ntags: foo\ncolor: green\ndate: today\n---\nBody')).toBe('green');
  });
});

// ─── setFrontmatterColor ─────────────────────────────────────────────────────

describe('setFrontmatterColor', () => {
  test('adds frontmatter with color to plain content', () => {
    expect(setFrontmatterColor('Hello', 'red')).toBe('---\ncolor: red\n---\nHello');
  });

  test('updates existing color in frontmatter', () => {
    const input = '---\ncolor: red\n---\nBody';
    expect(setFrontmatterColor(input, 'blue')).toBe('---\ncolor: blue\n---\nBody');
  });

  test('adds color to existing frontmatter without color', () => {
    const input = '---\ntags: foo\n---\nBody';
    const result = setFrontmatterColor(input, 'green');
    expect(result).toContain('color: green');
    expect(result).toContain('tags: foo');
    expect(result).toContain('Body');
  });

  test('removes color and keeps other fields', () => {
    const input = '---\ntags: foo\ncolor: red\n---\nBody';
    const result = setFrontmatterColor(input, null);
    expect(result).toContain('tags: foo');
    expect(result).not.toContain('color:');
    expect(result).toContain('Body');
  });

  test('removes entire frontmatter when color was the only field', () => {
    const input = '---\ncolor: red\n---\nBody';
    expect(setFrontmatterColor(input, null)).toBe('Body');
  });

  test('no-op when removing color from content without frontmatter', () => {
    expect(setFrontmatterColor('Hello', null)).toBe('Hello');
  });
});
