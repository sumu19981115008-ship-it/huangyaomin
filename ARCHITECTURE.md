# FixelFlow 2 — 架构文档

> 每次新开发前阅读本文档。最后更新：2026-04-20

---

## 一、项目结构

```
game2/
├── index.html          # 游戏入口，加载 phaser.min.js + src/main.js
├── phaser.min.js        # Phaser 3 本地副本（不走 npm，避免打包体积问题）
├── vite.config.js       # 开发服务器 port=5174，build outDir=dist
├── serve.ps1            # 不依赖 node 的静态服务器备用方案（PowerShell .NET）
├── package.json         # 仅 vite 一个 devDependency，type=module
├── levels/              # 301 个关卡 JSON（level1.json ~ level301.json）
└── src/
    ├── main.js          # Phaser.Game 初始化入口
    ├── constants.js     # 所有常量 + 动态几何对象 G
    ├── GameLogic.js     # 纯游戏逻辑（无渲染依赖）
    ├── GameScene.js     # Phaser Scene，渲染 + 输入 + 调用 GameLogic
    └── dev/
        └── DevTools.js  # 开发用跳关面板（生产环境可关闭）
```

---

## 二、启动方式

| 方式 | 命令 | 说明 |
|------|------|------|
| Vite 开发服务器 | `npm run dev` | 热更新，port 5174 |
| PowerShell 静态服务 | `.\serve.ps1` | 不依赖 node，同 port 5174 |
| 生产构建 | `npm run build` | 输出到 dist/ |

> **注意**：serve.ps1 是只读静态服务，无法处理 POST 请求。编辑器保存文件必须用 Vite dev server + 自定义插件，或单独的 Node 脚本。

---

## 三、常量与动态几何（constants.js）

### 固定常量

| 常量 | 值 | 说明 |
|------|----|------|
| `VW` | 480 | 视口宽度 |
| `VH` | 920 | 视口高度 |
| `TRACK_GAP` | 22 | 轨道到画布边缘的间距 |
| `CELL_MIN` | 6 | 格子最小像素尺寸 |
| `CELL_MAX` | 18 | 格子最大像素尺寸 |
| `TRACK_CAP` | 5 | 轨道最大炮车数 |
| `BUFFER_CAP` | 5 | 暂存区初始容量（道具一可扩展到8） |
| `BULLET_SPEED` | 14 | 子弹像素速度/帧 |
| `TURRET_SPEED` | 3 | 炮车路径速度/帧（冲刺时乘以 speedMult） |
| `TOTAL_LEVELS` | 301 | 关卡总数 |

### 动态几何对象 G

每次 `loadLevel()` 时由 `GameLogic` 重新计算并写入，`GameScene` 只读不写。

```js
export const G = {
  GW, GH,           // 网格列数、行数（= boardWidth, boardHeight）
  CELL,             // 格子像素尺寸（动态计算，钳制在 CELL_MIN~CELL_MAX）
  CW, CH,           // 画布像素宽高 = GW*CELL, GH*CELL
  CANVAS_X,         // 画布左上角 X（居中）
  CANVAS_Y,         // 画布左上角 Y（固定 90）
  ITEM_BAR_Y,       // 道具栏 Y
  BUFFER_Y,         // 暂存区 Y
  QUEUE_Y,          // 队列 Y
  LEN_BOTTOM/RIGHT/TOP/LEFT,  // 四边轨道长度
  TOTAL_DIST,       // 一圈总路径长度
};
```

**计算公式：**
```
CANVAS_Y_FIXED = 90
UI_RESERVE     = 516
cellByW  = floor((480 - 40) / GW)
cellByH  = floor((920 - 90 - 516) / GH)
CELL     = clamp(CELL_MIN, CELL_MAX, min(cellByW, cellByH))
CW       = GW * CELL
CH       = GH * CELL
CANVAS_X = floor((480 - CW) / 2)
ITEM_BAR_Y = CANVAS_Y + CH + TRACK_GAP + 52
BUFFER_Y   = ITEM_BAR_Y + 130
QUEUE_Y    = BUFFER_Y + 90
```

---

## 四、关卡 JSON 格式

### 完整字段说明

