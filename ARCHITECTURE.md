# FixelFlow 2 — 架构文档

> 每次新开发前阅读本文档。最后更新：2026-04-22（editor.js 重构）

---

## 一、项目结构

```
game2/
├── index.html          # 游戏入口，加载 phaser.min.js + src/main.js
├── editor.html         # 关卡编辑器入口（独立，不依赖 Phaser）
├── pixel-tool.html     # 像素图→关卡JSON 转换工具（单文件）
├── phaser.min.js       # Phaser 3 本地副本（不走 npm，避免打包体积问题）
├── vite.config.js      # 开发服务器 port=5174，build outDir=dist，含编辑器 API 中间件
├── serve.ps1           # 不依赖 node 的静态服务器备用方案（PowerShell .NET）
├── package.json        # 仅 vite 一个 devDependency，type=module
├── levels/             # 304 个关卡 JSON（level1.json ~ level304.json）
└── src/
    ├── main.js         # Phaser.Game 初始化入口
    ├── constants.js    # 所有常量 + 动态几何对象 G
    ├── GameLogic.js    # 纯游戏逻辑（无渲染依赖）
    ├── GameScene.js    # Phaser Scene 调度层（~170行）
    ├── renderer.js     # 所有绘制逻辑 + 坐标工具函数
    ├── bullets.js      # 子弹物理 + 粒子特效
    ├── items.js        # 三个道具的完整逻辑与特效
    ├── dev/
    │   └── DevTools.js # 开发用跳关面板（生产环境可关闭）
    ├── editor/
    │   └── editor.js   # 关卡编辑器逻辑（与游戏独立）
    └── ui/             # 预留目录（待开发 UI 组件）
```

---

## 二、模块分层与依赖

```
GameScene（调度）
    ├── GameLogic   ← 纯逻辑，无 Phaser 依赖
    ├── Renderer    ← 所有 _draw* 方法，import { turretScreen, blockScreen } from renderer.js
    ├── BulletSystem← 子弹物理 + 粒子，import { turretScreen, blockScreen } from renderer.js
    └── ItemSystem  ← 道具状态与特效，通过 scene.bullets / scene.logic 访问其他系统
```

**单向依赖规则**：constants → GameLogic；renderer/bullets/items → constants；GameScene 持有其余所有实例。

---

## 三、启动方式

| 方式 | 命令 | 说明 |
|------|------|------|
| Vite 开发服务器 | `npm run dev` | 热更新，port 5174（被占时自动递增） |
| PowerShell 静态服务 | `.\serve.ps1` | 不依赖 node，port 5174 |
| 生产构建 | `npm run build` | 输出到 dist/ |

> **注意**：serve.ps1 是只读静态服务，无法处理 POST 请求。编辑器保存文件必须用 Vite dev server。

---

## 四、常量与动态几何（constants.js）

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
| `TOTAL_LEVELS` | 301 | 关卡总数（preload 循环上限） |

### 动态几何对象 G

每次 `loadLevel()` 时由 `GameLogic` 重新计算并写入，其余模块只读不写。

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
  TOTAL_DIST,       // 一圈总路径长度 = 2(CW+CH)
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

## 五、关卡 JSON 格式

### 完整字段说明

