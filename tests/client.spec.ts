import { describe, expect, it, vi } from 'vitest'
import { PagerDutyClient, PagerDutyError } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const token = 'u+test-token'

function client(fetchImpl: ReturnType<typeof vi.fn>) {
  return new PagerDutyClient({ token, fromEmail: 'bot@example.com', fetchImpl })
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

  it('throws on missing token and maps HTTP errors', async () => {
    const noToken = new PagerDutyClient({})
    await expect(noToken.authTest()).rejects.toThrow(PagerDutyError)

    const fetchImpl = vi.fn(async () => jsonResponse({ errors: ['Invalid API token'] }, 401))
    await expect(client(fetchImpl).authTest()).rejects.toThrow('Invalid API token')
  })
})
