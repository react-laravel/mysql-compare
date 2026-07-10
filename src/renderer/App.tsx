import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { Workspace } from '@renderer/pages/Workspace'
import { useUIStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'

export default function App() {
  const { toast, clearToast } = useUIStore()
  const ToastIcon =
    toast?.level === 'success' ? CheckCircle2 : toast?.level === 'error' ? AlertCircle : Info

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <Workspace />
      {toast && (
        <div
          className={cn(
            'fixed right-4 top-4 z-[70] flex w-[min(28rem,calc(100vw-2rem))] items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur',
            toast.level === 'success' && 'bg-emerald-600/20 border-emerald-600/40 text-emerald-700 dark:text-emerald-300',
            toast.level === 'error' && 'bg-destructive/20 border-destructive/40 text-destructive dark:text-red-300',
            toast.level === 'info' && 'bg-secondary border-border text-foreground'
          )}
          role={toast.level === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <ToastIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 break-words">{toast.message}</div>
          <button
            type="button"
            className="rounded p-0.5 text-current opacity-70 hover:bg-background/40 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={clearToast}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
