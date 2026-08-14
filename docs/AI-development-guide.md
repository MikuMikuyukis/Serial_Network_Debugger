# AI Development Guide

更新日期：2026-08-14
适用版本：`0.3.1` 及当前 `main` 代码

本文是后续开发者和 AI 理解当前实现的主交接文档。开始修改前还必须阅读根目录 `AGENTS.md`，并以当前源码和测试为最终依据。

## 1. 项目目标与当前形态

Serial Network Debugger 是一个跨 Windows、macOS、Linux 的串口与网络调试工具。当前已完全使用 Node.js + TypeScript，不再依赖 Python。

应用有两种运行形态，但共享同一套通信后端：

```text
浏览器版
  Browser -> Fastify REST/WebSocket -> TransportManager -> Serial/TCP/UDP

Electron 版
  BrowserWindow -> Electron 内嵌 Fastify(随机回环端口)
                -> 同一个 TransportManager -> Serial/TCP/UDP
```

不要为 Electron 复制通信核心。Electron 主进程直接调用 `server/src/http/app.ts` 的 `createApp()`。

## 2. 技术栈与环境

- Node.js `>=24.12 <25`
- npm workspaces / npm 11
- TypeScript 5.9
- Vue 3 + Vite
- Fastify + `@fastify/websocket`
- Electron + electron-builder
- `serialport` 13（包含平台原生模块）
- Zod 4 运行时请求校验
- Vitest 4

`node_modules` 和 Electron 产物不能跨操作系统复制。Windows、macOS、Linux 必须分别安装依赖并在目标平台构建，CPU 架构也必须匹配。

## 3. 目录职责

| 路径 | 职责 |
| --- | --- |
| `frontend/src/App.vue` | 顶层页面、工具标签和独立窗口路由 |
| `frontend/src/components/` | 通信栏、日志、发送预设、组帧、生成控件、帧解析和仪表盘 |
| `frontend/src/composables/useCommunication.ts` | REST/WS 状态、日志与接收帧队列 |
| `frontend/src/storage.ts` | 浏览器本地存储、兼容恢复、配置隔离和输入校验 |
| `frontend/src/types.ts` | 前端通信、帧和解析类型 |
| `frontend/src/hex-display.ts` | HEX 展示空格、光标和删除行为 |
| `frontend/src/frame-parser.ts` | RX 帧字段校验和浏览器端解析 |
| `server/src/core/` | 编解码、类型、Zod schema、组帧、周期发送和管理器 |
| `server/src/transports/` | Serial、TCP Client、TCP Server、UDP |
| `server/src/http/app.ts` | REST、WebSocket、静态资源和错误响应 |
| `server/src/cli.ts` | 浏览器生产服务入口，默认 `127.0.0.1:8765` |
| `server/test/` | 单元测试、本地存储测试和回环集成测试 |
| `server/public/` | Vite 生产资源，构建生成但纳入 Git |
| `desktop/src/main.ts` | Electron 生命周期、窗口、子窗口、安全配置和内嵌服务 |

## 4. 通信与实时事件数据流

连接流程：

```text
ConnectionBar
  -> POST /api/connect
  -> transportConfigSchema
  -> TransportManager.connect()
  -> Serial/TCP/UDP transport
  -> EventBroker 发布 status/system/traffic
  -> /ws/events
  -> useCommunication
  -> 页面状态与日志
```

发送流程：

```text
发送框或预设
  -> POST /api/send
  -> sendRequestSchema
  -> 普通 codec 或 HexFrameSession
  -> TransportManager.send()
  -> transport write
  -> 成功后才提交帧序号
```

周期发送由服务端 `PeriodicSender` 调度，页面关闭或进入后台不会触发浏览器定时器节流。每次发送完成后再等待下一间隔，不允许同一周期任务重叠写入。

## 5. Transport 行为边界

