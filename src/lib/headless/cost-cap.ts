/**
 * A daily spend cap per person for paid MCP calls.
 *
 * `MCP_DAILY_COST_CAP_USD` unset or 0 means no cap (today's behaviour). When
 * set, a paid call is refused if the owner's logged spend since 00:00 UTC
 * plus this call's estimate would pass it. Spend comes from
 * `headless_usage_logs.cost_usd`, which a finished job writes even when its
 * caller was handed a job id and has gone.
 *
 * The cap is keyed on the credential's owner. The shared organisation token is
 * owned by the admin who issued it, so every colleague on it counts against
 * that one owner: set the cap once people sign in one by one, not before.
 */

import { prisma } from '@/lib/prisma'

export function dailyCostCapUsd(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = Number(env.MCP_DAILY_COST_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export type SpentTodayUsd = (ownerId: string, since: Date) => Promise<number>

export const spentTodayFromUsageLog: SpentTodayUsd = async (ownerId, since) => {
  const agg = await prisma.headlessUsageLog.aggregate({
    _sum: { costUsd: true },
    where: { ownerId, status: 'success', createdAt: { gte: since } },
  })
  return Number(agg._sum.costUsd ?? 0)
}

export type CostCapDecision =
  | { ok: true }
  | { ok: false; capUsd: number; spentUsd: number; estimateUsd: number; message: string }

export async function checkDailyCostCap(input: {
  ownerId: string
  estimateUsd: number | null
  env?: NodeJS.ProcessEnv
  now?: Date
  spentToday?: SpentTodayUsd
}): Promise<CostCapDecision> {
  const cap = dailyCostCapUsd(input.env)
  if (cap == null) return { ok: true }
  const estimate = Math.max(0, input.estimateUsd ?? 0)
  const spent = await (input.spentToday ?? spentTodayFromUsageLog)(input.ownerId, startOfUtcDay(input.now))
  if (spent + estimate <= cap) return { ok: true }
  return {
    ok: false,
    capUsd: cap,
    spentUsd: spent,
    estimateUsd: estimate,
    message:
      `This call would pass today's spend cap of $${cap.toFixed(2)} for your account ` +
      `($${spent.toFixed(2)} spent since 00:00 UTC, this call about $${estimate.toFixed(2)}). ` +
      'The cap resets at 00:00 UTC; ask a Vesper admin if you need more today.',
  }
}
