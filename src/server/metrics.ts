import type { CredentialCheckSource, CredentialStatus } from './credential-verifier.ts'

export type AdmissionResult =
  | 'admitted'
  | 'missing_credentials'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'account_limit'
  | 'capacity'
  | 'upstream_unavailable'
  | 'aborted'

export type SessionCloseReason = 'idle' | 'lifetime' | 'revoked' | 'closed' | 'aborted' | 'shutdown'

export interface MetricsGauges {
  activeSessions: number
  pendingAdmissions: number
}

/**
 * Minimal Prometheus text-format metrics. Labels are restricted to fixed enums,
 * so API keys, session IDs and client addresses can never appear here.
 */
export class Metrics {
  readonly admissions = new Map<AdmissionResult, number>()
  readonly credentialChecks = new Map<`${CredentialStatus}:${CredentialCheckSource}`, number>()
  readonly sessionsClosed = new Map<SessionCloseReason, number>()

  admission(result: AdmissionResult) {
    this.admissions.set(result, (this.admissions.get(result) ?? 0) + 1)
  }

  credentialCheck(status: CredentialStatus, source: CredentialCheckSource) {
    const key = `${status}:${source}` as const
    this.credentialChecks.set(key, (this.credentialChecks.get(key) ?? 0) + 1)
  }

  sessionClosed(reason: SessionCloseReason) {
    this.sessionsClosed.set(reason, (this.sessionsClosed.get(reason) ?? 0) + 1)
  }

  render(gauges: MetricsGauges): string {
    const lines = [
      '# HELP mcp_session_admissions_total Session admission attempts by result.',
      '# TYPE mcp_session_admissions_total counter',
      ...[...this.admissions].map(([result, n]) => `mcp_session_admissions_total{result="${result}"} ${n}`),
      '# HELP mcp_credential_checks_total API key checks performed during session admission.',
      '# TYPE mcp_credential_checks_total counter',
      ...[...this.credentialChecks].map(([key, n]) => {
        const [result, source] = key.split(':')
        return `mcp_credential_checks_total{result="${result}",source="${source}"} ${n}`
      }),
      '# HELP mcp_sessions_closed_total Sessions removed from the session pool by reason.',
      '# TYPE mcp_sessions_closed_total counter',
      ...[...this.sessionsClosed].map(([reason, n]) => `mcp_sessions_closed_total{reason="${reason}"} ${n}`),
      '# HELP mcp_active_sessions Sessions currently held in the session pool.',
      '# TYPE mcp_active_sessions gauge',
      `mcp_active_sessions ${gauges.activeSessions}`,
      '# HELP mcp_pending_admissions Session admissions currently being processed.',
      '# TYPE mcp_pending_admissions gauge',
      `mcp_pending_admissions ${gauges.pendingAdmissions}`
    ]
    return lines.join('\n') + '\n'
  }
}
