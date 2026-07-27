// The ONE place a table-compare row's diff sign is decided (DS §1.5).
//
// The old view encoded three row states by colour adjacency alone — amber /
// sky / violet washes with a swatch legend (`TableCompareView.tsx:583-592`).
// DESIGN-SYSTEM §1.5 measures that as failing even for full-colour vision, so
// the glyph is now the signal and the colour is reinforcement:
//
//   +  source only      (`add`)
//   −  target only      (`del`)
//   ~  changed field    (`mod`)
//   (blank) identical   (`same`)
//
// The sign is a property of the *aligned row*, not of the pane, so both panes
// render the same glyph on the same line. That is what makes the legend below
// readable from either side.
import { DiffGutter, type DiffKind } from '@renderer/components/ui/diff-gutter'
import { useI18n } from '@renderer/i18n'
import type { RowDiffLookup, RowDiffStatus } from './table-compare-diff'

export function rowDiffKind(status: RowDiffStatus | undefined): DiffKind {
  switch (status) {
    case 'source-only':
      return 'add'
    case 'target-only':
      return 'del'
    case 'modified':
      return 'mod'
    default:
      return 'same'
  }
}

/**
 * `RowDiffLookup.source` only holds keys the source has, so a target-only row is
 * absent from it. Merging both maps is what lets the source pane render a `−`
 * on the line where its counterpart is missing.
 */
export function buildRowDiffKinds(lookup: RowDiffLookup | null): Map<string, DiffKind> {
  const kinds = new Map<string, DiffKind>()
  if (!lookup) return kinds

  for (const [key, info] of lookup.source) {
    kinds.set(key, rowDiffKind(info.status))
  }
  for (const [key, info] of lookup.target) {
    if (!kinds.has(key)) kinds.set(key, rowDiffKind(info.status))
  }

  return kinds
}

/** The filters-row legend (§3.6). Each entry leads with its glyph. */
export function TableCompareLegend() {
  const { t } = useI18n()

  const entries: Array<{ kind: DiffKind; label: string }> = [
    { kind: 'mod', label: t('diff.compareView.legendChangedField') },
    { kind: 'add', label: t('diff.compareView.legendSourceOnly') },
    { kind: 'del', label: t('diff.compareView.legendTargetOnly') }
  ]

  return (
    <>
      {entries.map((entry) => (
        <span key={entry.kind} className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <DiffGutter kind={entry.kind} />
          {entry.label}
        </span>
      ))}
    </>
  )
}
