import { PlatfoneApiError } from '../platfone/types.ts'
import { CatalogCache } from '../platfone/catalog-cache.ts'

type ToolError = { content: [{ type: 'text'; text: string }]; isError: true }
type Resolved = { country: { country_id: string; name: string }; service: { service_id: string; name: string } }

export async function resolveCountryAndService(
  catalog: CatalogCache,
  country: string,
  service: string
): Promise<Resolved | ToolError> {
  const resolvedCountry = await catalog.resolveCountryId(country)
  if (!resolvedCountry) {
    return {
      content: [
        { type: 'text', text: `❌ Country "${country}" not found.` }
      ],
      isError: true
    }
  }
  if ('ambiguous' in resolvedCountry) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ "${country}" is ambiguous — matches multiple countries:\n${resolvedCountry.ambiguous.map((n) => `  • ${n}`).join('\n')}\nPlease specify the full country name or country_id.`
        }
      ],
      isError: true
    }
  }

  const resolvedService = await catalog.resolveServiceId(service)
  if (!resolvedService) {
    return {
      content: [
        { type: 'text', text: `❌ Service "${service}" not found.` }
      ],
      isError: true
    }
  }
  if ('ambiguous' in resolvedService) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ "${service}" is ambiguous — matches multiple services:\n${resolvedService.ambiguous.map((n) => `  • ${n}`).join('\n')}\nPlease specify the full service name or service_id.`
        }
      ],
      isError: true
    }
  }

  return { country: resolvedCountry, service: resolvedService }
}

export function isToolError(result: Resolved | ToolError): result is ToolError {
  return 'isError' in result
}

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

export function formatCancelability(cancelableAfter: number | null): string {
  if (cancelableAfter == null) {
    return `🚫 Cancelable: No (expires automatically)`
  }

  const nowSec = Math.floor(Date.now() / 1000)
  if (nowSec >= cancelableAfter) {
    return `🚫 Can cancel now via cancel_activation.`
  }

  return `⏳ Cancel available after ${humanReadableExpiry(cancelableAfter)}`
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
