import {
  Activation,
  Balance,
  CatalogResponse,
  Country,
  NewActivationRequest,
  PlatfoneApiError,
  PriceInfo,
  Service,
  SuccessResponse
} from './types.ts'

const DEFAULT_BASE_URL = 'https://temp-number-api.com/api/v1'

export interface PlatfoneClientOptions {
  apiKey: string
  baseUrl?: string
}

export class PlatfoneClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(opts: PlatfoneClientOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  async getBalance(): Promise<Balance> {
    return this.get<Balance>('/user/balance')
  }

  async getCountries(etag?: string): Promise<CatalogResponse<Country[]> | null> {
    return this.getCatalog<Country[]>('/activation/countries', etag)
  }

  async getServices(etag?: string): Promise<CatalogResponse<Service[]> | null> {
    return this.getCatalog<Service[]>('/activation/services', etag)
  }

  async getPrice(serviceId: string, countryId: string): Promise<PriceInfo> {
    return this.get<PriceInfo>(
      `/activation/prices/services/${encodeURIComponent(serviceId)}/countries/${encodeURIComponent(countryId)}`
    )
  }

  async orderNumber(req: NewActivationRequest): Promise<Activation> {
    return this.post<Activation>('/activation', req)
  }

  async getActivation(activationId: string): Promise<Activation> {
    return this.get<Activation>(`/activation/${encodeURIComponent(activationId)}`)
  }

  async cancelActivation(activationId: string): Promise<SuccessResponse> {
    return this.put<SuccessResponse>(`/activation/${encodeURIComponent(activationId)}/cancel`)
  }

  async retryActivation(activationId: string): Promise<SuccessResponse> {
    return this.put<SuccessResponse>(`/activation/${encodeURIComponent(activationId)}/retry`)
  }

  // HTTP helpers

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers()
    })
    return this.handleResponse<T>(res)
  }

  private async getCatalog<T>(path: string, etag?: string): Promise<CatalogResponse<T> | null> {
    const headers = this.headers()
    if (etag) {
      headers['If-None-Match'] = etag
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers
    })

    if (res.status === 304) return null

    const data = await this.handleResponse<T>(res)
    return {
      data,
      etag: res.headers.get('x-etag')
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    })
    return this.handleResponse<T>(res)
  }

  private async put<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers()
    })
    return this.handleResponse<T>(res)
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey
    }
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.ok) {
      return (await res.json()) as T
    }

    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      // non-JSON error body — ignore
    }

    throw new PlatfoneApiError(
      res.status,
      (body.errorName as string) ?? 'UnknownError',
      (body.errorMessage as string) ?? res.statusText,
      body
    )
  }
}
