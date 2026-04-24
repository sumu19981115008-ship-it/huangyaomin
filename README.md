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
├── index.html              # 游戏入口
├── editor.html             # 关卡编辑器
├── pixel-tool.html         # 图片→关卡JSON 转换工具
├── src/                    # 游戏源码
│   ├── GameLogic.js        # 纯游戏逻辑（无渲染依赖）
│   ├── GameScene.js        # Phaser Scene 调度层
│   ├── AutoBot.js          # 自动打关机器人（v10）
│   ├── renderer.js         # 渲染层
│   ├── bullets.js          # 子弹系统
│   ├── items.js            # 道具系统
│   ├── constants.js        # 常量 + 动态几何对象 G
│   ├── dev/                # 开发工具（跳关、回放）
│   └── editor/             # 关卡编辑器逻辑
├── tools/                  # 开发工具链
│   ├── sim.js              # 关卡模拟器（批量测试）
│   ├── level_generator.py  # 图片→关卡自动生成器
│   ├── difficulty_analysis.py  # 难度特征分析
│   ├── sim_analyze.mjs     # 卡关原因分析
│   ├── debug/              # 单关调试脚本（trace/debug/*.mjs）
│   └── testdata/           # 测试用关卡 JSON + 图片
├── levels/                 # 全部关卡
│   ├── a/                  # A 组（299 关，自制）
│   ├── b/                  # B 组（171 关，竞品筛选）
│   └── c/                  # C 组（编辑器创作，动态增长）
├── research/               # AutoBot 算法研究档案
│   ├── bots/               # v1~v7 历代算法快照
│   └── results/            # 各版本通关率基准
└── _archive/               # 历史归档（旧格式关卡、旧脚本）
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
node tools/sim.js levels/a 1 299   # 跑 A 组全部
node tools/sim.js levels/b 1 171   # 跑 B 组全部
node tools/sim.js levels/a 13 13   # 只跑第 13 关
```

## 技术栈

- **Phaser 3**（本地副本，不走 npm）
- **Vite**（仅 devDependency）
- **Python 3**（关卡生成器，可选）
