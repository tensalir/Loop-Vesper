import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { KitSchema, type Kit } from '../src/lib/creative/kit-schema'
import { FEEDBACK_MARKER, FeedbackRefused, renderFeedback, type FeedbackFields, type Reporter } from '../src/lib/feedback/render'
import { PreviewInvalid, signPreview, verifyPreview, PREVIEW_TTL_MS } from '../src/lib/feedback/preview-token'
import { memoryFeedbackStore } from '../src/lib/feedback/store'
import { SECRET_PATTERNS, findSecret, neutralise } from '../src/lib/feedback/text'
import {
  LIMITS,
  blockOf,
  listFeedback,
  listTargets,
  previewFeedback,
  similarity,
  submitFeedback,
  triageAnswer,
  type FeedbackDeps,
} from '../src/lib/feedback/service'
import type { FeedbackGithub, GhIssue } from '../src/lib/feedback/github-issues'

/**
 * Feedback from Claude to the plugin's repository, end to end without a network.
 *
 * The golden issue (tests/fixtures/feedback/golden-issue.md) is what Vesper files for a fixed
 * remark. When the plugin's repository sits beside this one (or LOOP_ASSET_REVIEWER_DIR names it),
 * its own triage gate reads that issue and must call it verified: the two repositories agree on the
 * marker, the data block and the schema. UPDATE_GOLDEN=1 rewrites the golden file.
 */

const FIX = join(__dirname, 'fixtures')
const kit: Kit = KitSchema.parse(JSON.parse(readFileSync(join(FIX, 'creative', 'kit.v1.sample.json'), 'utf8')))
const SCHEMA = JSON.parse(readFileSync(join(FIX, 'feedback', 'feedback-issue.schema.json'), 'utf8'))
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const SECRET = 'test-secret-for-feedback-previews-0123456789'
const NOW = new Date('2026-09-24T10:00:00.000Z')
const BOT = 'vesper-loop[bot]'
const ZW = String.fromCharCode(0x200b)

const reporter: Reporter = { profileId: '11111111-1111-4111-8111-111111111111', name: 'Test Designer', email: 'designer@loop.example' }
const someoneElse: Reporter = { profileId: '22222222-2222-4222-8222-222222222222', name: 'Other', email: 'other@loop.example' }

const remark: FeedbackFields = {
  target: 'eclipse',
  kind: 'remark',
  words: 'The grade passed a Plum draw with the strap on the ear. @someone look at #12 <!-- not a marker -->',
  what_should_have_happened: 'B3 should have failed it.',
  links: ['https://loop.frontify.com/document/1#/assets/42'],
  claudes_reading: 'Looks like B3, the strap position.',
  check: 'B3',
  check_confirmed: true,
  output_id: 'out-123',
  surface: 'chat',
  mode: 'issue',
}

interface Call {
  op: string
  args: unknown[]
}

function fakeGithub(opts: { issues?: GhIssue[]; comments?: Record<number, Array<{ id: number; body: string; user_login: string; created_at: string }>>; labelsFail?: number } = {}) {
  const calls: Call[] = []
  let next = 100
  let labelFailures = opts.labelsFail ?? 0
  const gh: FeedbackGithub = {
    repo: 'tensalir/loop-asset-reviewer',
    async listIssues(q) {
      calls.push({ op: 'listIssues', args: [q] })
      return (opts.issues ?? []).filter((i) => q.labels.every((l) => i.labels.includes(l)) && (q.state === 'all' || i.state === q.state))
    },
    async searchIssues(q, n) {
      calls.push({ op: 'searchIssues', args: [q, n] })
      return opts.issues ?? []
    },
    async getIssue(n) {
      calls.push({ op: 'getIssue', args: [n] })
      return (opts.issues ?? []).find((i) => i.number === n) ?? null
    },
    async listComments(n) {
      calls.push({ op: 'listComments', args: [n] })
      return opts.comments?.[n] ?? []
    },
    async createIssue(title, body) {
      calls.push({ op: 'createIssue', args: [title, body] })
      const n = next++
      return { number: n, title, state: 'open', body, labels: [], created_at: NOW.toISOString(), updated_at: NOW.toISOString(), html_url: `https://github.com/x/${n}`, is_pull_request: false }
    },
    async addLabels(n, labels) {
      calls.push({ op: 'addLabels', args: [n, labels] })
      if (labelFailures > 0) {
        labelFailures -= 1
        throw new Error('422 label does not exist')
      }
    },
    async createLabel(name) {
      calls.push({ op: 'createLabel', args: [name] })
    },
    async createComment(n, body) {
      calls.push({ op: 'createComment', args: [n, body] })
      return { id: 5000 + n, html_url: `https://github.com/x/${n}#c` }
    },
  }
  return { gh, calls }
}

