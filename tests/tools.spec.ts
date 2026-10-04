import { describe, expect, it } from 'vitest'
import { PagerDutyClient } from '../src/client.ts'
import { createTools } from '../src/index.ts'

describe('dsh-tool-pagerduty tools', () => {
  it('registers the PagerDuty tool set', () => {
    const client = new PagerDutyClient({ token: 'token' })
    expect(createTools(client).map(tool => tool.name)).toEqual([
      'pagerduty_auth_test',
      'pagerduty_list_services',
      'pagerduty_list_incidents',
      'pagerduty_get_incident',
      'pagerduty_list_on_calls',
      'pagerduty_list_escalation_policies',
      'pagerduty_acknowledge_incident',
      'pagerduty_resolve_incident',
      'pagerduty_list_incident_notes',
      'pagerduty_create_incident_note',
    ])
  })

  it('renders service results', () => {
    const tool = createTools(new PagerDutyClient({ token: 'token' })).find(item => item.name === 'pagerduty_list_services')!
    const view = tool.output.render({}, {
      found: true,
      items: [{ id: 'PS1', name: 'Payments', status: 'active', escalationPolicyName: 'Primary', teamNames: 'Platform' }],
    }) as Array<{ text: string }>
    expect(view[0].text).toContain('Payments (PS1) status=active policy=Primary teams=Platform')
  })

  it('renders incident details and write results', () => {
    const tools = createTools(new PagerDutyClient({ token: 'token' }))
    const detailTool = tools.find(item => item.name === 'pagerduty_get_incident')!
    const detailView = detailTool.output.render({}, {
      found: true,
      incidentNumber: 42,
      id: 'PI1',
      title: 'Latency',
      status: 'triggered',
      urgency: 'high',
      serviceName: 'Payments',
      assignments: [{ userName: 'Alice', userEmail: 'alice@example.com' }],
    }) as Array<{ text: string }>
    expect(detailView[0].text).toContain('#42 Latency (PI1)')
    expect(detailView[0].text).toContain('Alice <alice@example.com>')

    const writeTool = tools.find(item => item.name === 'pagerduty_resolve_incident')!
    const writeView = writeTool.output.render({}, { ok: true, id: 'PI1', status: 'resolved', resolution: 'fixed' }) as Array<{ text: string }>
    expect(writeView[0].text).toContain('Incident PI1 status=resolved')
    expect(writeView[0].text).toContain('resolution=fixed')
  })
})
