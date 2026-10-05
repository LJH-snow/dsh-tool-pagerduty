import { describe, expect, it, vi } from 'vitest'
import { PagerDutyClient, PagerDutyError } from '../src/client.ts'
import type { LookupImpl } from '../src/url-security.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const token = 'u+test-token'
const stablePublicLookup: LookupImpl = async () => [{ address: '93.184.216.34', family: 4 }]

function client(fetchImpl: ReturnType<typeof vi.fn>, options: Partial<ConstructorParameters<typeof PagerDutyClient>[0]> = {}) {
  return new PagerDutyClient({ token, fromEmail: 'bot@example.com', lookupImpl: stablePublicLookup, fetchImpl, ...options })
}

describe('PagerDutyClient', () => {
  it('authenticates with token and returns current user', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { id: 'P1', name: 'On Call Bot', email: 'bot@example.com', role: 'admin', html_url: 'https://pd/users/P1' } }))
    const result = await client(fetchImpl).authTest()

    expect(result).toMatchObject({ id: 'P1', name: 'On Call Bot', email: 'bot@example.com', role: 'admin' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.pagerduty.com/users/me')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Token token=u+test-token')
    expect((init.headers as Record<string, string>).from).toBe('bot@example.com')
  })

  it('lists services with filters and pagination', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      services: [{ id: 'PS1', name: 'Payments', status: 'active', description: 'Payment API', html_url: 'https://pd/services/PS1', escalation_policy: { id: 'PE1', summary: 'Primary' }, teams: [{ summary: 'Platform' }] }],
      limit: 1,
      offset: 2,
      total: 5,
    }))
    const result = await client(fetchImpl).listServices({ limit: 1, offset: 2, query: 'pay', statuses: ['active', 'warning'] })

    expect(result).toMatchObject({ limit: 1, offset: 2, total: 5, hasMore: true, nextOffset: 3 })
    expect(result.items[0]).toMatchObject({ id: 'PS1', name: 'Payments', status: 'active', escalationPolicyName: 'Primary', teamNames: 'Platform' })
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/services?')
    expect(url).toContain('limit=1')
    expect(url).toContain('offset=2')
    expect(url).toContain('query=pay')
    expect(url).toContain('statuses%5B%5D=active')
    expect(url).toContain('statuses%5B%5D=warning')
  })

  it('maps incidents and assignments', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      incidents: [{
        id: 'PI1', incident_number: 42, title: 'Database latency', description: 'p95 high', status: 'triggered', urgency: 'high', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z',
        service: { id: 'PS1', summary: 'Payments' },
        escalation_policy: { id: 'PE1', summary: 'Primary' },
        assignments: [{ assignee: { id: 'P1', summary: 'Alice', email: 'alice@example.com' } }],
        html_url: 'https://pd/incidents/PI1',
      }],
      limit: 25,
      offset: 0,
      total: 1,
    }))
    const result = await client(fetchImpl).listIncidents({ statuses: ['triggered'], serviceIds: ['PS1'], urgency: 'high' })

    expect(result.items[0]).toMatchObject({ id: 'PI1', incidentNumber: 42, title: 'Database latency', status: 'triggered', serviceName: 'Payments', escalationPolicyName: 'Primary' })
    expect(result.items[0].assignments[0]).toMatchObject({ userId: 'P1', userName: 'Alice', userEmail: 'alice@example.com' })
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('statuses%5B%5D=triggered')
    expect(url).toContain('service_ids%5B%5D=PS1')
    expect(url).toContain('urgency=high')
  })

  it('gets an incident by id', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ incident: { id: 'PI1', incident_number: 1, summary: 'Recovered', status: 'resolved' } }))
    const result = await client(fetchImpl).getIncident('PI1')
    expect(result).toMatchObject({ id: 'PI1', incidentNumber: 1, title: 'Recovered', status: 'resolved' })
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://api.pagerduty.com/incidents/PI1')
  })

  it('lists on-call entries and escalation policies', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ oncalls: [{ escalation_level: 1, start: '2026-01-01', end: '2026-01-02', schedule: { id: 'PSCH1', summary: 'Primary schedule' }, user: { id: 'P1', summary: 'Alice', email: 'alice@example.com' } }], limit: 25, offset: 0, total: 1 }))
      .mockResolvedValueOnce(jsonResponse({ escalation_policies: [{ id: 'PE1', name: 'Primary', num_loops: 2, rules: [{ escalation_delay_in_minutes: 30, targets: [{ id: 'P1', summary: 'Alice' }] }] }], limit: 25, offset: 0, total: 1 }))
    const pd = client(fetchImpl)
    const onCalls = await pd.listOnCalls({ earliest: true, scheduleIds: ['PSCH1'] })
    const policies = await pd.listEscalationPolicies()

    expect(onCalls.items[0]).toMatchObject({ escalationLevel: 1, scheduleName: 'Primary schedule', userName: 'Alice' })
    expect(policies.items[0]).toMatchObject({ id: 'PE1', name: 'Primary', numLoops: 2, ruleSummary: '30m: Alice' })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('earliest=true')
    expect(url).toContain('schedule_ids%5B%5D=PSCH1')
  })

  it('acknowledges and resolves incidents with the correct body', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ incident: { id: 'PI1', status: 'acknowledged' } }))
      .mockResolvedValueOnce(jsonResponse({ incident: { id: 'PI1', status: 'resolved', resolution: 'Deployed fix' } }))
    const pd = client(fetchImpl)
    const acknowledged = await pd.updateIncidentStatus({ incidentId: 'PI1', status: 'acknowledged' })
    const resolved = await pd.updateIncidentStatus({ incidentId: 'PI1', status: 'resolved', resolution: 'Deployed fix' })

    expect(acknowledged).toMatchObject({ id: 'PI1', status: 'acknowledged' })
    expect(resolved).toMatchObject({ id: 'PI1', status: 'resolved', resolution: 'Deployed fix' })
    const firstInit = (fetchImpl.mock.calls[0] as [string, RequestInit])[1]
    expect(firstInit.method).toBe('PUT')
    expect(JSON.parse(String(firstInit.body))).toEqual({ incident: { type: 'incident_reference', status: 'acknowledged' } })
    const secondInit = (fetchImpl.mock.calls[1] as [string, RequestInit])[1]
    expect(JSON.parse(String(secondInit.body))).toEqual({ incident: { type: 'incident_reference', status: 'resolved', resolution: 'Deployed fix' } })
  })

  it('lists and creates incident notes', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ notes: [{ id: 'N1', content: 'Investigating', created_at: '2026-01-01T00:00:00Z', user: { id: 'P1', summary: 'Alice' } }] }))
      .mockResolvedValueOnce(jsonResponse({ note: { id: 'N2', content: 'Deployed fix', created_at: '2026-01-01T01:00:00Z', user: { id: 'P1', summary: 'Alice' } } }))
    const pd = client(fetchImpl)
    const notes = await pd.listIncidentNotes('PI1')
    const created = await pd.createIncidentNote({ incidentId: 'PI1', content: 'Deployed fix' })

    expect(notes.items[0]).toMatchObject({ id: 'N1', content: 'Investigating', userName: 'Alice' })
    expect(created).toMatchObject({ id: 'N2', content: 'Deployed fix' })
    const createInit = (fetchImpl.mock.calls[1] as [string, RequestInit])[1]
    expect(createInit.method).toBe('POST')
    expect((createInit.headers as Record<string, string>).from).toBe('bot@example.com')
    expect(JSON.parse(String(createInit.body))).toEqual({ note: { content: 'Deployed fix' } })
  })

  it('preserves a custom base URL path prefix while normalizing slashes', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { id: 'P1', name: 'On Call Bot' } }))
    await client(fetchImpl, { baseUrl: 'https://pagerduty.example.test/api///' }).authTest()

    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://pagerduty.example.test/api/users/me')
  })

  it('rejects an invalid base URL during construction without exposing credentials', () => {
    expect(() => new PagerDutyClient({ baseUrl: 'https://user:secret@example.test' })).toThrow(PagerDutyError)
    expect(() => new PagerDutyClient({ baseUrl: 'https://user:secret@example.test' })).not.toThrow('secret')
    expect(() => new PagerDutyClient({ baseUrl: 'ftp://example.test' })).toThrow(PagerDutyError)
    expect(() => new PagerDutyClient({ baseUrl: 'https://example.test/?token=secret' })).toThrow(PagerDutyError)
  })

  it.each([
    'https://localhost',
    'https://service.localhost',
    'https://localhost.localdomain',
    'https://service.local',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://192.0.2.1',
    'https://198.18.0.1',
    'https://224.0.0.1',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fe80::1]',
    'https://[::ffff:10.0.0.1]',
    'https://[2001:db8::1]',
    'https://[ff02::1]',
    // IANA special-purpose blocks that previously slipped through.
    'https://192.175.48.1',
    'https://[fec0::1]',
    'https://[2001:3::1]',
    'https://[2001:4:112::1]',
    'https://[2001:20::1]',
    'https://[2001:30::1]',
    'https://[5f00::1]',
    'https://[100:0:0:1::1]',
    'https://[2620:4f:8000::1]',
  ])('rejects unsafe literal destination %s before fetch', async baseUrl => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: {} }))
    await expect(client(fetchImpl, { baseUrl }).authTest()).rejects.toThrow(PagerDutyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when DNS resolves a hostname to a private address or mismatched family', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: {} }))
    for (const lookupImpl of [
      async () => [{ address: '10.0.0.7', family: 4 }],
      async () => [{ address: '93.184.216.34', family: 6 }],
      async () => [{ address: '2001:db8::1', family: 4 }],
    ] satisfies LookupImpl[]) {
      await expect(client(fetchImpl, { baseUrl: 'https://pagerduty.example.test', lookupImpl }).authTest()).rejects.toThrow(PagerDutyError)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed when DNS resolution fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: {} }))
    const lookupImpl: LookupImpl = async () => {
      throw new Error('DNS unavailable')
    }

    await expect(client(fetchImpl, { baseUrl: 'https://pagerduty.example.test', lookupImpl }).authTest()).rejects.toThrow(PagerDutyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws on missing token and maps HTTP errors', async () => {
    const noToken = new PagerDutyClient({})
    await expect(noToken.authTest()).rejects.toThrow(PagerDutyError)

    const fetchImpl = vi.fn(async () => jsonResponse({ errors: ['Invalid API token'] }, 401))
    await expect(client(fetchImpl).authTest()).rejects.toThrow('Invalid API token')
  })
})
