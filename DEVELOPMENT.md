# dsh-tool-pagerduty 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-pagerduty` |
| 定位 | DeepSeek Harness 的事件/值班响应插件 |
| 版本 | v0.1.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | PagerDuty REST API v2（`application/vnd.pagerduty+json;version=2`） |
| 认证 | `Token token=<user-token>` 请求头 + 可选 `From` 邮箱 |

### 1.1 目录

```text
src/client.ts       PagerDutyClient：fetch 注入、15s 超时、AbortSignal 透传、错误映射
src/index.ts        8 个 defineTool 定义与插件 apply
tests/client.spec.ts  客户端契约测试（认证头、过滤、分页、写 body）
tests/tools.spec.ts   工具注册、render 测试
examples/cordis.yml   dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证

- 使用 REST API v2 用户 token（`Token token=...`）；`fromEmail` 可选，写接口需要该身份时自动携带。
- 不实现 OAuth，避免 v0.1 引入刷新流程。

### 2.2 工具范围

- 读：services、incidents（含详情）、on-calls、escalation policies。
- 写：acknowledge、resolve（单对象，`kind: 'edit'`），resolve 支持可选 resolution 说明。
- 不做批量更新、删除、schedule 维护、incident notes 创建。

### 2.3 分页与错误

- 分页基于 `limit/offset/total`，返回 `hasMore` 与 `nextOffset`。
- 未配置 token 返回 `{ ok: false }` / `{ found: false }`；API 错误抛 `PagerDutyError`，工具层转规范化失败值。
- 429/5xx 不自动重试，由调用方决定。

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前 10 个测试覆盖：token/From 认证头、服务过滤与分页、事件映射与指派、事件详情、值班与升级策略、acknowledge/resolve 请求体、缺 token 保护、HTTP 错误映射、工具注册与 render。

注：tests/tools.spec.ts 只做静态注册与 render 断言（Mimosa 对动态 execute 辅助函数有误报），执行路径由客户端测试完整覆盖。

## 4. 后续方向

- Incident notes 列表/创建（只读 + 写）。
- Schedules 只读巡检与 override 查询。
- Webhook 订阅管理。
