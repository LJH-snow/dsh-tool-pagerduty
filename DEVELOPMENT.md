# dsh-tool-pagerduty 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-pagerduty` |
| 定位 | DeepSeek Harness 的事件/值班响应插件 |
| 版本 | v0.3.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | PagerDuty REST API v2（`application/vnd.pagerduty+json;version=2`） |
| 认证 | `Token token=<user-token>` 请求头 + 可选 `From` 邮箱 |

### 1.1 目录

```text
src/client.ts       PagerDutyClient：fetch/DNS lookup 注入、15s 超时、AbortSignal 透传、URL 安全校验、错误映射
src/url-security.ts URL 规范化、IPv4/IPv6 特殊地址分类、DNS 解析安全校验
src/index.ts        10 个 defineTool 定义与插件 apply
tests/client.spec.ts  客户端契约测试（认证头、过滤、分页、写 body）
tests/tools.spec.ts   工具注册、render 测试
examples/cordis.yml   dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证

- 使用 REST API v2 用户 token（`Token token=...`）；`fromEmail` 可选，写接口需要该身份时自动携带。
- 不实现 OAuth，避免 v0.1 引入刷新流程。

### 2.2 工具范围

- 读：services、incidents（含详情）、incident notes、on-calls、escalation policies。
- 写：acknowledge、resolve（单对象，`kind: 'edit'`），resolve 支持可选 resolution 说明；incident notes 创建（需要 `fromEmail`，内容限长 2000 字符）。
- 不做批量更新、删除、schedule 维护。

### 2.3 分页与错误

- 分页基于 `limit/offset/total`，返回 `hasMore` 与 `nextOffset`。
- 未配置 token 返回 `{ ok: false }` / `{ found: false }`；API 错误抛 `PagerDutyError`，工具层转规范化失败值。
- 429/5xx 不自动重试，由调用方决定。

### 2.4 baseUrl 与 URL 安全

- `baseUrl` 默认为 `https://api.pagerduty.com`，只接受带 hostname 的绝对 `http`/`https` URL；禁止 username、password、query 和 fragment，允许路径前缀并规范化末尾斜杠。
- 每次 `fetch` 前校验最终 URL 的 host。literal localhost、环回、未指定、私有、链路本地、CGNAT、组播、保留/文档/基准测试 IPv4/IPv6 地址均拒绝。
- 阻断清单与 IANA IPv4/IPv6 Special-Purpose Address Registry 对齐，额外覆盖 `2001::/23`（IETF Protocol Assignments，含 Teredo、AMT、AS112-v6、ORCHID/ORCHIDv2、DRiP）、`5f00::/16`（SRv6 SID）、`100:0:0:1::/64`（RFC 9780）、`2620:4f:8000::/48`、`fec0::/10`（已废弃站点本地）及 IPv4-mapped/NAT64 形式；该清单需与 aws/dockerhub/zendesk 三个同源插件保持一致，不得只改其中一份。
- 普通域名通过 `dns.promises.lookup(hostname, { all: true })` 解析；解析失败、无结果或任何结果属于阻断地址时 fail closed。`lookupImpl` 只作为 `PagerDutyClientOptions` 的测试注入点，不暴露到插件配置接口。
- 安全失败统一包装为 `PagerDutyError`，消息不包含凭证或完整敏感 URL。

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前客户端与工具测试覆盖：token/From 认证头、服务过滤与分页、事件映射与指派、事件详情、值班与升级策略、incident notes 列表/创建（含 From 头与请求体）、acknowledge/resolve 请求体、缺 token 保护、HTTP 错误映射、baseUrl 路径前缀与非法 URL、literal 与 DNS 解析目标安全校验（含 IANA 特殊用途网段）、工具注册与 render。

注：tests/tools.spec.ts 只做静态注册与 render 断言（Mimosa 对动态 execute 辅助函数有误报），执行路径由客户端测试完整覆盖。

## 4. 后续方向

- Schedules 只读巡检与 override 查询。
- Webhook 订阅管理。
