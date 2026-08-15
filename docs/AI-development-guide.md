# AI Development Guide

更新日期：2026-08-15
适用版本：`0.1.x` 及当前 `main` 代码

本文是后续开发者和 AI 理解当前实现的主交接文档。开始修改前还必须阅读根目录 `AGENTS.md`，并以当前源码和测试为最终依据。

## 1. 项目目标与当前形态

Serial Network Debugger 是一个跨 Windows、macOS、Linux 的串口与网络调试工具。当前已完全使用 Node.js + TypeScript，不再依赖 Python。

应用有两种运行形态，但共享同一套通信后端：

```text
浏览器版
  Browser -> Fastify REST/WebSocket -> TransportManager -> Serial/TCP/UDP

Electron 版
  Electron instance A -> userData A -> Fastify A -> TransportManager A -> device A
                      \-> BrowserWindow A / browser on Web port A
  Electron instance B -> userData B -> Fastify B -> TransportManager B -> device B
                      \-> BrowserWindow B / browser on Web port B
```

不要为 Electron 复制通信核心。Electron 主进程直接调用 `server/src/http/app.ts` 的 `createApp()`。

## 2. 技术栈与环境

- Node.js `>=24.12 <25`
- npm workspaces / npm 11
- TypeScript 5.9
- Vue 3 + Vite
- Fastify + `@fastify/websocket`
- Electron + electron-builder
- QuickJS WebAssembly 0.32（自定义校验脚本隔离）
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
| `server/src/core/custom-checksum-sandbox.ts` | QuickJS WASM 自定义校验脚本隔离与资源限制 |
| `server/src/transports/` | Serial、TCP Client、TCP Server、UDP |
| `server/src/http/app.ts` | REST、WebSocket、静态资源和错误响应 |
| `server/src/cli.ts` | 浏览器生产服务入口，默认 `127.0.0.1:8765` |
| `server/src/version.ts` | 从根 `package.json` 读取运行时应用版本 |
| `server/test/` | 单元测试、本地存储测试和回环集成测试 |
| `server/public/` | Vite 生产资源，构建生成但纳入 Git |
| `desktop/src/main.ts` | Electron 多实例生命周期、窗口、子窗口和内嵌服务 |
| `desktop/src/options.ts` | Electron 实例 ID、Web 监听参数和独立 userData 路径校验 |
| `scripts/check-version-policy.mjs` | 校验各 workspace 版本同步及补丁号递增规则 |
| `scripts/bump-patch-version.mjs` | 同步递增根包、workspace 和 lockfile 的补丁版本 |
| `.github/workflows/portable-release.yml` | 在三个原生 runner 构建并发布便携版 |

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

`ConnectionBar.vue` 允许在已连接或 TCP Client 自动重连期间编辑设置。应用或全局保存通信草稿时，先通过 `transport-config.ts` 规范化并比较当前模式配置；未变化只保存，变化时再次调用 `/api/connect`。`TransportManager.connect()` 在同一个串行操作中停止旧 transport 后创建新 transport，成功或失败由顶层 Toast 在右下角提示。新连接失败时不会恢复旧 transport；新配置保留在当前 profile，运行状态刷新为未连接。连接切换仍会停止周期发送。

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
- 连接中应用不同通信参数会替换当前 transport；相同的规范化配置不得造成无意义断线重连。
- TCP Server 的发送会广播给全部已连接客户端。
- UDP 配置固定远端时发往固定地址；未配置时发往最近一个数据报来源。
- 串口一般由一个进程独占。浏览器服务和 Electron 不应同时连接同一串口。
- macOS 上 `SerialPort.list()` 不一定返回 `socat` 创建的 PTY；`server/src/core/serial-ports.ts` 会补充枚举名称匹配 `/dev/ttys[0-9a-f]{3,}` 的设备。该补充只用于 Darwin，不应把任意 `/dev` 条目暴露为串口。

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

`/api/health` 的版本由 `server/src/version.ts` 从根 `package.json` 读取，不允许在 HTTP 路由中硬编码版本。源码运行、编译后的浏览器服务和 Electron 包都依赖同一份根包元数据。

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
- `checksum`：CRC、SUM、XOR、自定义 JS 和字段 ID 范围

核心实现在 `server/src/core/hex-frame.ts`。处理顺序是固定字段/数据编码、长度占位与计算、校验占位与计算、最终拼接。完整帧最大 4 MiB。一个配置可放置多个校验字段，但前面的校验不能引用自身或尚未计算的后续校验字段。

