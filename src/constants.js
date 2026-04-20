// 棋盘尺寸
export const GW   = 20;
export const GH   = 20;
export const CELL = 18;

export const CW = GW * CELL;   // 360
export const CH = GH * CELL;   // 360

// 轨道路径
export const SIDE_LEN   = CW;
export const TOTAL_DIST = SIDE_LEN * 4;

// 游戏规则
export const TRACK_CAP    = 5;
export const BUFFER_CAP   = 5;
export const TURRET_SPEED = 3;
export const BULLET_SPEED = 14;

// 视口
export const VW = 480;
export const VH = 900;

// 布局
export const CANVAS_X  = 60;
export const CANVAS_Y  = 90;
export const TRACK_GAP = 22;
export const BUFFER_Y  = 510;
export const QUEUE_Y   = 590;

// 方向枚举
export const SIDE = Object.freeze({ BOTTOM: 0, RIGHT: 1, TOP: 2, LEFT: 3 });

// 颜色
export const C_BG         = 0x0d0d1a;
export const C_CANVAS_BG  = 0x13132a;
export const C_TRACK      = 0x2a2a50;
export const C_GRID_LINE  = 0x1c1c38;
export const C_EMPTY_SLOT = 0x1e1e35;

export const BUFFER_COLORS = [
  0x33cc55, 0x33cc55, 0x33cc55,
  0xddaa00, 0xff6600, 0xff2222,
];

// 可用关卡总数
export const TOTAL_LEVELS = 304;
