# FixelFlow 2

消除类益智手机游戏，Phaser 3 构建。炮车沿轨道行驶，向棋盘上的同色方块射击消除。

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5174
```

也可用 PowerShell 静态服务（无需 node）：
```powershell
.\serve.ps1
```

## 项目结构

```
game2/
├── index.html          # 游戏入口
├── editor.html         # 关卡编辑器
├── pixel-tool.html     # 图片→关卡JSON 转换工具
├── src/                # 游戏源码
│   ├── GameLogic.js    # 纯游戏逻辑（无渲染依赖）
│   ├── GameScene.js    # Phaser Scene 调度层
│   ├── AutoBot.js      # 自动打关机器人（v10）
│   ├── renderer.js     # 渲染层
│   ├── bullets.js      # 子弹系统
│   ├── items.js        # 道具系统
│   └── constants.js    # 常量 + 动态几何对象 G
├── tools/              # 开发工具链
│   ├── sim.js          # 关卡模拟器（批量测试）
│   └── level_generator.py  # 图片→关卡自动生成器
├── levels_a2/          # A 组关卡（299 关，自制）
├── levels_b2/          # B 组关卡（171 关，竞品筛选）
├── levels_c2/          # C 组关卡（编辑器创作）
└── research/           # AutoBot 算法研究档案
```

## AutoBot

内置自动打关机器人，点击右上角「🤖 自动」开启。

| 版本 | A 组（299关） | B 组（171关） |
|------|--------------|--------------|
| v10（当前） | 277/299（92.6%） | 164/171（95.9%） |

详见 [ARCHITECTURE.md](ARCHITECTURE.md) 第十节。

## 关卡编辑器

访问 `/editor.html`，支持：
- 上传图片自动生成关卡
- 手动像素绘制
- 调整难度 / 炮车序列
- 一键试玩

## 批量模拟

```bash
node tools/sim.js levels_a2 1 299   # 跑 A 组全部
node tools/sim.js levels_b2 1 171   # 跑 B 组全部
node tools/sim.js levels_a2 13 13   # 只跑第 13 关
```

## 技术栈

- **Phaser 3**（本地副本，不走 npm）
- **Vite**（仅 devDependency）
- **Python 3**（关卡生成器，可选）
