# FixelFlow 2 — 架构文档

> 每次新开发前阅读本文档。最后更新：2026-04-24（AutoBot v10：A组92.6%/B组95.9%，cellDepth容量感知评分框架）

---

## 一、项目结构

```
game2/
├── index.html              # 游戏入口，加载 phaser.min.js + src/main.js
├── editor.html             # 关卡编辑器入口（独立，不依赖 Phaser）
├── pixel-tool.html         # 像素图→关卡JSON 转换工具（单文件）
├── phaser.min.js           # Phaser 3 本地副本（不走 npm，避免打包体积问题）
├── vite.config.js          # 开发服务器 port=5174，build outDir=dist，含编辑器 API 中间件
├── serve.ps1               # 不依赖 node 的静态服务器备用方案（PowerShell .NET）
├── package.json            # 仅 vite 一个 devDependency，type=module
│
├── levels/                 # 全部关卡（统一 levels2 格式）
│   ├── a/                  # ✅ A 组，299 关，自制
│   ├── b/                  # ✅ B 组，171 关，来自竞品筛选
│   └── c/                  # ✅ C 组，编辑器创作，数量动态增长
│
├── tools/
│   ├── sim.js              # 关卡模拟器（批量跑关，无渲染）
│   ├── level_generator.py  # 图片→关卡自动生成器（CLI + 编辑器后端）
│   ├── difficulty_analysis.py  # 关卡难度特征提取 + 回归分析
│   ├── sim_analyze.mjs     # 指定帧数后打印完整游戏状态（卡关分析）
│   ├── sim_debug.mjs       # 打印单关模拟详情
│   ├── sim_detail.mjs      # 每帧决策追踪
│   ├── debug/              # 单关专项调试脚本（trace_*/debug_*）
│   └── testdata/           # 测试用关卡 JSON 样本 + 图片
│
├── research/               # AutoBot 算法演化研究档案
│   ├── README.md           # v1~v10 算法演化说明
│   ├── bots/               # 历代 Bot 源码快照（v1~v7）及配套模拟器
│   └── results/
│       └── benchmark.md    # 各版本通关率对标表
│
├── _archive/               # 历史归档（不参与游戏）
│   ├── levels_old_format/  # 旧格式 A 组关卡（entities/initialTanks）
│   ├── levels2_competitor_raw/  # 竞品原始关卡（300个，研究参考）
│   ├── scripts_convert/    # 旧格式转换脚本（已完成历史使命）
│   └── dev-log/            # 开发日志
│
└── src/
    ├── main.js             # Phaser.Game 初始化入口
    ├── constants.js        # 所有常量 + 动态几何对象 G
    ├── GameLogic.js        # 纯游戏逻辑（无渲染依赖）
    ├── GameScene.js        # Phaser Scene 调度层
    ├── renderer.js         # 所有绘制逻辑 + 坐标工具函数
    ├── bullets.js          # 子弹物理 + 粒子特效
    ├── items.js            # 三个道具的完整逻辑与特效
    ├── AutoBot.js          # 自动打关机器人（可开关，不影响正常游戏逻辑）
    ├── dev/
    │   ├── DevTools.js     # 开发用跳关面板（生产环境可关闭）
    │   └── PlayRecorder.js # 游戏录播回放
    └── editor/
        └── editor.js       # 关卡编辑器逻辑（与游戏独立）
```

---

## 二、模块分层与依赖

```
GameScene（调度）
    ├── GameLogic    ← 纯逻辑，无 Phaser 依赖
    ├── Renderer     ← 所有 _draw* 方法
    ├── BulletSystem ← 子弹物理 + 粒子
    ├── ItemSystem   ← 道具状态与特效
    └── AutoBot      ← 自动打关机器人（可关闭）
```

**单向依赖规则**：constants → GameLogic；renderer/bullets/items/AutoBot → constants；GameScene 持有其余所有实例。

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

> **当前唯一格式**。`levels/a/`、`levels/b/`、`levels/c/` 均使用此格式。

```jsonc
{
  // 颜色索引表：material ID（数组下标）→ hex 颜色字符串
  "colorTable": ["#FFD700", "#3498DB", ...],

  // 难度标记（B 组来自竞品，A 组固定为 "Medium"，C 组由生成器或手动设置）
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
→ levels/a/ 的转换脚本已在生成时完成翻转，游戏不再翻转
```

### 约束

