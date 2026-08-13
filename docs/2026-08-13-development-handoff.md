# 2026-08-13 开发交接文档

本文面向后续接手该项目的开发者或 AI 工具，记录 2026-08-13 在 `Serial_Network_Debugger` 中完成的主要修改、关键实现位置、不可破坏的行为约束、验证结果和继续开发前的检查事项。

## 1. 当前状态摘要

- 当前主线：`main`
- 本轮功能完成并首次推送后的主线提交：`45a3b59`
- GitHub 远端：`origin` -> `https://github.com/MikuMikuyukis/Serial_Network_Debugger.git`
- `main` 已与 `origin/main` 同步
- 功能开发分支 `feature/hex-frame-builder` 仍保留在本地，没有删除
- 当前应用版本：`0.3.1`
- 技术栈：Node.js 24、TypeScript、Fastify、Vue 3、Vite、Electron、Vitest
- Electron 使用免安装目录形式，不要求生成 EXE 安装程序
- 完整验证结果：8 个测试文件、63 项测试通过，类型检查和生产构建通过

本文档提交后，`main` 的 HEAD 会比 `45a3b59` 多一个纯文档提交；功能代码基线仍是 `45a3b59`。

## 2. 本轮开发的起点

本轮工作开始时，仓库已经有周期发送和可编辑发送预设：

| 提交 | 说明 |
| --- | --- |
| `5679024` | `feat: add periodic sending and send presets` |
| `6f73297` | `feat: make send presets directly editable` |

从 `4da629a` 到 `45a3b59` 的 11 个提交是本轮在该基础上完成并最终合并到主线的工作。

## 3. 本轮提交时间线

| 提交 | 修改内容 | 关键文件 |
| --- | --- | --- |
| `4da629a` | 增加中英文提交、默认不推送、敏感修改走分支的仓库协作规范 | `AGENTS.md` |
| `d88acee` | 接入 Electron 桌面版；主进程内启动 Fastify；增加免安装目录打包 | `desktop/src/main.ts`、`package.json` |
| `23a8d49` | TCP Client 增加可开关的掉线自动重连 | `server/src/transports/tcp.ts`、`ConnectionBar.vue` |
| `a4b0e5d` | 主发送框在 HEX 模式下按字节显示空格，但不改变业务值 | `frontend/src/hex-display.ts`、`TrafficConsole.vue` |
| `9dfc0f2` | 发送预设的 HEX 输入复用相同显示格式、光标和删除行为 | `SendPresetPanel.vue`、`hex-display.ts` |
| `58e5999` | 增加可自由组合的 HEX 帧编辑器和服务端组帧核心 | `HexFrameBuilder.vue`、`server/src/core/hex-frame.ts` |
| `80d8f34` | 修复帧编辑入口不可见；入口始终可见并自动切换到 HEX | `TrafficConsole.vue`、`HexFrameBuilder.vue` |
| `68963bb` | 每条发送预设支持独立 HEX 帧配置；数据长度统一为右侧属性选择 | `SendPresetPanel.vue`、`TrafficConsole.vue`、`storage.ts` |
| `69329ba` | 增加帧数据“自定义生成”和多种运行控件 | `FrameGeneratedControls.vue`、`hex-frame.ts` |
| `5c755c0` | Electron 窗口可由两个加载事件显示，降低窗口不出现的概率 | `desktop/src/main.ts` |
| `45a3b59` | 预设发送框显示完整组包结果；增加帧变化自动发送 | `TrafficConsole.vue`、`SendPresetPanel.vue`、`FrameGeneratedControls.vue` |

所有本轮提交都已经进入 `main` 并推送到 GitHub。

## 4. 当前架构

```text
Electron 主进程
  -> 在 127.0.0.1 随机端口启动 Fastify
  -> Fastify 托管 server/public 中的 Vue 生产资源
  -> Vue 通过 REST 发送命令，通过 WebSocket 接收状态和通信日志
  -> TransportManager 管理 Serial/TCP Client/TCP Server/UDP
  -> HexFrameSession 负责组帧和成功发送后的序号状态
```