- 同一服务进程一次只能激活一种通信模式。
- Serial 使用 `receive_idle_ms` 合并底层读取块；持续空闲达到该间隔才形成一条 RX 记录。
- TCP 是字节流，不保留发送端业务帧边界。不要把一次 `data` 事件等同于一帧。
- TCP Client 可选自动重连；用户主动断开后旧连接尝试必须通过 generation 状态失效。
- TCP Server 的发送会广播给全部已连接客户端。
- UDP 配置固定远端时发往固定地址；未配置时发往最近一个数据报来源。
- 串口一般由一个进程独占。浏览器服务和 Electron 不应同时连接同一串口。

## 6. HTTP 与 WebSocket 接口

当前主要接口：

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态和版本 |
| GET | `/api/status` | 当前 transport 状态 |
| GET | `/api/serial/ports` | 枚举串口 |
| POST | `/api/connect` | 建立串口/TCP/UDP 连接 |
| POST | `/api/disconnect` | 断开或停止重连 |
| POST | `/api/send` | 普通发送或启用配置后的组帧发送 |
| POST | `/api/frame/preview` | 使用服务端同一核心生成完整帧预览 |
| GET | `/api/periodic-send` | 周期发送状态 |
| POST | `/api/periodic-send/start` | 启动周期发送 |
| POST | `/api/periodic-send/stop` | 停止周期发送 |
| WS | `/ws/events` | 状态、系统提示、TX/RX 和统计事件 |

运行时请求由 `server/src/core/schemas.ts` 校验。新增枚举或字段只改 TypeScript 类型是不够的。

## 7. HEX 展示与业务值

`frontend/src/hex-display.ts` 只负责展示格式：

```text
业务值: 123456AB
显示值: 12 34 56 AB
```

空格不能写回发送业务值、本地存储或组帧字段。主发送框和发送预设共用该模块，以维持光标、Backspace/Delete 和最大长度行为一致。

## 8. 自由组帧模型

`HexFrameConfig.fields` 是用户可自由排序、重复和删除的字段列表，不是固定协议模板。字段类型包括：

- `header`、`frame_id`、`tail`：固定 HEX
- `sequence`：1/2/3/4/8 Byte 序号
- `length`：按字段 ID 范围计算长度
- `data`：fixed/editor/generated 数据
- `checksum`：CRC16 和字段 ID 范围

核心实现在 `server/src/core/hex-frame.ts`。处理顺序是固定字段/数据编码、长度占位与计算、CRC 占位与计算、最终拼接。完整帧最大 4 MiB。

必须保持：

- 预览不递增序号。
- 发送失败不递增序号。
- transport 成功写入后才提交下一序号。
- 范围使用字段 ID；字段移动不能改变引用对象。
- 删除字段时清理长度/CRC 对该 ID 的引用。
- CRC 不能依赖自身或尚未计算的后续 CRC。
- 完整帧预览不能写回 `preset.data` 或主发送框原始数据，否则会重复套帧。

## 9. 自定义生成控件

当数据字段 `source === "generated"` 时，运行控件来自 `FrameGeneratedControls.vue`。

| control | 数据类型 | 说明 |
| --- | --- | --- |
| `uint_slider` | UInt | 无符号整数滑块 |
| `int_slider` | Int | 有符号整数滑块 |
| `float32_slider` | Float32 | 固定 4 Byte IEEE 754 |
| `float64_slider` | Float64 | 固定 8 Byte IEEE 754 |
| `bcd_slider` | BCD | 十进制数字压缩编码 |
| `bit_checkboxes` | UInt | 多位掩码 |
| `bit_radio` | UInt | 单选位 |
| `byte_switches` | UInt | 按字节 `00/FF` 掩码 |
| `enum` | UInt | `名称=数值` 枚举 |

Float 默认范围是 `-100..100`、步进 `0.1`，用户可修改范围和步进；最终按字段大小端编码。后端必须校验有限数、范围和步进。

控件事件语义：

```text
update: 更新值和预览
commit: 一次用户操作完成，可以触发“帧变化自动发送”
```

滑块拖动的 `input` 只能 update，松手的 `change` 才 commit。复选、单选、字节开关和枚举一次 change 同时 update/commit。

## 10. 发送预设、全局配置和本地存储

