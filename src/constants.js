// 游戏规则（固定）
export const TRACK_CAP    = 5;
export const BUFFER_CAP   = 5;
export const TURRET_SPEED = 3;
export const BULLET_SPEED = 14;

// 动态布局范围
export const CELL_MIN = 6;
export const CELL_MAX = 18;

// 视口
export const VW = 480;
export const VH = 920;

// 轨道间距
export const TRACK_GAP = 22;

// 方向枚举
export const SIDE = Object.freeze({ BOTTOM: 0, RIGHT: 1, TOP: 2, LEFT: 3 });

// 动态布局对象（每关 loadLevel 时由 GameLogic 重新写入）
export const G = {
  GW: 20, GH: 20, CELL: 18,
  CW: 360, CH: 360,
  CANVAS_X: 60, CANVAS_Y: 90,
  ITEM_BAR_Y: 524, BUFFER_Y: 654, QUEUE_Y: 744,
  LEN_BOTTOM: 360, LEN_RIGHT: 360, LEN_TOP: 360, LEN_LEFT: 360,
  TOTAL_DIST: 1440,
};

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
export const TOTAL_LEVELS   = 301;
export const TOTAL_LEVELS_B = 167;
