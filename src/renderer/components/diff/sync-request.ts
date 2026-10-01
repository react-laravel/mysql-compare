import type { IPCResult, SyncPlan, SyncRequest } from '../../../shared/types'

export interface SyncRequestRouter {
  buildPlan(req: SyncRequest, operationId?: string): Promise<IPCResult<SyncPlan>>
  execute(req: SyncRequest, operationId?: string): Promise<IPCResult<{ executed: number; errors: number }>>
}

export function submitSyncRequest(
  router: SyncRequestRouter,
  req: SyncRequest & { dryRun: true }, operationId?: string
): Promise<IPCResult<SyncPlan>>
export function submitSyncRequest(
  router: SyncRequestRouter,
  req: SyncRequest & { dryRun: false }, operationId?: string
): Promise<IPCResult<{ executed: number; errors: number }>>
export function submitSyncRequest(router: SyncRequestRouter, req: SyncRequest, operationId?: string) {
  return req.dryRun ? (operationId ? router.buildPlan(req, operationId) : router.buildPlan(req)) : (operationId ? router.execute(req, operationId) : router.execute(req))
}