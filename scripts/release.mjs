// Release: squash `dev` onto `main` as `release: vX.Y.Z`, tag it, and back-merge into `dev`.
// `main` only ever receives these commits, so it is what plugin users install. Usage:
//   node scripts/release.mjs [--bump patch|minor|major] [--dry-run]
// The release commit is built with plumbing (tree of dev, parent origin/main), which is what a squash
// merge produces when main has no commits of its own, and needs no checkout of main.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const VERSION_FILE = 'plugins/animate/.claude-plugin/plugin.json'

const NOISE = /^(chore: back-merge|chore: bump version)/

/** Files that never justify a release on their own: release tooling, CI and top-level docs. */
export function canSkip(changedFiles) {
  return changedFiles.every((f) => f.startsWith('scripts/') || f.startsWith('.github/') || (!f.startsWith('plugins/') && f.endsWith('.md')))
}

export function bumpVersion(version, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`not a plain semver version: ${version}`)
  const [major, minor, patch] = m.slice(1).map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`bump must be patch, minor or major (got ${bump})`)
}

/**
 * Pure planning step.
 * `changedFiles` are the paths changed since the last release tag, `subjects` the commit subjects since then.
 * @param {{ version: string, bump?: string, changedFiles: string[], subjects: string[] }} input
 */
export function planRelease({ version, bump = 'patch', changedFiles, subjects }) {
  if (!changedFiles.length) return { skip: true, reason: 'no changes since the last release' }
  if (canSkip(changedFiles)) return { skip: true, reason: `only tooling or docs changed (${changedFiles.length})` }
  const next = bumpVersion(version, bump)
  const topics = [...new Set(subjects.filter((s) => !NOISE.test(s)))].slice(0, 40)
  const body = topics.map((s) => `- ${s}`).join('\n')
  return {
    skip: false,
    version: next,
    tag: `v${next}`,
    bumpMessage: `chore: bump version to ${next}`,
    releaseMessage: `release: v${next}\n\n${body}`.trimEnd(),
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function run(argv) {
  const dryRun = argv.includes('--dry-run')
  const bump = argv.includes('--bump') ? argv[argv.indexOf('--bump') + 1] : 'patch'
  git('fetch', 'origin', 'main', 'dev', '--tags', '--quiet')
  if (!dryRun) {
    if (git('status', '--porcelain')) throw new Error('working tree is not clean')
    try {
      git('merge-base', '--is-ancestor', 'origin/dev', 'HEAD')
    } catch {
      throw new Error('HEAD does not contain origin/dev; update first')
    }
  }
  let base
  try {
    base = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'origin/main')
  } catch {
    base = 'origin/main'
  }
  const changedFiles = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean)
  // main holds only release commits, so `base..HEAD` would list all of dev's history every time:
  // restrict the notes to commits made after the base release.
  const since = git('log', '-1', '--format=%cI', base)
  const subjects = git('log', '--no-merges', '--format=%s', `--since=${since}`, `${base}..HEAD`).split('\n').filter(Boolean)
  const manifest = JSON.parse(readFileSync(VERSION_FILE, 'utf8'))
  const plan = planRelease({ version: manifest.version, bump, changedFiles, subjects })
  if (plan.skip) return console.log(`No release: ${plan.reason}.`)
  console.log(`${dryRun ? 'Would release' : 'Releasing'} ${plan.tag} (${changedFiles.length} files changed since ${base})\n\n${plan.releaseMessage}`)
  if (dryRun) return

  manifest.version = plan.version
  writeFileSync(VERSION_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
  git('add', VERSION_FILE)
  git('commit', '-m', plan.bumpMessage)
  const release = git('commit-tree', 'HEAD^{tree}', '-p', 'origin/main', '-m', plan.releaseMessage)
  git('tag', plan.tag, release)
  git('push', 'origin', `${release}:refs/heads/main`, `refs/tags/${plan.tag}`)
  git('merge', '--no-ff', '-m', `chore: back-merge ${plan.tag} into dev`, release)
  git('push', 'origin', 'HEAD:refs/heads/dev')
  console.log(`Released ${plan.tag} (${release.slice(0, 7)}).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
