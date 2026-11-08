import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bumpVersion, canSkip, planRelease } from './release.mjs'

const base = { version: '1.0.0', bump: 'patch', changedFiles: ['plugins/animate/skills/animate/SKILL.md'], subjects: ['Fix the storyboard check-in', 'chore: back-merge v1.0.0 into dev', 'chore: bump version to 1.0.0'] }

describe('bumpVersion', () => {
  it('bumps each part and resets the lower ones', () => {
    assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4')
    assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0')
    assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0')
  })
  it('rejects unknown input', () => {
    assert.throws(() => bumpVersion('1.2', 'patch'), /semver/)
    assert.throws(() => bumpVersion('1.2.3', 'huge'), /bump/)
  })
})

describe('canSkip', () => {
  it('skips tooling, CI and top-level docs only', () => {
    assert.equal(canSkip(['scripts/release.mjs', '.github/workflows/ci.yml', 'README.md']), true)
    assert.equal(canSkip(['README.md', 'plugins/animate/README.md']), false)
    assert.equal(canSkip(['docs/styles.png']), false)
  })
})

describe('planRelease', () => {
  it('skips when nothing changed or only tooling did', () => {
    assert.equal(planRelease({ ...base, changedFiles: [] }).skip, true)
    assert.equal(planRelease({ ...base, changedFiles: ['scripts/release.mjs'] }).skip, true)
  })

  it('plans the next version with the topics, without bot noise', () => {
    const plan = planRelease(base)
    assert.deepEqual({ skip: plan.skip, version: plan.version, tag: plan.tag, bumpMessage: plan.bumpMessage }, { skip: false, version: '1.0.1', tag: 'v1.0.1', bumpMessage: 'chore: bump version to 1.0.1' })
    assert.equal(plan.releaseMessage, 'release: v1.0.1\n\n- Fix the storyboard check-in')
  })

  it('honours the requested bump', () => {
    assert.equal(planRelease({ ...base, bump: 'minor' }).version, '1.1.0')
  })
})
