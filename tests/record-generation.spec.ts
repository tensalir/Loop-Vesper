import { test, expect } from '@playwright/test'
import {
  recordMcpGeneration,
  CLAUDE_PROJECT_KEY,
  STREAM_SESSIONS,
  type GenerationRecordStore,
} from '../src/lib/headless/record-generation'

/** MCP draws are written into the owner's "Claude" project so the web app shows them. */

class FakeStore implements GenerationRecordStore {
  projects: Array<{ id: string; ownerId: string; key: string; name: string }> = []
  sessions: Array<{ id: string; projectId: string; name: string; type: string }> = []
  generations: Array<Record<string, unknown>> = []
  outputs: Array<Record<string, unknown>> = []
  analyses: string[] = []
  raceOnCreate = false
  failAnalyses = false

  async findSystemProject(ownerId: string, key: string) {
    return this.projects.find((p) => p.ownerId === ownerId && p.key === key) ?? null
  }
  async createSystemProject(input: { ownerId: string; key: string; name: string; description: string }) {
    if (this.raceOnCreate) {
      // Another request created it between our find and our create.
      this.projects.push({ id: 'p-raced', ownerId: input.ownerId, key: input.key, name: input.name })
      return null
    }
    const row = { id: `p-${this.projects.length + 1}`, ownerId: input.ownerId, key: input.key, name: input.name }
    this.projects.push(row)
    return { id: row.id }
  }
  async findSession(projectId: string, name: string, type: string) {
    return this.sessions.find((s) => s.projectId === projectId && s.name === name && s.type === type) ?? null
  }
  async createSession(input: { projectId: string; name: string; type: string }) {
    const row = { id: `s-${this.sessions.length + 1}`, ...input }
    this.sessions.push(row)
    return { id: row.id }
  }
  async writeGeneration(input: Parameters<GenerationRecordStore['writeGeneration']>[0]) {
    this.generations.push(input.generation)
    this.outputs.push(...input.outputs)
  }
  async enqueueAnalyses(ids: string[]) {
    if (this.failAnalyses) throw new Error('analysis table busy')
    this.analyses.push(...ids)
  }
}

const base = {
  ownerId: 'owner-1',
  generationId: 'gen-1',
  modelId: 'gemini-nano-banana-pro',
  prompt: 'a chair',
  parameters: { toolName: 'generate_asset' },
  outputs: [
    { url: 'https://abcd.supabase.co/a.png', width: 2048, height: 2048 },
    { url: 'https://abcd.supabase.co/b.png', width: 2048, height: 2048 },
  ],
  costUsd: 0.268,
}

test('first draw creates the Claude project and the stream session, private', async () => {
  const store = new FakeStore()
  const res = await recordMcpGeneration({ ...base, stream: 'free' }, store)
  expect(store.projects).toHaveLength(1)
  expect(store.projects[0].key).toBe(CLAUDE_PROJECT_KEY)
  expect(store.projects[0].name).toBe('Claude')
  expect(store.sessions[0].name).toBe(STREAM_SESSIONS.free.name)
  expect(store.sessions[0].type).toBe('image')
  expect(res.outputIds).toHaveLength(2)
  expect(store.outputs.map((o) => o.fileType)).toEqual(['image', 'image'])
  expect(store.generations[0].parameters).toMatchObject({ source: 'mcp', toolName: 'generate_asset' })
  expect(store.generations[0].id).toBe('gen-1')
  expect(store.analyses).toEqual(res.outputIds)
})

test('later draws reuse the project and the session; other streams get their own session', async () => {
  const store = new FakeStore()
  await recordMcpGeneration({ ...base, stream: 'free' }, store)
  await recordMcpGeneration({ ...base, generationId: 'gen-2', stream: 'free' }, store)
  await recordMcpGeneration({ ...base, generationId: 'gen-3', stream: 'video' }, store)
  expect(store.projects).toHaveLength(1)
  expect(store.sessions.map((s) => `${s.name}/${s.type}`)).toEqual(['Free generation/image', 'Video/video'])
  expect(store.outputs.filter((o) => o.generationId === 'gen-3').every((o) => o.fileType === 'video')).toBe(true)
})

test('a concurrent create is resolved by reading the winner', async () => {
  const store = new FakeStore()
  store.raceOnCreate = true
  const res = await recordMcpGeneration({ ...base, stream: 'free' }, store)
  expect(res.projectId).toBe('p-raced')
})

test('a failed analysis enqueue does not fail the record', async () => {
  const store = new FakeStore()
  store.failAnalyses = true
  const res = await recordMcpGeneration({ ...base, stream: 'free' }, store)
  expect(res.outputIds).toHaveLength(2)
})
