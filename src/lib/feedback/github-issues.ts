/**
 * The GitHub calls feedback makes, over Vesper's App (Issues: read and write
 * on the plugin's repository). An interface, so the tests never touch GitHub.
 */

import { GithubError, type Gh } from '@/lib/github/rest'

export interface GhIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body: string | null
  labels: string[]
  created_at: string
  updated_at: string
  html_url: string
  is_pull_request: boolean
}

export interface GhComment {
  id: number
  body: string
  user_login: string
  created_at: string
}

export interface FeedbackGithub {
  repo: string
  listIssues(q: { labels: string[]; state: 'open' | 'closed' | 'all'; perPage: number }): Promise<GhIssue[]>
  searchIssues(q: string, perPage: number): Promise<GhIssue[]>
  getIssue(number: number): Promise<GhIssue | null>
  listComments(number: number): Promise<GhComment[]>
  createIssue(title: string, body: string): Promise<GhIssue>
  addLabels(number: number, labels: string[]): Promise<void>
  createLabel(name: string): Promise<void>
  createComment(number: number, body: string): Promise<{ id: number; html_url: string }>
}

interface RawIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  body?: string | null
  labels?: Array<string | { name?: string }>
  created_at: string
  updated_at: string
  html_url: string
  pull_request?: unknown
}

function toIssue(r: RawIssue): GhIssue {
  return {
    number: r.number,
    title: r.title,
    state: r.state,
    body: r.body ?? null,
    labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
    created_at: r.created_at,
    updated_at: r.updated_at,
    html_url: r.html_url,
    is_pull_request: Boolean(r.pull_request),
  }
}

export function githubFeedback(gh: Gh, repo: string): FeedbackGithub {
  const base = `/repos/${repo}`
  return {
    repo,
    async listIssues({ labels, state, perPage }) {
      const qs = new URLSearchParams({ labels: labels.join(','), state, per_page: String(perPage), sort: 'updated' })
      const res = await gh(`${base}/issues?${qs}`)
      if (res.status === 404) return []
      return res.json<RawIssue[]>().map(toIssue)
    },
    async searchIssues(q, perPage) {
      const qs = new URLSearchParams({ q, per_page: String(perPage), sort: 'updated' })
      const res = await gh(`/search/issues?${qs}`)
      if (res.status === 404) return []
      return res.json<{ items: RawIssue[] }>().items.map(toIssue)
    },
    async getIssue(number) {
      const res = await gh(`${base}/issues/${number}`)
      return res.status === 404 ? null : toIssue(res.json<RawIssue>())
    },
    async listComments(number) {
      const res = await gh(`${base}/issues/${number}/comments?per_page=100`)
      if (res.status === 404) return []
      return res
        .json<Array<{ id: number; body?: string; user?: { login?: string }; created_at: string }>>()
        .map((c) => ({ id: c.id, body: c.body ?? '', user_login: c.user?.login ?? '', created_at: c.created_at }))
    },
    async createIssue(title, body) {
      // No labels here: labels given on create are dropped when the caller lacks push access.
      const res = await gh(`${base}/issues`, { method: 'POST', body: { title, body } })
      if (res.status === 404) throw new GithubError(`GitHub has no repository ${repo} for Vesper's app`, 404)
      return toIssue(res.json<RawIssue>())
    },
    async addLabels(number, labels) {
      const res = await gh(`${base}/issues/${number}/labels`, { method: 'POST', body: { labels } })
      if (res.status === 404) throw new GithubError(`issue #${number} not found`, 404)
    },
    async createLabel(name) {
      try {
        await gh(`${base}/labels`, {
          method: 'POST',
          body: { name, color: 'ededed', description: 'Created by Vesper; .github/labels.json sets its colour and words' },
        })
      } catch (err) {
        // 422: it exists already, which is what we wanted.
        if (!(err instanceof GithubError && err.status === 422)) throw err
      }
    },
    async createComment(number, body) {
      const res = await gh(`${base}/issues/${number}/comments`, { method: 'POST', body: { body } })
      if (res.status === 404) throw new GithubError(`issue #${number} not found`, 404)
      const c = res.json<{ id: number; html_url: string }>()
      return { id: c.id, html_url: c.html_url }
    },
  }
}