```jsonc
{
  "boardWidth":  20,   // 网格列数（实际使用）
  "boardHeight": 20,   // 网格行数（实际使用）
  "boardSize":   20,   // 遗留字段，游戏代码不读，保留兼容
  "numberOfLanes": 3,  // 队列数量，分布：2(19关) 3(109关) 4(111关) 5(61关) 6(1关)
  "maxTanksOnConveyor": 5,  // 遗留字段，固定为5，游戏代码不读

  "entities": [
    {
      "type": "PixelBlock",  // 目前只有此类型；新障碍类型在此扩展
      "color": "#FF0000",    // 十六进制颜色，游戏内统一转大写
      "cells": [
        { "x": 5, "y": 10 } // 原始坐标：x向右，y向上（0=底部）
                             // 游戏内转换：row = (boardHeight-1) - cell.y
      ]
    }
  ],

  "initialTanks": [
    {
      "color": "#FF0000",
      "ammo": 20,      // 单辆弹药数，必须是10的倍数
      "lane": 0,       // 所在队列索引（0 ~ numberOfLanes-1）
      "position": 0    // 队列内排序位置（同lane内按position升序）
      // isLinked/linkedGroupId/isMystery/isLock/stoneData/isHammer：遗留字段，保留默认值
    }
  ],

  "shooterPipes": []   // 遗留字段，固定为空
}
```

### 关卡数据约束（必须满足）

1. **同色对齐**：每种颜色的有效方块数 == 该颜色所有炮车的 ammo 合计
2. **整十**：每种颜色的方块/弹药总数必须是 10 的倍数
3. **单车整十**：每辆炮车的 ammo 必须是 10 的倍数
4. **坐标有效**：`cell.x ∈ [0, boardWidth)`，翻转后 `row ∈ [0, boardHeight)`

### 坐标系说明

```
原始 JSON 坐标（y向上）      游戏内网格坐标（y向下）
(0, boardHeight-1) ←→ row 0（顶部）
(0, 0)             ←→ row boardHeight-1（底部）

转换：row = (boardHeight - 1) - cell.y
```

---

## 六、游戏逻辑（GameLogic.js）

### 核心数据

```
grid[][]         ← 二维网格 [row][col]，值为颜色字符串或 null
blocks[]         ← 所有待消除方块 { x, y, color }
obstacles[]      ← 障碍物列表 { x, y, type, color, raw }（预留，当前为空）
lanes[][]        ← 各车道炮台队列（TurretDef）
turrets[]        ← 轨道上的活跃炮台（ActiveTurret）
buffer[]         ← 暂存区
pendingBullets[] ← 本帧待生成子弹，由 GameScene 通过 flushPendingBullets() 消费
inFlightTargets  ← Set，飞行中子弹的目标坐标（防重复锁定）
```

### 主要方法

| 方法 | 说明 |
|------|------|
| `loadLevel(data)` | 解析 JSON，计算 G，初始化所有状态；entity 按 type 分发到 blocks/obstacles |
| `update()` | 每帧：移动炮车、检测射击槽位、生成 pendingBullets |
| `onBulletHit(turretId, col, row)` | 命中回调，清除方块，检查胜负 |
| `deployFromLane/Buffer()` | 玩家正常部署（受 trackCap 限制） |
| `forceDeployFromLane/Buffer/LaneAt()` | 道具二强制部署（忽略 trackCap） |
| `_findTarget(turret)` | 沿当前边向内扫描，找第一个同色且未锁定的方块 |
| `_checkEndgame()` | 剩余炮车总数 < bufferCap+1 时触发冲刺 |
| `_handleLapComplete(t)` | 炮车跑完一圈：有弹药进暂存区（或冲刺继续绕），无弹药移除 |

### entity 扩展点

`loadLevel` 中使用 `switch(entity.type)` 分发：

```js
switch (entity.type) {
  case 'PixelBlock': // 写入 grid + blocks
  default:           // 写入 obstacles（待实现的障碍类型在此加 case）
}
```

### 冲刺机制

- **触发条件**：`turrets.length + buffer.length + Σlanes < bufferCap + 1`
- **触发效果**：`speedMult = 2`，GameScene 批量自动部署剩余炮台
- **加速上限**：每圈 `speedMult *= 1.2`，上限 2.4

### 炮车路径

