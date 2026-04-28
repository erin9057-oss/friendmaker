# 朋友制作器

专为 Switch 版《朋友收集：梦想生活》制作。

一个基于 Mac + ESP32 的 Nintendo Switch 自动画图 MVP。

## 作者说明

- 来源作者：小红书作者 `惜羽拓麻镇`
- 当前仓库内容禁止商用
- 转发、转载或二次分享时，需注明作者名称 `惜羽拓麻镇`
- 转发、转载或二次分享时，需同时附上原始发布地址
- 如需公开传播，请先自行补全并核对原始发布地址后再发布

当前这版仓库先把最关键的一条链路落地了：

`导入图片 -> 像素化/限色 -> 扫描线命令 -> 串口 ACK 发送 -> ESP32 协议解析`

默认硬件目标现在按 `ESP32-WROOM-32 / ESP-32S` 这条路线组织：

`Mac CLI -> USB 串口 -> ESP32-WROOM-32 -> 蓝牙 -> Switch`

## 当前范围

- macOS 上的 TypeScript CLI
- PNG / JPG / SVG 图片输入
- 黑白模式与固定调色板模式
- `1 / 3 / 7 / 13 / 19 / 27` 六种画笔大小
- 生成 PNG 预览
- 生成串口文本命令
- 通过串口逐条发送并等待 `OK`
- ESP32 端命令解析与 ACK 返回
- 现成的串口 smoke test 命令文件
- 本地图形界面原型

## 仓库结构

```txt
apps/desktop/src
  cli/               参数解析
  config/            默认配置与 profile 加载
  image/             图片缩放、限色、预览导出
  path/              扫描线路径
  protocol/          指令对象与序列化
  serial/            串口枚举与 ACK 发送

firmware/esp32
  src/               PlatformIO 固件骨架

profiles/            示例配置
examples/            演示图片与示例命令
docs/                使用说明
```

## 快速开始

给第一次试用的朋友，建议直接先看：

- `docs/user-trial-guide.md`

试用时最容易漏掉的 3 个前提：

- Switch 里的画笔大小要和网页当前选择一致
- 开始绘制前，画笔要停在画布中心
- 如果使用 `官方色绘制`，右侧 `9` 个色盘槽位要先全部手动设成基本颜色页左上角的白色

安装依赖：

```bash
npm install
```

如果你想用 `pnpm`：

```bash
corepack enable
corepack prepare pnpm@10.11.1 --activate
pnpm install
```

生成预览和命令文件：

```bash
npm run dev -- --image ./examples/demo.svg --preview ./tmp/demo-preview.png --write-commands ./tmp/demo-commands.txt
```

列出串口：

```bash
npm run dev -- --list-ports
```

发送到 ESP32：

```bash
npm run dev -- --image ./examples/demo.svg --port /dev/cu.usbmodemXXXX --send
```

无板模拟发送：

```bash
npm run dev -- --commands-file ./examples/smoke-test-commands.txt --send --simulate-device
```

启动图形界面：

```bash
npm run ui:dev
```

然后打开：

```txt
http://127.0.0.1:4307
```

当前 Web UI 已支持：

- 三页工作台：脚本生成 / 刷入固件 / 手柄测试
- 导入 PNG / JPG / SVG
- 调整尺寸、模式、阈值、调色板
- 生成像素预览和命令脚本
- 复制 / 下载脚本
- 发送到本地模拟器
- 发送到串口设备（ESP32）
- 调用本机 PlatformIO 刷入固件
- 发送单步控制命令做手柄测试

当前针对目标绘画页，先采用一组固定场景假设：

- 进入页面时光标在主画布中心
- 默认工具是 `pen`
- 颜色栏固定在右侧
- 工具栏固定在顶部
- 正式绘制前，需要先完成一次 `center -> top-left` 校准

发送过程中可用：

- `p` 暂停 / 继续
- `q` 停止

## 固件烧录

如果你现在用的是通用 `ESP32-WROOM-32 / ESP-32S` 开发板，先烧这个环境：

```bash
pio run -e esp32dev_wireless -t upload
pio device monitor -b 115200
```

如果你的克隆板更贴近 `NodeMCU-32S`，可以切到：

```bash
pio run -e nodemcu_32s_wireless -t upload
pio device monitor -b 115200
```

