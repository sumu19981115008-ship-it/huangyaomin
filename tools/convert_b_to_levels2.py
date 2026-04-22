"""
从 levels2/ 原始文件中筛选弹药=像素的关卡（上个session得出167关），
转换为统一 levels2 格式（带 colorTable），输出到 levels_b2/

统一格式（与 convert_a_to_levels2.py 生成格式相同）：
{
  colorTable: ["#HEX0","#HEX1",...],
  Difficulty: "...",
  HasTimeLimit: false,
  SlotCount: 5,
  ConveyorLimit: 5,
  boardWidth: N, boardHeight: N,
  QueueGroup: [[{id, ammo, material}]],    <- material 为 colorTable 下标
  PixelImageData: { width, height, pixels:[{x,y,material}] }
}
"""

import json
import os
import sys

# 竞品原始 material ID → hex 颜色（全部33种）
STD_COLORS = {
    0:  '#E74C3C',
    1:  '#3498DB',
    2:  '#2ECC71',
    3:  '#F39C12',
    4:  '#9B59B6',
    5:  '#1ABC9C',
    6:  '#E91E63',
    7:  '#00BCD4',
    8:  '#FF5722',
    9:  '#8BC34A',
    10: '#FFD700',
    11: '#607D8B',
    12: '#FF4081',
    13: '#00E5FF',
    14: '#76FF03',
    15: '#FF6D00',
    16: '#D500F9',
    17: '#00B0FF',
    18: '#FF1744',
    19: '#69F0AE',
    20: '#FFAB40',
    21: '#EA80FC',
    22: '#80D8FF',
    23: '#CCFF90',
    24: '#FF9E80',
    25: '#A7FFEB',
    26: '#B9F6CA',
    27: '#FFE57F',
    28: '#84FFFF',
    29: '#FF80AB',
    30: '#CFD8DC',
    31: '#F8BBD9',
    32: '#B3E5FC',
}

SRC_DIR = os.path.join(os.path.dirname(__file__), '..', 'levels2')
DST_DIR = os.path.join(os.path.dirname(__file__), '..', 'levels_b2')
os.makedirs(DST_DIR, exist_ok=True)


def convert(src_path, dst_path, seq_id):
    with open(src_path, encoding='utf-8') as f:
        data = json.load(f)

    pix_data = data.get('PixelImageData', {})
    pixels_raw = pix_data.get('pixels', [])
    bw = pix_data.get('width',  50)
    bh = pix_data.get('height', 50)

    queue_groups = data.get('QueueGroup', [])

    # ── 收集本关用到的所有 material ID ─────────────────────────────────────
    mat_ids = set()
    for p in pixels_raw:
        mat_ids.add(p['material'])
    for lane in queue_groups:
        for t in lane:
            mat_ids.add(t['material'])

    # ── 建立 旧material ID → colorTable下标 的映射 ──────────────────────────
    # colorTable 只包含本关实际用到的颜色，按首次出现顺序
    color_set = []
    mat_to_new = {}
    for mid in sorted(mat_ids):
        hex_c = STD_COLORS.get(mid, '#FFFFFF')
        mat_to_new[mid] = len(color_set)
        color_set.append(hex_c)

    # ── 转换像素（levels2 y=0 已是顶部，无需翻转）──────────────────────────
    pixels_out = []
    for p in pixels_raw:
        pixels_out.append({
            'x': p['x'],
            'y': p['y'],
            'material': mat_to_new[p['material']],
        })

    # ── 转换炮车队列 ───────────────────────────────────────────────────────
    tank_id_counter = [0]
    lanes_out = []
    for lane in queue_groups:
        lane_out = []
        for t in lane:
            lane_out.append({
                'id':       tank_id_counter[0],
                'ammo':     t['ammo'],
                'material': mat_to_new[t['material']],
            })
            tank_id_counter[0] += 1
        lanes_out.append(lane_out)

    out = {
        'colorTable':    color_set,
        'Difficulty':    data.get('Difficulty', 'Medium'),
        'HasTimeLimit':  data.get('HasTimeLimit', False),
        'SlotCount':     data.get('SlotCount', 5),
        'ConveyorLimit': data.get('ConveyorLimit', 5),
        'boardWidth':    bw,
        'boardHeight':   bh,
        'QueueGroup':    lanes_out,
        'PixelImageData': {
            'width':  bw,
            'height': bh,
            'pixels': pixels_out,
        },
    }

    with open(dst_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    return len(pixels_out), sum(len(l) for l in lanes_out)


def is_matched(src_path):
    """像素数 == 弹药总数"""
    with open(src_path, encoding='utf-8') as f:
        data = json.load(f)
    pix_data = data.get('PixelImageData', {})
    pixels = pix_data.get('pixels', [])

    # 统计各 material 像素数
    pix_cnt = {}
    for p in pixels:
        m = p['material']
        pix_cnt[m] = pix_cnt.get(m, 0) + 1

    # 统计各 material 弹药数
    ammo_cnt = {}
    for lane in data.get('QueueGroup', []):
        for t in lane:
            m = t['material']
            ammo_cnt[m] = ammo_cnt.get(m, 0) + t['ammo']

    all_mats = set(list(pix_cnt.keys()) + list(ammo_cnt.keys()))
    for m in all_mats:
        if pix_cnt.get(m, 0) != ammo_cnt.get(m, 0):
            return False
    return True


# ── 主逻辑 ───────────────────────────────────────────────────────────────────
src_files = sorted(os.listdir(SRC_DIR))
matched = []
for fname in src_files:
    if not fname.endswith('.json'):
        continue
    fpath = os.path.join(SRC_DIR, fname)
    try:
        if is_matched(fpath):
            matched.append(fname)
    except Exception as e:
        pass

print(f'筛选出 {len(matched)} 个匹配关卡')

errors = []
for i, fname in enumerate(matched, start=1):
    src = os.path.join(SRC_DIR, fname)
    dst = os.path.join(DST_DIR, f'level{i}.json')
    try:
        px, tk = convert(src, dst, i)
    except Exception as e:
        errors.append(f'{fname}: {e}')

print(f'转换完成 {len(matched) - len(errors)} 关，错误 {len(errors)} 个')
for e in errors:
    print(' ', e)

# 输出最终列表，方便调试
print('\n前10关文件名：')
for f in matched[:10]:
    print(' ', f)