关键目录：

| 路径 | 职责 |
| --- | --- |
| `frontend/src/` | Vue 3 页面、组件、本地存储和前端类型 |
| `server/src/core/` | 编解码、组帧、周期发送、事件和通信管理 |
| `server/src/transports/` | 串口、TCP Client、TCP Server、UDP 实现 |
| `server/src/http/` | Fastify REST、WebSocket 和静态资源服务 |
| `desktop/src/main.ts` | Electron 生命周期、窗口和内嵌 Fastify 服务 |
| `server/test/` | Vitest 单元测试与本机回环集成测试 |
| `server/public/` | Vite 生成的生产前端资源，不应手工编辑 |

## 5. Electron 桌面版

### 5.1 实现方式

Electron 没有复制一套通信逻辑。`desktop/src/main.ts` 直接复用 `createApp()`，在 `127.0.0.1` 的随机端口启动 Fastify，再由 `BrowserWindow` 加载该本地地址。

安全设置：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 禁止窗口跳转到非本地 origin
- 外部 HTTP/HTTPS 链接交给系统浏览器打开
- 使用单实例锁；再次启动会显示并聚焦已有窗口

关闭应用时先关闭 Fastify，再退出 Electron，避免本地端口和通信资源残留。

### 5.2 窗口显示修复

窗口初始使用 `show: false`。当前代码同时监听：

- `BrowserWindow` 的 `ready-to-show`
- `webContents` 的 `did-finish-load`

任一事件发生都会通过幂等的 `showWindow()` 显示窗口。不要重新改成只依赖一个事件；在当前 Windows 环境中曾出现 `ready-to-show` 未及时触发、进程和服务都正常但窗口不可见的情况。

### 5.3 启动和免安装打包

```powershell
npm run desktop
npm run desktop:pack
```

免安装目录位于：

```text
release/win-unpacked/
```

Windows 入口是 `Serial Network Debugger.exe`，但它是免安装应用目录中的可执行文件，不是安装程序；分发时必须保留整个 `win-unpacked` 目录。

### 5.4 `ELECTRON_RUN_AS_NODE` 注意事项

开发期间曾发现执行环境设置了：

```text
ELECTRON_RUN_AS_NODE=1
```

该变量会使 Electron 被当作普通 Node.js 运行，并产生类似错误：

```text
The requested module 'electron' does not provide an export named 'BrowserWindow'
```

只需在启动 Electron 的子进程中清除它，不要修改用户全局环境：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run desktop
```

## 6. TCP Client 掉线自动重连

### 6.1 配置和状态

`TcpClientConfig` 增加：

```ts
auto_reconnect: boolean
```

前端在通信设置中提供“掉线自动重连”开关，并将配置保存到浏览器本地存储。服务端状态的 `details` 会暴露：

- `auto_reconnect`
- `reconnecting`
- `reconnect_interval_ms`

### 6.2 服务端行为

实现位于 `server/src/transports/tcp.ts`：

- 远端关闭后，如果开关关闭，只发布断开状态
- 如果开关开启，每 3 秒尝试重连一次
- 服务恢复后自动连接并发布状态/提示
- 用户点击“停止重连”会执行正常 stop 流程
- `generation` 令牌用于使旧连接尝试和旧定时器失效
- `#stopping`、`#reconnectTimer` 和连接状态共同避免重复重连

后续修改时必须保留 generation 检查，否则“用户停止后旧异步连接又成功”的竞态会重新出现。

## 7. HEX 输入显示格式化

实现位于 `frontend/src/hex-display.ts`。

目标行为：

```text
业务值：123456AB
显示值：12 34 56 AB
```

关键原则：空格只用于显示，绝不进入发送、持久化或组帧业务值。

相关函数：

