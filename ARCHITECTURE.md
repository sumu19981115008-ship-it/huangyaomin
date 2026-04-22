# FixelFlow 2 — 架构文档

> 每次新开发前阅读本文档。最后更新：2026-04-22（方案B全量重构：levels2格式统一）

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
│
├── levels/             # 旧格式 A 组关卡（entities/initialTanks，保留备用）
├── levels2/            # 竞品原始关卡（300个，研究用，不参与游戏）
├── levels_a2/          # ✅ A 组关卡，301 个，统一 levels2 格式（带 colorTable）
├── levels_b2/          # ✅ B 组关卡，167 个，统一 levels2 格式（来自竞品筛选）
│
├── tools/
│   ├── convert_a_to_levels2.py   # 将旧格式 A 组转换为 levels2 格式
│   └── convert_b_to_levels2.py   # 从竞品原始文件筛选并转换 B 组
│
└── src/
    ├── main.js         # Phaser.Game 初始化入口
    ├── constants.js    # 所有常量 + 动态几何对象 G
    ├── GameLogic.js    # 纯游戏逻辑（无渲染依赖）
    ├── GameScene.js    # Phaser Scene 调度层
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
    ├── Renderer    ← 所有 _draw* 方法
    ├── BulletSystem← 子弹物理 + 粒子
    └── ItemSystem  ← 道具状态与特效
```

**单向依赖规则**：constants → GameLogic；renderer/bullets/items → constants；GameScene 持有其余所有实例。

---

## 三、启动方式

| 方式 | 命令 | 说明 |
|------|------|------|
| Vite 开发服务器 | `npm run dev` | 热更新，port 5174 |
| PowerShell 静态服务 | `.\serve.ps1` | 不依赖 node，port 5174 |
| 生产构建 | `npm run build` | 输出到 dist/ |

> **注意**：serve.ps1 支持所有 API 路由。编辑器保存也可用 serve.ps1（PowerShell .NET 实现）。

---

## 四、关卡 JSON 格式（统一 levels2 格式）

> **当前唯一格式**。`levels_a2/` 和 `levels_b2/` 均使用此格式。

```jsonc
{
  // 颜色索引表：material ID（数组下标）→ hex 颜色字符串
  "colorTable": ["#FFD700", "#3498DB", ...],

  // 难度标记（B 组来自竞品，A 组固定为 "Medium"）
  "Difficulty": "Easy" | "Medium" | "Hard" | "Very Hard",
  "HasTimeLimit": false,
  "SlotCount":     5,    // 轨道容量（对应 TRACK_CAP）
  "ConveyorLimit": 5,    // 暂存区容量（对应 BUFFER_CAP）

  // 棋盘尺寸
  "boardWidth":  20,
  "boardHeight": 20,

  // 炮车队列：每个元素是一条队列（Lane），队列内按出队顺序排列
  "QueueGroup": [
    [
      { "id": 0, "ammo": 20, "material": 0 },
      { "id": 1, "ammo": 10, "material": 1 }
    ],
    [...]
  ],

  // 像素方块数据
  "PixelImageData": {
    "width":  20,
    "height": 20,
    "pixels": [
      { "x": 5, "y": 3, "material": 0 }
      // ⚠️ 坐标系：y=0 在顶部（与 canvas row 方向一致，无需翻转）
    ]
  }
}
```

### 坐标系说明

```
levels2 坐标（y=0 顶部）= 游戏内 grid[row][col] 坐标
pixel.y === grid row，直接使用，无需转换

旧格式（levels/）坐标翻转：row = (boardHeight-1) - cell.y
→ levels_a2/ 的转换脚本已在生成时完成翻转，游戏不再翻转
```

### 约束

1. **同色对齐**：每种 material 的像素数 == 该 material 所有炮车的 ammo 合计
2. **整十**：每种颜色的方块/弹药总数应为 10 的倍数（A 组 4 关历史遗留不满足，L33/59/85/92）
3. **坐标有效**：`pixel.x ∈ [0, boardWidth)`，`pixel.y ∈ [0, boardHeight)`

---

## 五、常量与动态几何（constants.js）

### 固定常量

| 常量 | 值 | 说明 |
|------|----|------|
| `VW` | 480 | 视口宽度 |
| `VH` | 920 | 视口高度 |
| `TRACK_GAP` | 22 | 轨道到画布边缘的间距 |
| `CELL_MIN` | 6 | 格子最小像素尺寸 |
| `CELL_MAX` | 18 | 格子最大像素尺寸 |
| `TRACK_CAP` | 5 | 轨道最大炮车数（关卡可通过 SlotCount 覆盖） |
| `BUFFER_CAP` | 5 | 暂存区初始容量（关卡可通过 ConveyorLimit 覆盖） |
| `BULLET_SPEED` | 14 | 子弹像素速度/帧 |
| `TURRET_SPEED` | 3 | 炮车路径速度/帧 |
| `TOTAL_LEVELS` | 301 | A 组关卡数 |
| `TOTAL_LEVELS_B` | 167 | B 组关卡数 |

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

## 六、游戏逻辑（GameLogic.js）

### loadLevel() 解析流程

```
1. 读取 PixelImageData.width/height → 计算 G（几何布局）
2. 读取 colorTable → 建立 material → hex 映射
3. 遍历 PixelImageData.pixels → 填充 grid[][] + blocks[]
   （y 即为 row，无需翻转）
