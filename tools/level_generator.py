"""
FixelFlow 2 关卡自动生成器
用法：python level_generator.py <图片路径> <输出JSON路径> [选项]
  --lanes N          轨道数（默认3）
  --difficulty D     easy / medium / hard / veryhard（默认medium）
  --colors N         颜色数量（默认自动，最多8）
  --board W H        网格尺寸（默认20 20）
  --slot N           槽位数（默认5）
  --fixed-palette    使用固定34色板（Lab最近邻匹配，与pixel-tool.html一致）

生成逻辑综述
  1. 图片量化为 N 色，映射到 W×H 网格
     （--fixed-palette 模式：每格 Lab 最近邻匹配到固定34色，取前 N 种）
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
# 固定色板（34色，与 pixel-tool.html 保持完全一致）
# ═══════════════════════════════════════════════════════════════════════════════

FIXED_PALETTE_HEX = [
    "#4169E1","#00008B","#222222","#228B22","#FF8C00",
    "#FF69B4","#8B008B","#CC0000","#00CED1","#FFD700",
    "#F5F5F5","#8B4513","#006400","#50C878","#C8A2C8",
    "#8FBC8F","#FA8072","#E6E6FA","#CC4E36","#F5DEB3",
    "#CB4154","#808080","#404040","#4B0082","#FF007F",
    "#FFB6C1","#FFAA5C","#800020","#6B8E23","#5F9EA0",
    "#C4A265","#8B6914","#9D00FF","#6E7F80","#FFFACD",
]

def _hex_to_rgb(h):
    h = h.lstrip('#')
    return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)

def _rgb_to_lab(r, g, b):
    """sRGB → CIE Lab（D65）"""
    def f(v):
        v /= 255.0
        return v/12.92 if v <= 0.04045 else ((v+0.055)/1.055)**2.4
    rx, gx, bx = f(r), f(g), f(b)
    X = rx*0.4124564 + gx*0.3575761 + bx*0.1804375
    Y = rx*0.2126729 + gx*0.7151522 + bx*0.0721750
    Z = rx*0.0193339 + gx*0.1191920 + bx*0.9503041
    X /= 0.95047; Z /= 1.08883
    def fc(t): return t**(1/3) if t > 0.008856 else 7.787*t + 16/116
    L = 116*fc(Y) - 16
    a = 500*(fc(X) - fc(Y))
    b_ = 200*(fc(Y) - fc(Z))
    return L, a, b_

def _delta_e(lab1, lab2):
    # 降低亮度权重，提高色相权重，避免有彩色像素因亮度接近而匹配到近白/近灰色
    dl = lab1[0] - lab2[0]
    da = lab1[1] - lab2[1]
    db = lab1[2] - lab2[2]
    return (0.5*dl**2 + 2.0*da**2 + 2.0*db**2) ** 0.5

FIXED_PALETTE_LAB = [_rgb_to_lab(*_hex_to_rgb(h)) for h in FIXED_PALETTE_HEX]

# ═══════════════════════════════════════════════════════════════════════════════
# 图片量化
# ═══════════════════════════════════════════════════════════════════════════════

def quantize_image(img_path, board_w, board_h, n_colors, use_fixed_palette=False):
    img = Image.open(img_path).convert('RGB')
    img = img.resize((board_w, board_h), Image.LANCZOS)
    arr = np.array(img).reshape(-1, 3)

    if use_fixed_palette:
        # 每格 Lab 最近邻匹配到固定34色，取覆盖最多的前 n_colors 种
        pixel_count = [0] * len(FIXED_PALETTE_HEX)
        assignments = []
        for rgb in arr:
            lab = _rgb_to_lab(int(rgb[0]), int(rgb[1]), int(rgb[2]))
            best_i = min(range(len(FIXED_PALETTE_LAB)),
                         key=lambda i: _delta_e(lab, FIXED_PALETTE_LAB[i]))
            assignments.append(best_i)
            pixel_count[best_i] += 1

        # 按覆盖数降序，取前 n_colors 个有像素的颜色
        ranked = sorted(
            [i for i in range(len(FIXED_PALETTE_HEX)) if pixel_count[i] > 0],
            key=lambda i: pixel_count[i], reverse=True
        )[:n_colors]
        # 将34色索引重映射为 0~(n_colors-1) 的 material id
        idx_to_mat = {fp_i: mat for mat, fp_i in enumerate(ranked)}
        # 不在 top-N 的格子改色为最近邻的 top-N 颜色
        top_labs = [FIXED_PALETTE_LAB[i] for i in ranked]
        pixels = []
        for pos, fp_i in enumerate(assignments):
            if fp_i in idx_to_mat:
                mat = idx_to_mat[fp_i]
            else:
                lab = _rgb_to_lab(int(arr[pos][0]), int(arr[pos][1]), int(arr[pos][2]))
                mat = min(range(len(top_labs)), key=lambda i: _delta_e(lab, top_labs[i]))
            x = pos % board_w
            y = pos // board_w
            pixels.append({'x': x, 'y': y, 'material': mat})
        color_table = [FIXED_PALETTE_HEX[i] for i in ranked]
        return pixels, color_table

    # 动态 KMeans 量化
    arr_f = arr.astype(float)
    km = KMeans(n_clusters=n_colors, random_state=42, n_init=10)
    labels = km.fit_predict(arr_f)
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

def generate_queue_group(pixels, color_table, n_lanes, params, rng, sync_lanes=False):
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
    # 预估总炮车数（用于计算爽感前段比例）
    est_total_tanks = sum(
        len(make_ammo_list(mat_px.get(m, 0), tmax, pref_pack))
        for m in avg_depth if mat_px.get(m, 0) > 0
    )
    # 关卡越短（炮车越少）前段比例越大：[5辆→40%, 30辆以上→25%]，线性插值
    warm_ratio = max(0.25, min(0.40, 0.40 - (est_total_tanks - 5) * (0.15 / 25)))
    n_colors   = len([m for m in avg_depth if mat_px.get(m, 0) > 0])
    # 前段颜色数（至少1种，最多留1种给后段）
    n_warm     = max(1, min(n_colors - 1, round(n_colors * warm_ratio)))

    # 浅→深顺序（爽感前段和 easy/medium 后段都用这个）
    easy_order = sorted(avg_depth.keys(), key=lambda m: avg_depth[m], reverse=False)
    # 后段顺序：mdir>0 深色先（逆序，Hard/VeryHard），否则浅色先
    hard_order = sorted(avg_depth.keys(), key=lambda m: avg_depth[m], reverse=(mdir > 0))
    warm_mats  = easy_order[:n_warm]
    warm_set   = set(warm_mats)
    hard_mats  = [m for m in hard_order if m not in warm_set]
    sorted_mats = warm_mats + hard_mats

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

    # ── 第二步：相邻颜色局部交错，保持颜色大组整体前后顺序 ────────────────────
    # 原全局 round-robin 会把后段深色提前，破坏 sorted_mats 难度设计。
    # 新策略：把 lane 内的炮车按颜色分组后，相邻两色之间做局部交错
    # （A1 B1 A2 B2），但不跨越更远的颜色组，保证颜色大组顺序不变。
    def local_interleave(items):
        from collections import defaultdict
        groups = defaultdict(list)
        for mat, ammo in items:
            groups[mat].append(ammo)
        order = list(dict.fromkeys(mat for mat, _ in items))
        if len(order) <= 1:
            return items
        # 相邻两色做 zip 交错，剩余尾巴直接追加
        result = []
        i = 0
        while i < len(order):
            if i + 1 < len(order):
                a, b = order[i], order[i+1]
                ga, gb = list(groups[a]), list(groups[b])
                # 交错取，短的先耗尽
                for j in range(max(len(ga), len(gb))):
                    if j < len(ga): result.append((a, ga[j]))
                    if j < len(gb): result.append((b, gb[j]))
                i += 2
            else:
                m = order[i]
                result.extend((m, ammo) for ammo in groups[m])
                i += 1
        return result

    lanes = [[] for _ in range(n_lanes)]
    tank_id = 1

    if sync_lanes:
        # ── 同步推进模式：所有 lane 按颜色批次齐头并进 ──────────────────────────
        # 把 lane_pending 里各 lane 的炮车按 sorted_mats 颜色顺序重新分批：
        # 第1批 = 所有 lane 中属于 sorted_mats[0] 的炮车（各 lane 各自的）
        # 第2批 = 所有 lane 中属于 sorted_mats[1] 的炮车，以此类推。
        # 同一批内仍保持 local_interleave 的相邻交错。
        color_rank = {m: i for i, m in enumerate(sorted_mats)}
        # 先 local_interleave 各 lane，再按批次重排
        scattered_lanes = [local_interleave(lane_pending[li]) for li in range(n_lanes)]
        # 按颜色批次分组：batch[rank] = {lane_i: [(mat,ammo),...]}
        from collections import defaultdict as _dd
        batches = defaultdict(_dd(list).__class__)  # rank → lane → list
        batches = [defaultdict(list) for _ in range(len(sorted_mats))]
        for li, items in enumerate(scattered_lanes):
            for mat, ammo in items:
                batches[color_rank[mat]][li].append((mat, ammo))
        # 按批次顺序组装：每批内所有 lane 的炮车交错写入各自 lane
        for batch in batches:
            if not batch:
                continue
            max_in_batch = max((len(v) for v in batch.values()), default=0)
            for step in range(max_in_batch):
                for li in range(n_lanes):
                    if step < len(batch[li]):
                        mat, ammo = batch[li][step]
                        lanes[li].append({'id': tank_id, 'ammo': int(ammo), 'material': mat})
                        tank_id += 1
    else:
        # ── 独立模式：每条 lane 内部各自局部交错 ────────────────────────────────
        for li in range(n_lanes):
            for mat, ammo in local_interleave(lane_pending[li]):
                lanes[li].append({'id': tank_id, 'ammo': int(ammo), 'material': mat})
                tank_id += 1

    return lanes, pixels  # pixels 已经过对齐，调用方需用返回值替换原始 pixels

# ═══════════════════════════════════════════════════════════════════════════════
# 仅重新生成炮车序列（供编辑器 API 调用，不重新量化图片）
# ═══════════════════════════════════════════════════════════════════════════════

def regen_queue(level_data, difficulty, n_lanes, slot, seed=42, sync_lanes=False):
    """
    接收完整的 levels2 JSON，只重新生成 QueueGroup，保持 PixelImageData 不变。
    返回更新后的 level_data（原地修改并返回）。
    """
    diff_key = difficulty.lower().replace(' ', '')
    params   = DIFFICULTY_PARAMS[diff_key]
    rng      = np.random.default_rng(seed)

    pixels     = list(level_data['PixelImageData']['pixels'])
    color_table= level_data['colorTable']

    queue_group, pixels = generate_queue_group(pixels, color_table, n_lanes, params, rng, sync_lanes=sync_lanes)

    level_data['QueueGroup']              = queue_group
    level_data['PixelImageData']['pixels']= pixels
    level_data['SlotCount']               = slot
    level_data['ConveyorLimit']           = slot
    level_data['Difficulty']              = {'easy':'Easy','medium':'Medium','hard':'Hard','veryhard':'Very Hard'}[diff_key]
    return level_data

# ═══════════════════════════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='FixelFlow 2 关卡自动生成器')
    parser.add_argument('image',       help='输入图片路径')
    parser.add_argument('output',      help='输出 JSON 路径')
    parser.add_argument('--lanes',          type=int,   default=3,        help='轨道数（默认3）')
    parser.add_argument('--difficulty',     type=str,   default='medium', help='easy/medium/hard/veryhard')
    parser.add_argument('--colors',         type=int,   default=0,        help='颜色数（0=自动）')
    parser.add_argument('--board',          type=int,   nargs=2,          default=[20, 20], metavar=('W','H'))
    parser.add_argument('--slot',           type=int,   default=5,        help='槽位数（默认5）')
    parser.add_argument('--seed',           type=int,   default=42)
    parser.add_argument('--fixed-palette',  action='store_true',          help='使用固定35色板（Lab最近邻，与pixel-tool一致）')
    parser.add_argument('--sync-lanes',     action='store_true',          help='同步推进模式：所有轨道按颜色批次齐头并进')
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

    use_fixed  = args.fixed_palette
    sync_lanes = args.sync_lanes
    print(f"图片：{args.image}")
    print(f"网格：{board_w}×{board_h}，颜色：{n_colors}，轨道：{args.lanes}，难度：{diff_key}"
          f"{'，固定色板' if use_fixed else ''}{'，同步推进' if sync_lanes else ''}")

    # 1. 图片量化
    pixels, color_table = quantize_image(args.image, board_w, board_h, n_colors, use_fixed_palette=use_fixed)
    print(f"量化完成：{len(pixels)} 像素，{len(color_table)} 色")

    # 2. 生成炮车队列（pixels 在内部做了整十对齐，需要接收返回值）
    queue_group, pixels = generate_queue_group(pixels, color_table, args.lanes, params, rng, sync_lanes=sync_lanes)

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