- `compactHexDisplay()`：移除显示空白并限制业务长度
- `formatHexDisplay()`：每两个字符插入一个显示空格
- `hexDisplayCaret()`：在格式化后恢复正确光标位置
- `deleteAcrossHexDisplaySpace()`：处理 Backspace/Delete 跨显示空格的行为

主发送框和发送预设共用这组函数。当前上限：

- 业务字符串最大长度：`1_048_576`
- 加入显示空格后的最大输入长度：`1_572_863`

不要把格式化后的显示字符串直接赋给 `sendData` 或 `preset.data`。

## 8. 自由组合 HEX 帧

### 8.1 配置模型

前端与服务端各自维护一份相同的 TypeScript 类型：

- `frontend/src/types.ts`
- `server/src/core/types.ts`

修改帧协议时必须同步更新这两处以及 `server/src/core/schemas.ts` 和 `frontend/src/storage.ts`。

`HexFrameConfig`：

```ts
interface HexFrameConfig {
  version: 1;
  id: string;
  enabled: boolean;
  fields: HexFrameField[];
}
```

字段不是固定顺序，用户可以任意添加、移动、复制和删除：

| `kind` | 用途 | 关键属性 |
| --- | --- | --- |
| `header` | 帧头 | 固定 HEX 值 |
| `sequence` | 帧序号 | 1/2/3/4/8 Byte、步进、字节序 |
| `frame_id` | 帧 ID/功能码 | 固定 HEX 值 |
| `length` | 动态长度 | 1/2/3/4 Byte、统计字段范围、字节序 |
| `data` | 数据 | 数据源、类型、长度、字节序、值/生成器 |
| `checksum` | CRC16 | 参数、计算范围、字节序 |
| `tail` | 帧尾 | 固定 HEX 值 |

“帧头、序号、ID、数据、CRC、帧尾”只是可选字段类型，不是强制模板。自由组合是该功能的核心要求。

### 8.2 数据字段

数据来源 `source`：

- `fixed`：配置中保存固定值
- `editor`：读取主发送框或预设的原始 `data`
- `generated`：读取自定义运行控件的当前值

数据类型 `data_type`：

- `hex`
- `uint`
- `int`
- `float32`
- `float64`
- `bcd`

可选字节长度统一为 `1 | 2 | 3 | 4 | 8`。Float32 固定 4 Byte，Float64 固定 8 Byte。`editor + hex` 可以使用任意长度。

### 8.3 长度和 CRC 范围

长度字段和 CRC 字段通过字段 ID 保存范围：

```ts
range_start_id: string | null
range_end_id: string | null
```

使用 ID 而不是数组索引，是为了在用户移动字段后仍引用原字段。删除字段时，前端必须清理对该 ID 的范围引用。

CRC16 内置：

- MODBUS
- ARC
- CCITT-FALSE
- XMODEM
- X25
- KERMIT
- 自定义多项式、初始值、结果异或、输入反转和输出反转

CRC 范围不能包含自身，也不能依赖尚未计算的后续 CRC 字段。

### 8.4 服务端组帧顺序

核心位于 `server/src/core/hex-frame.ts`：

1. 校验配置启用、字段非空、字段 ID 唯一。
2. 先将固定字段、序号、数据编码为字节；长度和 CRC 先占位。
3. 按配置范围计算所有长度字段。
4. 按配置范围计算所有 CRC 字段。
5. 拼接最终 Buffer，并限制最大组帧大小为 4 MiB。
6. 计算每个序号字段的下一值，但此时不立即提交状态。

### 8.5 序号提交语义

`HexFrameSession` 按 `HexFrameConfig.id` 保存序号状态，并串行化发送操作。

必须保持以下约束：

- 预览不会递增序号
- 发送失败不会递增序号
- 只有目标 transport 成功写入后才提交 `nextSequences`
- 序号按字段字节宽度自动回绕
- 前端收到 `frame_sequences` 后，将最新序号写回对应配置并持久化