配置数据保存在当前浏览器/Electron profile 的 `localStorage`，不是服务端数据库：

| Key | 内容 |
| --- | --- |
| `snd.configuration-profiles.v1` | 最多 20 个全局配置元数据 |
| `snd.active-configuration-profile.v1` | 当前配置 ID |
| `snd.theme` | 主题 |
| `snd.profile.<id>.transport-settings.v1` | 当前配置的通信参数 |
| `snd.profile.<id>.send-editor.v1` | 当前配置的发送区 |
| `snd.profile.<id>.send-presets.v1` | 当前配置最多 100 条预设 |
| `snd.profile.<id>.hex-frame-config.v1` | 当前配置的主组帧 |
| `snd.profile.<id>.frame-parser-config.v1` | 当前配置的 RX 解析 |
| `snd.configuration-import.v1` | 成功导入后的跨窗口重载通知 |

默认配置会兼容读取旧版未分组 key。存储内容属于不可信输入，`storage.ts` 必须逐字段恢复；新增字段要提供兼容默认值，不能让旧配置整体消失。

复制配置或预设时必须深拷贝并生成新的预设、组帧和解析配置 ID，避免共享序号会话或响应式嵌套引用。

全局 `Ctrl+S` / `Command+S` 由 `App.vue` 捕获，并依次调用配置列表、通信栏、发送控制台和独立解析器暴露的 `persistPendingState()`。各组件必须先校验当前草稿再同步写入，返回 `false` 时顶层不能提示成功。新增可编辑且持久化的配置面板时，也必须接入这条即时保存链路。

配置备份是 `application = "serial-network-debugger"`、`version = 1` 的 JSON 对象，包含 `exported_at`、主题、当前配置 ID 和全部 `profiles`。每个 profile 必须完整包含：

```text
metadata
transport
send_editor
hex_frame
send_presets[]（含各自 frame_config）
frame_parser（含仪表盘显示字段）
```

导入文件上限为 32 MiB。`storage.ts` 必须在任何写入前逐字段校验版本、数量限制、ID 唯一性、通信参数、组帧嵌套和 RX 解析语义；不能使用兼容读取时的默认值悄悄修复损坏的备份。导入会替换全部 profile：先生成当前配置快照，写入失败则用快照回滚，成功后写入 `snd.configuration-import.v1` 通知其他同源窗口并重新加载当前窗口。导入 UI 在已连接、自动重连或周期发送期间必须保持禁用，并在文件读取和用户确认后再次检查锁定状态。

备份只包含持久配置，不包含 transport 连接、重连/周期任务、日志、统计、帧序号运行会话和趋势点。提高备份版本时应保留旧版本解析或明确拒绝，并为迁移与回滚添加存储测试。

## 11. RX 帧解析与仪表盘

RX 解析完全在浏览器端执行。`useCommunication` 保存最近接收记录，`frame-parser.ts` 根据固定 HEX、Byte 偏移、长度、类型和大小端提取数据。

支持 UInt、Int、Float32、Float64、BCD、Boolean、HEX、ASCII。数值可以应用倍率、偏移、小数位与单位，并以数字、半圆仪表、趋势、进度条或状态显示。

重要边界：

- 当前一条 RX 日志被视为一帧。
- TCP 没有天然帧边界，解析正确性依赖实际协议分帧。
- 最多 32 个解析字段，每个字段最长 64 Byte。
- 趋势每个窗口只保留最近 240 点，不持久化。
- 不要把大批量趋势历史写入 localStorage。

## 12. 独立工具窗口

发送预设、仪表盘和解析配置可拆到同源子窗口。主窗口会暂时隐藏对应标签，并通过窗口生命周期/存储同步恢复。

Electron 的 `setWindowOpenHandler` 只允许同源 `/` 且 `tool` 为 `presets`、`dashboard` 或 `parser` 的内部窗口；外部 HTTP/HTTPS 使用系统浏览器。关闭子窗口后必须恢复主窗口标签，不能同时拆出整个工具区。

## 13. Electron 与打包

