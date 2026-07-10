import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Database, GitCompareArrows, Globe, Moon, Sun } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n, LOCALES } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import { useTheme } from '@renderer/theme'

export function SidebarAppMenu() {
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { setRightView } = useUIStore()
  const { locale, setLocale, t } = useI18n()
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!open) return

    const closeMenu = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openMenu = () => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    setMenuPosition({
      left: rect.left,
      top: rect.bottom + 4
    })
    setOpen(true)
  }

  const openDiffSync = () => {
    setRightView({ kind: 'diff' })
    setOpen(false)
  }

  return (
    <>
      <Button
        ref={buttonRef}
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1 px-2"
        onClick={(event) => {
          event.stopPropagation()
          if (open) {
            setOpen(false)
            return
          }
          openMenu()
        }}
        title={t('sidebar.appMenu')}
        aria-label={t('sidebar.appMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Database className="h-4 w-4 text-primary" />
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)}>
          <div
            role="menu"
            className="absolute w-56 rounded-md border border-border bg-card p-1 text-sm shadow-xl"
            style={{ left: menuPosition.left, top: menuPosition.top }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs font-medium text-foreground">{t('app.title')}</div>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={openDiffSync}
            >
              <GitCompareArrows className="h-4 w-4 shrink-0" />
              {t('app.diffSync')}
            </button>
            <div className="my-1 h-px bg-border" />
            <div className="px-2 py-1.5">
              <div className="mb-1.5 text-xs text-muted-foreground">{t('theme.label')}</div>
              <div className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
                <ThemeButton
                  active={theme === 'light'}
                  icon={<Sun className="h-3.5 w-3.5" />}
                  label={t('theme.light')}
                  onClick={() => setTheme('light')}
                />
                <ThemeButton
                  active={theme === 'dark'}
                  icon={<Moon className="h-3.5 w-3.5" />}
                  label={t('theme.dark')}
                  onClick={() => setTheme('dark')}
                />
              </div>
            </div>
            <div className="my-1 h-px bg-border" />
            <label className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">{t('language.label')}</span>
              <select
                aria-label={t('language.label')}
                value={locale}
                onChange={(event) => setLocale(event.target.value as typeof locale)}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                {LOCALES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </>
  )
}

function ThemeButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={cn(
        'flex h-7 items-center justify-center gap-1.5 rounded text-xs transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