这是预览内容与实际发送内容一致的基础，不要在前端控件变化时直接增加序号。

### 8.6 HTTP 接口

完整帧预览：

```http
POST /api/frame/preview
```

请求：

```json
{
  "data": "AABB",
  "frame_config": { "version": 1, "id": "...", "enabled": true, "fields": [] }
}
```

响应包含：

- `hex`：带字节空格的完整帧
- `size`：字节数
- `next_sequences`：下一序号，仅供展示，不提交会话状态

实际发送仍使用：

```http
POST /api/send
```

当请求是 HEX 且 `frame_config.enabled` 时，服务端忽略普通 HEX 直发路径，改为通过 `HexFrameSession.send()` 组帧并发送。

## 9. 每条发送预设的独立帧配置

`SendPreset` 可以携带自己的：

```ts
frame_config?: HexFrameConfig
```

每条预设的配置、字段值和序号互相独立。主要实现位置：

- 编辑入口和运行区：`frontend/src/components/SendPresetPanel.vue`
- 状态更新、发送、预览和持久化：`frontend/src/components/TrafficConsole.vue`
- 旧数据恢复：`frontend/src/storage.ts`

打开某条预设的帧编辑器时，如果该预设还没有配置，会创建新的、带唯一 ID 的空配置。载入预设到主发送区时，会深拷贝配置并创建新的主编辑器配置 ID，避免主发送区和原预设共享序号会话。

## 10. 自定义数据生成控件

### 10.1 生成器模型

`HexFrameDataField.source === "generated"` 时使用：

```ts
interface HexFrameGenerator {
  control: FrameGeneratorControl;
  control_name: string;
  minimum: number;
  maximum: number;
  step: number;
  options: string;
}
```

可用控件：

| 控件 | `control` | 数据类型 |
| --- | --- | --- |
| 无 | `none` | UInt |
| UInt 滑块 | `uint_slider` | UInt |
| Int 滑块 | `int_slider` | Int |
| 按位复选框 | `bit_checkboxes` | UInt 位掩码 |
| 按位单选框 | `bit_radio` | UInt 单选位 |
| 按字节开关 | `byte_switches` | UInt 字节掩码 |
| 枚举 | `enum` | UInt/枚举值 |
| BCD 码滑块 | `bcd_slider` | BCD |

运行控件组件：`frontend/src/components/FrameGeneratedControls.vue`。

按位和按字节控件使用 `BigInt` 操作，支持 8 Byte 值。HTML 数字/滑块只能可靠表达 JavaScript 安全整数，因此 8 Byte UInt/Int/BCD 滑块的自动范围会限制在 `Number.MIN_SAFE_INTEGER` 到 `Number.MAX_SAFE_INTEGER` 能表示的范围内。

### 10.2 枚举格式

枚举选项支持每行或逗号分隔：

```text
关闭=0
开启=1
自动=2
```

服务端会校验当前值必须出现在枚举选项中。

### 10.3 BCD 语义

BCD 编码会移除十进制点并左侧补零。例如 2 Byte 的 `12.3` 编码为：

```text
01 23
```

字节序为 little 时再反转整个字节数组。后续如果要支持固定小数位或比例因子，应扩展 schema，不能仅靠当前 `step` 推断协议小数位。

## 11. 预设完整帧预览

当预设满足以下条件时，“发送内容”框不再显示原始 `preset.data`，而是只读显示 `/api/frame/preview` 返回的完整组包 HEX：

- `preset.format === "hex"`
- `preset.frame_config?.enabled === true`

预览包括帧头、序号、长度、数据、CRC 和帧尾，与服务端发送使用同一组帧核心。

关键约束：

> 完整帧预览绝不能写回 `preset.data`。

`preset.data` 是 `source: "editor"` 数据字段的原始输入。如果把完整帧写回，下一次会把帧头、CRC 等再次嵌入数据字段，产生重复组帧。

因此组帧启用时输入框是只读的；关闭该预设的帧配置后，原始数据仍然存在并可继续编辑。

