// The persistent 24px bottom bar (DESIGN-SYSTEM §7.2 tier 3).
//
// This is the single home for *global* background work. Before it existed, a
// running database export lived only inside its own tab: switch away and the
// app looked idle (blueprint §2.10). Every job in `job-store` shows up here with
// its own Cancel, which is also what makes §7.3 ("cancel is mandatory")
// enforceable for work whose view is not on screen.
import * as React from 'react'
import { Command as CommandIcon } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/kbd'
import { Popover } from '@renderer/components/ui/popover'
import { ProgressBar } from '@renderer/components/ui/progress-bar'
import { StatusDot, statusTone } from '@renderer/components/ui/status-dot'
import { useI18n } from '@renderer/i18n'
import { getViewContext } from '@renderer/lib/tab-presentation'
import { isJobActive, useJobStore, type Job } from '@renderer/store/job-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useShell } from './shell-context'

function byStart(left: Job, right: Job): number {
  return left.startedAt - right.startedAt
}

export function AppStatusBar() {
  const { t } = useI18n()
  const shell = useShell()
  const jobMap = useJobStore((state) => state.jobs)
  const cancelJob = useJobStore((state) => state.cancel)
  const clearFinished = useJobStore((state) => state.clearFinished)
  const rightView = useUIStore((state) => state.rightView)
  const workspaceTabs = useUIStore((state) => state.workspaceTabs)
  const setActiveTab = useUIStore((state) => state.setActiveTab)
  const [jobsOpen, setJobsOpen] = React.useState(false)

  const jobs = React.useMemo(() => Array.from(jobMap.values()).sort(byStart), [jobMap])
  const openTabIds = React.useMemo(
    () => new Set(workspaceTabs.map((tab) => tab.id)),
    [workspaceTabs]
  )
  const active = React.useMemo(() => jobs.filter(isJobActive), [jobs])
  const leading = active[0] ?? null
  const context = getViewContext(rightView)

  const summary = leading
    ? active.length > 1
      ? t('statusbar.jobsRunning', { count: active.length })
      : String(leading.label)
    : t('statusbar.ready')

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-3 border-t border-border bg-surface px-2 text-xs text-fg-muted">
      <Popover
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        side="top"
        align="start"
        className="w-80 p-2"
        aria-label={t('statusbar.jobList')}
        trigger={
          <button
            type="button"
            className="flex h-5 items-center gap-1.5 rounded-sm px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"
            aria-label={t('statusbar.openJobs')}
          >
            <StatusDot status={leading ? statusTone(leading.status) : 'idle'} />
            <span className="max-w-64 truncate">{summary}</span>
            {leading?.count?.total ? (
              <span className="ds-tabular">
                {leading.count.done}/{leading.count.total}
              </span>
            ) : null}
          </button>
        }
      >
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="text-xs font-medium text-fg">{t('statusbar.jobList')}</span>
          <Button size="xs" variant="ghost" onClick={clearFinished} disabled={jobs.length === active.length}>
            {t('statusbar.clearFinished')}
          </Button>
        </div>
        {jobs.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-fg-subtle">{t('statusbar.noJobs')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-md border border-border bg-surface p-2">
                <div className="flex items-center gap-2">
                  <StatusDot status={statusTone(job.status)} />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">{job.label}</span>
                  {/* §2.10: the point of the list is work you navigated away
                      from, so the job has to be able to take you back. */}
                  {job.tabId && openTabIds.has(job.tabId) ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        if (job.tabId) setActiveTab(job.tabId)
                        setJobsOpen(false)
                      }}
                    >
                      {t('statusbar.showJobTab')}
                    </Button>
                  ) : null}
                  <Badge size="xs" tone={statusTone(job.status)}>
                    {t(`statusbar.status.${job.status}`)}
                  </Badge>
                </div>
                {/* Cancel lives with the progress, never anywhere else (§7.3). */}
                <ProgressBar
                  className="mt-1.5"
                  status={job.status}
                  value={job.value}
                  count={job.count}
                  detail={job.detail}
                  cancelLabel={t('statusbar.cancelJob')}
                  onCancel={isJobActive(job) ? () => cancelJob(job.id) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </Popover>

      <div className="min-w-0 flex-1 truncate">
        {context ? (
          <span className="font-mono text-2xs">
            {context.connectionName ? `${context.connectionName} / ` : ''}
            {context.database}
            {context.engine ? ` · ${context.engine}` : ''}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={shell.openCommandPalette}
        className="flex h-5 items-center gap-1.5 rounded-sm px-1 hover:bg-hover hover:text-fg"
      >
        <CommandIcon aria-hidden strokeWidth={1.75} className="size-3" />
        <span>{t('statusbar.commandHint')}</span>
        <Kbd>Mod+K</Kbd>
      </button>
    </footer>
  )
}
