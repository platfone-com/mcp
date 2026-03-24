import { PlatfoneApiError } from '../platfone/types.ts'

export function humanReadableExpiry(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  if (isNaN(d.getTime())) return '(invalid date)'

  const formatted = d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })

  const diffSec = unixSeconds - Math.floor(Date.now() / 1000)
  if (diffSec <= 0) return `${formatted} (expired)`

  const m = Math.floor(diffSec / 60)
  const s = diffSec % 60
  const remaining = m > 0 ? `${m}m ${s}s` : `${s}s`
  return `${formatted} (in ${remaining})`
}

export function formatError(err: unknown) {
  if (err instanceof PlatfoneApiError) {
    const hints: Record<number, string> = {
      401: 'Invalid or missing API key. Check your PLATFONE_API_KEY.',
      402: 'Insufficient balance. Top up your Platfone account.',
      403: 'Account on hold. Check your Platfone dashboard.',
      404: 'Resource not found. Verify IDs are correct.',
      429: 'Rate limited. Wait a moment and try again.',
      503: 'Platfone service temporarily unavailable. Try again later.'
    }
    const hint = hints[err.status] ?? ''
    const text = `❌ ${err.errorName}: ${err.errorMessage}${hint ? `\n💡 ${hint}` : ''}`
    return { content: [{ type: 'text' as const, text }], isError: true }
  }

  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text' as const, text: `❌ Unexpected error: ${msg}` }], isError: true }
}

export function formatSmsReceived(activation: {
  sms_code: string | null
  sms_text: string | null
  phone: string
  activation_id: string
}): string {

  const lines = [
    `✅ SMS received!`,
    `📋 Code: ${activation.sms_code ?? '(no code parsed)'}`,
    `📝 Message: ${activation.sms_text ?? '(empty)'}`,
    `📱 +${activation.phone} | 🆔 ${activation.activation_id}`
  ]

  return lines.join('\n')
}