预览管理位于 `TrafficConsole.vue`：

- 仅观察预设的 `id/data/format/frame_config`
- 100 ms 防抖
- 通过 JSON signature 避免名称、延时等无关修改触发重算
- generation 计数丢弃过期异步响应
- 配置变化时先清空旧帧，显示“正在生成完整帧”
- 配置无效时显示后端返回的错误，不保留过期预览

## 12. 帧变化自动发送

### 12.1 配置范围

每条发送预设新增持久化开关：

```ts
auto_send_on_change: boolean
```

旧预设没有该字段时，`normalizeSendPreset()` 会默认设为 `false`，所以升级不会突然自动发送数据。

当前精确功能范围：

- 只适用于发送预设中的自定义生成控件
- 不会因帧编辑器中修改字段并点击应用而自动发送
- 不会因异步预览完成而自动发送
- 不会因序号回写或本地存储保存而自动发送
- 必须已连接、预设已启用、自动发送开关已开启且帧可发送

如果后续要扩展为“任何帧配置变化都自动发送”，必须单独设计来源识别，不能简单 watch 整个配置，否则预览、序号回写和持久化都可能形成误发送或循环。

### 12.2 滑块事件语义

`FrameGeneratedControls.vue` 故意区分两个事件：

```text
update  -> 更新字段值和完整帧预览
commit  -> 用户完成一次操作，可触发自动发送
```

滑块：

- `input`：拖动时连续触发，只发 `update`
- `change`：松开后触发，先确保最新值已 update，再发 `commit`

数字输入框同样在输入时更新预览，在 change/完成编辑时提交。

复选框、单选框、字节开关和枚举没有持续拖动阶段，因此一次 change 同时触发 update 和 commit。

不要把滑块的自动发送绑定回 `input`，否则拖动会产生大量真实通信发送。

### 12.3 防并发和保留最后一次变化

`TrafficConsole.vue` 使用 `pendingAutoSendPresetIds` 保存待发送预设：

- 同一时间只允许一个预设发送
- 当前发送期间又完成一次操作，会保留待发送标记
- 当前发送结束后，使用最新配置补发一次
- 不并发写 transport
- 不丢掉最后一次已提交的控件变化
- 删除预设时会清理对应待发送标记

## 13. 本地存储和兼容恢复

本地存储键位于 `frontend/src/storage.ts`：

| Key | 内容 |
| --- | --- |
| `snd.transport-settings.v1` | 四种通信模式配置和当前模式 |
| `snd.theme` | 浅色/深色主题 |
| `snd.send-presets.v1` | 最多 100 条发送预设及独立帧配置 |
| `snd.send-editor.v1` | 主发送区内容、格式和周期 |
| `snd.hex-frame-config.v1` | 主发送区 HEX 帧配置 |

本地存储数据被视为不可信输入。恢复时会逐字段校验：

- 字符串长度
- 枚举值
- 字节长度
- 字节序
- CRC 参数
- 生成器范围和步进
- 字段 ID 与范围引用
- `auto_send_on_change` 缺失时默认关闭

增加新字段时应提供旧版本默认值，不要让已有预设整体加载失败。

数据只保存在当前 Electron/浏览器 profile 中，不会自动同步到 GitHub、其他浏览器或其他电脑。

## 14. 前后端类型和校验同步要求

修改通信或组帧协议时，通常至少需要同步检查：

1. `frontend/src/types.ts`
2. `server/src/core/types.ts`
3. `server/src/core/schemas.ts`
4. `frontend/src/storage.ts`
5. `frontend/src/components/HexFrameBuilder.vue`
6. `server/src/core/hex-frame.ts`
7. 对应测试

只改前端类型会导致 API 被 Zod 拒绝；只改服务端会导致旧本地数据被前端恢复逻辑丢弃。

## 15. 构建产物规则

Vite 配置将前端直接输出到 `server/public/`：

