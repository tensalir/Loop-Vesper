import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { oauthConfig } from '@/lib/oauth/config'
import { redirectHostLabel } from '@/lib/oauth/redirects'
import { verifyAuthRequest } from '@/lib/oauth/request'

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
 */

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
    select: { role: true, mcpAccess: true, pausedAt: true, deletedAt: true, displayName: true },
  })
  const allowed = Boolean(
    profile && !profile.deletedAt && !profile.pausedAt && (profile.mcpAccess || profile.role === 'admin')
  )
  const who = redirectHostLabel(request.redirectUri)

  if (!allowed) {
    return (
      <Shell>
        <h1 className="mb-3 text-lg font-semibold">Claude access is not turned on for you yet</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          You are signed in to Vesper as {user.email}. Connecting Claude is turned on person by person. Ask
          whoever runs Vesper at Loop to turn on Claude access for your account, then click Connect in Claude again.
        </p>
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
        <li>file feedback on the Loop Creative plugin in your name</li>
      </ul>
      <p className="mb-5 text-xs text-muted-foreground">
        What it makes is saved in your project &ldquo;Claude&rdquo;. You can disconnect it at any time in Settings,
        under Connected apps.
      </p>
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
