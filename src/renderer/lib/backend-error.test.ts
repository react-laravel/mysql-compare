import { expect, it } from 'vitest'
import { describeBackendError } from './backend-error'
it('offers an actionable localized hint while preserving driver details', () => {
  expect(describeBackendError('Access denied for user restricted', true)).toContain('用户名、密码')
  expect(describeBackendError('certificate hostname mismatch', false)).toContain('certificate authority and server name')
  expect(describeBackendError('unknown server failure', true)).toBe('unknown server failure')
})
it('keeps an opaque host trust challenge out of toasts', () => {
  const result = describeBackendError('SSH_HOST_KEY_CHALLENGE:{"challengeId":"opaque"}', true)
  expect(result).toContain('核对 SSH 指纹')
  expect(result).not.toContain('opaque')
})
