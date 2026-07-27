import { useState } from 'react'
import { Braces } from 'lucide-react'
import { IconButton } from '@renderer/components/ui/icon-button'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'
import { JsonViewerDialog } from './JsonViewerDialog'

interface Props {
  column: ColumnInfo
  row: Record<string, unknown>
  content: string
  readOnly?: boolean
  onSave?: (row: Record<string, unknown>, column: string, value: string) => Promise<void>
}

export function JsonViewerTrigger({ column, row, content, readOnly = false, onSave }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <IconButton
        icon={Braces}
        label={t('tableData.viewJson')}
        size="xs"
        variant="secondary"
        className="shrink-0"
        data-focus-inset
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      />
      {open && (
        <JsonViewerDialog
          state={{ column, row, content }}
          readOnly={readOnly}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </>
  )
}