function deps(over: Partial<FeedbackDeps> = {}, clock: { now: Date } = { now: NOW }): FeedbackDeps {
  return {
    loaded: { kit, commit: COMMIT },
    github: fakeGithub().gh,
    store: memoryFeedbackStore(),
    reporter,
    credentialId: '33333333-3333-4333-8333-333333333333',
    secret: SECRET,
    submitEnabled: true,
    now: () => clock.now,
    ...over,
  }
}

function issue(n: number, title: string, labels: string[], body = '', state: 'open' | 'closed' = 'open'): GhIssue {
  return { number: n, title, state, body, labels, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), html_url: `https://github.com/x/${n}`, is_pull_request: false }
}

/** The schema's own rules, checked by hand (the Python gate runs the full validator). */
function schemaProblems(block: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const key of SCHEMA.required as string[]) if (!(key in block)) problems.push(`missing ${key}`)
  for (const key of Object.keys(block)) if (!(key in SCHEMA.properties)) problems.push(`extra ${key}`)
  for (const [key, spec] of Object.entries(SCHEMA.properties as Record<string, { enum?: unknown[]; pattern?: string; const?: unknown }>)) {
    const v = block[key]
    if (v === undefined || v === null) continue
    if (spec.enum && !spec.enum.includes(v)) problems.push(`${key} not in enum`)
    if (spec.const !== undefined && v !== spec.const) problems.push(`${key} not ${String(spec.const)}`)
    if (spec.pattern && typeof v === 'string' && !new RegExp(spec.pattern).test(v)) problems.push(`${key} fails ${spec.pattern}`)
  }
  const email = (block.reporter as { email?: string })?.email ?? ''
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) problems.push('reporter.email')
  return problems
}

const PINNED = { askedAt: NOW.toISOString(), kitCommit: COMMIT, pluginVersion: '0.2.0' }