```text
frontend build -> server/public/index.html
               -> server/public/index-<hash>.css
               -> server/public/index-<hash>.js
```

这些哈希文件已纳入 Git。每次前端修改后需要运行完整构建并提交：

- 新哈希资源
- 删除的旧哈希资源
- 更新后的 `server/public/index.html`

不要手工修改压缩后的 `server/public/index-*.js/css`。所有界面修改应从 `frontend/src` 完成后重新构建。

## 16. 验证记录

本轮最终状态已通过：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

结果：

- Vitest：8 个测试文件通过
- 测试数量：63/63 通过
- Vue TypeScript 检查通过
- Server TypeScript 检查通过
- Electron TypeScript 检查通过
- Vite 生产构建通过
- Server 构建通过
- Electron 主进程构建通过

额外手工/端到端验证：

- 自定义 UInt 滑块值设为 `42`
- 配置持久化值为 `42`
- 服务端完整帧预览编码为 `2A`
- Electron 内置 Fastify 首页返回 HTTP 200
- Electron 加载了对应最新哈希前端资源
- Windows Electron 窗口能显示 `Serial Network Debugger` 标题
- TCP 自动重连使用真实本机回环服务验证

测试说明：周期发送测试包含真实计时和本机 TCP 回环。在 Electron 同时运行、系统负载较高时曾出现一次 75 ms 窗口内少收到一轮数据的抖动；关闭运行中的 Electron 后重新执行，63 项全部通过。不要因单次资源争用直接放宽协议断言，先隔离运行进程重试。

## 17. 启动方式

环境要求：

- Node.js `>=24.12 <25`
- npm 11

安装：

```powershell
npm install
```

浏览器开发模式：

```powershell
# 终端 1
npm run dev:server

# 终端 2
npm run dev:frontend
```

地址：`http://127.0.0.1:5173`。Vite 将 `/api` 和 `/ws` 代理到 `127.0.0.1:8765`。

生产服务：

```powershell
npm run build
npm start
```

Electron：

```powershell
npm run desktop
```

## 18. Git 和协作规则

仓库规则记录在 `AGENTS.md`：

- 每次完成代码、配置或文档修改后都要创建 Git commit
- 每条提交信息必须同时包含中文和英文
- 每个提交聚焦一个逻辑修改
- 默认不推送 GitHub，只有用户明确要求时才推送
- 认证、权限、密钥、迁移、发布配置、核心架构等高风险修改必须使用独立分支
- 分支上完成测试和提交后，必须获得用户明确确认才能合并 `main`
- 禁止提交密码、令牌、私钥或其他敏感凭据

本轮使用的功能分支：

```text
feature/electron-desktop
feature/tcp-client-auto-reconnect
feature/hex-frame-builder
```

最终已在用户确认后将 `feature/hex-frame-builder` 快进合并到 `main` 并推送 GitHub。

## 19. 已知边界和后续风险

### 19.1 缺少前端组件自动化测试

当前 63 项测试主要覆盖服务端、回环通信、schema、组帧和纯 HEX 显示函数。以下浏览器交互目前依赖类型检查、构建和手工验证：

- 滑块拖动期间不发送、松手发送
- 自动发送排队使用最新值
- 每条预设的异步完整帧预览
- 只读预览不修改 `preset.data`
- 多预设同时快速操作

后续建议增加 Vue Test Utils/Vitest 组件测试，或 Playwright Electron/浏览器端到端测试。

### 19.2 自动发送当前只覆盖生成控件

“帧变化自动发送”目前不是对整个 `frame_config` 的深度 watch，而是由运行控件明确发出 commit。这样能避免误发送，但也意味着在帧编辑器中修改固定帧头、CRC 配置等不会自动发送。

### 19.3 大量预设的预览请求

预览有 100 ms 防抖和 signature 去重，但如果一次恢复或同时改变很多带帧配置的预设，仍可能并发请求 `/api/frame/preview`。当前最多 100 条预设，通常可接受；若继续扩大上限，应考虑请求队列或只预览可见行。