4. 遍历 QueueGroup → 每条队列创建 TurretDef[] → lanes[][]
5. SlotCount/ConveyorLimit 覆盖 TRACK_CAP/BUFFER_CAP
```

### 核心数据

```
grid[][]         ← 二维网格 [row][col]，值为颜色字符串或 null
blocks[]         ← 所有待消除方块 { x, y, color }
obstacles[]      ← 障碍物列表（预留，当前为空）
lanes[][]        ← 各车道炮台队列（TurretDef）
turrets[]        ← 轨道上的活跃炮台（ActiveTurret）
buffer[]         ← 暂存区
pendingBullets[] ← 本帧待生成子弹
inFlightTargets  ← Set，飞行中子弹的目标坐标（防重复锁定）
```

### 主要方法

| 方法 | 说明 |
|------|------|
| `loadLevel(data)` | 解析 levels2 JSON，计算 G，初始化所有状态 |
| `update()` | 每帧：移动炮车、检测射击槽位、生成 pendingBullets |
| `onBulletHit(turretId, col, row)` | 命中回调，清除方块，检查胜负 |
| `deployFromLane/Buffer()` | 玩家正常部署（受 trackCap 限制） |
| `forceDeployFromLane/Buffer/LaneAt()` | 道具二强制部署（忽略 trackCap） |
| `_findTarget(turret)` | 沿当前边向内扫描，找第一个同色且未锁定的方块 |
| `_checkEndgame()` | 剩余炮车总数 < bufferCap+1 时触发冲刺 |
| `_handleLapComplete(t)` | 炮车跑完一圈：有弹药进暂存区（或冲刺继续绕），无弹药移除 |

### 冲刺机制

- **触发条件**：`turrets.length + buffer.length + Σlanes < bufferCap + 1`
- **触发效果**：`speedMult = 2`，GameScene 批量自动部署剩余炮台
- **加速上限**：每圈 `speedMult *= 1.2`，上限 2.4

### 炮车路径

轨道顺序：BOTTOM → RIGHT → TOP → LEFT（顺时针）
```
BOTTOM: pathPos 0       → CW
RIGHT:  pathPos CW      → CW+CH
TOP:    pathPos CW+CH   → 2CW+CH
LEFT:   pathPos 2CW+CH  → 2CW+2CH
```

---

## 七、渲染（renderer.js）

- 每帧 `g.clear()` 后完整重绘（无脏区域优化）
- `g`（depth 0）：画布、轨道、炮台、子弹、粒子、暂存区、队列
- `overlayG`（depth 10）：胜负遮罩

### 共享坐标工具函数（renderer.js 顶层导出）

```js
turretScreen(pathPos)    // 路径位置 → 屏幕坐标 {x, y}
blockScreen(col, row)    // 网格坐标 → 屏幕中心坐标 {x, y}
hex(str)                 // '#RRGGBB' → 0xRRGGBB
hexNum(color)            // string | number → 0xRRGGBB
```

### entity 绘制扩展点

```js
_drawObstacle(g, obs, cx, cy0, CELL) {
  // 按 obs.type 分发绘制（新障碍类型在此添加）
}
```

---

## 八、子弹系统（bullets.js）

**BulletSystem** 拥有 `vBullets[]` 和 `vParticles[]`，每帧由 GameScene 驱动：

```
spawnFromLogic()   ← 消费 logic.flushPendingBullets()，创建视觉子弹
moveBullets()      ← 推进位置，命中时调 logic.onBulletHit() + 生成粒子
draw(g)            ← 绘制子弹 + 更新/绘制粒子（由 Renderer.render 调用）
spawnFlash(x, y)   ← 白色扩散圆圈（供 ItemSystem 调用）
```

---

## 九、道具系统（items.js）

| 道具 | 效果 | 限制 |
|------|------|------|
| 道具一（＋槽） | `bufferCap++`，金色光束特效 | 上限 BUFFER_CAP+3=8 |
| 道具二（取车） | 队列上移，点选任意炮台强制入轨（忽略 trackCap） | 每关3次 |
| 道具三（清色） | 点选方块清除同色所有方块+炮台/队列/暂存，旋转轮动画 | 每关3次 |

**关键状态**（GameScene/Renderer 读取）：
- `items.canvasOffsetY` — 道具三激活时画布上移量
- `items.queueOffsetY`  — 道具二激活时队列上移量

---

## 十、DevTools（dev/DevTools.js）

- 仅在 `ENABLED=true` 时构建（Vite dev 模式自动启用，或设置 `window.__DEV_TOOLS__=true`）
- 面板隐藏时：zones depth 降为 -1，同时启用 depth=102 的遮罩 Zone 吞掉穿透点击
- **注意**：Phaser `container.setVisible(false)` 不影响 Zone 交互，必须用 depth+遮罩方案

---

## 十一、编辑器（editor.html + src/editor/editor.js）

- 独立页面，不依赖 Phaser，通过 `/editor.html` 访问
- 纯原生 Canvas + HTML，操作 **levels2 格式** 数据

### API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/level-list-a2` | 获取 levels_a2/ 目录文件名列表 |
| `POST /api/save-level-a2` | 保存到 levels_a2/（body: `{filename, data}`） |
| `GET /api/level-list` | 旧接口，指向 levels/（保留兼容） |
| `POST /api/save-level` | 旧接口，保存到 levels/（保留兼容） |

