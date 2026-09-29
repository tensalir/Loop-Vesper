import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { claudeAccessFor, type RefusalReason } from '@/lib/oauth/claude-access'
import { oauthConfig } from '@/lib/oauth/config'
import { redirectHostLabel } from '@/lib/oauth/redirects'
import { verifyAuthRequest } from '@/lib/oauth/request'
import { HowToUseInClaude } from '@/components/connect/HowToUseInClaude'

export const dynamic = 'force-dynamic'

/**
 * /connect — the consent page of the Claude sign-in.
 *
 * Reached from /api/mcp/oauth/authorize with a signed request (`areq`). The
 * middleware sends a signed-out visitor to /login first and brings them back.
 * The page names who is asking (the host the code goes back to, which is the
 * part that cannot be faked), the app's own name, and the Vesper account, and
 * lists what the connection can do. The answer is a plain form post to
 * /api/mcp/oauth/decision.
 *
 * A person with a confirmed email on a Claude access domain whom no admin has
 * decided on sees the normal consent: their Allow turns Claude access on
 * (src/lib/oauth/claude-access.ts). This page only reads; it never grants.
 */

function refusalText(reason: RefusalReason, email: string | undefined): { title: string; body: string } {
  const who = email ? `You are signed in to Vesper as ${email}.` : 'You are signed in to Vesper.'
  if (reason === 'paused' || reason === 'deleted') {
    return {
      title: `This Vesper account is ${reason}`,
      body: `${who} Claude cannot connect to a ${reason} account. Ask a Vesper admin.`,
    }
  }
  if (reason === 'admin_decided') {
    return {
      title: 'Claude access is turned off for you',
      body: `${who} An admin has turned Claude access off for this account. Ask a Vesper admin if you need it.`,
    }
  }
  if (reason === 'email_unconfirmed') {
    return {
      title: 'Claude access is not turned on for you yet',
      body: `${who} Your email address is not confirmed yet. Loop accounts get Claude access the first time they connect once the address is confirmed (signing in with Google confirms it); otherwise ask a Vesper admin to turn it on, then click Connect in Claude again.`,
    }
  }
  return {
    title: 'Claude access is not turned on for you yet',
    body: `${who} Loop accounts get Claude access the first time they connect. For any other account, ask a Vesper admin to turn on Claude access, then click Connect in Claude again.`,
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex min-h-screen items-center justify-center bg-[#141414] p-4">
      <div className="w-full max-w-md rounded-xl border border-[#333333] bg-card p-6 text-foreground">
        <div className="mb-6 flex justify-center">
          <Image src="/images/Loop-Vesper-White.svg" alt="Loop Vesper" width={120} height={40} className="object-contain" />
        </div>
        {children}
      </div>
    </div>
  )
}

export default async function ConnectPage({ searchParams }: { searchParams: { areq?: string } }) {
  const cfg = oauthConfig()
  const areq = typeof searchParams?.areq === 'string' ? searchParams.areq : ''
  const request = verifyAuthRequest(areq, cfg.secret, Math.floor(Date.now() / 1000))

  if (!cfg.enabled || !request) {
    return (
      <Shell>
        <h1 className="mb-3 text-lg font-semibold">This sign-in link has expired</h1>
        <p className="text-sm text-muted-foreground">
          A sign-in link lasts ten minutes. Go back to Claude and click Connect on Vesper again.
        </p>
      </Shell>
    )
  }

  const supabase = createServerComponentClient({ cookies })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/connect?areq=${areq}`)}`)
  }

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { id: true, role: true, mcpAccess: true, pausedAt: true, deletedAt: true, mcpAccessDecidedAt: true },
  })
  const access = claudeAccessFor(profile, user)
  const who = redirectHostLabel(request.redirectUri)

  if (access.state === 'refused') {
    const refusal = refusalText(access.reason, user.email)
    return (
      <Shell>
        <h1 className="mb-3 text-lg font-semibold">{refusal.title}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{refusal.body}</p>
        <form method="post" action="/api/mcp/oauth/decision">
          <input type="hidden" name="areq" value={areq} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="w-full rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/10"
          >
            Back to {who}
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="mb-2 text-lg font-semibold">Connect {who} to Vesper</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        The app calls itself &ldquo;{request.clientName}&rdquo;. It will act in Vesper as{' '}
        <span className="text-foreground">{user.email}</span>.
      </p>
      <p className="mb-2 text-sm">It will be able to:</p>
      <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>write and improve prompts, and generate images and video with your Vesper account</li>
        <li>grade images against Loop&apos;s product rubrics and record your answers</li>
        <li>file feedback on the Loop Studio Design plugin in your name</li>
      </ul>
      <p className="mb-4 text-xs text-muted-foreground">
        What it makes is saved in your project &ldquo;Claude&rdquo;. You can disconnect it at any time in Settings,
        under Connected apps. Images and grading through Claude have a daily allowance per person.
        {access.state === 'grantable' && (
          <> Your {access.domain} account gets Claude access when you click Allow.</>
        )}
      </p>
      <div className="mb-5">
        <HowToUseInClaude compact />
      </div>
      <form method="post" action="/api/mcp/oauth/decision" className="flex gap-3">
        <input type="hidden" name="areq" value={areq} />
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent/10"
        >
          Cancel
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          className="flex-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Allow
        </button>
      </form>
    </Shell>
  )
}