轨道顺序：BOTTOM → RIGHT → TOP → LEFT（顺时针）
```
BOTTOM: pathPos 0       → CW       （从左向右，y = CANVAS_Y + CH + TRACK_GAP）
RIGHT:  pathPos CW      → CW+CH    （从下向上，x = CANVAS_X + CW + TRACK_GAP）
TOP:    pathPos CW+CH   → 2CW+CH   （从右向左，y = CANVAS_Y - TRACK_GAP）
LEFT:   pathPos 2CW+CH  → 2CW+2CH  （从上向下，x = CANVAS_X - TRACK_GAP）
```

---

## 七、渲染（renderer.js）

### 渲染架构

- 每帧 `g.clear()` 后完整重绘（无脏区域优化）
- `g`（depth 0）：画布、轨道、炮台、子弹、粒子、暂存区、队列
- `overlayG`（depth 10）：胜负遮罩
- 道具特效 graphics（depth 20~21）：由 ItemSystem 管理生命周期

### 共享坐标工具函数（renderer.js 顶层导出）

```js
turretScreen(pathPos)    // 路径位置 → 屏幕坐标 {x, y}
blockScreen(col, row)    // 网格坐标 → 屏幕中心坐标 {x, y}
hex(str)                 // '#RRGGBB' → 0xRRGGBB
hexNum(color)            // string | number → 0xRRGGBB
```

bullets.js 也 import 这四个函数，是唯一的坐标转换来源。

### entity 绘制扩展点

`_drawEntities(g, cy0)` 遍历 `logic.blocks` 和 `logic.obstacles`：

```js
_drawEntities(g, cy0) {
  for (const b of logic.blocks)    this._drawBlock(g, b, ...);
  for (const obs of logic.obstacles) this._drawObstacle(g, obs, ...); // 待实现
}

_drawObstacle(g, obs, cx, cy0, CELL) {
  // 按 obs.type 分发绘制（新障碍类型在此添加）
}
```

### 命中特效缩放

缩放系数 `s = CELL / 18`（以 CELL=18 为基准）。受影响：线宽、火花速度/大小、碎片速度/宽高、ring 偏移。

---

## 八、子弹系统（bullets.js）

**BulletSystem** 拥有 `vBullets[]` 和 `vParticles[]`，每帧由 GameScene 驱动：

```
spawnFromLogic()   ← 消费 logic.flushPendingBullets()，创建视觉子弹
moveBullets()      ← 推进位置，命中时调 logic.onBulletHit() + 生成粒子
draw(g)            ← 绘制子弹 + 更新/绘制粒子（由 Renderer.render 调用）
spawnFlash(x, y)   ← 白色扩散圆圈（供 ItemSystem 调用）
```

粒子类型：`flash`（闪光）、`ring`（扩展环）、`spark`（火花）、`chip`（旋转碎片）。

---

## 九、道具系统（items.js）

**ItemSystem** 持有所有道具状态，通过 `scene.logic` 和 `scene.bullets` 访问其他系统。

| 道具 | 效果 | 限制 |
|------|------|------|
| 道具一（＋槽） | `bufferCap++`，金色光束特效 | 上限 BUFFER_CAP+3=8 |
| 道具二（取车） | 队列上移，点选任意炮台强制入轨（忽略 trackCap） | 每关3次 |
| 道具三（清色） | 点选方块清除同色所有方块+同色炮台/队列/暂存，旋转轮动画 | 每关3次，清色后触发冲刺检测 |

**关键状态**（GameScene/Renderer 读取）：
- `items.canvasOffsetY` — 道具三激活时画布上移量，Renderer 读取用于偏移绘制
- `items.queueOffsetY`  — 道具二激活时队列上移量，Renderer 读取用于偏移绘制

**输入优先级**：

```
_handleClick → items.handleClick → 暂存区点击 → 队列点击
```

道具激活时的拦截规则：
- 道具三激活（`item3Active`）：所有点击最先被拦截
- 道具二激活（`item2Paused`）：点击转到 `_item2HandleClick`

---

## 十、DevTools（dev/DevTools.js）

