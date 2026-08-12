# Serial Network Debugger

一个跨平台的串口与网络调试工具。Python 后端负责本机串口及 Socket 通信，浏览器界面负责连接配置、数据发送和实时日志显示。

## 当前功能

- 串口枚举、连接、收发，支持波特率、数据位、校验位、停止位和接收合并间隔配置
- TCP Client 连接、双向收发和断线状态通知
- TCP Server 监听多个客户端，接收数据并向所有客户端广播
- UDP 本地绑定、固定远端发送，或自动回复最近的数据来源
- 文本与 HEX 数据收发，支持 UTF-8、ASCII、GBK 和 CR/LF 行尾
- WebSocket 实时日志、收发字节统计、暂停显示和自动滚动
- 顶部通信工具栏集中显示当前参数，通过齿轮弹窗配置串口、TCP Client、TCP Server 和 UDP
- 支持浅色/深色主题，并在浏览器中记住最近选择的主题和四种通信模式参数
- 浏览器最多保留 5,000 条日志，并以 50 ms 为周期批量渲染；桌面端只在日志区内部滚动，发送区固定可见
- FastAPI 自动生成的接口文档

## 环境要求

- Python 3.13
- Node.js 24 LTS（仅修改或构建前端时需要）
- Windows 10/11、macOS 或主流 Linux 发行版
- Chrome、Edge、Firefox 或 Safari 的近期版本

普通使用和部署不需要 Node.js。仓库已经包含 Vue 前端的生产构建产物，Python 会直接托管这些静态文件。

通信设置保存在当前浏览器的本地存储中，刷新或重新打开页面后会恢复，但不会自动建立连接。不同浏览器或不同电脑的设置彼此独立。

## 安装

在项目根目录创建虚拟环境：

```powershell
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

macOS 或 Linux：

```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

## 启动

```powershell
serial-network-debugger
```

也可以直接运行模块：

```powershell
python -m comm_debugger
```

浏览器打开 <http://127.0.0.1:8765>。API 文档位于 <http://127.0.0.1:8765/docs>。

默认只监听 `127.0.0.1`，局域网内其他电脑无法访问。确需开放访问时可以运行：

```powershell
serial-network-debugger --host 0.0.0.0 --port 8765
```

开放到局域网前应配置系统防火墙；当前基础版本没有身份认证，不应暴露到公网。

## 前端开发

界面使用 Vue 3、TypeScript 和 Vite。修改前端时先启动 Python 后端，再启动 Vite 开发服务器：

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

浏览器打开 <http://127.0.0.1:5173>。Vite 会把 `/api` 和 `/ws` 请求代理到 <http://127.0.0.1:8765>。

生成由 Python 托管的生产文件：

```powershell
cd frontend
npm.cmd run build
```

构建会先运行 TypeScript 类型检查，再将产物写入 `src/comm_debugger/static/`。修改 Vue 源码后，应重新构建并提交生成文件。

## 串口权限

Windows 通常无需额外配置。Linux 用户需要具有串口设备权限，常见做法是加入 `dialout` 组，然后重新登录：

```bash
sudo usermod -aG dialout "$USER"
```

macOS 串口通常显示为 `/dev/cu.*`。三个平台都不能同时由多个程序独占打开同一串口。

## 测试

```powershell
python -m pytest
```

测试会使用本机回环地址创建临时 TCP/UDP 端点，不访问公网，也不需要真实串口设备。

## 项目结构

```text
src/comm_debugger/
├── app.py                 FastAPI REST 与 WebSocket 接口
├── codec.py               文本和 HEX 编解码
├── events.py              实时事件分发
├── manager.py             当前通信连接管理
├── models.py              API 配置模型
├── transports/            串口、TCP Client、TCP Server、UDP
└── static/                浏览器界面
frontend/                  Vue 3 + TypeScript 前端源码
tests/                     单元与回环集成测试
```

## 当前边界

- 同一服务进程一次只运行一种通信模式。
- TCP Server 发送时广播给全部客户端，暂不支持选择单个客户端。
- UDP 未配置固定远端时，发送目标为最近一个数据报来源。
- 暂停日志只停止页面显示，后端仍正常接收和统计数据。
- 当前版本没有周期发送、日志落盘、协议组帧和动态快速控件，这些属于后续功能。

## 故障排查

通信日志标题下方应显示“实时通道已连接”。如果持续显示“实时通道正在重连”，请确认项目通过 `python -m pip install -e ".[dev]"` 完整安装；浏览器实时日志依赖 Uvicorn 的 WebSocket 运行组件。

串口是字节流，本身没有数据包边界。工具默认等待线路空闲 20 ms，再把这段时间内连续到达的底层读取块合并成一条 RX 日志；可在串口配置中调整“接收合并间隔”。间隔过小可能拆成多条，间隔过大则增加显示延迟。它只负责显示层合并，不等同于按帧头、长度或帧尾解析协议包。

选择 HEX 发送后，界面会自动启用 HEX 显示，避免 `00` 等不可见字节看起来像空内容。