数据字段的 `data_type === "text"` 会按 `text_encoding` 编码为 UTF-8、ASCII 或 GBK 字节后嵌入 HEX 帧。`byte_length === null` 表示采用编码后的实际长度；指定长度时必须与编码结果严格相等。长度字段计算的是最终编码字节数，不是 JavaScript 字符数。前端存储恢复、运行时 Schema 和服务端组帧必须同步接受这些字段，不能只在 UI 中增加选项。

`checksum` 字段的 `method` 为 `crc`、`sum`、`xor` 或 `custom_js`，`byte_length` 控制输出宽度。CRC 支持 8/16/32 位内置参数和自定义参数，CRC 输出长度必须等于位宽。旧配置缺少 `method`、`byte_length`、`parameters.width` 和 `script` 时，Schema 与 `storage.ts` 会分别补为 `crc`、2、16 和空字符串。

自定义 JS 由 `custom-checksum-sandbox.ts` 在 QuickJS WebAssembly 虚拟机中同步执行。每次计算创建全新的 runtime/context，只注入当前校验范围内冻结的 `bytes` 数组，不注入任何宿主函数或宿主对象；`process`、`require`、`fetch`、WebAssembly、SharedArrayBuffer 和 Atomics 均不可用。即使脚本使用 `Function` 或其他 QuickJS 内部动态代码能力，也只能留在独立 WASM 虚拟机内，无法切换到 Node.js 上下文。

每次执行限制为 100 ms、16 MiB runtime 内存、512 KiB 栈和 64 KiB 输入；超时、内存耗尽、递归溢出和超限输入必须作为组帧错误返回，不能拖垮服务进程。脚本返回值只能是非负安全整数、`BigInt` 或定长 HEX 字符串。`/api/send`、`/api/frame/preview` 和 `/api/periodic-send/start` 还必须在执行前检查来源地址，包含自定义脚本时只允许 IPv4/IPv6 回环地址，以防无认证的局域网请求反复消耗脚本执行资源。QuickJS 是安全边界，回环限制和资源限制是额外的纵深防御，不能退回 Node.js `vm`。

必须保持：

- 预览不递增序号。
- 发送失败不递增序号。
- transport 成功写入后才提交下一序号。
- 范围使用字段 ID；字段移动不能改变引用对象。
- 删除字段时清理长度/校验对该 ID 的引用。
- 校验字段不能依赖自身或尚未计算的后续校验字段。
- 自定义 JS 不能接触 Node.js 或宿主对象，且每次执行不得复用上一次脚本上下文。
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
| `snd.layout-preferences.v1` | 全局工具面板比例和发送预设六列列宽 |

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

布局尺寸属于当前 origin/Electron profile 的界面偏好，不随业务 profile 隔离，也不进入配置备份。`TrafficConsole.vue` 保存主日志/工具面板比例，`SendPresetPanel.vue` 保存六个表格列宽；拖动过程中只更新响应式样式，松手后才写入 `localStorage`。方向键调整会立即保存，双击或 `Home` 恢复单项默认值。两个组件都监听同一个布局键的 `storage` 事件，以同步独立窗口。读取时必须校验版本、比例范围和每列最小/最大宽度，窄屏断点继续使用单面板覆盖布局并隐藏主分隔条。

## 11. RX 帧解析与仪表盘

RX 解析完全在浏览器端执行。`useCommunication` 保存最近接收记录，`frame-parser.ts` 按配置数组顺序解析字段；`FrameAnalyzer.vue` 中的字段移动、添加和删除会重新计算连续 Byte 偏移，避免让用户手工维护重叠切片。

界面一级字段只提供固定字节、跳过字节、帧长度、定长数据和变长数据。底层继续用 `kind` 区分固定匹配、数值和跳过字段，用 `length_mode` 区分固定长度、剩余字节和长度字段引用：

- 固定字节必须与 `match_hex` 完全匹配，可用于帧头、功能码或帧尾，不产生仪表值。
- 跳过字节只推进偏移，不产生仪表值。
- 帧长度是定长 UInt 值字段，可被后续变长字段通过 `length_field_id` 引用。
- 定长数据可解析 UInt、Int、Float32、Float64、BCD、Boolean、HEX 或字符串。
- 变长数据只解析 HEX 或字符串，长度来自前置定长 UInt 字段，或采用扣除后续定长字段后的剩余字节。
- 字符串使用 `text_encoding` 解码 UTF-8、ASCII 或 GBK；旧 `ascii` 类型仍为已保存配置保留兼容读取。

