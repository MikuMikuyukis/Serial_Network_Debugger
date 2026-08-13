# Serial Network Debugger

一个跨平台的串口与网络调试工具。Node.js + TypeScript 负责本机串口、Socket、HTTP 和 WebSocket，Vue 3 浏览器界面负责连接配置、数据发送与实时日志显示。

## 当前功能

- 串口枚举、连接、收发，支持波特率、数据位、校验位、停止位和接收合并间隔配置
- TCP Client 连接、双向收发和断线状态通知
- TCP Client 可选掉线自动重连，远端服务恢复后每 3 秒自动尝试重新建立连接
- TCP Server 监听多个客户端，接收数据并向所有客户端广播
- UDP 本地绑定、固定远端发送，或自动回复最近的数据来源
- 文本与 HEX 数据收发，支持 UTF-8、ASCII、GBK 和 CR/LF 行尾
- HEX 发送支持自由组合帧字段，可重复添加并任意排序帧头、序号、功能码、长度、数据、CRC16 和帧尾
- 后端周期自动发送，支持 10 ms 至 24 小时间隔、启动后立即发送、累计次数和多页面状态同步
- 发送预设的新增、编辑、删除、载入与一键发送，每条 HEX 预设可独立保存自由组合的帧格式
- WebSocket 实时日志、收发字节统计、暂停显示和自动滚动
- 顶部通信工具栏集中显示当前参数，通过齿轮弹窗配置四种通信模式
- 支持浅色/深色主题，并在浏览器中记住最近选择的主题和四种通信模式参数
- 浏览器最多保留 5,000 条日志，批量渲染并保持发送区固定可见

通信设置和最多 100 条发送预设保存在当前浏览器的本地存储中。刷新或重新打开页面后会恢复设置与预设，但不会自动建立连接。不同浏览器或不同电脑的数据彼此独立。

HEX 帧配置也保存在当前浏览器中。打开“编辑 HEX 帧”后，可以从空白配置逐项添加字段，也可以载入“通用变长帧”或“固定命令帧”样例，再继续移动、复制、删除或修改任意字段。定长数据在添加后从右侧属性选择 1、2、3、4 或 8 Byte。每条 HEX 发送预设右侧也有独立的帧配置入口，配置随预设保存；样例只会替换当前配置草稿，不会限制后续组合方式。

帧序号仅在发送成功后自增并按字段宽度回绕；发送失败不会跳号。帧长度和 CRC16 都可以按字段范围计算，范围通过字段 ID 记录，因此字段移动后引用仍然有效。CRC16 内置 MODBUS、ARC、CCITT-FALSE、XMODEM、X25、KERMIT，也支持自定义多项式、初始值、结果异或及输入/输出反转。只含固定字段的帧不需要在发送框中填写数据，也可以手动或周期发送。

周期发送由 Node.js 后端调度，不受浏览器后台标签页节流影响。启动时会立即发送一次，之后每次发送完成再等待设定间隔，因此慢速通信不会发生周期任务重叠。切换连接、断开连接、发送失败或关闭服务时会自动停止周期任务。

## 技术结构

项目已经完全使用 Node.js + TypeScript，不再需要 Python：

```text
server/src/core/          通信类型、编解码、事件分发和连接管理
server/src/transports/    串口、TCP Client、TCP Server、UDP
server/src/http/          Fastify REST、WebSocket 和静态页面服务
server/src/cli.ts         命令行启动入口
server/test/              Vitest 单元及回环集成测试
server/public/            Vue 生产构建，由 Node.js 直接托管
frontend/                 Vue 3 + TypeScript 前端源码
```

通信核心不依赖 Fastify。后续迁移 Electron 时，主进程可以直接复用 `server/src/core` 和 `server/src/transports`，浏览器部署仍使用当前 HTTP/WebSocket 层。

## 环境要求

- Node.js 24 LTS（建议 24.12 或更高的 24.x 版本）
- npm 11
- Windows 10/11、macOS 或主流 Linux 发行版
- Chrome、Edge、Firefox 或 Safari 的近期版本

