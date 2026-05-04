/**
 * Admin-side helpers for issuing, listing, and revoking headless Vesper
 * credentials. Kept outside `auth.ts` so the verifier path is the smallest
 * possible attack surface.
 */

import { prisma } from '@/lib/prisma'
import { issueHeadlessToken } from './tokens'
import type { HeadlessTool } from './auth'

export interface IssueCredentialInput {
  ownerId: string
  name: string
  allowedTools: HeadlessTool[]
  allowedModels?: string[]
  rateLimitPerMinute?: number
  rateLimitPerDay?: number
  expiresAt?: Date
}

export interface IssueCredentialResult {
  /**
   * Plaintext token. Only available at creation time. The caller is
   * responsible for showing this to the operator exactly once.
   */
  rawToken: string
  credential: {
    id: string
    name: string
    tokenPrefix: string
    allowedTools: string[]
    allowedModels: string[]
    rateLimitPerMinute: number | null
    rateLimitPerDay: number | null
    expiresAt: Date | null
    createdAt: Date
  }
}

/**
 * Issue a new credential for `ownerId`. The plaintext token is returned
 * to the caller exactly once and never persisted.
 */
export async function issueCredential(
  input: IssueCredentialInput
): Promise<IssueCredentialResult> {
  if (!input.allowedTools || input.allowedTools.length === 0) {
    throw new Error('At least one allowed tool is required')
  }

  const issued = issueHeadlessToken()

  const credential = await prisma.headlessCredential.create({
    data: {
      ownerId: input.ownerId,
      name: input.name,
      tokenHash: issued.tokenHash,
      tokenPrefix: issued.tokenPrefix,
      allowedTools: input.allowedTools,
      allowedModels: input.allowedModels ?? [],
      rateLimitPerMinute: input.rateLimitPerMinute ?? null,
      rateLimitPerDay: input.rateLimitPerDay ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      allowedTools: true,
      allowedModels: true,
      rateLimitPerMinute: true,
      rateLimitPerDay: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  return {
    rawToken: issued.rawToken,
    credential,
  }
}

export async function listCredentialsForOwner(ownerId: string) {
  return prisma.headlessCredential.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      allowedTools: true,
      allowedModels: true,
      rateLimitPerMinute: true,
      rateLimitPerDay: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      createdAt: true,
    },
  })
}

export async function revokeCredential(input: {
  credentialId: string
  reason?: string
}): Promise<void> {
  await prisma.headlessCredential.update({
    where: { id: input.credentialId },
    data: {
      revokedAt: new Date(),
      revokedReason: input.reason ?? null,
    },
  })
}