数值可以应用倍率、偏移、小数位与单位，并以数字、半圆仪表、趋势、进度条或状态显示。

重要边界：

- 当前一条 RX 日志被视为一帧。
- TCP 没有天然帧边界，解析正确性依赖实际协议分帧。
- 最多 32 个解析字段，累计布局上限为 65,535 Byte。
- `length_field_id` 只能引用当前字段之前的定长 UInt 字段；删除该字段必须清除引用。
- 变长字段后允许存在定长帧尾或其他定长字段，解析剩余长度时必须为这些尾部字段预留字节。
- 趋势每个窗口只保留最近 240 点，不持久化。
- 不要把大批量趋势历史写入 localStorage。

## 12. 独立工具窗口

发送预设、仪表盘和解析配置可拆到同源子窗口。主窗口会暂时隐藏对应标签，并通过窗口生命周期/存储同步恢复。

Electron 的 `setWindowOpenHandler` 只允许同源 `/` 且 `tool` 为 `presets`、`dashboard` 或 `parser` 的内部窗口；外部 HTTP/HTTPS 使用系统浏览器。关闭子窗口后必须恢复主窗口标签，不能同时拆出整个工具区。

## 13. Electron 与打包

`desktop/src/main.ts`：

- 在读取 session/localStorage 前按 `--instance` 切换 `userData`；`default` 必须继续使用旧目录以兼容现有配置。
- 实例锁在切换 `userData` 后申请，因此同名实例单例、不同命名实例可以并行。
- 每个进程创建自己的 Fastify、TransportManager、EventBroker、周期发送器和随机或固定 Web 端口。
- `--web-host` 默认 `127.0.0.1`，`--web-port` 默认 `0`；非回环监听没有认证，只能用于可信网络。
- Electron 窗口加载该实例的本机地址；同端口浏览器页面是该实例的扩展客户端，共享后端状态。
- BrowserWindow 开启 `contextIsolation` 和 sandbox，关闭 `nodeIntegration`。
- 窗口同时监听 `ready-to-show` 和 `did-finish-load`，避免部分 Windows 环境窗口不显示。
- 退出前先关闭 Fastify，释放 transport 和端口。

开发运行：

```powershell
npm run desktop
```

并行实例：

```powershell
npm run desktop -- --instance device-a --web-port 8871
npm run desktop -- --instance device-b --web-port 8872
```

实例 ID 只允许 1 到 40 位 ASCII 字母、数字、点、下划线和连字符，防止命名实例逃逸 `userData/instances`。不同实例必须使用不同 ID；固定 Web 端口也必须互不冲突。浏览器 origin 包含端口，因此不同固定端口的浏览器 localStorage 也自然隔离。

免安装目录：

```powershell
npm run desktop:pack
```

Windows NSIS EXE 安装包：

```powershell
npm exec electron-builder -- --win nsis --x64
```

产物位于 `release/`，该目录不提交 Git。未签名安装包可能触发 SmartScreen。

自动发布使用 `.github/workflows/portable-release.yml`：

```text
main 更新
  -> 校验 workspace 版本和相对上一 main 的版本变化
  -> npm test + npm run typecheck
  -> Windows runner: portable x64 EXE
  -> Linux runner: x64 AppImage
  -> macOS runner: Universal DMG
  -> 生成 SHA256SUMS.txt
  -> 创建或更新当前提交的 V<version> GitHub Release
```

工作流只允许从 `main` 发布，并使用最小的 `contents: write` 权限和 GitHub 自动签发的 `GITHUB_TOKEN`。支线提交和支线推送不是发布版本，不应触发安装包编译、Git 标签或 GitHub Release；只有候选发布合并并推送到 `main` 后才执行完整发布。手动重跑也只能针对 `main` 上的同一发布提交。同名标签如果已经指向其他提交必须立即失败；仅允许同一提交重跑时覆盖附件。三个构建 Artifact 在 Actions 中保留 7 天，最终 Release 附件不受该临时保留期影响。

