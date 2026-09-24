/**
 * What the OAuth server needs from storage, as an interface.
 *
 * `prismaOAuthStore` (./store-prisma.ts) is the production store; the tests run
 * the whole flow over an in-memory one. Codes and tokens are only ever stored
 * as sha256 hashes: a database read never yields a usable token.
 */

export interface CodeRecord {
  id: string
  codeHash: string
  profileId: string
  credentialId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  resource: string
  expiresAt: Date
  usedAt: Date | null
}

export type TokenKind = 'access' | 'refresh'

export interface TokenRecord {
  id: string
  credentialId: string
  kind: TokenKind
  tokenHash: string
  familyId: string
  parentId: string | null
  codeId: string | null
  clientId: string
  scope: string
  resource: string
  familyExpiresAt: Date
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}

export type NewToken = Omit<TokenRecord, 'id' | 'usedAt' | 'revokedAt'>

export interface CredentialState {
  id: string
  ownerId: string
  kind: string
  revokedAt: Date | null
}

export interface OAuthOwner {
  id: string
  role: string
  pausedAt: Date | null
  deletedAt: Date | null
  mcpAccess: boolean
}

export interface UpsertCredentialInput {
  ownerId: string
  clientKey: string
  clientId: string
  clientName: string
  subjectEmail: string | null
}

export interface ConnectedApp {
  id: string
  name: string
  clientName: string | null
  clientKey: string | null
  subjectEmail: string | null
  createdAt: Date
  lastUsedAt: Date | null
}

export interface OAuthStore {
  /** The one live OAuth credential of this person and client key, created when missing. */
  upsertCredential(input: UpsertCredentialInput): Promise<{ id: string }>
  createCode(input: Omit<CodeRecord, 'id' | 'usedAt'>): Promise<CodeRecord>
  /** Mark an unused, unexpired code used, atomically; the code when this call did it, else null. */
  consumeCode(codeHash: string, now: Date): Promise<CodeRecord | null>
  findCode(codeHash: string): Promise<CodeRecord | null>
  createTokens(tokens: NewToken[]): Promise<void>
  findToken(tokenHash: string): Promise<TokenRecord | null>
  /** Mark a token used if it is still unused; true when this call did it. */
  markTokenUsed(id: string, now: Date): Promise<boolean>
  revokeFamily(familyId: string, now: Date): Promise<void>
  revokeTokensFromCode(codeId: string, now: Date): Promise<void>
  credentialState(credentialId: string): Promise<CredentialState | null>
  listConnectedApps(ownerId: string): Promise<ConnectedApp[]>
  /** Revoke one of this person's OAuth credentials and every token it holds; false when it is not theirs. */
  revokeCredential(ownerId: string, credentialId: string, now: Date, reason: string): Promise<boolean>
  /** Delete codes older than a day, access tokens expired a week, refresh tokens expired a month. */
  cleanup(now: Date): Promise<{ codes: number; tokens: number }>
}
