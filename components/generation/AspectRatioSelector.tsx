'use client'

interface AspectRatioSelectorProps {
  value: string
  onChange: (value: string) => void
  options: string[]
}

// Visual representations for each aspect ratio
const AspectRatioIcon = ({ ratio }: { ratio: string }) => {
  const getIconStyle = (ratio: string) => {
    const ratioMap: Record<string, { width: string; height: string }> = {
      '1:1': { width: 'w-5', height: 'h-5' },
      '2:3': { width: 'w-4', height: 'h-6' },
      '3:2': { width: 'w-6', height: 'h-4' },
      '3:4': { width: 'w-4', height: 'h-5' },
      '4:3': { width: 'w-5', height: 'h-4' },
      '4:5': { width: 'w-4', height: 'h-5' },
      '5:4': { width: 'w-5', height: 'h-4' },
      '9:16': { width: 'w-3', height: 'h-6' },
      '16:9': { width: 'w-6', height: 'h-3' },
      '21:9': { width: 'w-8', height: 'h-3' },
    }
    return ratioMap[ratio] || { width: 'w-5', height: 'h-5' }
  }

  const { width, height } = getIconStyle(ratio)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${width} ${height} bg-current`} />
      <span className="text-[10px] font-medium">{ratio}</span>
    </div>
  )
}

export function AspectRatioSelector({ value, onChange, options }: AspectRatioSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((ratio) => (
        <button
          key={ratio}
          onClick={() => onChange(ratio)}
          className={`
            relative px-2.5 py-2 rounded-lg border transition-all
            ${
              value === ratio
                ? 'bg-primary/20 border-primary text-primary shadow-sm'
                : 'bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50 hover:border-border'
            }
          `}
          title={`Aspect ratio ${ratio}`}
        >
          <AspectRatioIcon ratio={ratio} />
        </button>
      ))}
    </div>
  )
}