1. **同色对齐**：每种 material 的像素数的 ceil10 == 该 material 所有炮车的 ammo 合计
2. **整十**：每种颜色的方块/弹药总数应为 10 的倍数（A 组 4 关历史遗留不满足，L33/59/85/92）
3. **标准弹药包**：每辆炮车的 ammo 应为 10/20/30/40 之一（竞品规范，生成器强制执行）
4. **坐标有效**：`pixel.x ∈ [0, boardWidth)`，`pixel.y ∈ [0, boardHeight)`

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
| `TOTAL_LEVELS` | 299 | A 组关卡数 |
| `TOTAL_LEVELS_B` | 171 | B 组关卡数 |
| `TOTAL_LEVELS_C` | 500 | C 组上限（实际按文件存在数量加载） |

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
| `_handleLapComplete(t)` | 炮车跑完一圈：有弹药进暂存区（或冲刺继续绕），无弹药移除；记录 `idleLastLap` |
| `clearColor(color)` | 道具三调用：清 grid/blocks/turrets/buffer/lanes，同步清 inFlightTargets，返回被清坐标列表 |

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

## 十、AutoBot（AutoBot.js）

右上角「🤖 自动」按钮开关，开启后自动部署炮车并在过关时自动进入下一关。

### 部署策略

每 120ms 决策一次：

1. **候选收集**：buffer 全部炮车 + 各队列队首（只有队首可直接部署）
2. **严格可达性**（`_computeReachable`）：从四个方向扫描，每行/列只取最外层第一个非空格子的颜色，与 `_findTarget` 逻辑完全一致，**不穿透**。只有当前真正暴露的颜色才进入候选。
3. **弹药匹配评分**：同色所有候选车弹药加总，`score = 1 / (1 + |弹药总和 - 该色方块数|)`，差值越小得分越高
4. **全不可达兜底**：若所有候选颜色均不可达（极端情况），保留全量候选防死锁，由 `idleLastLap` 机制继续过滤
5. **排序**：score 降序 > buffer 优先于队列
6. **间距保护**：每次只部署一辆，轨道入口 `pathPos < 28` 范围内有车时等待
7. **容量感知评分（v10）**：`score = urgency[color] × ammoFit × exposureWeight`
   - `cellDepth[row][col]` = 该格从四方向看的最小遮挡层数（0=已暴露）
   - `urgency[color] = Σ 1/(depth+1)`，方块越浅越紧迫
   - `exposureWeight = 1 / (1 + ep/(TOTAL_DIST×2))`，轨道起点附近的颜色优先

### 停车场策略（v8~v10）

当队列头部颜色不可达时，通过主动"停车"移除挡路车辆解锁后续可达色：

- **unlockPool**：扫描各队列，若队头不可达但队列内有可达色（_dist步内），计算 `_gain`（可达色弹药）、`_cost`（中间不可达车弹药）、`_dist`（距第一个可达色的步数）
- **allEmpty挖坑**：轨道为空 + 全不可达 + `gain > cost × 1.2` + `dist ≤ 3` → 主动停车挖队列
- **nearUnlock（v9）**：轨道有车 + 全不可达 + `dist = 1` → 停一步即解锁，直接执行
- **commitLane**：一旦开始挖某条队列，锁定承诺直到该队列头部变为可达色

### 无用炮车剔除（GameLogic._pruneUselessTurrets/Buffer/Lanes）

每次 `onBulletHit` 消除方块后自动调用三个清理方法：

| 方法 | 清理对象 | 条件 |
|------|----------|------|
| `_pruneUselessTurrets` | 轨道炮车 | 颜色已从 blocks 消失 且 `activeShotCount=0` |
| `_pruneUselessBuffer` | 暂存区炮车 | 颜色已从 blocks 消失 |
| `_pruneUselessLanes` | 队列队首 | 持续移除队首颜色已消失的车，直到队首有效或队列为空 |

`_pruneUselessLanes` 解决了"过量弹药车（ammo > 像素数）完成后残留在队列阻塞后续有效车"的死锁场景（如 A 组 L33）。

### ActiveTurret 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `hitsThisLap` | number | 本圈累计击中方块数，`onBulletHit` 时递增 |
| `idleLastLap` | bool | 上圈转完时 `hitsThisLap===0`，退回 buffer 时记录，`resetForDeploy` 时清除 |

### UI

- 右上角工具栏横排：`[DEV]` `[🤖 自动]` `[A组下拉▼]`，统一胶囊样式
- `[A组下拉▼]` 为 HTML select，直接选 A/B/C 组（显示各组关卡数），选中即切换
- 激活状态下自动按钮变黄色显示 `▶ 自动ON`，关卡切换时保持开关状态

---

