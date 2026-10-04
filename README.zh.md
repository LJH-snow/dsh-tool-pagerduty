# dsh-tool-pagerduty

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）提供 PagerDuty 集成能力的 Cordis 工具插件。Agent 可以验证凭证，查看服务、事件、值班和升级策略，并确认或解决事件。

## 安装

```sh
npm install @libai168/dsh-tool-pagerduty
```

需要 `@deepseek-ai/cordis`（^4.0.1）与 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）作为 peer 依赖。

## 配置

```yaml
- name: 'github:LJH-snow/dsh-tool-pagerduty'
  config:
    token: 'u+...'                    # REST API v2 用户 token
    # fromEmail: 'bot@example.com'    # 写接口使用的身份邮箱
    # timeoutMs: 15000
```

在 PagerDuty 的 User Settings > API Access 创建 token。写操作需要具备事件写权限的用户 token，建议使用专用 bot 账号。

## 工具

| 工具 | 说明 | 写操作 |
|---|---|---|
| `pagerduty_auth_test` | 验证 token 并返回当前用户 | 否 |
| `pagerduty_list_services` | 按搜索/状态过滤服务列表 | 否 |
| `pagerduty_list_incidents` | 按状态/服务/紧急度/时间过滤事件列表 | 否 |
| `pagerduty_get_incident` | 查看单个事件详情与指派、升级上下文 | 否 |
| `pagerduty_list_on_calls` | 查看当前值班条目 | 否 |
| `pagerduty_list_escalation_policies` | 查看升级策略与规则摘要 | 否 |
| `pagerduty_acknowledge_incident` | 确认一个事件 | 是 |
| `pagerduty_resolve_incident` | 解决一个事件，可附解决说明 | 是 |

## 错误契约

- 未配置 token：`{ ok: false, reason }` 或 `{ found: false, reason }`。
- PagerDuty 错误抛 `PagerDutyError`（含状态码与 errors 列表），工具层统一转为规范化失败值。
- 写工具只做单对象操作（`kind: 'edit'`），不提供批量或删除。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

## 许可证

[MIT](LICENSE)
