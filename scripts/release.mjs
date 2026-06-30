#!/usr/bin/env node
// One-command release: bump the version everywhere, commit, tag, and push.
//
//   npm run release -- 0.6.5
//
// Bumps the version in package.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml, and src-tauri/Cargo.lock (kept in lockstep so they
// never drift), creates a "Bump version to vX.Y.Z" commit, tags it vX.Y.Z, and
// pushes the branch + tag. The pushed tag triggers .github/workflows/release.yml,
// which builds and publishes the installers and updates latest.json.
//
// Pass --no-push to do everything locally without pushing (review first).

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noPush = args.includes('--no-push');
const version = args.find((a) => !a.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run release -- <version> [--no-push]   (e.g. 0.6.5)');
  process.exit(1);
}
const tag = `v${version}`;

const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

// Refuse to run on a dirty tree so the release commit is exactly the bump.
const dirty = git('status --porcelain');
if (dirty) {
  console.error('Working tree is not clean. Commit or stash first:\n' + dirty);
  process.exit(1);
}

// Refuse to clobber an existing tag.
if (git('tag --list ' + tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

function bump(relPath, regex, replacement) {
  const p = join(root, relPath);
  const src = readFileSync(p, 'utf8');
  if (!regex.test(src)) {
    console.error(`Could not find a version to bump in ${relPath}`);
    process.exit(1);
  }
  writeFileSync(p, src.replace(regex, replacement));
}

// Each file gets a targeted edit so the diff stays clean. package-lock.json
// carries the version in two spots (root + the "" package entry), so it needs
// a global replace; the rest are single occurrences.
bump('package.json', /("version":\s*")[^"]+(")/, `$1${version}$2`);
bump('package-lock.json', /("name": "sidebar-notes",\r?\n\s*"version": ")[^"]+(")/g, `$1${version}$2`);
bump('src-tauri/tauri.conf.json', /("version":\s*")[^"]+(")/, `$1${version}$2`);
bump('src-tauri/Cargo.toml', /^version = "[^"]*"/m, `version = "${version}"`);
bump('src-tauri/Cargo.lock', /(name = "sidebar-notes"\r?\nversion = ")[^"]*(")/, `$1${version}$2`);

console.log(`Bumped to ${version}`);

run('git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock');
run(`git commit -m "Bump version to ${tag}"`);
run(`git tag -a ${tag} -m "${tag}"`);

if (noPush) {
  console.log(`\nCommitted and tagged ${tag} locally. Push when ready:`);
  console.log(`  git push --follow-tags`);
} else {
  run('git push --follow-tags');
  console.log(`\nPushed ${tag}. CI is now building the release.`);
}
