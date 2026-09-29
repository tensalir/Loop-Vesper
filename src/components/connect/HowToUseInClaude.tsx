/**
 * The one card a person reads when they connect Vesper to Claude: how to prompt it, in three
 * lines. Shown on the consent page (/connect), which every person sees exactly once, and on the
 * connect instructions (/headless). Text only: the Claude name in its own colour, no logo file,
 * so nothing here imitates Anthropic's mark.
 */

const CLAUDE = '#D97757'

const STEPS: Array<{ lead: string; rest: string }> = [
  {
    lead: 'Use the Claude desktop app.',
    rest: 'A chat for one picture; a Cowork task for a whole round.',
  },
  {
    lead: 'Drag a folder in.',
    rest: 'Or click Add folder. Every picture is saved there and shows as a card you can open.',
  },
  {
    lead: 'Ask in plain words, and name Vesper.',
    rest: '"With Vesper, make one 1:1 image of a lemon on a white table with Nano Banana 2."',
  },
]

export function HowToUseInClaude({ compact = false }: { compact?: boolean }) {
  return (
    <aside
      aria-label="How to use Vesper in Claude"
      className={`rounded-lg border border-[#333333] bg-[#1b1b1b] ${compact ? 'p-4' : 'p-5'} text-left`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">How to use Vesper in Claude</h2>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ borderColor: CLAUDE, color: CLAUDE }}
        >
          Works with Claude
        </span>
      </div>
      <ol className="space-y-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.lead} className="flex gap-3">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-[#141414]"
              style={{ backgroundColor: CLAUDE }}
            >
              {i + 1}
            </span>
            <span className="text-muted-foreground">
              <span className="text-foreground">{s.lead}</span> {s.rest}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        In the browser, a picture shows as a thumbnail above the reply; click it to open. The desktop app shows it
        as a card. Everything Vesper makes is also in your project &ldquo;Claude&rdquo; in the web app.
      </p>
    </aside>
  )
}
