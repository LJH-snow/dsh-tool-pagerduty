/** PagerDuty REST API v2 client with injected fetch for testability. */

export interface PagerDutyClientOptions {
  /** PagerDuty REST API user token. */
  token?: string
  /** PagerDuty API base URL. Defaults to https://api.pagerduty.com. */
  baseUrl?: string
  /** Optional email identity used by PagerDuty write endpoints. */
  fromEmail?: string
  /** Request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class PagerDutyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors: string[] = [],
  ) {
    super(message)
    this.name = 'PagerDutyError'
  }
}

export interface PagerDutyUserInfo {
  id: string
  name: string
  email: string
  role: string
  htmlUrl: string
}

export interface PagerDutyServiceInfo {
  id: string
  name: string
  status: string
  description: string
  htmlUrl: string
  escalationPolicyId: string
  escalationPolicyName: string
  teamNames: string
}

export interface PagerDutyIncidentAssignment {
  userId: string
  userName: string
  userEmail: string
}

export interface PagerDutyIncidentInfo {
  id: string
  incidentNumber: number
  title: string
  description: string
  status: string
  urgency: string
  createdAt: string
  updatedAt: string
  serviceId: string
  serviceName: string
  escalationPolicyId: string
  escalationPolicyName: string
  assignments: PagerDutyIncidentAssignment[]
  htmlUrl: string
}

export interface PagerDutyOnCallInfo {
  escalationLevel: number
  start: string
  end: string
  scheduleId: string
  scheduleName: string
  userId: string
  userName: string
  userEmail: string
}

export interface PagerDutyEscalationRuleInfo {
  delayMinutes: number
  targets: string
}

export interface PagerDutyEscalationPolicyInfo {
  id: string
  name: string
  description: string
  numLoops: number
  ruleSummary: string
}

export interface PagerDutyPage<T> {
  items: T[]
  limit: number
  offset: number
  total: number
  hasMore: boolean
  nextOffset: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function mapUser(value: unknown): PagerDutyUserInfo {
  const r = asRecord(value)
  return {
    id: asString(r, 'id'),
    name: asString(r, 'name') || asString(r, 'summary'),
    email: asString(r, 'email'),
    role: asString(r, 'role'),
    htmlUrl: asString(r, 'html_url'),
  }
}

function mapService(value: unknown): PagerDutyServiceInfo {
  const r = asRecord(value)
  const policy = asRecord(r.escalation_policy)
  const teamNames = asArray(r.teams).map(team => {
    const item = asRecord(team)
    return asString(item, 'summary') || asString(item, 'name')
  }).filter(Boolean).join(', ')
  return {
    id: asString(r, 'id'),
    name: asString(r, 'name') || asString(r, 'summary'),
    status: asString(r, 'status'),
    description: asString(r, 'description'),
    htmlUrl: asString(r, 'html_url'),
    escalationPolicyId: asString(policy, 'id'),
    escalationPolicyName: asString(policy, 'summary') || asString(policy, 'name'),
    teamNames,
  }
}

function mapIncident(value: unknown): PagerDutyIncidentInfo {
  const r = asRecord(value)
  const service = asRecord(r.service)
  const policy = asRecord(r.escalation_policy)
  const assignments = asArray(r.assignments).map(assignment => {
    const assignee = asRecord(asRecord(assignment).assignee)
    return {
      userId: asString(assignee, 'id'),
      userName: asString(assignee, 'summary') || asString(assignee, 'name'),
      userEmail: asString(assignee, 'email'),
    }
  })
  return {
    id: asString(r, 'id'),
    incidentNumber: asNumber(r, 'incident_number'),
    title: asString(r, 'title') || asString(r, 'summary'),
    description: asString(r, 'description'),
    status: asString(r, 'status'),
    urgency: asString(r, 'urgency'),
    createdAt: asString(r, 'created_at'),
    updatedAt: asString(r, 'updated_at'),
    serviceId: asString(service, 'id'),
    serviceName: asString(service, 'summary') || asString(service, 'name'),
    escalationPolicyId: asString(policy, 'id'),
    escalationPolicyName: asString(policy, 'summary') || asString(policy, 'name'),
    assignments,
    htmlUrl: asString(r, 'html_url'),
  }
}

function mapOnCall(value: unknown): PagerDutyOnCallInfo {
  const r = asRecord(value)
  const schedule = asRecord(r.schedule)
  const user = asRecord(r.user)
  return {
    escalationLevel: asNumber(r, 'escalation_level'),
    start: asString(r, 'start'),
    end: asString(r, 'end'),
    scheduleId: asString(schedule, 'id'),
    scheduleName: asString(schedule, 'summary') || asString(schedule, 'name'),
    userId: asString(user, 'id'),
    userName: asString(user, 'summary') || asString(user, 'name'),
    userEmail: asString(user, 'email'),
  }
}

function mapEscalationPolicy(value: unknown): PagerDutyEscalationPolicyInfo {
  const r = asRecord(value)
  const rules = asArray(r.rules).map(rule => {
    const rr = asRecord(rule)
    const targets = asArray(rr.targets).map(target => {
      const tr = asRecord(target)
      return asString(tr, 'summary') || asString(tr, 'name') || asString(tr, 'id')
    }).filter(Boolean).join(', ')
    return `${asNumber(rr, 'escalation_delay_in_minutes')}m: ${targets}`
  })
  return {
    id: asString(r, 'id'),
    name: asString(r, 'name') || asString(r, 'summary'),
    description: asString(r, 'description'),
    numLoops: asNumber(r, 'num_loops'),
    ruleSummary: rules.join(' | '),
  }
}

function mapPage<T>(
  root: Record<string, unknown>,
  key: string,
  mapper: (value: unknown) => T,
  requestedLimit: number,
  requestedOffset: number,
): PagerDutyPage<T> {
  const rawItems = asArray(root[key])
  const limit = asNumber(root, 'limit') || requestedLimit
  const offset = asNumber(root, 'offset') || requestedOffset
  const total = asNumber(root, 'total')
  const hasMore = total > 0 ? offset + rawItems.length < total : rawItems.length >= limit
  return {
    items: rawItems.map(mapper),
    limit,
    offset,
    total,
    hasMore,
    nextOffset: hasMore ? offset + rawItems.length : offset,
  }
}

function addParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value)) {
    for (const item of value) addParam(params, key, item)
    return
  }
  params.append(key, String(value))
}

export class PagerDutyClient {
  private readonly token: string
  private readonly baseUrl: string
  private readonly fromEmail: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: PagerDutyClientOptions = {}) {
    this.token = options.token ?? ''
    this.baseUrl = (options.baseUrl ?? 'https://api.pagerduty.com').replace(/\/+$/, '')
    this.fromEmail = options.fromEmail ?? ''
    this.timeoutMs = options.timeoutMs ?? 15000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  hasCredentials(): boolean {
    return Boolean(this.token)
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    options: { params?: Record<string, unknown>; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!this.hasCredentials()) throw new PagerDutyError('PagerDuty token not configured.', 401)
    const url = new URL(`${this.baseUrl}${path}`)
    if (options.params) {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(options.params)) addParam(search, key, value)
      url.search = search.toString()
    }
    const headers: Record<string, string> = {
      authorization: `Token token=${this.token}`,
      accept: 'application/vnd.pagerduty+json;version=2',
    }
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (this.fromEmail) headers.from = this.fromEmail
    const controller = new AbortController()
    const combined = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const timer = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: combined,
      })
      const raw = await response.text()
      let json: unknown = {}
      if (raw) {
        try { json = JSON.parse(raw) } catch { json = {} }
      }
      if (!response.ok) {
        const record = asRecord(json)
        const errors = asArray(record.errors).map(error => String(error)).filter(Boolean)
        const message = errors.join('; ') || raw.slice(0, 300) || response.statusText
        throw new PagerDutyError(`PagerDuty API ${method} ${path} returned HTTP ${response.status}: ${message}`, response.status, errors)
      }
      return json as T
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async authTest(signal?: AbortSignal): Promise<PagerDutyUserInfo> {
    const raw = await this.request<{ user?: unknown }>('GET', '/users/me', { signal })
    return mapUser(asRecord(raw).user)
  }

  async listServices(options: {
    limit?: number
    offset?: number
    query?: string
    statuses?: string[]
    signal?: AbortSignal
  } = {}): Promise<PagerDutyPage<PagerDutyServiceInfo>> {
    const limit = options.limit ?? 25
    const offset = options.offset ?? 0
    const raw = await this.request<Record<string, unknown>>('GET', '/services', {
      params: { limit, offset, query: options.query, 'statuses[]': options.statuses },
      signal: options.signal,
    })
    return mapPage(raw, 'services', mapService, limit, offset)
  }

  async listIncidents(options: {
    limit?: number
    offset?: number
    statuses?: string[]
    serviceIds?: string[]
    teamIds?: string[]
    urgency?: string
    since?: string
    until?: string
    sortBy?: string
    signal?: AbortSignal
  } = {}): Promise<PagerDutyPage<PagerDutyIncidentInfo>> {
    const limit = options.limit ?? 25
    const offset = options.offset ?? 0
    const raw = await this.request<Record<string, unknown>>('GET', '/incidents', {
      params: {
        limit,
        offset,
        'statuses[]': options.statuses,
        'service_ids[]': options.serviceIds,
        'team_ids[]': options.teamIds,
        urgency: options.urgency,
        since: options.since,
        until: options.until,
        sort_by: options.sortBy,
      },
      signal: options.signal,
    })
    return mapPage(raw, 'incidents', mapIncident, limit, offset)
  }

  async getIncident(incidentId: string, signal?: AbortSignal): Promise<PagerDutyIncidentInfo> {
    const raw = await this.request<{ incident?: unknown }>('GET', `/incidents/${encodeURIComponent(incidentId)}`, { signal })
    return mapIncident(asRecord(raw).incident)
  }

  async listOnCalls(options: {
    limit?: number
    offset?: number
    earliest?: boolean
    scheduleIds?: string[]
    userIds?: string[]
    signal?: AbortSignal
  } = {}): Promise<PagerDutyPage<PagerDutyOnCallInfo>> {
    const limit = options.limit ?? 25
    const offset = options.offset ?? 0
    const raw = await this.request<Record<string, unknown>>('GET', '/oncalls', {
      params: {
        limit,
        offset,
        earliest: options.earliest,
        'schedule_ids[]': options.scheduleIds,
        'user_ids[]': options.userIds,
      },
      signal: options.signal,
    })
    return mapPage(raw, 'oncalls', mapOnCall, limit, offset)
  }

  async listEscalationPolicies(options: {
    limit?: number
    offset?: number
    query?: string
    signal?: AbortSignal
  } = {}): Promise<PagerDutyPage<PagerDutyEscalationPolicyInfo>> {
    const limit = options.limit ?? 25
    const offset = options.offset ?? 0
    const raw = await this.request<Record<string, unknown>>('GET', '/escalation_policies', {
      params: { limit, offset, query: options.query },
      signal: options.signal,
    })
    return mapPage(raw, 'escalation_policies', mapEscalationPolicy, limit, offset)
  }

  async updateIncidentStatus(options: {
    incidentId: string
    status: 'acknowledged' | 'resolved'
    resolution?: string
    signal?: AbortSignal
  }): Promise<{ id: string; status: string; resolution: string }> {
    const incident: Record<string, string> = {
      type: 'incident_reference',
      status: options.status,
    }
    if (options.resolution) incident.resolution = options.resolution
    const raw = await this.request<{ incident?: unknown }>('PUT', `/incidents/${encodeURIComponent(options.incidentId)}`, {
      body: { incident },
      signal: options.signal,
    })
    const result = asRecord(asRecord(raw).incident)
    return {
      id: asString(result, 'id') || options.incidentId,
      status: asString(result, 'status') || options.status,
      resolution: asString(result, 'resolution') || options.resolution || '',
    }
  }
}