```jsonc
{
  "boardWidth":  20,   // 网格列数（实际使用，可与 boardHeight 不同）
  "boardHeight": 20,   // 网格行数（实际使用）
  "boardSize":   20,   // 遗留字段，原游戏中 boardWidth==boardHeight==boardSize
                       // 当前301关中有211关三者不完全相等，游戏代码只读 boardWidth/boardHeight
  "numberOfLanes": 3,  // 队列（lane）数量，分布：2(19关) 3(109关) 4(111关) 5(61关) 6(1关)
  "maxTanksOnConveyor": 5,  // 固定为5，对应 TRACK_CAP，游戏代码不读此字段

  "entities": [
    {
      "type": "PixelBlock",
      "color": "#FF0000",   // 十六进制颜色，游戏内统一转大写
      "cells": [
        { "x": 5, "y": 10 } // 原始坐标系：x向右，y向上（0=底部）
                             // 游戏内转换：row = (boardHeight-1) - cell.y
      ],
      // 以下字段为遗留字段，301关中全部为默认值，游戏代码不读
      "pixelCount": 0,
      "colorRanges": []
    }
  ],

  "initialTanks": [
    {
      "color": "#FF0000",
      "ammo": 20,           // 单辆弹药数，必须是10的倍数
      "lane": 0,            // 所在队列索引（0 ~ numberOfLanes-1）
      "position": 0,        // 队列内排序位置（同lane内按position升序部署）
      // 以下字段为遗留字段，301关中全部为默认值，游戏代码不读
      "isLinked": false,
      "linkedGroupId": -1,
      "isMystery": false,
      "isLock": false,
      "stoneData": { "amount": 0 },
      "isHammer": false
    }
  ],

  "shooterPipes": [],   // 遗留字段，301关中全部为空，游戏代码不读
}
```

### 关卡数据约束（必须满足）

1. **同色对齐**：每种颜色的有效方块数 == 该颜色所有炮车的 ammo 合计
2. **整十**：每种颜色的方块/弹药总数必须是 10 的倍数
3. **单车整十**：每辆炮车的 ammo 必须是 10 的倍数
4. **坐标有效**：`cell.x ∈ [0, boardWidth)`，翻转后 `row = (boardHeight-1)-cell.y ∈ [0, boardHeight)`

### 坐标系说明

```
原始 JSON 坐标（y向上）      游戏内网格坐标（y向下）
(0, boardHeight-1) ←→ row 0（顶部）
(0, 0)             ←→ row boardHeight-1（底部）

转换：row = (boardHeight - 1) - cell.y
```

---

## 五、游戏逻辑（GameLogic.js）

### 核心类

**`GameLogic`**
- `loadLevel(data)` — 解析关卡 JSON，计算 G，初始化 grid/blocks/lanes
- `update()` — 每帧：移动炮车、检测射击槽位、生成 pendingBullets
- `onBulletHit(turretId, col, row)` — 命中回调，清除方块，检查胜负
- `deployFromLane(laneIdx)` / `deployFromBuffer(bufferIdx)` — 玩家部署炮车
- `_findTarget(turret)` — 炮车射击目标查找（沿当前边向内扫描同色方块）
- `_checkEndgame()` — 检查是否触发冲刺（剩余炮车总数 < bufferCap+1）
- `_handleLapComplete(t)` — 炮车跑完一圈：有剩余弹药进暂存区，无弹药移除

**`ActiveTurret`**
- `pathPos` — 当前路径位置（0 ~ TOTAL_DIST）
- `getSide()` — 根据 pathPos 返回当前所在边（BOTTOM/RIGHT/TOP/LEFT）
- `getSlot()` — 当前对应的网格列/行索引

### 冲刺机制

- **触发条件**：轨道上炮车数 + 暂存区数 + 所有队列数 < `bufferCap + 1`（默认阈值=6）
- **触发效果**：speedMult = 2，GameScene 侧触发 `_checkEndgameDeploy` 批量入场
- **加速上限**：每圈完成后 speedMult *= 1.2，上限 2.4
- **道具三清色后**：动画结束时额外触发一次冲刺检测

### 炮车路径