`desktop/src/main.ts`：

- 使用单实例锁。
- 在随机 `127.0.0.1` 端口启动 Fastify。
- BrowserWindow 开启 `contextIsolation` 和 sandbox，关闭 `nodeIntegration`。
- 窗口同时监听 `ready-to-show` 和 `did-finish-load`，避免部分 Windows 环境窗口不显示。
- 退出前先关闭 Fastify，释放 transport 和端口。

开发运行：

```powershell
npm run desktop
```

免安装目录：

```powershell
npm run desktop:pack
```

Windows NSIS EXE 安装包：

```powershell
npm exec electron-builder -- --win nsis --x64
```

产物位于 `release/`，该目录不提交 Git。未签名安装包可能触发 SmartScreen。

如果环境存在 `ELECTRON_RUN_AS_NODE=1`，仅在当前终端清除后再启动：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## 14. 跨层修改清单

修改通信、组帧、生成器或解析配置时，至少检查：

1. `frontend/src/types.ts`
2. `server/src/core/types.ts`
3. `server/src/core/schemas.ts`
4. `frontend/src/storage.ts`
5. 对应 Vue 组件
6. 服务端编码、接口或 transport
7. `server/test/` 对应测试
8. `README.md`
9. 架构或行为边界变化时更新本文

典型遗漏表现：

- 前端能选新枚举，但 API 返回 `Invalid option`：后端 schema 未更新或 `8765` 仍是旧进程。
- 保存后新配置消失：`storage.ts` 的恢复校验未更新。
- TypeScript 正常但生产页面还是旧 UI：未运行完整构建或运行服务未重启。

## 15. 构建产物与验证

前端构建直接输出到 `server/public/`，这些哈希资源纳入 Git。不要手改压缩 JS/CSS。

完整交付验证：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

截至 2026-08-14 当前基线：10 个测试文件、79 项测试通过，前端/服务端/Electron 类型检查和完整构建通过。后续新增测试后应更新这里和 README 中涉及的数字，或者改为不写固定数量。

测试使用本机回环 TCP/UDP，不需要物理串口。如果 Electron 或旧开发服务器正在运行，可能造成端口或计时竞争；先停止项目进程再重试。

## 16. Git 工作流

根目录 `AGENTS.md` 是强制规则。摘要：

- 每次完成修改都创建本地 commit。
- commit 标题和必要正文必须中英文双语。
- 默认不 push，用户明确要求才 push。
- 高风险修改走独立分支，测试提交后等待用户确认再合并 `main`。
- 不提交密钥、`.env`、日志、`release/`、`server/dist/` 或 `desktop/dist/`。
- 不要合并仅因为“还存在”的旧功能分支；先确认其是否已经是 `main` 祖先。

## 17. 后续 AI 检查清单

1. 阅读 `AGENTS.md`、`README.md`、`docs/README.md` 和本文。
2. 执行 `git status --short --branch`，保留来源不明的用户修改。
3. 查清数据从 UI 到 schema、服务实现、存储和测试的完整路径。
4. 维持 HEX 展示/业务值分离、原始数据/完整帧预览分离。
5. 维持序号成功后提交、滑块 update/commit 分离。
6. 前端修改后生成并提交 `server/public` 新哈希资源。
7. 跑完整测试、类型检查、构建和 diff 检查。
8. 同步 README；架构变化同步本文。
9. 按中英文规范提交；没有用户明确授权不推送。

## 18. 当前限制与优先风险

- 没有认证，服务只应绑定回环或可信局域网，不能直接暴露公网。
- 没有日志落盘，刷新后内存日志和趋势数据会丢失。
- 配置默认保存在浏览器/Electron profile，可通过版本化 JSON 手动导入导出，但没有云端或自动跨设备同步。
- TCP 业务协议分帧尚未提供通用 framing engine。
- TCP Server 暂不能选择单个客户端发送。
- 前端复杂交互主要依赖类型检查和手工验证，缺少 Playwright/Vue 组件端到端覆盖。
- Electron 安装包尚未配置数字签名和自动更新。