### 19.4 前后端类型重复

帧类型在 frontend/server 各有一份，存在漂移风险。若未来进行架构整理，可考虑增加共享 workspace package，但不要在功能修改中顺手做大范围迁移。

### 19.5 无认证

服务默认只监听 `127.0.0.1`。当前没有用户认证，不应直接暴露到公网。GitHub 仓库内也不能实现“同仓库中特定文件仅部分成员可读”；敏感代码或配置需要独立私有仓库，密钥应使用环境变量或 GitHub Secrets。

## 20. 后续 AI 开始工作前的检查清单

1. 阅读根目录 `AGENTS.md` 和本文档。
2. 执行 `git status --short --branch`，确认当前分支和未提交修改。
3. 不要撤销来源不明的工作区修改；它们可能属于用户。
4. 读取目标组件和对应服务端 schema/类型，不要只改一端。
5. 涉及高风险修改时从 `main` 创建新功能分支。
6. 保持 HEX 显示值与业务值分离。
7. 保持完整帧预览与原始 `preset.data` 分离。
8. 保持序号仅在发送成功后提交。
9. 保持滑块 `input=预览`、`change=提交发送` 的事件语义。
10. 前端修改后运行完整 `npm run build`，提交新的 `server/public` 哈希资源。
11. 至少执行 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。
12. 使用中英文提交信息；未获用户明确要求不要 push 或 merge。

## 21. 关键文件索引

| 文件 | 后续修改时重点关注 |
| --- | --- |
| `AGENTS.md` | 提交、推送和分支规则 |
| `package.json` | 根脚本、Electron 入口和免安装打包配置 |
| `desktop/src/main.ts` | Electron 窗口、随机端口 Fastify、退出清理 |
| `frontend/src/hex-display.ts` | HEX 显示空格、光标和删除规则 |
| `frontend/src/components/HexFrameBuilder.vue` | 自由字段编辑器、样例、属性和编辑预览 |
| `frontend/src/components/FrameGeneratedControls.vue` | 运行控件、update/commit 事件边界 |
| `frontend/src/components/SendPresetPanel.vue` | 预设列表、完整帧只读显示、自动发送开关 |
| `frontend/src/components/TrafficConsole.vue` | 主发送、预设状态、预览缓存、发送排队和序号回写 |
| `frontend/src/storage.ts` | localStorage schema、旧数据兼容和默认值 |
| `frontend/src/types.ts` | 前端通信和帧类型 |
| `server/src/core/types.ts` | 服务端通信和帧类型 |
| `server/src/core/schemas.ts` | API 运行时校验 |
| `server/src/core/hex-frame.ts` | 最终组帧、数据编码、长度、CRC、序号 |
| `server/src/core/periodic-sender.ts` | 周期发送和帧序号状态 |
| `server/src/http/app.ts` | REST、WebSocket、预览和发送入口 |
| `server/src/transports/tcp.ts` | TCP Client 自动重连和 TCP Server |
| `server/test/hex-frame.test.ts` | 自由组帧、生成数据、BCD 和错误边界 |
| `server/test/api.test.ts` | HTTP、WebSocket、帧预览与实际发送一致性 |
| `server/test/transports.test.ts` | TCP/UDP 回环和自动重连 |

## 22. 建议的下一步

优先级从高到低：

1. 为生成控件和自动发送增加浏览器/Electron 端到端测试。
2. 为预设的原始 editor 数据提供明确的独立编辑入口，避免启用完整帧预览后用户找不到原始数据来源。
3. 增加预设导入/导出，解决本地存储不跨设备同步的问题。
4. 如果协议需求增加，扩展 BCD 的小数位/缩放语义，并先定义兼容 schema 版本。
5. 如果需要多人维护受保护文件，配置 CODEOWNERS + Branch Ruleset；敏感内容则拆到独立私有仓库。