## 常用参数

```bash
--image <path>
--commands-file <path>
--profile <path>
--preview <path>
--write-commands <path>
--port <device>
--send
--simulate-device
--simulate-ack-delay 15
--simulate-error-at 3
--size 32
--brush-size 3
--mode mono
--mode palette --colors 4
--palette "#000000,#ffffff,#ff0000,#0000ff"
--resize contain
--threshold 128
```

## 配置文件示例

参考：

- `profiles/switch-mono-250.json`
- `profiles/switch-palette-32.json`

你可以按目标游戏调这些关键参数：

- `cellMoveDuration`
- `inputDelay`
- `homeDuration`
- `colorChangeDuration`
- `palette`
- `brushSize`
- `startCursor`
- `startTool`
- `startColorIndex`
- `centerToTopLeftDx`
- `centerToTopLeftDy`

其中新增的场景字段含义是：

- `startCursor`：进入绘画页时的默认光标锚点
- `startTool`：进入绘画页后的默认工具
- `brushSize`：当前绘制使用的画笔大小
- `startColorIndex`：进入绘画页后的默认颜色索引
- `centerToTopLeftDx / centerToTopLeftDy`：从中心移动到左上角的校准步数

这组场景字段目前已经写进 profile 和 PRD，用来固定目标场景与后续校准数据；它们还没有全部接入固件执行层。

## 现在最重要的限制

- 当前 UI 是轻量 Web 原型，还不是 Electron 桌面应用
- `ESP32-WROOM-32 / ESP-32S` 现在已经切到基于 `UARTSwitchCon` 的 `Switch Pro Controller` 兼容蓝牙实现，但还需要用实机继续验证首次配对和绘画页移动校准
- 颜色切换逻辑目前是占位版，适合固定颜色栏场景
- 第一优先级仍然是输入稳定性，不是绘图速度

## 硬件提醒

当前主线是原版 `ESP32` 的 `Bluetooth Classic` 路线，不是 `USB HID` 路线。你已经买的 `ESP32-WROOM-32 / ESP-32S` 正适合这条路径。

如果后面你想探索另一条 `USB HID` 路线，再考虑 `ESP32-S2/S3` 也不晚。但那是另一套实现，不是这个分支当前的默认方向。

从这次开始，`esp32dev_wireless` / `nodemcu_32s_wireless` 这两个环境走的是 `Arduino + ESP-IDF` 联编。第一次编译会比以前慢很多，因为要把 `ESP-IDF` 的依赖和 Bluedroid 组件一起准备好。

## 许可证提醒

当前 `firmware/esp32` 里的 `Switch` 蓝牙兼容实现，已经引入并改写自 [UARTSwitchCon](https://github.com/nullstalgia/UARTSwitchCon) 的思路与代码路径。`UARTSwitchCon` 使用 `GPL-3.0` 许可证，所以如果你继续按这个方向分发或开源整个固件实现，需要把这一层的许可证义务一起考虑进去。

## 到货后先做什么

先跑最简单的串口自检，不要直接上图片：

```bash
npm run dev -- --commands-file ./examples/smoke-test-commands.txt --port /dev/cu.SLAB_USBtoUART --send
```

完整 bring-up 流程见：

- `docs/setup-mac.md`
- `docs/arrival-checklist.md`
- `docs/wiring.md`
- `docs/development-manual.md`

## 到货前还能做什么

现在已经支持本地模拟设备，可以在没有开发板的情况下先验证：

- ACK 时序
- 命令顺序
- pause / resume / stop
- 重试逻辑
- 错误路径

例如：

```bash
npm run dev -- --commands-file ./examples/smoke-test-commands.txt --send --simulate-device
npm run dev -- --commands-file ./examples/smoke-test-commands.txt --send --simulate-device --simulate-error-at 2
```

## 下一步建议

当前开发判断与阶段性结论，优先看：

- `docs/development-manual.md`

1. 先用 `smoke-test-commands.txt` 跑 `串口 ACK + 指令解析 + 单步动作时序`
2. 再跑 `demo.svg` 的图像生成和串口发送
3. 再用 `I` 命令或手柄测试页确认 `bt_hid_ready / bt_app_registered / bt_discoverable / bt_connected`
4. 完成 `Switch` 配对和单格移动校准后，再接多色配置和离线存储