## 十一、DevTools（dev/DevTools.js）

- 仅在 `ENABLED=true` 时构建（Vite dev 模式自动启用，或设置 `window.__DEV_TOOLS__=true`）
- 触发按钮 `[DEV]` 位于**右上角工具栏**，与"🤖 自动"同行排列
- 面板从工具栏下方 y=42 开始，不遮挡工具栏
- 跳关使用 HTML `<select>` 下拉框，选中即跳转，替代原来的翻页格子
- 面板隐藏时：zones depth 降为 -1，同时启用 depth=102 的遮罩 Zone 吞掉穿透点击
- **注意**：Phaser `container.setVisible(false)` 不影响 Zone 交互，必须用 depth+遮罩方案

---

## 十二、关卡分组与编辑器

### 关卡组

游戏支持 A/B/C 三组，循环切换（A→B→C→A）：

| 组 | 目录 | 数量 | 来源 | 特点 |
|----|------|------|------|------|
| A | `levels/a/` | 299 关 | 自制 | colorTable 动态分配，Difficulty 固定 Medium |
| B | `levels/b/` | 171 关 | 竞品筛选 | 含 Difficulty 字段（Easy/Medium/Hard/Very Hard） |
| C | `levels/c/` | 动态 | 编辑器创作 | 编辑器默认保存目标，Difficulty 由生成器或手动设置 |

### 编辑器 API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/level-list-a2` | 获取 levels/a/ 文件名列表 |
| `POST /api/save-level-a2` | 保存到 levels/a/ |
| `POST /api/delete-levels-a2` | 批量删除 levels/a/ 中的关卡（body: `{ filenames: [] }`） |
| `GET /api/level-list-b2` | 获取 levels/b/ 文件名列表 |
| `POST /api/save-level-b2` | 保存到 levels/b/ |
| `POST /api/delete-levels-b2` | 批量删除 levels/b/ 中的关卡 |
| `GET /api/level-list-c2` | 获取 levels/c/ 文件名列表 |
| `POST /api/save-level-c2` | 保存到 levels/c/ |
| `POST /api/delete-levels-c2` | 批量删除 levels/c/ 中的关卡 |
| `POST /api/generate-level` | 图片→关卡 JSON（调用 level_generator.py，支持 `fixedPalette` 参数） |
| `POST /api/regen-queue` | 仅重新生成炮车序列，保持画布不变（body: `{ levelData, difficulty, lanes, slot }`） |
| `GET /api/level-list` | 旧接口，指向 _archive/levels_old_format/（兼容保留） |
| `POST /api/save-level` | 旧接口，保存到 _archive/levels_old_format/（兼容保留） |

### 编辑器试玩机制

点击「试玩当前关卡」按钮：
1. 把当前编辑器内存数据写入 `sessionStorage['editorPreview']`
2. 新标签页打开 `/`（游戏页）
3. GameScene.create() 检测到 `editorPreview` → 注入 C 组队首 → 自动切换到 C 组并载入
4. 读取后立即清除 sessionStorage，无需保存即可试玩

### 编辑器关键状态

```js
state = {
  group,      // 'a' | 'b' | 'c'（默认 'c'）
  brushMat,   // 当前画笔 material ID（-1 = 橡皮擦）
  currentFile,// 当前文件名（如 'level302.json'）
  data,       // 当前关卡 JSON 对象（levels2 格式）
  zoom,       // 每格像素（默认 12）
}
```

### 多选删除

列表底部「多选删除」按钮进入多选模式，列表项显示 checkbox，点击整行勾选。勾选后出现「删除所选关卡」按钮，点击弹出二次确认框，确认后调用 `/api/delete-levels-{组}` 批量删除。若当前打开的关卡被删除，编辑器自动清空。切换组时自动退出多选模式。

### 重新生成炮车序列

save-bar「重新生成炮车序列…」按钮，针对已有关卡仅重跑炮车队列生成，**画布像素完全不变**。弹窗预填当前关卡的难度/轨道数/槽位数，可修改后提交。调用 `/api/regen-queue`，后端执行 `level_generator.regen_queue()`（内部仍走整十对齐 + 难度参数调度），返回更新后的完整 levelData，编辑器立即刷新颜色/炮车面板并标注「未保存」。

### 轨道推进模式

图片生成弹窗和重新生成炮车序列弹窗均提供「轨道推进模式」单选：

| 模式 | 说明 |
|------|------|
| 独立模式（默认） | 每条轨道内部各自按浅→深顺序，玩家可自由选择先消哪条 |
| 同步模式 | 所有轨道按颜色批次齐头并进，三条队列同一阶段只出同批颜色的炮车 |

