import { randomUUID } from 'node:crypto'
import type {
  CodeRecord,
  ConnectedApp,
  CredentialState,
  NewToken,
  OAuthStore,
  TokenRecord,
  UpsertCredentialInput,
} from '../../src/lib/oauth/store'

/** The OAuth store in memory, with the same "use once" rules as the Prisma one. */
export class MemoryOAuthStore implements OAuthStore {
  credentials = new Map<string, CredentialState & { clientKey: string; clientName: string; createdAt: Date }>()
  codes = new Map<string, CodeRecord>()
  tokens = new Map<string, TokenRecord>()

  async upsertCredential(input: UpsertCredentialInput) {
    for (const c of Array.from(this.credentials.values())) {
      if (c.ownerId === input.ownerId && c.clientKey === input.clientKey && !c.revokedAt) {
        c.clientName = input.clientName
        return { id: c.id }
      }
    }
    const id = randomUUID()
    this.credentials.set(id, {
      id,
      ownerId: input.ownerId,
      kind: 'oauth',
      revokedAt: null,
      clientKey: input.clientKey,
      clientName: input.clientName,
      createdAt: new Date(),
    })
    return { id }
  }

  async createCode(input: Omit<CodeRecord, 'id' | 'usedAt'>) {
    const code: CodeRecord = { ...input, id: randomUUID(), usedAt: null }
    this.codes.set(code.codeHash, code)
    return code
  }

  async consumeCode(codeHash: string, now: Date) {
    const code = this.codes.get(codeHash)
    if (!code || code.usedAt || code.expiresAt <= now) return null
    code.usedAt = now
    return { ...code }
  }

  async findCode(codeHash: string) {
    const code = this.codes.get(codeHash)
    return code ? { ...code } : null
  }

  async createTokens(tokens: NewToken[]) {
    for (const t of tokens) {
      const row: TokenRecord = { ...t, id: randomUUID(), usedAt: null, revokedAt: null }
      this.tokens.set(row.tokenHash, row)
    }
  }

  async findToken(tokenHash: string) {
    const t = this.tokens.get(tokenHash)
    return t ? { ...t } : null
  }

  async markTokenUsed(id: string, now: Date) {
    for (const t of Array.from(this.tokens.values())) {
      if (t.id === id) {
        if (t.usedAt) return false
        t.usedAt = now
        return true
      }
    }
    return false
  }

  async revokeFamily(familyId: string, now: Date) {
    for (const t of Array.from(this.tokens.values())) if (t.familyId === familyId && !t.revokedAt) t.revokedAt = now
  }

  async revokeTokensFromCode(codeId: string, now: Date) {
    for (const t of Array.from(this.tokens.values())) if (t.codeId === codeId && !t.revokedAt) t.revokedAt = now
  }

  async credentialState(credentialId: string) {
    const c = this.credentials.get(credentialId)
    return c ? { id: c.id, ownerId: c.ownerId, kind: c.kind, revokedAt: c.revokedAt } : null
  }

  async listConnectedApps(ownerId: string): Promise<ConnectedApp[]> {
    return Array.from(this.credentials.values())
      .filter((c) => c.ownerId === ownerId && !c.revokedAt)
      .map((c) => ({
        id: c.id,
        name: c.clientName,
        clientName: c.clientName,
        clientKey: c.clientKey,
        subjectEmail: null,
        createdAt: c.createdAt,
        lastUsedAt: null,
      }))
  }

  async revokeCredential(ownerId: string, credentialId: string, now: Date) {
    const c = this.credentials.get(credentialId)
    if (!c || c.ownerId !== ownerId || c.revokedAt) return false
    c.revokedAt = now
    for (const t of Array.from(this.tokens.values())) if (t.credentialId === credentialId && !t.revokedAt) t.revokedAt = now
    return true
  }

  async cleanup() {
    return { codes: 0, tokens: 0 }
  }

  /** Test helper: the stored row of a raw token. */
  tokenRow(hash: string): TokenRecord | undefined {
    return this.tokens.get(hash)
  }
}
