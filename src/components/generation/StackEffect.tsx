'use client'

interface StackEffectProps {
  /** Whether the stacked layers should pulse to signal a processing state */
  pulse?: boolean
  /** How many cosmetic layers to render behind the card */
  layers?: number
  /** Optional class override on the wrapper */
  className?: string
}

/**
 * Reusable cosmetic stacked-card effect that peeks out from the right edge
 * of its parent. Used to indicate that a card has related siblings (e.g.
 * image iteration branches) without taking extra layout space.
 */
export function StackEffect({ pulse = false, layers = 3, className }: StackEffectProps) {
  return (
    <div
      className={`absolute inset-0 pointer-events-none overflow-visible ${
        pulse ? 'animate-stack-pulse' : ''
      } ${className ?? ''}`}
      style={{ zIndex: 0 }}
      aria-hidden
    >
      {Array.from({ length: layers }).map((_, index) => {
        const layerIndex = layers - index - 1
        const offset = (layerIndex + 1) * 8
        const verticalOffset = offset * 0.3
        const baseOpacity = pulse ? 0.2 : 0.15
        const opacity = baseOpacity - layerIndex * 0.03
        const scale = 1 - layerIndex * 0.02

        return (
          <div
            key={`stack-layer-${layerIndex}`}
            className="absolute pointer-events-none rounded-xl transition-all duration-500"
            style={{
              top: `${verticalOffset}px`,
              left: `${offset}px`,
              right: `${-offset}px`,
              bottom: `${-verticalOffset}px`,
              zIndex: -10 - layerIndex,
              transform: `scale(${scale})`,
              background: `linear-gradient(to left,
                hsl(var(--primary) / ${opacity * 0.35}) 0%,
                hsl(var(--primary) / ${opacity * 0.18}) 45%,
                transparent 85%
              )`,
              border: `1.5px solid hsl(var(--primary) / ${opacity * 0.8})`,
              borderLeft: '0',
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              boxShadow: `
                ${offset}px 0 ${offset * 2}px -${offset * 0.65}px hsl(var(--primary) / ${opacity * 0.55}),
                inset 10px 0 ${12 + layerIndex * 2}px hsl(var(--primary) / ${opacity * 0.25})
              `,
              backdropFilter: 'blur(1px)',
            }}
          />
        )
      })}
    </div>
  )
}
