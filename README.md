# dsh-tool-pagerduty

[English](README.md) | [中文](README.zh.md)

PagerDuty integration for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) as a Cordis plugin. The agent can verify credentials, inspect services, incidents, on-call schedules, and escalation policies, and acknowledge or resolve incidents.

## Install

```sh
npm install @libai168/dsh-tool-pagerduty
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies.

## Configuration

```yaml
- name: 'github:LJH-snow/dsh-tool-pagerduty'
  config:
    token: 'u+...'                    # REST API v2 user token
    # fromEmail: 'bot@example.com'    # identity used by write endpoints
    # timeoutMs: 15000
```

Create the token under User Settings > API Access. Write actions require a user token with incident write permission; prefer a dedicated bot account.

## Tools

| Tool | Description | Write |
|---|---|---|
| `pagerduty_auth_test` | Verify the token and return the current user | No |
| `pagerduty_list_services` | List services with search/status filters | No |
| `pagerduty_list_incidents` | List incidents with status/service/urgency/time filters | No |
| `pagerduty_get_incident` | Get one incident with assignments and escalation context | No |
| `pagerduty_list_on_calls` | List current on-call entries | No |
| `pagerduty_list_escalation_policies` | List escalation policies with rule summaries | No |
| `pagerduty_acknowledge_incident` | Acknowledge one incident | Yes |
| `pagerduty_resolve_incident` | Resolve one incident, optionally with a resolution note | Yes |

## Error contract

- Missing token: `{ ok: false, reason }` or `{ found: false, reason }`.
- PagerDuty errors throw `PagerDutyError` (status + `errors` list); tools surface them as normalized failure values.
- Write tools are single-object operations only (`kind: 'edit'`); no bulk or delete actions.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)