`serialport` 包含平台原生模块。首次安装时 npm 会获取当前操作系统和 CPU 架构对应的组件，因此 Windows、macOS、Linux 应分别执行安装和构建，不要跨平台复制 `node_modules`。

## 安装

在项目根目录运行：

```powershell
npm install
```

根目录使用 npm workspaces 统一管理前端与服务端依赖，只保留一份 `package-lock.json`。

## 构建与启动

生成 Vue 页面和 Node.js 服务端代码：

```powershell
npm run build
```

启动生产服务：

```powershell
npm start
```

浏览器打开 <http://127.0.0.1:8765>。

## Electron 桌面版

桌面版会在 Electron 主进程中启动现有 Node.js 服务，并使用随机本地端口加载界面。串口、TCP、UDP、周期发送和浏览器版使用同一套后端实现，不需要另外启动服务。

开发机直接启动桌面版：

```powershell
npm run desktop
```

生成无需安装、可直接运行的桌面应用目录：

```powershell
npm run desktop:pack
```

Windows 入口为 `release/win-unpacked/Serial Network Debugger.exe`，整个 `win-unpacked` 目录需要一起保留或分发，不需要运行安装程序。`serialport` 包含原生模块，因此应在目标操作系统上安装依赖并打包；Windows、macOS 和 Linux 的桌面产物不能直接跨平台构建复用。

默认只监听 `127.0.0.1`，局域网内其他电脑无法访问。确需开放访问时：

```powershell
npm start -- --host 0.0.0.0 --port 8765
```

开放到局域网前应配置系统防火墙。当前版本没有身份认证，不应暴露到公网。

## 开发

终端一启动 Node.js 服务端热重载：

```powershell
npm run dev:server
```

终端二启动 Vue 开发服务器：

```powershell
npm run dev:frontend
```

浏览器打开 <http://127.0.0.1:5173>。Vite 会将 `/api` 和 `/ws` 代理到 <http://127.0.0.1:8765>。

## 测试

```powershell
npm test
npm run typecheck
npm run build
```

测试会使用本机回环地址创建临时 TCP/UDP 端点，不访问公网，也不要求真实串口。自动测试涵盖编解码、HEX 自由组帧、配置校验、串口接收合并、TCP/UDP、HTTP、WebSocket 实时事件链路和周期发送调度。

## 串口权限

Windows 通常无需额外配置。Linux 用户需要具有串口设备权限，常见做法是加入 `dialout` 组，然后重新登录：

```bash
sudo usermod -aG dialout "$USER"
```

macOS 串口通常显示为 `/dev/cu.*`。三个平台都不能同时由多个程序独占打开同一串口。

## 当前边界

- 同一服务进程一次只运行一种通信模式。
- TCP Server 发送时广播给全部客户端，暂不支持选择单个客户端。
- UDP 未配置固定远端时，发送目标为最近一个数据报来源。
- 暂停日志只停止页面显示，后端仍正常接收和统计数据。
- 周期发送运行时仍允许手动发送和预设一键发送，后端会将所有发送操作排队执行，避免数据交错。
- 发送预设只保存在当前浏览器；它不是服务端账号数据，也不会自动同步到其他电脑。
- 当前版本没有日志落盘和动态快速控件，这些属于后续功能。
- 服务部署到远程服务器时，操作的是服务器上的串口；要访问浏览器所在电脑的本地串口，应使用未来的 Electron 桌面版本或本地代理。

## 故障排查

串口是字节流，本身没有数据包边界。工具默认等待线路持续空闲 20 ms，再把这段时间内连续到达的底层读取块合并成一条 RX 日志。可以在串口配置中调整“接收合并间隔”：间隔过小可能拆成多条，间隔过大则增加显示延迟。

选择 HEX 发送后，界面会自动启用 HEX 显示，避免 `00` 等不可见字节看起来像空内容。

如果 `npm start` 提示找不到 `server/dist/cli.js`，请先运行 `npm run build`。