CLI 对应参数：`--sync-lanes`（不加则为独立模式）。

---

## 十三、关卡自动生成器（tools/level_generator.py）

### CLI 用法

```bash
python3 tools/level_generator.py <图片> <输出JSON> \
  --difficulty easy|medium|hard|veryhard \
  --lanes N        # 轨道数（默认3）
  --colors N       # 颜色数（0=按难度自动：easy=4, medium=6, hard=7, veryhard=8）
  --board W H      # 网格尺寸（默认20 20）
  --slot N         # 槽位数（默认5）
  --fixed-palette  # 使用固定35色板（Lab最近邻，与pixel-tool.html一致）
  --sync-lanes     # 同步推进模式（所有轨道按颜色批次齐头并进）
```

### Python API（供后端调用）

| 函数 | 说明 |
|------|------|
| `quantize_image(img_path, bw, bh, n_colors, use_fixed_palette)` | 图片量化，返回 `(pixels, color_table)` |
| `generate_queue_group(pixels, color_table, n_lanes, params, rng, sync_lanes)` | 生成炮车队列，内含整十对齐，返回 `(lanes, pixels)` |
| `regen_queue(level_data, difficulty, n_lanes, slot, seed, sync_lanes)` | 仅重新生成炮车序列，保持 PixelImageData 不变，原地修改并返回 level_data |

### 生成流程

```
1. 图片量化（KMeans 或 --fixed-palette 固定35色最近邻匹配）→ N 色像素网格
2. BFS 计算各色平均暴露深度（外层=浅，内层=深）
3. 爽感前段：关卡前 25%~40% 的颜色按浅→深顺序排（比例随关卡长度动态调整）
4. 难点后段：Easy/Medium 继续浅→深，Hard/VeryHard 深→浅（逆序错配）
5. make_ammo_list() 用标准包（10/20/40）拆分每色炮车
6. 独立模式：各 lane 内相邻颜色局部交错；同步模式：所有 lane 按颜色批次齐推
7. 输出 levels2 格式 JSON
```

### 难度参数对照

| 难度 | 后段时序方向 | 优先弹药包 | 最大辆/色 | 分散度 |
|------|------------|-----------|----------|--------|
| Easy | 浅→深（顺序） | 40 发 | 3 | 0.2 |
| Medium | 浅→深（顺序） | 20 发 | 5 | 0.5 |
| Hard | 深→浅（逆序） | 20 发 | 8 | 0.8 |
| Very Hard | 深→浅（逆序） | 10 发 | 15 | 1.0 |

> **注**：原 Medium 的 `mismatch_dir=0` 被 `reverse=(mdir>=0)` 误判为逆序，已修复为 `reverse=(mdir>0)`，Medium 现在和 Easy 一样走顺序。

### 弹药约束

- 每辆炮车弹药值 ∈ {10, 20, 30, 40}（复刻竞品规范）
- 各色弹药总量 **严格等于** 该色像素数（像素数保证是 10 的倍数，见下）
- 颜色大组顺序严格保持，相邻两色之间做局部交错（原全局 round-robin 已废弃）

### 像素整十对齐（`_align_counts_to_ten`）

量化完成后、生成炮车前，对每种颜色的像素数做整十修正。

**核心数学**：棋盘全满（总像素 = boardWidth × boardHeight，必然是 10 的倍数），因此各色余数之和 ≡ 0 (mod 10)，"多出的"与"不足的"可以精确抵消。策略为**纯改色，不增删任何像素**，图像轮廓完全不变：

1. 计算每色余数 r_i = count_i % 10，D = Σr_i
2. 需要 D/10 个颜色向上取整（ceil），其余向下取整（floor）
3. 优先让余数大（r_i 靠近 9）的颜色向上取整，改动像素数最少
4. 向下取整的颜色贡献出 BFS 最外层像素（donor），视觉损失最小
5. 每个 donor 优先改色给**相邻**的有需求颜色，保证颜色边界自然连续；无相邻时选需求量最大的颜色

`generate_queue_group()` 返回 `(lanes, pixels)` 供 `main()` 同步使用。

---

## 十四、难度算法（tools/difficulty_analysis.py）

基于 B 组 167 关的监督回归分析，提取 5 个难度维度：