轨道顺序：BOTTOM → RIGHT → TOP → LEFT（顺时针）
```
BOTTOM: pathPos 0        → CW          （从左向右，y = CANVAS_Y + CH + TRACK_GAP）
RIGHT:  pathPos CW       → CW+CH       （从下向上，x = CANVAS_X + CW + TRACK_GAP）
TOP:    pathPos CW+CH    → 2CW+CH      （从右向左，y = CANVAS_Y - TRACK_GAP）
LEFT:   pathPos 2CW+CH   → 2CW+2CH    （从上向下，x = CANVAS_X - TRACK_GAP）
```

---

## 六、渲染（GameScene.js）

### 渲染架构

- 每帧调用 `g.clear()` 后完整重绘（无脏区域优化）
- `g`（depth 0）：画布、轨道、炮车、子弹、粒子、道具栏、暂存区、队列
- `overlayG`（depth 10）：胜负遮罩
- DevTools panel（depth 99），DevTools btn（depth 100），遮罩 zone（depth 102）

### 命中特效缩放

特效大小随 CELL 动态缩放，缩放系数 `s = CELL / 18`（以 CELL=18 为基准）。
受缩放影响的属性：线宽、火花速度/大小、碎片速度/宽高、ring 初始偏移。

### 输入优先级

`_handleClick` → `_handleItemClick` → 正常游戏点击（暂存区/队列）

道具激活状态下的拦截规则：
- 道具三激活（`_item3Active`）：**所有点击**被 `_handleItemClick` 最先拦截，不漏到游戏层
- 道具二激活（`_item2Paused`）：点击转到 `_item2HandleClick`

---

## 七、DevTools（dev/DevTools.js）

- 仅在 `ENABLED=true` 时构建（Vite dev 模式自动启用，或设置 `window.__DEV_TOOLS__=true`）
- 所有可交互 Zone 统一收集在 `this._zones[]`
- 面板隐藏时：zones depth 降为 -1，同时启用一个 depth=102 的遮罩 Zone 吃掉穿透点击
- **注意**：Phaser `container.setVisible(false)` 不影响 Zone 交互，必须用 depth+遮罩方案

---

## 八、道具系统

| 道具 | 效果 | 限制 |
|------|------|------|
| 道具一（＋槽） | bufferCap++ | 最多扩展到 BUFFER_CAP+3=8 |
| 道具二（取车） | 从队列任意位置强制部署一辆（忽略 trackCap） | 每关3次 |
| 道具三（清色） | 清除指定颜色所有方块+该颜色所有炮车/队列/暂存 | 每关3次，清色后触发冲刺检测 |

---

## 九、编辑器开发指引（待实现）

### 技术选型

- 独立 `editor.html`，与游戏并列，通过 `/editor.html` 访问
- 纯原生 Canvas + HTML，不依赖 Phaser
- 保存文件需要 Node 后端：在 `vite.config.js` 中添加自定义 `configureServer` 插件，提供 `POST /api/save-level` 接口

### 文件保存接口（需在 vite.config.js 添加）

```js
configureServer(server) {
  server.middlewares.use('/api/save-level', async (req, res) => {
    // 读取 body，写入 levels/levelN.json
  });
}
```

### 编辑器必须满足的约束

编辑器在保存时必须强制校验并自动修正：
1. 同色方块数 == 该颜色弹药总数
2. 每种颜色总数是 10 的倍数
3. 每辆炮车 ammo 是 10 的倍数
4. 所有 cell 坐标在 boardWidth/boardHeight 范围内

### 遗留字段处理

保存时保留但不编辑以下字段（填默认值）：
- `boardSize`：建议设为 `max(boardWidth, boardHeight)`
- `pixelCount`、`colorRanges`：固定为 0 / []
- `isLinked`、`linkedGroupId`、`isMystery`、`isLock`、`stoneData`、`isHammer`：固定默认值
- `shooterPipes`：固定为 []
- `maxTanksOnConveyor`：固定为 5

---

## 十、已知问题 / 历史决策

- `boardSize` 字段在 211 个关卡中与实际 boardWidth/boardHeight 不一致，游戏代码已不读此字段，仅保留兼容
- serve.ps1 为只读静态服务，编辑器保存必须使用 Vite dev server
- Phaser Zone 的 `disableInteractive()` 在某些情况下无效，正确做法是 depth=-1 + 遮罩 Zone（参见 DevTools）
