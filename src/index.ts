import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PagerDutyClient, PagerDutyError } from './client.js'

export const name = 'dsh-tool-pagerduty'
export const inject = ['tools']

export interface PagerDutyPluginConfig {
  token?: string
  baseUrl?: string
  fromEmail?: string
  timeoutMs?: number
}

export function apply(ctx: Context, config: PagerDutyPluginConfig = {}) {
  const client = new PagerDutyClient(config)
  for (const tool of createTools(client)) ctx.tools.register(tool)
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }]
}

function unavailable(reason: string) {
  return { found: false, items: [], hasMore: false, nextOffset: 0, reason }
}

function errorReason(error: unknown): string {
  return error instanceof PagerDutyError ? error.message : error instanceof Error ? error.message : String(error)
}

function renderServices(items: Array<{ id?: string; name?: string; status?: string; escalationPolicyName?: string; teamNames?: string }>) {
  if (!items.length) return text('No PagerDuty services found.')
  return text(items.map(service => `${service.name ?? ''} (${service.id ?? ''}) status=${service.status ?? ''} policy=${service.escalationPolicyName ?? ''} teams=${service.teamNames ?? ''}`).join('\n'))
}

function renderIncidents(items: Array<{ id?: string; incidentNumber?: number; title?: string; status?: string; urgency?: string; serviceName?: string; assignments?: Array<{ userName?: string }> }>) {
  if (!items.length) return text('No PagerDuty incidents found.')
  return text(items.map(incident => {
    const assignees = incident.assignments?.map(assignment => assignment.userName ?? '').filter(Boolean).join(', ') ?? ''
    return `#${incident.incidentNumber ?? ''} ${incident.title ?? ''} (${incident.id ?? ''}) status=${incident.status ?? ''} urgency=${incident.urgency ?? ''} service=${incident.serviceName ?? ''} assignees=${assignees}`
  }).join('\n'))
}

function renderOnCalls(items: Array<{ escalationLevel?: number; start?: string; end?: string; scheduleName?: string; userName?: string; userEmail?: string }>) {
  if (!items.length) return text('No PagerDuty on-call entries found.')
  return text(items.map(onCall => `level=${onCall.escalationLevel ?? 0} ${onCall.userName ?? ''} <${onCall.userEmail ?? ''}> schedule=${onCall.scheduleName ?? ''} ${onCall.start ?? ''} -> ${onCall.end ?? ''}`).join('\n'))
}

function renderPolicies(items: Array<{ id?: string; name?: string; numLoops?: number; ruleSummary?: string }>) {
  if (!items.length) return text('No PagerDuty escalation policies found.')
  return text(items.map(policy => `${policy.name ?? ''} (${policy.id ?? ''}) loops=${policy.numLoops ?? 0} rules=${policy.ruleSummary ?? ''}`).join('\n'))
}

function clip(value: string | undefined, limit: number): string {
  return (value ?? '').slice(0, limit)
}

function renderNotes(items: Array<{ id?: string; content?: string; createdAt?: string; userName?: string }>) {
  if (!items.length) return text('No PagerDuty incident notes found.')
  return text(items.map(note => `[${note.createdAt ?? ''}] ${note.userName ?? ''}\n${clip(note.content, 800)}`).join('\n\n'))
}

function renderIncident(value: {
  id?: string
  incidentNumber?: number
  title?: string
  description?: string
  status?: string
  urgency?: string
  createdAt?: string
  updatedAt?: string
  serviceName?: string
  escalationPolicyName?: string
  assignments?: Array<{ userName?: string; userEmail?: string }>
  htmlUrl?: string
}) {
  const assignees = value.assignments?.map(assignment => `${assignment.userName ?? ''} <${assignment.userEmail ?? ''}>`).join(', ') ?? ''
  return text([
    `#${value.incidentNumber ?? ''} ${value.title ?? ''} (${value.id ?? ''})`,
    `status=${value.status ?? ''} urgency=${value.urgency ?? ''}`,
    `service=${value.serviceName ?? ''} policy=${value.escalationPolicyName ?? ''}`,
    `created=${value.createdAt ?? ''} updated=${value.updatedAt ?? ''}`,
    `assignees=${assignees}`,
    value.description ? `description=${value.description}` : '',
    value.htmlUrl ? `url=${value.htmlUrl}` : '',
  ].filter(Boolean).join('\n'))
}

