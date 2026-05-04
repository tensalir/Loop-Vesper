'use client'

import { useEffect, useState } from 'react'

/**
 * Self-service MCP credential control for the /headless landing page.
 *
 * Renders a small state machine in place of the static "Server URL" field
 * on the MCP surface card:
 *
 *   no-token    -> "Generate URL" CTA
 *   generating  -> button disabled with a spinner label
 *   just-created -> the full URL with a one-time warning + Copy button
 *   has-token   -> masked URL with prefix + meta + "Revoke and generate"
 *   confirming  -> inline confirmation before destructive replace
 *
 * The plaintext URL exists only inside this component's state, set once
 * by the POST response. It is gone after a refresh or navigation; the
 * server only ever stores the SHA-256 hash. This is the standard
 * personal-access-token pattern used by GitHub, Stripe, etc.
 */

export type McpAccessSummary = {
  tokenPrefix: string
  createdAt: string
  lastUsedAt: string | null
} | null

type Mode = 'no-token' | 'generating' | 'just-created' | 'has-token' | 'confirming'

interface IssuedToken {
  url: string
  rawToken: string
  tokenPrefix: string
  createdAt: string
}

const PLACEHOLDER_URL = 'https://vesper.loop.dev/api/mcp/<your-token>'

function formatRelative(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  const date = new Date(iso)
  return date.toLocaleDateString()
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function McpAccessControl({ initial }: { initial: McpAccessSummary }) {
  const [mode, setMode] = useState<Mode>(initial ? 'has-token' : 'no-token')
  const [issued, setIssued] = useState<IssuedToken | null>(null)
  const [existing, setExisting] = useState<McpAccessSummary>(initial)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Auto-clear the "Copied" feedback so the button label resets.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function generate() {
    setMode('generating')
    setError(null)
    try {
      const res = await fetch('/api/me/headless-credential', { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        let message = `Failed to generate URL (${res.status})`
        try {
          message = JSON.parse(text).error || message
        } catch {
          /* non-JSON */
        }
        throw new Error(message)
      }
      const data = (await res.json()) as {
        url: string
        rawToken: string
        credential: { tokenPrefix: string; createdAt: string }
      }
      setIssued({
        url: data.url,
        rawToken: data.rawToken,
        tokenPrefix: data.credential.tokenPrefix,
        createdAt: data.credential.createdAt,
      })
      setExisting({
        tokenPrefix: data.credential.tokenPrefix,
        createdAt: data.credential.createdAt,
        lastUsedAt: null,
      })
      setMode('just-created')
      // Try to drop it into the clipboard automatically. Silent on
      // failure — the visible Copy button is the fallback.
      try {
        await navigator.clipboard.writeText(data.url)
        setCopied(true)
      } catch {
        /* user can press Copy */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate URL')
      // Fall back to the previous mode so the user can retry without losing
      // sight of their existing credential meta.
      setMode(existing ? 'has-token' : 'no-token')
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      /* swallow: the value is select-all-able in the field */
    }
  }

  return (
    <div className="vh-mcp">
      <label className="vh-field__label">Server URL</label>

      {mode === 'just-created' && issued ? (
        <>
          <div className="vh-field__row">
            <code className="vh-field__value">{issued.url}</code>
            <button
              type="button"
              className={`vh-copy${copied ? ' is-copied' : ''}`}
              onClick={() => copy(issued.url)}
              aria-label="Copy server URL"
            >
              <span aria-hidden="true" className="vh-copy__icon">
                {copied ? '\u2713' : '\u29C9'}
              </span>
              <span className="vh-copy__label">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="vh-token-warning" role="status">
            <strong>Save this URL now.</strong> It contains your token and we
            will not show it again. Treat it like a password: anyone with the
            URL can call Vesper as you.
          </div>
          <p className="vh-mcp__meta">
            Generated just now. Need a new one?{' '}
            <button
              type="button"
              className="vh-mcp__linkbtn"
              onClick={() => setMode('confirming')}
            >
              Revoke and generate new.
            </button>
          </p>
        </>
      ) : mode === 'has-token' && existing ? (
        <>
          <div className="vh-field__row">
            <code className="vh-field__value vh-field__value--masked">
              {`https://vesper.loop.dev/api/mcp/${existing.tokenPrefix}_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022`}
            </code>
            <button
              type="button"
              className="vh-copy vh-copy--ghost"
              onClick={() => setMode('confirming')}
            >
              <span aria-hidden="true" className="vh-copy__icon">
                {'\u21BB'}
              </span>
              <span className="vh-copy__label">Regenerate</span>
            </button>
          </div>
          <p className="vh-field__hint">
            Created {formatDate(existing.createdAt)}
            {existing.lastUsedAt
              ? ` \u00B7 last used ${formatRelative(existing.lastUsedAt)}`
              : ' \u00B7 never used yet'}
            . Loop already emailed this URL to you. Lost it? Regenerate to get
            a fresh one (the old URL stops working immediately).
          </p>
        </>
      ) : mode === 'confirming' ? (
        <>
          <div className="vh-field__row">
            <code className="vh-field__value vh-field__value--masked">
              {existing
                ? `https://vesper.loop.dev/api/mcp/${existing.tokenPrefix}_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022`
                : PLACEHOLDER_URL}
            </code>
          </div>
          <div className="vh-token-warning" role="alertdialog" aria-label="Confirm regenerate">
            <strong>Regenerate this URL?</strong> Your current URL will stop
            working immediately. Anything you have configured (Claude, Cursor,
            scripts) will need the new URL.
            <div className="vh-mcp__confirm">
              <button
                type="button"
                className="vh-action__btn vh-action__btn--danger"
                onClick={generate}
              >
                Yes, revoke and generate
              </button>
              <button
                type="button"
                className="vh-mcp__linkbtn"
                onClick={() => setMode(existing ? 'has-token' : 'no-token')}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="vh-field__row">
            <code className="vh-field__value vh-field__value--placeholder">
              {PLACEHOLDER_URL}
            </code>
            <button
              type="button"
              className="vh-copy"
              onClick={generate}
              disabled={mode === 'generating'}
            >
              <span aria-hidden="true" className="vh-copy__icon">
                {'\u2192'}
              </span>
              <span className="vh-copy__label">
                {mode === 'generating' ? 'Generating\u2026' : 'Generate URL'}
              </span>
            </button>
          </div>
          <p className="vh-field__hint">
            One click, one URL. Loop creates it for your account, hashes it,
            and shows you the plaintext exactly once. Treat it like a password.
          </p>
        </>
      )}

      {error && (
        <p className="vh-mcp__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