三个 `release:*` 构建脚本必须显式传入 `--publish never`。electron-builder 26 会在 CI 环境中隐式尝试发布，若不禁用，会在已经生成 AppImage 或 DMG 后因构建作业没有个人 `GH_TOKEN` 而失败。构建作业的职责只限于生成并上传临时 Artifact；只有最终 `release` 作业可以使用 `${{ github.token }}` 创建或更新 GitHub Release。不要为了规避该错误向构建矩阵注入个人令牌。

GitHub Actions 使用原生 Node 24 运行时的官方 Action 版本。更新工作流依赖时需要检查 Action 自身的 `runs.using`，不能只看 `setup-node` 配置的应用 Node 版本；二者是不同的运行时。

当前 `package-lock.json` 在 Windows 生成，npm 的 optional dependency 问题可能导致 `npm ci` 在其他平台漏装 Rollup 原生包。构建矩阵通过 `rollup_package` 为 Linux x64 和 macOS arm64 显式安装与 `frontend/node_modules/rollup` 完全相同版本的二进制包。该步骤必须位于 `npm ci` 之后和 Vite 构建之前，不能把平台二进制版本独立写死。

当前发布目标为 Windows x64 单文件 portable EXE、Linux x64 单文件 AppImage 和同时支持 Intel/Apple Silicon 的 macOS Universal DMG。`serialport` 包含平台原生模块，因此三个产物必须由对应平台 runner 分别安装依赖和构建。Windows 和 macOS 产物尚未签名；需要签名时只能从 GitHub Secrets 注入证书和密码，不能写入仓库。

根、frontend、server 和 lockfile 中的版本必须一致。包元数据不带前缀，例如 `0.1.0`；标签与 Release 使用大写 `V`，例如 `V0.1.0`。同一大版本和小版本内，每个准备进入 `main` 的小修改必须让 patch 恰好增加一；major/minor 只有用户明确指定时才能改变。

所有代码、配置和文档修改都必须从最新且干净的 `main` 创建独立支线，在支线上开发、测试和提交。支线中的中间提交沿用当前公开版本，不为每个提交逐次增加版本号。准备合并时，先让支线同步最新 `main`，确认本次合并仍对应下一个公开版本，再针对整个候选发布只执行一次：

```powershell
npm run version:patch
npm run version:check
```

完成验证后在支线提交候选发布，等待用户明确授权，再合并并推送 `main`。优先使用 squash merge，让支线上的多个开发提交在 `main` 上形成一个发布提交。每个版本只能对应一个 `main` 提交；一次 push 如果跨过多个 patch，工作流会因相对 push 前版本不是 `+1` 而失败。

发布边界如下：

```text
最新 main
  -> 创建独立支线
  -> 支线开发、测试和提交（不发布，不逐提交增加版本）
  -> 同步最新 main
  -> 候选发布只增加一次版本并完成验证
  -> 用户明确批准合并与推送
  -> squash merge 为一个 main 发布提交
  -> 推送 main
  -> GitHub Actions 编译安装包、创建 V<version> 标签和 Release
```

禁止直接在 `main` 上开发或堆叠中间功能提交。默认也不得自行合并或推送 `main`；用户只要求本地开发或支线提交时，工作必须停留在支线，不能因此触发公开发布。

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
npm run version:check
npm test
npm run typecheck
npm run build
git diff --check
```

截至 2026-08-15 当前基线：15 个测试文件、123 项测试通过，前端/服务端/Electron 类型检查和完整构建通过。后续新增测试后应更新这里和 README 中涉及的数字，或者改为不写固定数量。

测试使用本机回环 TCP/UDP，不需要物理串口。如果 Electron 或旧开发服务器正在运行，可能造成端口或计时竞争；先停止项目进程再重试。

## 16. Git 工作流

根目录 `AGENTS.md` 是强制规则。摘要：

- 每次完成修改都创建本地 commit。
- commit 标题和必要正文必须中英文双语。
- 默认不 push，用户明确要求才 push。
- 所有修改都走独立支线；支线提交和推送不发布，也不为每个中间提交增加版本。
- 准备合并时同步最新 `main`，为整个候选发布只增加一次版本，验证后等待用户确认。
- 只有用户批准合并并把发布提交推送到 `main` 后，Actions 才编译并创建标签与 GitHub Release。
- 当前发布线从 `V0.1.0` 开始；同一 major/minor 内每个 `main` 小修改只允许 patch `+1`，major/minor 由用户控制。
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
