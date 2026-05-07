'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useImportCmfWorkbook } from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'
import { Upload, Download, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface CmfImportPanelProps {
  onPacketCreated?: (packetId: string) => void
}

export function CmfImportPanel({ onPacketCreated }: CmfImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [packetName, setPacketName] = useState('')
  const [cmfCode, setCmfCode] = useState('')
  const [errors, setErrors] = useState<
    Array<{ rowIndex: number; field?: string; message: string }>
  >([])
  const [lastSuccess, setLastSuccess] = useState<{ rows: number } | null>(null)
  const importMutation = useImportCmfWorkbook()
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast({ title: 'No file', description: 'Pick an .xlsx workbook to import.' })
      return
    }
    setErrors([])
    setLastSuccess(null)
    try {
      const result = await importMutation.mutateAsync({
        file,
        packetName: packetName || undefined,
        cmfCode: cmfCode || undefined,
        createPacket: true,
      })
      if (result.import.errors.length > 0) {
        setErrors(result.import.errors)
        toast({
          title: 'Import had warnings',
          description: `${result.import.rowCount} rows imported, ${result.import.errors.length} rows skipped`,
        })
      } else {
        setLastSuccess({ rows: result.import.rowCount })
        toast({
          title: 'Workbook imported',
          description: `Created packet from ${result.import.rowCount} rows`,
        })
      }
      if (result.packet?.id) {
        onPacketCreated?.(result.packet.id)
      }
      // reset selection so the same file can be re-imported after edits
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast({ title: 'Import failed', description: message })
    }
  }

  async function handleDownloadTemplate() {
    const res = await fetch('/api/cmf/template?productSlug=switch2')
    if (!res.ok) {
      toast({ title: 'Failed to download template' })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cmf-template-switch2.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Workbook (.xlsx)
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        {file && (
          <p className="text-xs text-muted-foreground truncate">{file.name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Packet name (optional)
        </Label>
        <Input
          value={packetName}
          onChange={(e) => setPacketName(e.target.value)}
          placeholder="Switch 2 Spring 2026"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          CMF code (optional)
        </Label>
        <Input
          value={cmfCode}
          onChange={(e) => setCmfCode(e.target.value)}
          placeholder="CMF-001234revA"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={importMutation.isPending} className="gap-2">
          {importMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownloadTemplate}
          className="gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Template
        </Button>
      </div>

      {lastSuccess && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            Imported {lastSuccess.rows} {lastSuccess.rows === 1 ? 'row' : 'rows'} cleanly.
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Skipped {errors.length} {errors.length === 1 ? 'row' : 'rows'}
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {errors.slice(0, 12).map((err, idx) => (
              <li key={idx} className="font-mono text-[11px] leading-snug">
                row {err.rowIndex + 1}
                {err.field ? ` · ${err.field}` : ''}: {err.message}
              </li>
            ))}
            {errors.length > 12 && (
              <li className="text-[11px] italic">
                …and {errors.length - 12} more
              </li>
            )}
          </ul>
        </div>
      )}
    </form>
  )
}
