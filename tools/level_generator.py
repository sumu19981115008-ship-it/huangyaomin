"""
FixelFlow 2 关卡自动生成器
用法：python level_generator.py <图片路径> <输出JSON路径> [选项]
  --lanes N        轨道数（默认3）
  --difficulty D   easy / medium / hard / veryhard（默认medium）
  --colors N       颜色数量（默认自动，最多8）
  --board W H      网格尺寸（默认20 20）
  --slot N         槽位数（默认5）

生成逻辑综述
  1. 图片量化为 N 色，映射到 W×H 网格
  2. BFS 计算各色暴露深度
  3. 按难度参数决定：炮车数、每辆弹药粒度、队列分配、时序错配方向
  4. 输出 levels2 JSON
"""

import argparse, json, math, sys
from collections import defaultdict, deque
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

# ═══════════════════════════════════════════════════════════════════════════════
# 难度参数表（源自对 B组/A组 300+ 关的回归分析）
#
# mismatch_dir:   +1 = 深色先出（Hard反向，越难越正）
#                 -1 = 浅色先出（Easy顺序）
# ammo_granule:   每辆炮车弹药粒度（10的倍数），越小越密集
# tank_per_color: 每种颜色拆成几辆炮车（越多队列越深，压力越大）
# lane_spread:    颜色跨队列分散度（0=集中一条, 1=强制分散到所有队列）
# surplus_ratio:  额外宽裕弹药比例（0=严格对齐, 0.1=多10%）
# ═══════════════════════════════════════════════════════════════════════════════