test.describe('the issue Vesper files', () => {
  test('the golden issue: title, labels from the kit, sections, one marker, a block the schema accepts', () => {
    const r = renderFeedback(kit, remark, reporter, PINNED)
    // cut at 80 characters on a word, after neutralising: the colleague's @name and #12 cannot mention or link
    expect(r.title).toBe(`[feedback] eclipse: The grade passed a Plum draw with the strap on the ear. @${ZW}someone look at #${ZW}12…`)
    expect(r.labels).toEqual(['feedback', 'kind:remark', 'skill:eclipse', 'triage:new'])
    expect(r.body.split(FEEDBACK_MARKER).length).toBe(2) // the colleague's `<!--` is not a marker
    expect(r.body).toContain('### Reported by\nTest Designer designer@loop.example via Vesper')
    expect(r.body).toContain('Check: B3')
    expect(r.block.check).toBe('B3')
    expect(r.block.words).toBe(remark.words) // verbatim in the data
    expect(schemaProblems(r.block)).toEqual([])
    const file = join(FIX, 'feedback', 'golden-issue.md')
    const golden = `${r.title}\n\n${r.body}`
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, golden)
    expect(golden).toBe(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    expect(blockOf(r.body)).toEqual(r.block)
  })

  test('a colleague\'s text cannot mention, link, plant a marker, add a heading or open a fence', () => {
    const n = neutralise('@dev #42 <!-- x --> \n### Fake section\n```\ncode\u0007')
    expect(n).not.toMatch(/@dev/)
    expect(n).not.toMatch(/#42/)
    expect(n).not.toContain('<!--')
    expect(n).not.toContain('-->')
    expect(n).not.toMatch(/^### /m)
    expect(n).not.toContain('```')
    expect(n).not.toContain('\u0007')
    const r = renderFeedback(kit, { ...remark, words: 'x\n### Where\n- Plugin: fake\n```json\n{}\n```' }, reporter, PINNED)
    expect(r.body.match(/^### Where$/gm)?.length).toBe(1)
    expect(r.body.match(/^```json$/gm)?.length).toBe(1)
  })

  test('a check the rubric does not have is refused; an unconfirmed one stays out of the block', () => {
    expect(() => renderFeedback(kit, { ...remark, check: 'B99' }, reporter, PINNED)).toThrow(FeedbackRefused)
    const r = renderFeedback(kit, { ...remark, check_confirmed: false }, reporter, PINNED)
    expect(r.block.check).toBeNull()
    expect(r.body).toContain('not yet confirmed by the reporter')
    expect(() => renderFeedback(kit, { ...remark, target: 'dream' }, reporter, PINNED)).toThrow("'dream' is not something")
  })

  test('comment mode joins an earlier issue: no title, no labels, joins set', () => {
    const r = renderFeedback(kit, { ...remark, mode: 'comment', issue_number: 12 }, reporter, PINNED)
    expect(r.title).toBeNull()
    expect(r.labels).toEqual([])
    expect(r.block.joins).toBe(12)
    expect(schemaProblems(r.block)).toEqual([])
  })

  test('the targets come from the kit, with each product\'s checks', () => {
    const view = listTargets(kit)
    expect(view.targets.map((t) => t.id).sort()).toEqual(kit.feedback.targets.map((t) => t.id).sort())
    const eclipse = view.targets.find((t) => t.id === 'eclipse')!
    expect(eclipse.checks.find((c) => c.id === 'B3')?.caption).toBeTruthy()
    expect(view.kinds).toEqual(['remark', 'bug', 'idea', 'question'])
  })
})

test.describe('secrets never reach an issue', () => {
  const samples: Record<string, string> = {
    'sk-ant-': 'sk-ant-api03-' + 'a'.repeat(30),
    'sk-': 'sk-proj-' + 'b'.repeat(30),
    ghp_: 'ghp_' + 'c'.repeat(36),
    github_pat_: 'github_pat_' + 'd'.repeat(30),
    AIza: 'AIza' + 'e'.repeat(35),
    jwt: 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4',
    vsp_: 'vsp_oat_' + 'f'.repeat(24),
    pem: '-----BEGIN RSA PRIVATE KEY-----',
    AKIA: 'AKIA' + 'G'.repeat(16),
    xoxb: 'xoxb-' + '1'.repeat(12),
  }
  test('every pattern refuses the preview, naming the field and never the value', async () => {
    expect(Object.keys(samples).length).toBe(SECRET_PATTERNS.length)
    for (const [name, value] of Object.entries(samples)) {
      const err = await previewFeedback({ ...remark, example: `see ${value}` }, deps()).then(
        () => null,
        (e: Error) => e
      )
      expect(err, name).toBeInstanceOf(FeedbackRefused)
      expect(err!.message).toContain("'example'")
      expect(err!.message).not.toContain(value)
    }
  })
  test('a Frontify asset id, a URL and ordinary words are not secrets', () => {
    expect(
      findSecret({
        words: 'asset eyJpZGVudGlmaWVyIjozMTgxLCJ0eXBlIjoiYXNzZXQifQ== looks wrong; the key light is too warm',
        links: ['https://loop.frontify.com/document/1#/assets/eyJpZGVudGlmaWVyIjozMTgxfQ=='],
      })
    ).toBeNull()
  })
})

test.describe('preview and submit', () => {
  test('files exactly the preview: the issue first, then the labels, once', async () => {
    const { gh, calls } = fakeGithub()
    const d = deps({ github: gh })
    const p = await previewFeedback(remark, d)
    expect(p.preview_id).toContain('.')
    expect(calls.map((c) => c.op)).toEqual(['listIssues']) // duplicates checked, nothing filed
    const s = await submitFeedback(remark, p.preview_id, d)
    expect(s).toMatchObject({ mode: 'issue', issue_number: 100, labels: 'added', already_filed: false })
    expect(calls.map((c) => c.op)).toEqual(['listIssues', 'createIssue', 'addLabels'])
    expect(calls[1].args).toEqual([p.rendered.title, p.rendered.body]) // no labels on create
    expect(calls[2].args).toEqual([100, ['feedback', 'kind:remark', 'skill:eclipse', 'triage:new']])
    const again = await submitFeedback(remark, p.preview_id, d)
    expect(again).toMatchObject({ issue_number: 100, already_filed: true })
    expect(calls.filter((c) => c.op === 'createIssue').length).toBe(1)
  })

  test('changed text, a changed or expired preview id, or another person files nothing', async () => {
    const clock = { now: NOW }
    const { gh, calls } = fakeGithub()
    const d = deps({ github: gh }, clock)
    const p = await previewFeedback(remark, d)
    await expect(submitFeedback({ ...remark, words: remark.words + '!' }, p.preview_id, d)).rejects.toThrow('The text changed since the preview')
    const tampered = p.preview_id.slice(0, -2) + (p.preview_id.endsWith('AA') ? 'BB' : 'AA')
    await expect(submitFeedback(remark, tampered, d)).rejects.toThrow(PreviewInvalid)
    await expect(submitFeedback(remark, p.preview_id, deps({ github: gh, reporter: someoneElse }, clock))).rejects.toThrow('someone else')
    clock.now = new Date(NOW.getTime() + PREVIEW_TTL_MS + 1000)
    await expect(submitFeedback(remark, p.preview_id, d)).rejects.toThrow('more than 15 minutes old')
    expect(calls.some((c) => c.op === 'createIssue')).toBe(false)
  })

  test('labels that fail are created and tried again; still failing, the issue stays filed', async () => {
    const one = fakeGithub({ labelsFail: 1 })
    const d1 = deps({ github: one.gh })
    const s1 = await submitFeedback(remark, (await previewFeedback(remark, d1)).preview_id, d1)
    expect(s1.labels).toBe('added')
    expect(one.calls.map((c) => c.op)).toEqual(['listIssues', 'createIssue', 'addLabels', 'createLabel', 'createLabel', 'createLabel', 'createLabel', 'addLabels'])
    const two = fakeGithub({ labelsFail: 2 })
    const d2 = deps({ github: two.gh })
    const s2 = await submitFeedback(remark, (await previewFeedback(remark, d2)).preview_id, d2)
    expect(s2).toMatchObject({ labels: 'failed', issue_number: 100 })
  })

  test('comment mode joins a feedback issue, and only a feedback issue', async () => {
    const { gh, calls } = fakeGithub({ issues: [issue(12, '[feedback] eclipse: strap on the ear', ['feedback', 'skill:eclipse']), issue(13, 'A bug in the build', [])] })
    const d = deps({ github: gh })
    const joined = { ...remark, mode: 'comment' as const, issue_number: 12 }
    const p = await previewFeedback(joined, d)
    expect(p.rendered.block.joins).toBe(12)
    const s = await submitFeedback(joined, p.preview_id, d)
    expect(s).toMatchObject({ mode: 'comment', issue_number: 12, comment_id: 5012, labels: 'none' })
    expect(calls.map((c) => c.op)).toEqual(['getIssue', 'createComment']) // the join is checked at preview
    await expect(previewFeedback({ ...joined, issue_number: 13 }, d)).rejects.toThrow('not a feedback issue')
  })

  test('the limits: twenty previews an hour, five filed an hour', async () => {
    const d = deps({ github: fakeGithub().gh })
    for (let i = 0; i < LIMITS.previewsPerHour; i++) await previewFeedback({ ...remark, words: `remark number ${i}` }, d)
    await expect(previewFeedback({ ...remark, words: 'one more' }, d)).rejects.toThrow('previews in the last hour')
    const d2 = deps({ github: fakeGithub().gh })
    for (let i = 0; i < LIMITS.filedPerHour; i++) {
      const f = { ...remark, words: `filed number ${i}` }
      await submitFeedback(f, (await previewFeedback(f, d2)).preview_id, d2)
    }
    const f = { ...remark, words: 'filed one too many' }
    await expect(submitFeedback(f, (await previewFeedback(f, d2)).preview_id, d2)).rejects.toThrow('the most Vesper files for one person')
  })

  test('filing switched off, no signed-in person, or no signing secret: nothing is filed', async () => {
    const p = await previewFeedback(remark, deps())
    await expect(submitFeedback(remark, p.preview_id, deps({ submitEnabled: false }))).rejects.toThrow('switched off')
    await expect(previewFeedback(remark, deps({ reporter: null }))).rejects.toThrow('does not know who you are')
    await expect(previewFeedback(remark, deps({ secret: undefined }))).rejects.toThrow('FEEDBACK_HMAC_SECRET')
    await expect(previewFeedback(remark, deps({ github: null }))).resolves.toMatchObject({ duplicates_checked: false })
  })

  test('the same remark filed earlier comes back as a possible duplicate', async () => {
    const earlier = issue(7, '[feedback] eclipse: the grade passed a Plum draw with the strap on the ear', ['feedback', 'skill:eclipse'])
    const d = deps({ github: fakeGithub({ issues: [earlier, issue(8, '[feedback] eclipse: teal too blue', ['feedback', 'skill:eclipse'])] }).gh })
    const p = await previewFeedback(remark, d)
    expect(p.possible_duplicates.map((x) => x.number)).toEqual([7])
    expect(similarity('strap on the ear', 'the strap sits on the ear')).toBeGreaterThan(0.5)
  })

  test('a preview id signs what the preview fixed, for this person, for fifteen minutes', () => {
    const t = signPreview(SECRET, { h: 'abc', r: reporter.profileId, e: NOW.getTime() + 1000, t: PINNED.askedAt, k: COMMIT, v: '0.2.0' })
    expect(verifyPreview(SECRET, t, reporter.profileId, NOW.getTime()).h).toBe('abc')
    expect(() => verifyPreview('another-secret-another-secret', t, reporter.profileId, NOW.getTime())).toThrow(PreviewInvalid)
  })
})

test.describe('reading what was filed', () => {
  test('issues with the first lines of the triage\'s latest answer; pull requests left out; mine filters', async () => {
    const mine = renderFeedback(kit, remark, reporter, PINNED)
    const theirs = renderFeedback(kit, { ...remark, words: 'another remark' }, someoneElse, PINNED)
    const pr = { ...issue(9, 'a pull request', ['feedback']), is_pull_request: true }
    const { gh } = fakeGithub({
      issues: [issue(5, mine.title!, ['feedback', 'skill:eclipse', 'triage:heard-once'], mine.body), issue(6, theirs.title!, ['feedback', 'skill:eclipse'], theirs.body), pr],
      comments: {
        5: [
          { id: 1, body: `Old answer\n\n<!-- triage:5:issue -->`, user_login: 'github-actions[bot]', created_at: '2026-09-24T10:01:00Z' },
          { id: 2, body: `Heard once. It reads as B3.\nNothing changes yet.\n\n<!-- triage:5:comment-9 -->`, user_login: 'github-actions[bot]', created_at: '2026-09-24T10:05:00Z' },
          { id: 3, body: 'a person says hi', user_login: 'someone', created_at: '2026-09-24T10:09:00Z' },
        ],
      },
    })
    const all = await listFeedback({ target: 'eclipse', state: 'open' }, deps({ github: gh }))
    expect(all.issues.map((i) => i.number)).toEqual([5, 6])
    expect(all.issues[0].triage_answer).toEqual(['Heard once. It reads as B3.', 'Nothing changes yet.'])
    expect(all.issues[0].triage).toEqual(['triage:heard-once'])
    expect(all.issues[1].triage_answer).toBeNull()
    const onlyMine = await listFeedback({ state: 'open', mine: true }, deps({ github: gh }))
    expect(onlyMine.issues.map((i) => i.number)).toEqual([5])
    expect(triageAnswer([])).toBeNull()
  })
})

// ------------------------------------------------------------------ the plugin's own gate

const PLUGIN_DIR =
  process.env.LOOP_ASSET_REVIEWER_DIR || join(__dirname, '..', '..', '..', 'loop-asset-reviewer-mother')
const GATE = join(PLUGIN_DIR, 'tools', 'feedback_triage.py')

function gate(event: object): { status: string; reason?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-gate-'))
  const eventPath = join(dir, 'event.json')
  writeFileSync(eventPath, JSON.stringify(event))
  const code =
    'import json, sys; sys.path.insert(0, "tools"); import feedback_triage as ft; ' +
    `ev = json.load(open(sys.argv[1], encoding="utf-8")); c = ft.classify(ev, ${JSON.stringify(BOT)}); ` +
    'print(json.dumps({"status": c["status"], "reason": c.get("reason")}))'
  const out = spawnSync(process.env.PYTHON || 'python', ['-c', code, eventPath], { cwd: PLUGIN_DIR, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (out.status !== 0) throw new Error(out.stderr)
  return JSON.parse(out.stdout.trim().split('\n').pop()!)
}

test.describe("the plugin's triage gate reads what Vesper files", () => {
  test.skip(!existsSync(GATE), `no plugin checkout at ${PLUGIN_DIR} (set LOOP_ASSET_REVIEWER_DIR)`)

  test('the golden issue and a joining comment are verified; the same text from a person is not', () => {
    const r = renderFeedback(kit, remark, reporter, PINNED)
    expect(gate({ action: 'opened', issue: { number: 200, title: r.title, body: r.body, user: { login: BOT }, created_at: NOW.toISOString(), labels: [] } })).toEqual({ status: 'verified', reason: null })
    const c = renderFeedback(kit, { ...remark, mode: 'comment', issue_number: 200 }, reporter, PINNED)
    expect(
      gate({ action: 'created', issue: { number: 200, title: r.title, body: r.body, user: { login: BOT } }, comment: { id: 9, body: c.body, user: { login: BOT }, created_at: NOW.toISOString() } })
    ).toEqual({ status: 'verified', reason: null })
    expect(gate({ action: 'opened', issue: { number: 201, title: r.title, body: r.body, user: { login: 'a-person' } } }).status).toBe('unverified')
  })
})
