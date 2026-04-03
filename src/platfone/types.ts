export interface Country {
  country_id: string
  name: string
  alt_name: string
  codes: string[]
}

export interface Service {
  service_id: string
  name: string
  alt_name: string
  has_description: boolean
  has_warning: boolean
  prohibited: boolean
}

export interface Activation {
  activation_id: string
  phone: string
  country_id: string
  service_id: string
  sms_status: 'smsRequested' | 'smsReceived' | 'retryRequested' | 'retryReceived'
  activation_status: 'active' | 'finalized' | 'expired' | 'canceled'
  billing_status: 'reserved' | 'released' | 'billed' | 'refunded'
  report_status: 'inReview' | 'declined' | 'approved' | null
  sms_code: string | null
  sms_text: string | null
  price: number
  expire_at: number
  updated_at: number
  created_at: number
  is_retriable: boolean
  cancelable_after: number | null
}

export interface NewActivationRequest {
  service_id: string
  country_id: string
  max_price?: number
  order_id?: string
  quality_factor?: number
}

export interface PriceInfo {
  price: {
    min: number
    max: number
    suggested: number
  }
  quality: {
    avg: number
  }
  count: number
}

export interface Balance {
  total: number
  reserved: number
}

export interface SuccessResponse {
  result: 'success'
}

export interface CatalogResponse<T> {
  data: T
  etag: string | null
}

export class PlatfoneApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorName: string,
    public readonly errorMessage: string,
    public readonly body?: Record<string, unknown>
  ) {
    super(`Platfone API ${status}: ${errorName} — ${errorMessage}`)
    this.name = 'PlatfoneApiError'
  }
}
