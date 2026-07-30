// Blueprint §5 chunk 12 — the ship criteria, as a test instead of a checklist.
//
// Every item below was a one-time grep in the redesign plan. A grep you run once
// is a grep that rots, so they live here: the next person to hardcode a hex, a
// `confirm()` or a `text-[11px]` finds out in `npm test` rather than in review.
//
// If one of these fires and the new code is genuinely right, widen the *narrow*
// allowlist next to the rule and write down why — do not delete the rule.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname)
const SELF = 'design-system-sweep.test.ts'

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

const ALL_FILES = walk(ROOT)
  .filter((file) => /\.(ts|tsx|css)$/.test(file))
  .map((file) => relative(ROOT, file).split(sep).join('/'))
  .sort()

const SOURCE_FILES = ALL_FILES.filter(
  (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx')
)

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

/**
 * Strips `//` and block comments so a rule matches real code, not the notes
 * every redesign chunk left behind describing what it deleted. Deliberately
 * naive about `//` inside string literals — no rule here cares.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

interface Hit {
  file: string
  line: number
  text: string
}

function scan(files: string[], pattern: RegExp, transform = (s: string) => s): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    const lines = transform(read(file)).split('\n')
    lines.forEach((text, index) => {
      const re = new RegExp(pattern.source, pattern.flags.replace('g', ''))
      if (re.test(text)) hits.push({ file, line: index + 1, text: text.trim() })
    })
  }
  return hits
}

const format = (hits: Hit[]): string[] => hits.map((h) => `${h.file}:${h.line}  ${h.text}`)

describe('ship criteria — colour', () => {
  it('has no hex literal outside tokens.css and the three brand marks', () => {
    // EngineIcon paints official MySQL / PostgreSQL / Redis logos. A trademark
    // that re-tints with the theme stops being the trademark.
    const allowed = new Set(['styles/tokens.css', 'components/icons/EngineIcon.tsx'])
    const hits = scan(
      SOURCE_FILES.filter((file) => !allowed.has(file)),
      /#[0-9a-fA-F]{3,8}\b/
    )
    expect(format(hits)).toEqual([])
  })

  it('has no raw Tailwind palette class — every colour is a token', () => {
    // `text-red-200` was dark-only and illegible in light mode; `text-amber-400`
    // and `text-emerald-400` were the same bug. Use danger/warning/success.
    const prefix = '(?:text|bg|border|ring|fill|stroke|from|to|via|decoration|outline|divide|accent)'
    const palette =
      '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
    const hits = scan(SOURCE_FILES, new RegExp(`\\b${prefix}-${palette}-[0-9]{2,3}\\b`), stripComments)
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — type scale', () => {
  it('has no arbitrary font-size literal (use text-2xs / text-xs / text-sm)', () => {
    const hits = scan(
      SOURCE_FILES.filter((file) => file !== 'styles/tokens.css'),
      /text-\[[0-9.]+(?:px|rem)\]/,
      stripComments
    )
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — no native dialogs', () => {
  it('calls neither alert(), confirm() nor prompt()', () => {
    // All 11 sites from blueprint §0.4 end in `ConfirmDialog`. A native dialog
    // ignores the theme, the type scale and the focus ring.
    const hits = scan(
      SOURCE_FILES,
      /(?:^|[^.\w'"`])(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
      stripComments
    )
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — focus', () => {
  it('suppresses the focus ring in exactly one documented place', () => {
    // `dropdown-menu`'s list is the single tab stop for the whole menu and
    // delegates focus to the active row via `aria-activedescendant`; a ring
    // around all of the items would be wrong. tokens.css owns the global policy.
    const allowed = new Set(['styles/tokens.css', 'components/ui/dropdown-menu.tsx'])
    const hits = scan(
      SOURCE_FILES.filter((file) => !allowed.has(file)),
      /\boutline-none\b|outline:\s*none/,
      stripComments
    )
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — one z ladder', () => {
  it('never writes a numeric z-index — stacking comes from the token ladder', () => {
    // Before the redesign every popover (z-[80]/[85]/[90]) rendered above every
    // dialog (z-50). Layers now use named --ds-z-* tokens ordered in tokens.css.
    const hits = scan(
      SOURCE_FILES.filter((file) => file !== 'styles/tokens.css'),
      /\bz-(?:\[\s*[0-9]{2,}\s*\]|[0-9]{2,})\b/,
      stripComments
    )
    expect(format(hits)).toEqual([])
  })

  it('hand-rolls no full-screen overlay outside the ui/ package', () => {
    // Overlays are Dialog / Drawer / Popover / DropdownMenu / ContextMenu /
    // Tooltip / CommandPalette — they trap focus and portal correctly.
    const hits = scan(
      SOURCE_FILES.filter((file) => !file.startsWith('components/ui/')),
      /fixed\s+inset-0/,
      stripComments
    )
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — overlays are accessible', () => {
  const overlays = [
    'components/ui/dialog.tsx',
    'components/ui/drawer.tsx',
    'components/ui/command-palette.tsx'
  ]

  it.each(overlays)('%s traps focus, is aria-modal and carries a name', (file) => {
    const source = read(file)
    expect(source).toContain('useFocusTrap')
    expect(source).toContain('aria-modal="true"')
    expect(source).toMatch(/aria-labelledby=|aria-label=/)
  })
})

describe('ship criteria — no suppressed diagnostics', () => {
  it('silences neither ESLint nor TypeScript', () => {
    // Assembled rather than written out so the rule does not match itself.
    const suppressors = ['eslint-' + 'disable', '@ts-' + 'ignore', '@ts-' + 'expect-error']
    const hits = scan(
      ALL_FILES.filter((file) => file !== SELF),
      new RegExp(suppressors.join('|'))
    )
    expect(format(hits)).toEqual([])
  })
})

describe('ship criteria — shared helpers are defined once', () => {
  it.each([
    ['formatBytes', /function formatBytes|const formatBytes\s*=/],
    ['formatNumber', /function formatNumber|const formatNumber\s*=/]
  ])('%s exists once, in lib/format.ts', (_name, pattern) => {
    const hits = scan(SOURCE_FILES, pattern)
    expect(hits.map((hit) => hit.file)).toEqual(['lib/format.ts'])
  })
})

describe('ship criteria — every EmptyState has a way out', () => {
  it('passes an action at every call site', () => {
    // `EmptyStateProps.action` is required, so `tsc` is the real gate; this
    // catches the shape that compiles but reads as a dead end: `action={null}`.
    const hits = scan(SOURCE_FILES, /action=\{(?:null|undefined|false)\}/, stripComments)
    expect(format(hits)).toEqual([])
  })
})