| 特征 | 说明 | 对高难度的贡献 |
|------|------|---------------|
| F1 时序错配 | BFS暴露深度 vs 队列位置的 Spearman 相关（取反） | 正（Hard刻意反向） |
| F2 槽位压力 | 模拟交错调度下的槽位满载率 | 正（最强信号） |
| F3 调度熵 | 颜色跨队列分散度 | 负（B组Easy反而高） |
| F4 宽裕惩罚 | (总弹药-像素数)/像素数 | 中性（B组全为0） |
| F5 混淆度 | Lab色差<50的颜色对占比 | 中性 |

逻辑回归训练集准确率 75%（B组有效标注167关）。
可用 B 组训练的模型对 A 组 301 关打分，综合分 0~2+ 对应 Easy→VeryHard。

---

## 十五、像素工具（pixel-tool.html）

单文件工具，将图片转换为 levels2 格式关卡 JSON。核心流程：

1. 上传图片（支持拖拽）→ 可选 remove.bg 抠图或泛洪填充去背景
2. 点「自动寻优网格」→ 先检测像素风原生尺寸，否则三段式搜索最优 GW×GH
3. 颜色控制（Median Cut 量化，调整 K/T）→「重新生成」
4. 可选「四格对比预览」查看 top-4 候选尺寸
5. 生成关卡 JSON → 保存到 levels/a/（或 b/c，由编辑器选择的组决定）

**网格评分**：`combo = cellPurity×0.6 + edge×0.2 + rle×0.2`

### 固定35色板模式

勾选「固定色板模式（35色）」后，跳过 KMeans，改用 Lab 最近邻匹配到固定35色，取覆盖最多的前 K 种颜色输出。与 `level_generator.py --fixed-palette` 使用完全相同的色板和匹配算法。

**颜色匹配算法**：加权 CIE76，降低亮度权重（L×0.5），提高色相权重（a×2、b×2），避免有彩色像素因亮度接近匹配到近白/近灰色。

**注意**：固定色板适合色彩鲜明的图（卡通、像素画、logo），对柔和渐变图（如照片）颜色还原度有限。上传的 PNG 若有透明边缘，PIL 会将透明区域填充为白色参与量化，建议使用无透明区域的图片。

---

## 十六、新增障碍元素开发指引

后续开发障碍元素（石头、冰块、锁格等）时，修改以下四处：

1. **关卡 JSON**（levels2 格式）：在 `PixelImageData.pixels` 里加新字段（如 `"type": "stone"`），或使用单独的 `obstacles` 顶层数组
2. **GameLogic.js** `loadLevel`：解析障碍数据，写入 `obstacles[]`，按需写入 `grid`（若障碍占格）
3. **renderer.js** `_drawObstacle()`：按 `obs.type` 分发绘制逻辑
4. **GameLogic.js** `_findTarget()`：按需让子弹被障碍物阻挡（当前扫描遇到非 null 格即停）

---

## 十七、编辑器自动对齐规则（normalize）

**原则：画布像素永远不动，只调整炮车弹药。**

- 目标弹药 = `ceil10(像素数)`（与生成器一致）
- 弹药不足：差值追加到最后一辆炮车，若超 40 则原地拆出新炮车插入同队列
- 弹药过多：从最后一辆往前削，整辆清零就删车，保留前面队列顺序
- 无炮车：调 `makeAmmoList()` 按标准包新建（优先 20 发，上限 5 辆）
- 保存校验：`ammo === ceil10(pixels)`（允许手绘像素数非整十）

> 生成器产出的关卡像素数已严格整十，normalize 对其 diff == 0，炮车序列完全不变。

---

## 十八、已知问题 / 历史决策

| 问题 | 说明 |
|------|------|
| A 组 4 关弹药>像素 | L33/59/85/92 原始设计如此（弹药比像素多 10~20 发），游戏可正常运行 |
| 旧格式关卡已归档 | 旧格式数据已移入 _archive/levels_old_format/，不参与游戏 |
| Phaser Zone 交互 | `container.setVisible(false)` 不禁用 Zone，必须用 depth=-1 + 遮罩方案（参见 DevTools） |
| pixel-tool.html 输出 | 当前仍输出到旧格式路径，待更新为输出到 levels/a/（levels2 格式） |
| C 组上限 500 | TOTAL_LEVELS_C=500 是预加载上限，Phaser 会静默忽略不存在的文件，无需手动维护 |
| AutoBot 通关率（2026-04-24 v10） | A 组 ✓277/299（92.6%）；B 组 ✓164/171（95.9%）。卡关22+7=29关，均为结构性死锁（颜色依赖图问题），零失败 |
| A 组空关已清理 | 原 level285/level289 为空关（boardSize=0），已删除，后续关卡顺位前移，A 组共 299 关 |
