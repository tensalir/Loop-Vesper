/**
 * The production `OAuthStore`, over Prisma.
 *
 * "Use once" is a conditional update (`updateMany … where used_at is null`),
 * so two requests racing with the same code or refresh token cannot both win.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { OAUTH_RATE_LIMIT_PER_DAY, OAUTH_RATE_LIMIT_PER_MINUTE } from './config'
import type {
  CodeRecord,
  ConnectedApp,
  CredentialState,
  NewToken,
  OAuthOwner,
  OAuthStore,
  TokenKind,
  TokenRecord,
  UpsertCredentialInput,
} from './store'

const DAY_MS = 24 * 60 * 60 * 1000

function toToken(row: {
  id: string
  credentialId: string
  kind: string
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
}): TokenRecord {
  return { ...row, kind: row.kind as TokenKind }
}

async function findActiveCredential(ownerId: string, clientKey: string) {
  return prisma.headlessCredential.findFirst({
    where: { ownerId, kind: 'oauth', oauthClientKey: clientKey, revokedAt: null },
    select: { id: true },
  })
}

export const prismaOAuthStore: OAuthStore = {
  async upsertCredential(input: UpsertCredentialInput) {
    const existing = await findActiveCredential(input.ownerId, input.clientKey)
    const fields = {
      oauthClientId: input.clientId,
      oauthClientName: input.clientName,
      subjectEmail: input.subjectEmail,
      name: `${input.clientName} (${input.clientKey})`,
    }
    if (existing) {
      await prisma.headlessCredential.update({ where: { id: existing.id }, data: fields })
      return existing
    }
    try {
      return await prisma.headlessCredential.create({
        data: {
          ...fields,
          ownerId: input.ownerId,
          kind: 'oauth',
          oauthClientKey: input.clientKey,
          tokenHash: null,
          tokenPrefix: 'vsp_oauth',
          allowedTools: ['*'],
          allowedModels: ['*'],
          rateLimitPerMinute: OAUTH_RATE_LIMIT_PER_MINUTE,
          rateLimitPerDay: OAUTH_RATE_LIMIT_PER_DAY,
        },
        select: { id: true },
      })
    } catch (err) {
      // Two consents at once: the partial unique index let one through; use it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await findActiveCredential(input.ownerId, input.clientKey)
        if (again) return again
      }
      throw err
    }
  },

  async createCode(input) {
    return prisma.mcpOAuthCode.create({ data: input })
  },

  async consumeCode(codeHash: string, now: Date): Promise<CodeRecord | null> {
    const { count } = await prisma.mcpOAuthCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (count !== 1) return null
    return prisma.mcpOAuthCode.findUnique({ where: { codeHash } })
  },

  async findCode(codeHash: string) {
    return prisma.mcpOAuthCode.findUnique({ where: { codeHash } })
  },

  async createTokens(tokens: NewToken[]) {
    await prisma.mcpOAuthToken.createMany({ data: tokens })
  },

  async findToken(tokenHash: string) {
    const row = await prisma.mcpOAuthToken.findUnique({ where: { tokenHash } })
    return row ? toToken(row) : null
  },

  async markTokenUsed(id: string, now: Date) {
    const { count } = await prisma.mcpOAuthToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    })
    return count === 1
  },

  async revokeFamily(familyId: string, now: Date) {
    await prisma.mcpOAuthToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } })
  },

  async revokeTokensFromCode(codeId: string, now: Date) {
    await prisma.mcpOAuthToken.updateMany({ where: { codeId, revokedAt: null }, data: { revokedAt: now } })
  },

  async credentialState(credentialId: string): Promise<CredentialState | null> {
    return prisma.headlessCredential.findUnique({
      where: { id: credentialId },
      select: { id: true, ownerId: true, kind: true, revokedAt: true },
    })
  },

  async listConnectedApps(ownerId: string): Promise<ConnectedApp[]> {
    return prisma.headlessCredential.findMany({
      where: { ownerId, kind: 'oauth', revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        oauthClientName: true,
        oauthClientKey: true,
        subjectEmail: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        clientName: r.oauthClientName,
        clientKey: r.oauthClientKey,
        subjectEmail: r.subjectEmail,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
      }))
    )
  },

  async revokeCredential(ownerId: string, credentialId: string, now: Date, reason: string) {
    const { count } = await prisma.headlessCredential.updateMany({
      where: { id: credentialId, ownerId, kind: 'oauth', revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    })
    if (count !== 1) return false
    await prisma.mcpOAuthToken.updateMany({ where: { credentialId, revokedAt: null }, data: { revokedAt: now } })
    return true
  },

  async cleanup(now: Date) {
    const codes = await prisma.mcpOAuthCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY_MS) } } })
    const tokens = await prisma.mcpOAuthToken.deleteMany({
      where: {
        OR: [
          { kind: 'access', expiresAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } },
          { kind: 'refresh', expiresAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
        ],
      },
    })
    return { codes: codes.count, tokens: tokens.count }
  },
}

/** An access token with its credential and owner, for verifying a request to /api/mcp. */
export async function findAccessToken(tokenHash: string) {
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash },
    include: {
      credential: {
        include: {
          owner: {
            select: {
              id: true,
              role: true,
              pausedAt: true,
              deletedAt: true,
              cmfAccess: true,
              packagingAccess: true,
              mcpAccess: true,
            },
          },
        },
      },
    },
  })
  if (!row) return null
  const { credential, ...token } = row
  const { owner, ...cred } = credential
  return { token: toToken(token), credential: cred, owner: owner as typeof owner & OAuthOwner }
}
