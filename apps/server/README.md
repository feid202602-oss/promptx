# `@promptx/server`

PromptX 后端服务，技术栈是 `Fastify + better-sqlite3`。

它既是 API 层，也是本地运行时的控制平面，还负责在构建态托管 `apps/web/dist`。

## 负责什么

- 任务、项目、运行记录、事件流的 HTTP API
- SQLite 持久化
- 上传、PDF 导入、静态资源与前端构建产物托管
- SSE 实时事件推送
- Relay、系统设置、push 通知、自动化触发
- 调度 `apps/runner` 执行具体 run

## 入口与目录

- 入口：`src/index.js`
- 数据访问：`src/repository.js`
- 数据库：`src/db.js`
- 任务路由：`src/taskRoutes.js`
- 项目 / run 路由：`src/codexRoutes.js`
- runner 内部回调与 SSE：`src/internalRoutes.js`
- 系统配置与诊断：`src/systemRoutes.js`
- 上传与导入：`src/assetRoutes.js`、`src/upload.js`、`src/pdf.js`
- 推送：`src/pushRoutes.js`、`src/pushSubscriptions.js`
- Relay：`src/relay*.js`

## 运行端口

默认端口取决于启动方式：

- `promptx start` / `pnpm start`：默认 `3000`
- `pnpm dev`：根脚本会把 server 端口设为 `3001`
- 单独跑 `pnpm --filter @promptx/server dev` 时，默认仍是 `3000`，除非显式传入 `PORT`

## 静态资源与前端托管

`src/index.js` 会检查 `../web/dist/index.html` 是否存在：

- 存在时：同时提供 `/assets/*` 和前端页面静态资源
- 不存在时：server 只提供 API，不托管前端构建产物

这也是为什么开发态通常是 Vite 单独跑，构建态由 server 统一托管。

## 持久化

数据库默认位于：

```text
~/.promptx/data/promptx.sqlite
```

主要表由 `src/db.js` 建立，包括：

- `tasks`
- `blocks`
- `codex_sessions`
- `codex_runs`
- `codex_run_events`
- `task_git_baselines`
- `run_git_baselines`
- `run_git_final_snapshots`
- `push_subscriptions`

上传和临时文件默认位于：

- `~/.promptx/uploads`
- `~/.promptx/tmp`

## 关键接口分组

公开 API：

- `/health`
- `/api/tasks*`
- `/api/codex*`
- `/api/events/stream`
- `/api/system*`
- `/api/push*`

内部接口：

- `/internal/runner-events`
- `/internal/runner-status`

`/internal/*` 由 runner 回调使用，不能把它当成普通浏览器 API 修改。

## 本地开发

```bash
pnpm --filter @promptx/server dev
pnpm --filter @promptx/server test
```

如果你要联调完整链路，优先使用根目录：

```bash
pnpm dev
```

这样 server、runner、web 会按约定端口一起启动。

## 运行与重启注意

### 不要用“不带环境变量”的方式单独拉起 server

`apps/server/src/index.js` 本身不会主动读取根目录 `.env.local` / `.env`。

正常通过下面这些入口启动时：

- `pnpm start`
- `pnpm restart`
- `node scripts/service.mjs start`

根脚本会先加载根目录可选环境文件，再拉起 `server` / `runner`。

但如果你为了“只重启 server”而手写一个最小 `node apps/server/src/index.js` 启动脚本，或者自己 `spawn` 新进程时没有先执行：

```js
process.loadEnvFile('.env.local')
process.loadEnvFile('.env')
```

就会把依赖环境变量的能力静默关掉。

### 这次真实踩到的故障

错误做法：只重启了本机 `server`，但没有把 `.env.local` / `.env` 里的 Web Push VAPID 配置带进新进程。

直接后果：

- iOS 端网页任务完成后收不到推送
- `/api/push/status?bootstrap=1` 返回 `501`
- 日志出现：

```text
[automation] browser push 未送达
reason="push-config-missing"
```

- 任务上的通知状态会变成：

```text
浏览器推送未发送：push-config-missing
```

注意，这种情况不是“手机没订阅”，而是“服务端当前进程没有推送密钥”。

### 正确做法

1. 优先使用仓库已有入口重启：

```bash
pnpm restart
```

如果只需要重启 `server`，也要复用 `scripts/service.mjs` 里的行为，先加载根目录环境文件，再启动新进程。

2. 重启后立刻做 push bootstrap 自检：

```bash
curl http://127.0.0.1:3000/api/push/status?bootstrap=1
```

预期应该返回 `200`，并带有 `vapidPublicKey`。

如果返回 `501`，说明当前 `server` 进程仍然没有拿到 VAPID 配置，不要继续把问题归因到 iPhone 订阅或 Safari。

### 这条规则的目的

以后只要有人为了“保留 runner、不重启全套服务”而手动重启 `server`，就必须先检查：

- 有没有加载 `.env.local`
- 有没有加载 `.env`
- `/api/push/status?bootstrap=1` 是否恢复为 `200`

否则最容易出现的假象就是：

- 任务能正常运行
- 页面能正常打开
- 只有 iOS 完成通知悄悄失效

## 修改注意点

- 改 `repository.js` 或 `db.js` 时，要考虑真实读写路径和兼容性
- 改 API 响应结构时，要同步检查 `apps/web` 和 `apps/runner`
- 改 `/internal/*` 契约时，要同步检查 runner 的请求形状
- 改静态资源托管逻辑时，要同时考虑 `apps/web/dist` 是否存在