### 关键状态

```js
state = {
  brushMat,   // 当前画笔 material ID（-1 = 橡皮擦）
  data,       // 当前关卡 JSON 对象（levels2 格式）
  zoom,       // 每格像素（默认 12）
  ...
}
```

### normalize() 弹药分配算法

将 target 颗弹药分给 n 辆炮车，每辆必须是 10 的倍数：

```js
let base = Math.max(10, Math.floor(target / n / 10) * 10);
while (n > 1 && base * (n - 1) > target - 10) base -= 10;
if (base < 10) base = 10;
const last = Math.max(10, target - base * (n - 1));
```

---

## 十二、A/B 关卡组切换

GameScene 维护 `this.group = 'A' | 'B'`，通过右上角"切换 B 组"按钮切换。

| 组 | 目录 | 数量 | 来源 | 特点 |
|----|------|------|------|------|
| A | `levels_a2/` | 301 关 | 自制 | colorTable 动态分配，难度无标注 |
| B | `levels_b2/` | 167 关 | 竞品筛选 | 含 Difficulty 字段（Easy/Medium/Hard/Very Hard） |

---

## 十三、像素工具（pixel-tool.html）

单文件工具，将图片转换为 levels2 格式关卡 JSON。核心流程：

1. 上传图片（支持拖拽）→ 可选 remove.bg 抠图或泛洪填充去背景
2. 点「自动寻优网格」→ 先检测像素风原生尺寸，否则三段式搜索最优 GW×GH
3. 颜色控制（Median Cut 量化，调整 K/T）→「重新生成」
4. 可选「四格对比预览」查看 top-4 候选尺寸
5. 生成关卡 JSON → 保存到 levels_a2/

**网格评分**：`combo = cellPurity×0.6 + edge×0.2 + rle×0.2`

---

## 十四、新增障碍元素开发指引

后续开发障碍元素（石头、冰块、锁格等）时，修改以下四处：

1. **关卡 JSON**（levels2 格式）：在 `PixelImageData.pixels` 里加新字段（如 `"type": "stone"`），或使用单独的 `obstacles` 顶层数组
2. **GameLogic.js** `loadLevel`：解析障碍数据，写入 `obstacles[]`，按需写入 `grid`（若障碍占格）
3. **renderer.js** `_drawObstacle()`：按 `obs.type` 分发绘制逻辑
4. **GameLogic.js** `_findTarget()`：按需让子弹被障碍物阻挡（当前扫描遇到非 null 格即停）

---

## 十五、已知问题 / 历史决策

| 问题 | 说明 |
|------|------|
| A 组 4 关弹药>像素 | L33/59/85/92 原始设计如此（弹药比像素多 10~20 发），游戏可正常运行（多余炮车循环后进暂存区直至通关） |
| 旧格式 levels/ 保留 | 旧格式数据保留在 levels/ 目录，不参与游戏，仅作备份 |
| Phaser Zone 交互 | `container.setVisible(false)` 不禁用 Zone，必须用 depth=-1 + 遮罩方案（参见 DevTools） |
| pixel-tool.html 输出 | 当前仍输出到 levels/ 旧格式，待更新为输出到 levels_a2/（levels2 格式） |