export function createTools(client: PagerDutyClient) {
  return [
    defineTool({
      name: 'pagerduty_auth_test',
      description: 'Verify the PagerDuty REST API token and return the current user.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
          },
        },
        render: (_args, value) => value.ok
          ? text(`${value.name ?? ''} (${value.id ?? ''})\nemail=${value.email ?? ''} role=${value.role ?? ''}`)
          : text(`PagerDuty auth failed: ${value.reason ?? ''}`),
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'Verify PagerDuty credentials', kind: 'read' }
      },
      async execute(_args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'PagerDuty token is not configured.' }
        try {
          return { ok: true, ...await client.authTest(exec.signal) }
        } catch (error) {
          return { ok: false, reason: errorReason(error) }
        }
      },
    }),

    defineTool({
      name: 'pagerduty_list_services',
      description: 'List PagerDuty services with optional search, status filters, and pagination.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 25)' },
        offset: { type: 'integer', description: 'Offset from a previous response (default 0)' },
        query: { type: 'string', description: 'Search services by name' },
        statuses: { type: 'array', items: { type: 'string' }, description: 'Service statuses such as active or warning' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean' }, reason: { type: 'string' },
            items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, description: { type: 'string' },
              htmlUrl: { type: 'string' }, escalationPolicyId: { type: 'string' }, escalationPolicyName: { type: 'string' }, teamNames: { type: 'string' },
            }}},
            limit: { type: 'number' }, offset: { type: 'number' }, total: { type: 'number' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'number' },
          },
        },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderServices(value.items ?? []),
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'PagerDuty services', kind: 'search' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('PagerDuty token is not configured.')
        try {
          return { found: true, ...await client.listServices({ limit: args.limit as number, offset: args.offset as number, query: args.query as string, statuses: args.statuses as string[], signal: exec.signal }) }
        } catch (error) {
          return unavailable(errorReason(error))
        }
      },
    }),

    defineTool({
      name: 'pagerduty_list_incidents',
      description: 'List PagerDuty incidents with status, service, urgency, time-range filters, and pagination.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 25)' },
        offset: { type: 'integer', description: 'Offset from a previous response (default 0)' },
        statuses: { type: 'array', items: { type: 'string' }, description: 'Incident statuses such as triggered, acknowledged, or resolved' },
        serviceIds: { type: 'array', items: { type: 'string' }, description: 'Filter by service IDs' },
        teamIds: { type: 'array', items: { type: 'string' }, description: 'Filter by team IDs' },
        urgency: { type: 'string', description: 'Filter by high or low urgency' },
        since: { type: 'string', description: 'ISO-8601 start time' },
        until: { type: 'string', description: 'ISO-8601 end time' },
        sortBy: { type: 'string', description: 'Sort field, e.g. created_at:desc' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean' }, reason: { type: 'string' },
            items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              id: { type: 'string' }, incidentNumber: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' },
              status: { type: 'string' }, urgency: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
              serviceId: { type: 'string' }, serviceName: { type: 'string' }, escalationPolicyId: { type: 'string' }, escalationPolicyName: { type: 'string' },
              assignments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { userId: { type: 'string' }, userName: { type: 'string' }, userEmail: { type: 'string' } }}}, htmlUrl: { type: 'string' },
            }}},
            limit: { type: 'number' }, offset: { type: 'number' }, total: { type: 'number' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'number' },
          },
        },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderIncidents(value.items ?? []),
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'PagerDuty incidents', kind: 'search' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('PagerDuty token is not configured.')
        try {
          return { found: true, ...await client.listIncidents({
            limit: args.limit as number, offset: args.offset as number, statuses: args.statuses as string[], serviceIds: args.serviceIds as string[], teamIds: args.teamIds as string[],
            urgency: args.urgency as string, since: args.since as string, until: args.until as string, sortBy: args.sortBy as string, signal: exec.signal,
          }) }
        } catch (error) {
          return unavailable(errorReason(error))
        }
      },
    }),

    defineTool({
      name: 'pagerduty_get_incident',
      description: 'Get one PagerDuty incident by ID with assignments and escalation context.',
      parameters: { incidentId: { type: 'string', required: true, description: 'PagerDuty incident ID' } },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, incidentNumber: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' },
            status: { type: 'string' }, urgency: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, serviceId: { type: 'string' }, serviceName: { type: 'string' },
            escalationPolicyId: { type: 'string' }, escalationPolicyName: { type: 'string' }, assignments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { userId: { type: 'string' }, userName: { type: 'string' }, userEmail: { type: 'string' } }}}, htmlUrl: { type: 'string' },
          },
        },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderIncident(value),
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `PagerDuty incident ${args.incidentId ?? ''}`, kind: 'read' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { found: false, reason: 'PagerDuty token is not configured.' }
        if (!args.incidentId) return { found: false, reason: 'incidentId is required.' }
        try {
          return { found: true, ...await client.getIncident(args.incidentId as string, exec.signal) }
        } catch (error) {
          return { found: false, reason: errorReason(error) }
        }
      },
    }),

    defineTool({
      name: 'pagerduty_list_on_calls',
      description: 'List current PagerDuty on-call entries with optional schedule or user filters.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 25)' },
        offset: { type: 'integer', description: 'Offset from a previous response (default 0)' },
        earliest: { type: 'boolean', description: 'Return the earliest on-call per escalation level' },
        scheduleIds: { type: 'array', items: { type: 'string' }, description: 'Filter by schedule IDs' },
        userIds: { type: 'array', items: { type: 'string' }, description: 'Filter by user IDs' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean' }, reason: { type: 'string' },
            items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              escalationLevel: { type: 'number' }, start: { type: 'string' }, end: { type: 'string' }, scheduleId: { type: 'string' }, scheduleName: { type: 'string' }, userId: { type: 'string' }, userName: { type: 'string' }, userEmail: { type: 'string' },
            }}},
            limit: { type: 'number' }, offset: { type: 'number' }, total: { type: 'number' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'number' },
          },
        },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderOnCalls(value.items ?? []),
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'PagerDuty on-call', kind: 'search' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('PagerDuty token is not configured.')
        try {
          return { found: true, ...await client.listOnCalls({ limit: args.limit as number, offset: args.offset as number, earliest: args.earliest as boolean, scheduleIds: args.scheduleIds as string[], userIds: args.userIds as string[], signal: exec.signal }) }
        } catch (error) {
          return unavailable(errorReason(error))
        }
      },
    }),

    defineTool({
      name: 'pagerduty_list_escalation_policies',
      description: 'List PagerDuty escalation policies with rule target summaries and pagination.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results per page, 1-100 (default 25)' },
        offset: { type: 'integer', description: 'Offset from a previous response (default 0)' },
        query: { type: 'string', description: 'Search policies by name' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            found: { type: 'boolean' }, reason: { type: 'string' },
            items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, numLoops: { type: 'number' }, ruleSummary: { type: 'string' } }}},
            limit: { type: 'number' }, offset: { type: 'number' }, total: { type: 'number' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'number' },
          },
        },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderPolicies(value.items ?? []),
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'PagerDuty escalation policies', kind: 'search' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('PagerDuty token is not configured.')
        try {
          return { found: true, ...await client.listEscalationPolicies({ limit: args.limit as number, offset: args.offset as number, query: args.query as string, signal: exec.signal }) }
        } catch (error) {
          return unavailable(errorReason(error))
        }
      },
    }),

    defineTool({
      name: 'pagerduty_acknowledge_incident',
      description: 'Acknowledge a PagerDuty incident. WRITE operation.',
      parameters: { incidentId: { type: 'string', required: true, description: 'PagerDuty incident ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, status: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`Incident ${value.id ?? ''} status=${value.status ?? 'acknowledged'}`) : text(`Failed to acknowledge incident: ${value.reason ?? ''}`),
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Acknowledge incident ${args.incidentId ?? ''}`, kind: 'edit' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'PagerDuty token is not configured.' }
        if (!args.incidentId) return { ok: false, reason: 'incidentId is required.' }
        try {
          return { ok: true, ...await client.updateIncidentStatus({ incidentId: args.incidentId as string, status: 'acknowledged', signal: exec.signal }) }
        } catch (error) {
          return { ok: false, reason: errorReason(error) }
        }
      },
    }),

    defineTool({
      name: 'pagerduty_resolve_incident',
      description: 'Resolve a PagerDuty incident, optionally recording a resolution note. WRITE operation.',
      parameters: {
        incidentId: { type: 'string', required: true, description: 'PagerDuty incident ID' },
        resolution: { type: 'string', description: 'Optional resolution note' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, status: { type: 'string' }, resolution: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`Incident ${value.id ?? ''} status=${value.status ?? 'resolved'}${value.resolution ? `\nresolution=${value.resolution}` : ''}`) : text(`Failed to resolve incident: ${value.reason ?? ''}`),
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Resolve incident ${args.incidentId ?? ''}`, kind: 'edit' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'PagerDuty token is not configured.' }
        if (!args.incidentId) return { ok: false, reason: 'incidentId is required.' }
        try {
          return { ok: true, ...await client.updateIncidentStatus({ incidentId: args.incidentId as string, status: 'resolved', resolution: args.resolution as string, signal: exec.signal }) }
        } catch (error) {
          return { ok: false, reason: errorReason(error) }
        }
      },
    }),

    defineTool({
      name: 'pagerduty_list_incident_notes',
      description: 'List notes on one PagerDuty incident.',
      parameters: { incidentId: { type: 'string', required: true, description: 'PagerDuty incident ID' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { found: { type: 'boolean' }, reason: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, content: { type: 'string' }, createdAt: { type: 'string' }, userId: { type: 'string' }, userName: { type: 'string' } } } } } },
        render: (_args, value) => !value.found ? text(value.reason ?? 'PagerDuty is not configured.') : renderNotes(value.items ?? []),
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Incident notes ${args.incidentId ?? ''}`, kind: 'search' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('PagerDuty token is not configured.')
        if (!args.incidentId) return unavailable('incidentId is required.')
        try {
          return { found: true, ...await client.listIncidentNotes(args.incidentId as string, exec.signal) }
        } catch (error) {
          return unavailable(errorReason(error))
        }
      },
    }),

    defineTool({
      name: 'pagerduty_create_incident_note',
      description: 'Add a note to one PagerDuty incident. WRITE operation; requires fromEmail config.',
      parameters: {
        incidentId: { type: 'string', required: true, description: 'PagerDuty incident ID' },
        content: { type: 'string', required: true, description: 'Note content (clipped to 2000 characters)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, id: { type: 'string' }, content: { type: 'string' }, createdAt: { type: 'string' }, userName: { type: 'string' } } },
        render: (_args, value) => value.ok ? text(`Note ${value.id ?? ''} added at ${value.createdAt ?? ''}\n${clip(value.content, 800)}`) : text(`Failed to add note: ${value.reason ?? ''}`),
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Add note to incident ${args.incidentId ?? ''}`, kind: 'edit' }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) return { ok: false, reason: 'PagerDuty token is not configured.' }
        if (!args.incidentId || !args.content) return { ok: false, reason: 'incidentId and content are required.' }
        try {
          const note = await client.createIncidentNote({ incidentId: args.incidentId as string, content: clip(args.content as string, 2000), signal: exec.signal })
          return { ok: true, id: note.id, content: clip(note.content, 800), createdAt: note.createdAt, userName: note.userName }
        } catch (error) {
          return { ok: false, reason: errorReason(error) }
        }
      },
    }),
  ]
}