- 仅在 `ENABLED=true` 时构建（Vite dev 模式自动启用，或设置 `window.__DEV_TOOLS__=true`）
- 所有可交互 Zone 统一收集在 `this._zones[]`
- 面板隐藏时：zones depth 降为 -1，同时启用 depth=102 的遮罩 Zone 吞掉穿透点击
- **注意**：Phaser `container.setVisible(false)` 不影响 Zone 交互，必须用 depth+遮罩方案

---

## 十一、编辑器（editor.html + src/editor/editor.js）

- 独立页面，不依赖 Phaser，通过 `/editor.html` 访问
- 纯原生 Canvas + HTML
- 保存接口：`POST /api/save-level`，`GET /api/level-list`（由 vite.config.js 中间件实现）
- 保存前强制校验：同色对齐、整十、坐标有效
- 保留所有遗留字段（填默认值）

### 关键状态

```js
state = {
  brushColor,      // 当前画笔颜色（null = 橡皮擦）
  brushTool,       // 'pixel' | 'obstacle'（扩展点，未来障碍工具分发）
  data,            // 当前关卡 JSON 对象
  canvas, ctx,     // 编辑画布
  ...
}
```

### 障碍元素接口预留（待实现）

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| `state.brushTool` | state 初始化 | 切换为 `'obstacle'` 后 paintCell 分发到 paintObstacleCell() |
| `renderObstacles()` | renderCanvas 末尾 | 遍历 entities 中障碍类型并绘制 |
| `paintObstacleCell(x, y)` | paintCell 分发 | 写入障碍 entity 的 cells |
| applyGridSize 注释 | applyGridSize 末尾 | 缩网格时同步裁剪障碍 cells |

### normalize() 弹药分配算法

将 target 颗弹药分给 n 辆炮车，每辆必须是 10 的倍数：

```js
let base = Math.max(10, Math.floor(target / n / 10) * 10);
while (n > 1 && base * (n - 1) > target - 10) base -= 10;
if (base < 10) base = 10;
const last = Math.max(10, target - base * (n - 1));
```

---

## 十二、像素工具（pixel-tool.html）

单文件工具，将图片转换为关卡 JSON。核心流程：

1. 上传图片（支持拖拽）→ 可选 remove.bg 抠图或泛洪填充去背景
2. 点「自动寻优网格」→ 先检测像素风原生尺寸，否则三段式搜索最优 GW×GH
3. 颜色控制（Median Cut 量化，调整 K/T）→「重新生成」
4. 可选「四格对比预览」查看 top-4 候选尺寸
5. 生成关卡 JSON → 保存到 levels/

**网格评分**：`combo = cellPurity×0.6 + edge×0.2 + rle×0.2`

---

## 十三、新增障碍元素开发指引

后续开发方块区域障碍（如石头、冰块、锁格等）时，只需修改以下四处：

1. **关卡 JSON**：entity 使用新 `type` 字段，如 `"type": "StoneBlock"`
2. **GameLogic.js** `loadLevel` 的 `switch`：加对应 `case`，更新 `obstacles[]`，按需写入 `grid`（若障碍占格）
3. **renderer.js** `_drawObstacle()`：按 `obs.type` 分发绘制逻辑
4. **GameLogic.js** `_findTarget()`：按需让子弹被障碍物阻挡（当前扫描遇到非 null 格即停）

---

## 十四、已知问题 / 历史决策

- `boardSize` 字段在 211 个关卡中与实际 boardWidth/boardHeight 不一致，游戏代码已不读此字段，仅保留兼容
- serve.ps1 为只读静态服务，编辑器保存必须使用 Vite dev server
- Phaser Zone 的 `disableInteractive()` 在某些情况下无效，正确做法是 depth=-1 + 遮罩 Zone（参见 DevTools）
- `TOTAL_LEVELS` 常量仍为 301（preload 循环上限），实际关卡文件已有 304 个，需手动同步
