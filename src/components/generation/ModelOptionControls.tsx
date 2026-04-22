'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { ModelParameter } from '@/lib/models/base'

const HANDLED_ELSEWHERE = new Set(['aspectRatio', 'resolution', 'numOutputs'])

interface ModelOptionControlsProps {
  modelParameters: ModelParameter[]
  parameters: Record<string, any>
  onParametersChange: (params: Record<string, any>) => void
}

export function ModelOptionControls({
  modelParameters,
  parameters,
  onParametersChange,
}: ModelOptionControlsProps) {
  const extras = modelParameters.filter((p) => !HANDLED_ELSEWHERE.has(p.name))
  if (extras.length === 0) return null

  const isCompressible =
    parameters.outputFormat === 'jpeg' || parameters.outputFormat === 'webp'

  return (
    <>
      {extras.map((param) => {
        if (param.name === 'outputCompression' && !isCompressible) return null

        if (param.type === 'select' && param.options) {
          const value = parameters[param.name] ?? param.default ?? ''
          return (
            <Select
              key={param.name}
              value={String(value)}
              onValueChange={(v) =>
                onParametersChange({ ...parameters, [param.name]: v })
              }
            >
              <SelectTrigger className="h-8 w-auto min-w-[72px] text-xs px-2 rounded-lg">
                <span className="text-muted-foreground mr-1">{param.label}:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {param.options.map((opt) => (
                  <SelectItem key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }

        if (param.type === 'number') {
          const value = parameters[param.name] ?? param.default ?? ''
          return (
            <div key={param.name} className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{param.label}:</span>
              <Input
                type="number"
                min={param.min}
                max={param.max}
                step={param.step}
                value={value}
                onChange={(e) =>
                  onParametersChange({
                    ...parameters,
                    [param.name]: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="h-8 w-16 text-xs px-2 rounded-lg"
              />
            </div>
          )
        }

        return null
      })}
    </>
  )
}