DIFFICULTY_PARAMS = {
    'easy': {
        'mismatch_dir':       -1,   # 顺序：浅色（外层）先出
        'pref_pack':          40,   # 优先 40 发大包，炮车数少
        'tank_per_color_max': 3,
        'lane_spread':        0.2,  # 集中在少数队列
        'score_range':        (0.0, 0.8),
    },
    'medium': {
        'mismatch_dir':       0,
        'pref_pack':          20,   # 优先 20 发中包
        'tank_per_color_max': 5,
        'lane_spread':        0.5,
        'score_range':        (0.8, 1.3),
    },
    'hard': {
        'mismatch_dir':       +1,   # 反向：深色先出，强迫暂存
        'pref_pack':          20,   # 20 发包，辆数多于 easy
        'tank_per_color_max': 8,
        'lane_spread':        0.8,
        'score_range':        (1.3, 1.8),
    },
    'veryhard': {
        'mismatch_dir':       +1,
        'pref_pack':          10,   # 10 发小包，队列深度爆炸
        'tank_per_color_max': 15,
        'lane_spread':        1.0,
        'score_range':        (1.8, 3.0),
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# 图片量化
# ═══════════════════════════════════════════════════════════════════════════════

def quantize_image(img_path, board_w, board_h, n_colors):
    img = Image.open(img_path).convert('RGB')
    img = img.resize((board_w, board_h), Image.LANCZOS)
    arr = np.array(img).reshape(-1, 3).astype(float)

    km = KMeans(n_clusters=n_colors, random_state=42, n_init=10)
    labels = km.fit_predict(arr)
    centers = km.cluster_centers_.astype(int)

    pixels = []
    for idx, lab in enumerate(labels):
        x = idx % board_w
        y = idx // board_w
        pixels.append({'x': x, 'y': y, 'material': int(lab)})

    color_table = [f"#{c[0]:02X}{c[1]:02X}{c[2]:02X}" for c in centers]
    return pixels, color_table

# ═══════════════════════════════════════════════════════════════════════════════
# BFS 暴露深度
# ═══════════════════════════════════════════════════════════════════════════════

def bfs_exposure_depth(pixels, bw, bh):
    grid = set((p['x'], p['y']) for p in pixels)

    def neighbors(x, y):
        for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
            yield x+dx, y+dy

    depth = {}
    q = deque()
    for (x, y) in grid:
        for nx, ny in neighbors(x, y):
            if (nx, ny) not in grid or nx < 0 or nx >= bw or ny < 0 or ny >= bh:
                if (x, y) not in depth:
                    depth[(x, y)] = 0
                    q.append((x, y))
                break

    while q:
        x, y = q.popleft()
        for nx, ny in neighbors(x, y):
            if (nx, ny) in grid and (nx, ny) not in depth:
                depth[(nx, ny)] = depth[(x, y)] + 1
                q.append((nx, ny))

    return depth

# ═══════════════════════════════════════════════════════════════════════════════
# 像素对齐：把各色数量调整为 10 的倍数（只改颜色，不增删格子）
# ═══════════════════════════════════════════════════════════════════════════════

def _align_counts_to_ten(pixels, bw, bh, rng):
    """
    让每种颜色的像素数成为 10 的倍数。

    棋盘全满（总像素 = bw*bh，必然是 10 的倍数），因此各色余数之和 ≡ 0 (mod 10)，
    "多出的"和"不足的"可以精确抵消。策略是纯改色，不增删任何像素：

    1. 计算每色余数 r_i = count_i % 10
    2. D = Σr_i，恰好需要 D/10 个颜色向上取整（其余向下取整）
    3. 优先让余数大（r_i 靠近 9）的颜色向上取整，改动量最小
    4. 向下取整的颜色贡献出 BFS 最外层的像素（donors）
    5. 每个 donor 优先改色给相邻的向上取整颜色，无相邻时给需求最大的颜色
    """
    from collections import defaultdict

    counts = defaultdict(int)
    for p in pixels:
        counts[p['material']] += 1

    remainders = {m: counts[m] % 10 for m in counts if counts[m] % 10 != 0}
    if not remainders:
        return pixels

    D = sum(remainders.values())
    assert D % 10 == 0, f"余数之和 {D} 不是 10 的倍数，棋盘尺寸非整十？"
    need_up_count = D // 10

    # 余数大的优先向上取整（cost = 10-r 更小，改动像素更少）
    sorted_colors = sorted(remainders.keys(), key=lambda m: remainders[m], reverse=True)
    round_up   = set(sorted_colors[:need_up_count])
    round_down = set(sorted_colors[need_up_count:])

    # 各色需要接收（正）或贡献（负）的像素数
    quota = {}
    for m in round_up:
        quota[m] = 10 - remainders[m]
    for m in round_down:
        quota[m] = -remainders[m]

    depth_map    = bfs_exposure_depth(pixels, bw, bh)
    coord_to_px  = {(p['x'], p['y']): p for p in pixels}

    # 收集 donor 像素（BFS 最外层优先），按深度升序排列
    donors = []
    for m in round_down:
        n = -quota[m]
        candidates = [p for p in pixels if p['material'] == m]
        candidates.sort(key=lambda p: depth_map.get((p['x'], p['y']), 0))
        donors.extend(candidates[:n])
    donors.sort(key=lambda p: depth_map.get((p['x'], p['y']), 0))

    dirs = [(0,1),(1,0),(0,-1),(-1,0)]
    remaining = {m: quota[m] for m in round_up}  # 还需要多少像素

    for donor in donors:
        # 优先选相邻且有需求的 round_up 颜色
        adj_up = set()
        for dx, dy in dirs:
            nb = coord_to_px.get((donor['x'] + dx, donor['y'] + dy))
            if nb and nb['material'] in remaining:
                adj_up.add(nb['material'])

        if adj_up:
            target = max(adj_up, key=lambda m: remaining[m])
        else:
            if not remaining:
                break
            target = max(remaining, key=lambda m: remaining[m])

        donor['material'] = target
        remaining[target] -= 1
        if remaining[target] == 0:
            del remaining[target]

    return pixels

# ═══════════════════════════════════════════════════════════════════════════════
# 炮车生成核心
# ═══════════════════════════════════════════════════════════════════════════════

def ceil10(n):
    """向上取整到 10 的倍数，最小 10"""
    return max(10, math.ceil(n / 10) * 10)

# 竞品标准弹药包：优先用大包，凑到目标总量
# 规则来自对 B 组 5000+ 辆炮车的统计：只用 10/20/30/40/50
def make_ammo_list(total, max_tanks, pref_pack=40):
    """
    把 total（10的倍数）分解为若干个标准包。
    pref_pack：优先用的包大小（easy=40大包少辆，veryhard=10小包多辆）
    max_tanks：最多炮车数上限。
    """
    assert total % 10 == 0 and total >= 10, f"total={total} 不是10的正整数倍"

    pack_order = {40: [40, 20, 10], 20: [20, 40, 10], 10: [10, 20, 40]}[pref_pack]

    tanks = []
    remain = total
    # 贪心拆包：每包严格 ≤ 40，总辆数 ≤ max_tanks
    for pack in pack_order:
        while remain >= pack and len(tanks) < max_tanks:
            tanks.append(pack)
            remain -= pack
        if remain == 0:
            break

    # 若还有剩余（max_tanks 用完但 remain > 0），把剩余并入最后一辆
    # 前提：最后一辆 + remain ≤ 40，否则继续拆
    if remain > 0:
        if tanks and tanks[-1] + remain <= 40:
            tanks[-1] += remain
        else:
            # 强制追加，不受 max_tanks 限制（保证弹药总量正确优先）
            while remain > 40:
                tanks.append(40)
                remain -= 40
            if remain > 0:
                tanks.append(remain)

    return tanks

def generate_queue_group(pixels, color_table, n_lanes, params, rng):
    bw = max(p['x'] for p in pixels) + 1
    bh = max(p['y'] for p in pixels) + 1

    # 各色像素数
    mat_px_raw = defaultdict(int)
    for p in pixels:
        mat_px_raw[p['material']] += 1

    # 边界像素重分配：使各色像素数均为 10 的倍数（不增删像素，只改颜色）
    pixels = _align_counts_to_ten(pixels, bw, bh, rng)

    # 重新统计（对齐后）
    mat_px_raw = defaultdict(int)
    for p in pixels:
        mat_px_raw[p['material']] += 1
    mat_px = dict(mat_px_raw)  # 此时每色均为 10 的倍数

    # BFS 各色平均暴露深度
    depth_map = bfs_exposure_depth(pixels, bw, bh)
    mat_depth = defaultdict(list)
    for p in pixels:
        mat_depth[p['material']].append(depth_map.get((p['x'], p['y']), 0))
    avg_depth = {m: sum(v)/len(v) for m, v in mat_depth.items()}

    tmax      = params['tank_per_color_max']
    spread    = params['lane_spread']
    mdir      = params['mismatch_dir']
    pref_pack = params['pref_pack']

    # ── 第一步：为每条 lane 生成待放炮车列表（按颜色分配）─────────────────────
    # 对颜色按暴露深度排序，mdir 决定时序错配方向
    sorted_mats = sorted(avg_depth.keys(), key=lambda m: avg_depth[m], reverse=(mdir >= 0))

    # lane_pending[li] = [(material, ammo), ...]，同色连续
    n_spread_global = max(1, min(n_lanes, round(spread * n_lanes))) if spread > 0 else 1
    lane_pending = [[] for _ in range(n_lanes)]

    for m in sorted_mats:
        px = mat_px.get(m, 0)
        if px == 0:
            continue
        ammo_list = make_ammo_list(px, tmax, pref_pack)
        cnt = len(ammo_list)

        # 辆数越多，分散到越多条 lane（最多 n_lanes 条）
        cnt = len(ammo_list)
        n_spread = min(n_lanes, max(1, round(spread * min(cnt, n_lanes))))
        load = [sum(a for _, a in pending) for pending in lane_pending]
        chosen = sorted(range(n_lanes), key=lambda i: load[i])[:n_spread]
        for ti, ammo in enumerate(ammo_list):
            li = chosen[ti % len(chosen)]
            lane_pending[li].append((m, ammo))

    # ── 第二步：对每条 lane 内部做颜色交错打散 ────────────────────────────────
    # 按颜色分组 → round-robin 交替取出，避免同色连片
    def interleave(items):
        from collections import defaultdict
        groups = defaultdict(list)
        for mat, ammo in items:
            groups[mat].append(ammo)
        # 按首次出现顺序排列颜色，保留时序错配方向
        order = list(dict.fromkeys(mat for mat, _ in items))
        result = []
        while any(groups[m] for m in order):
            for m in order:
                if groups[m]:
                    result.append((m, groups[m].pop(0)))
        return result

    lanes = [[] for _ in range(n_lanes)]
    tank_id = 1
    for li in range(n_lanes):
        scattered = interleave(lane_pending[li])
        for mat, ammo in scattered:
            lanes[li].append({'id': tank_id, 'ammo': int(ammo), 'material': mat})
            tank_id += 1

    return lanes, pixels  # pixels 已经过对齐，调用方需用返回值替换原始 pixels

# ═══════════════════════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='FixelFlow 2 关卡自动生成器')
    parser.add_argument('image',       help='输入图片路径')
    parser.add_argument('output',      help='输出 JSON 路径')
    parser.add_argument('--lanes',      type=int,   default=3,        help='轨道数（默认3）')
    parser.add_argument('--difficulty', type=str,   default='medium', help='easy/medium/hard/veryhard')
    parser.add_argument('--colors',     type=int,   default=0,        help='颜色数（0=自动）')
    parser.add_argument('--board',      type=int,   nargs=2,          default=[20, 20], metavar=('W','H'))
    parser.add_argument('--slot',       type=int,   default=5,        help='槽位数（默认5）')
    parser.add_argument('--seed',       type=int,   default=42)
    args = parser.parse_args()

    diff_key = args.difficulty.lower().replace(' ', '')
    if diff_key not in DIFFICULTY_PARAMS:
        print(f"难度无效：{args.difficulty}，可选 easy/medium/hard/veryhard")
        sys.exit(1)

    params   = DIFFICULTY_PARAMS[diff_key]
    rng      = np.random.default_rng(args.seed)
    board_w, board_h = args.board

    # 自动决定颜色数
    if args.colors == 0:
        n_colors = {'easy': 4, 'medium': 6, 'hard': 7, 'veryhard': 8}.get(diff_key, 6)
    else:
        n_colors = max(2, min(12, args.colors))

    print(f"图片：{args.image}")
    print(f"网格：{board_w}×{board_h}，颜色：{n_colors}，轨道：{args.lanes}，难度：{diff_key}")

    # 1. 图片量化
    pixels, color_table = quantize_image(args.image, board_w, board_h, n_colors)
    print(f"量化完成：{len(pixels)} 像素，{len(color_table)} 色")

    # 2. 生成炮车队列（pixels 在内部做了整十对齐，需要接收返回值）
    queue_group, pixels = generate_queue_group(pixels, color_table, args.lanes, params, rng)

    total_ammo = sum(t['ammo'] for lane in queue_group for t in lane)
    total_px   = len(pixels)
    n_tanks    = sum(len(lane) for lane in queue_group)
    print(f"炮车：{n_tanks} 辆，总弹药：{total_ammo}，像素：{total_px}，差值：{total_ammo - total_px:+d}")

    for li, lane in enumerate(queue_group):
        ammos = [t['ammo'] for t in lane]
        print(f"  Lane {li}：{len(lane)} 辆  弹药={ammos}")

    # 3. 组装 levels2 JSON
    diff_display = {'easy':'Easy','medium':'Medium','hard':'Hard','veryhard':'Very Hard'}[diff_key]
    level_data = {
        'colorTable':     color_table,
        'QueueGroup':     queue_group,
        'PixelImageData': {
            'width':  board_w,
            'height': board_h,
            'pixels': pixels,
        },
        'Difficulty':     diff_display,
        'SlotCount':      args.slot,
        'ConveyorLimit':  args.slot,
        'boardWidth':     board_w,
        'boardHeight':    board_h,
    }

    with open(args.output, 'w', encoding='utf-8') as fh:
        json.dump(level_data, fh, ensure_ascii=False, separators=(',', ':'))

    print(f"已写出：{args.output}")

    # 4. 简单校验
    _verify(level_data)

def _verify(d):
    from collections import Counter
    px_cnt  = Counter(p['material'] for p in d['PixelImageData']['pixels'])
    am_cnt  = Counter()
    ammo_vals = Counter()
    for lane in d['QueueGroup']:
        for t in lane:
            am_cnt[t['material']] += t['ammo']
            ammo_vals[t['ammo']] += 1
    ok = True
    for m in range(len(d['colorTable'])):
        b, a = px_cnt.get(m, 0), am_cnt.get(m, 0)
        if a != b:
            print(f"  [!] mat{m} ({d['colorTable'][m]}): 像素{b} 弹药{a}  差{a-b:+d}")
            ok = False
    if ok:
        print("校验通过：弹药 == 像素（严格对齐）")
    print(f"弹药包分布：{dict(sorted(ammo_vals.items()))}")

if __name__ == '__main__':
    main()
