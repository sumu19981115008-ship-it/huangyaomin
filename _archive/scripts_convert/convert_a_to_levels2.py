"""
将 A 组关卡（levels/levelN.json，旧格式）批量转换为 levels2 格式
输出到 levels_a2/ 目录
格式：{
  colorTable: ["#HEX0","#HEX1",...],   # 颜色索引表（material ID → hex）
  Difficulty: "Medium",                 # 固定 Medium（旧格式无难度标记）
  HasTimeLimit: false,
  SlotCount: 5,
  ConveyorLimit: 5,
  boardWidth: N, boardHeight: N,        # 保留棋盘尺寸
  QueueGroup: [[{id, ammo, material}]], # material = colorTable 中的下标
  PixelImageData: {
    width: N, height: N,
    pixels: [{x, y, material}]         # y=0 在顶部（levels2 坐标系，无翻转）
  }
}
"""

import json
import os
import sys

SRC_DIR  = os.path.join(os.path.dirname(__file__), '..', 'levels')
DST_DIR  = os.path.join(os.path.dirname(__file__), '..', 'levels_a2')
os.makedirs(DST_DIR, exist_ok=True)

def convert(src_path, dst_path):
    with open(src_path, encoding='utf-8') as f:
        data = json.load(f)

    bw = data.get('boardWidth',  data.get('boardSize', 20))
    bh = data.get('boardHeight', data.get('boardSize', 20))

    # ── 收集所有出现颜色，建立 hex→material 映射 ──────────────────────────
    color_set = []
    color_idx = {}

    def get_mat(hex_color):
        c = hex_color.upper()
        if c not in color_idx:
            color_idx[c] = len(color_set)
            color_set.append(c)
        return color_idx[c]

    # ── 解析像素方块 ───────────────────────────────────────────────────────
    # 旧格式 y=0 在底部；levels2 y=0 在顶部
    # 转换：levels2_y = (bh-1) - old_y
    pixels = []
    for entity in data.get('entities', []):
        if entity.get('type') != 'PixelBlock':
            continue
        mat = get_mat(entity.get('color', '#FFFFFF'))
        for cell in entity.get('cells', []):
            cx = cell['x']
            cy_new = (bh - 1) - cell['y']   # 坐标翻转
            if 0 <= cx < bw and 0 <= cy_new < bh:
                pixels.append({'x': cx, 'y': cy_new, 'material': mat})

    # ── 解析炮车队列 ───────────────────────────────────────────────────────
    num_lanes = data.get('numberOfLanes', 2)
    lanes = [[] for _ in range(num_lanes)]

    tanks = data.get('initialTanks', [])
    # 按 lane, position 排序
    tanks_sorted = sorted(tanks, key=lambda t: (t.get('lane', 0), t.get('position', 0)))
    for i, t in enumerate(tanks_sorted):
        lane = t.get('lane', 0)
        if lane < num_lanes:
            mat = get_mat(t.get('color', '#FFFFFF'))
            lanes[lane].append({
                'id': i,
                'ammo': t.get('ammo', 10),
                'material': mat,
            })

    out = {
        'colorTable':    color_set,
        'Difficulty':    'Medium',
        'HasTimeLimit':  False,
        'SlotCount':     5,
        'ConveyorLimit': 5,
        'boardWidth':    bw,
        'boardHeight':   bh,
        'QueueGroup':    lanes,
        'PixelImageData': {
            'width':  bw,
            'height': bh,
            'pixels': pixels,
        },
    }

    with open(dst_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    return len(pixels), sum(len(l) for l in lanes)


errors = []
total = 0
for i in range(1, 302):
    src = os.path.join(SRC_DIR, f'level{i}.json')
    dst = os.path.join(DST_DIR, f'level{i}.json')
    if not os.path.exists(src):
        print(f'跳过（不存在）: level{i}.json')
        continue
    try:
        px, tk = convert(src, dst)
        total += 1
        if i <= 5 or i % 50 == 0:
            print(f'level{i}: {px} 像素, {tk} 炮车 ✓')
    except Exception as e:
        errors.append(f'level{i}: {e}')
        print(f'level{i}: 错误 — {e}', file=sys.stderr)

print(f'\n完成 {total} 关，错误 {len(errors)} 个')
for e in errors:
    print(' ', e)
