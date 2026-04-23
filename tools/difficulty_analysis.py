import json, os, re, math
from collections import defaultdict, deque
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import classification_report, silhouette_score

# ── 目录配置 ─────────────────────────────────────────────────────────────────
DIRS = {
    'A': r'D:/fixelflow/game2/levels_a2',
    'B': r'D:/fixelflow/game2/levels_b2',
}

# ── 工具函数 ──────────────────────────────────────────────────────────────────

def hex_to_lab(hex_str):
    h = hex_str.lstrip('#')
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    r, g, b = [int(h[i:i+2], 16)/255.0 for i in (0, 2, 4)]
    def lin(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
    r, g, b = lin(r), lin(g), lin(b)
    X = r*0.4124 + g*0.3576 + b*0.1805
    Y = r*0.2126 + g*0.7152 + b*0.0722
    Z = r*0.0193 + g*0.1192 + b*0.9505
    def f(t): return t**(1/3) if t > 0.008856 else 7.787*t + 16/116
    L = 116*f(Y/1.0) - 16
    a = 500*(f(X/0.9505) - f(Y/1.0))
    b_ = 200*(f(Y/1.0) - f(Z/1.0888))
    return (L, a, b_)

def color_distance(h1, h2):
    L1,a1,b1 = hex_to_lab(h1)
    L2,a2,b2 = hex_to_lab(h2)
    return math.sqrt((L1-L2)**2 + (a1-a2)**2 + (b1-b2)**2)

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

def spearman_corr(xs, ys):
    n = len(xs)
    if n < 2: return 0.0
    def rank(arr):
        si = sorted(range(n), key=lambda i: arr[i])
        r = [0]*n
        for rv, idx in enumerate(si): r[idx] = rv + 1
        return r
    rx, ry = rank(xs), rank(ys)
    d2 = sum((rx[i]-ry[i])**2 for i in range(n))
    return 1 - 6*d2 / (n*(n**2-1))

# ── 特征提取 ──────────────────────────────────────────────────────────────────

def extract_features(d):
    qg     = d.get('QueueGroup', [])
    ct     = d.get('colorTable', [])
    pid    = d.get('PixelImageData', {})
    pixels = pid.get('pixels', [])
    bw     = d.get('boardWidth', 20)
    bh     = d.get('boardHeight', 20)

    tanks      = [t for lane in qg for t in lane]
    num_tanks  = len(tanks)
    num_lanes  = len(qg)
    total_ammo = sum(t.get('ammo', 0) for t in tanks)
    total_px   = len(pixels)

    # F1: 时序错配（Spearman 取反，越正越难）
    depth_map = bfs_exposure_depth(pixels, bw, bh)
    mat_depth = defaultdict(list)
    for p in pixels:
        mat_depth[p['material']].append(depth_map.get((p['x'], p['y']), 0))
    avg_depth = {m: sum(v)/len(v) for m, v in mat_depth.items()}
    mat_queue_pos = {}
    pos = 0
    for lane in qg:
        for t in lane:
            m = t['material']
            if m not in mat_queue_pos:
                mat_queue_pos[m] = pos
            pos += 1
    shared = [m for m in avg_depth if m in mat_queue_pos]
    if len(shared) >= 2:
        f1 = -spearman_corr([avg_depth[m] for m in shared], [mat_queue_pos[m] for m in shared])
    else:
        f1 = 0.0

    # F2: 槽位饱和率
    slot_count = d.get('SlotCount', 5)
    max_len = max((len(lane) for lane in qg), default=0)
    interleaved = []
    for i in range(max_len):
        for lane in qg:
            if i < len(lane):
                interleaved.append(lane[i])
    slot = []
    full_steps = total_steps = 0
    for t in interleaved:
        if len(slot) >= slot_count:
            slot.pop(0)
        slot.append(t)
        total_steps += 1
        if len(slot) >= slot_count:
            full_steps += 1
    f2 = full_steps / total_steps if total_steps else 0.0

    # F3: 颜色调度复杂度
    mat_lanes = defaultdict(set)
    for li, lane in enumerate(qg):
        for t in lane: mat_lanes[t['material']].add(li)
    f3 = sum(len(v) for v in mat_lanes.values()) / (len(ct) * num_lanes) if (num_lanes > 0 and ct) else 0.0

    # F4: 弹药宽裕惩罚
    f4 = max(0, total_ammo - total_px) / total_px if total_px else 0.0

    # F5: 颜色感知混淆度
    cp = vp = 0
    for i in range(len(ct)):
        for j in range(i+1, len(ct)):
            try:
                vp += 1
                if color_distance(ct[i], ct[j]) < 50: cp += 1
            except Exception: pass
    f5 = cp / max(1, vp)

    return {
        'f1': f1,
        'f2': f2,
        'f3': f3,
        'f4': f4,
        'f5': f5,
        'num_tanks':  num_tanks,
        'num_lanes':  num_lanes,
        'avg_ammo':   total_ammo / num_tanks if num_tanks else 0,
        'num_colors': len(ct),
        'total_px':   total_px,
    }

# ── 加载所有关卡 ──────────────────────────────────────────────────────────────

DIFF_ORDER = {'Easy': 0, 'Medium': 1, 'Hard': 2, 'Very Hard': 3}
DIFF_NAMES = ['Easy', 'Medium', 'Hard', 'VeryHard']

all_rows = []
for group, DIR in DIRS.items():
    if not os.path.isdir(DIR):
        print(f"跳过（目录不存在）：{DIR}")
        continue
    files = sorted(
        [f for f in os.listdir(DIR) if re.match(r'^level\d+\.json$', f)],
        key=lambda f: int(re.search(r'\d+', f).group())
    )
    for fname in files:
        with open(os.path.join(DIR, fname), encoding='utf-8') as fh:
            d = json.load(fh)
        diff = d.get('Difficulty', '?')
        feats = extract_features(d)
        feats['level'] = int(re.search(r'\d+', fname).group())
        feats['group'] = group
        feats['diff']  = diff
        feats['diff_num'] = DIFF_ORDER.get(diff, -1)
        all_rows.append(feats)

print(f"总关卡：{len(all_rows)}  (A组：{sum(1 for r in all_rows if r['group']=='A')}  B组：{sum(1 for r in all_rows if r['group']=='B')})")

# ── 段一：A 组 vs B 组特征均值对比 ──────────────────────────────────────────

feat_keys   = ['f1','f2','f3','f4','f5','num_tanks','num_lanes','avg_ammo','num_colors','total_px']
feat_labels = ['F1时序错配','F2槽位压力','F3调度熵','F4宽裕惩罚','F5混淆度','炮车数','队列数','均弹/车','颜色数','像素数']

print("\n====== A 组 vs B 组 整体特征对比 ======")
print(f"{'特征':<12}  {'A组均值':>10}  {'B组均值':>10}  {'差值':>10}")
print("-"*46)
for fk, fl in zip(feat_keys, feat_labels):
    av = [r[fk] for r in all_rows if r['group']=='A']
    bv = [r[fk] for r in all_rows if r['group']=='B']
    am = sum(av)/len(av) if av else 0
    bm = sum(bv)/len(bv) if bv else 0
    print(f"{fl:<12}  {am:>10.3f}  {bm:>10.3f}  {bm-am:>+10.3f}")

# ── 段二：B 组有标注难度 → 回归 ──────────────────────────────────────────────

b_labeled = [r for r in all_rows if r['group']=='B' and r['diff_num'] >= 0]
print(f"\n====== B 组监督回归（{len(b_labeled)} 关）======")

Xb = np.array([[r[k] for k in feat_keys] for r in b_labeled])
yb = np.array([r['diff_num'] for r in b_labeled])

scaler_b = StandardScaler()
Xbs = scaler_b.fit_transform(Xb)
clf_b = LogisticRegression(max_iter=2000, C=1.0)
clf_b.fit(Xbs, yb)
yb_pred = clf_b.predict(Xbs)

print(classification_report(yb, yb_pred, target_names=['Easy','Medium','Hard','VeryHard'], zero_division=0))

print("特征重要性（Hard+VH vs Easy+Med）：")
coef = clf_b.coef_
importance = coef[2] + coef[3] - coef[0] - coef[1]
order = np.argsort(-importance)
for i in order:
    bar = "#" * max(1, int(abs(importance[i]) * 6))
    sign = "+" if importance[i] > 0 else "-"
    print(f"  {feat_labels[i]:<12} {sign}{abs(importance[i]):.3f}  {bar}")

# ── 段三：用 B 组回归模型给 A 组打难度分 ────────────────────────────────────

print("\n====== 用 B 组模型对 A 组 300 关打分 ======")
Xa = np.array([[r[k] for k in feat_keys] for r in all_rows if r['group']=='A'])
Xas = scaler_b.transform(Xa)
ya_pred = clf_b.predict(Xas)
ya_prob  = clf_b.predict_proba(Xas)
ya_score = ya_prob @ np.array([0, 1, 2, 3])

a_rows = [r for r in all_rows if r['group']=='A']
from collections import Counter
pred_dist = Counter(DIFF_NAMES[p] for p in ya_pred)
print(f"预测分布：{dict(pred_dist)}")

print(f"\n{'关卡':<7} {'预测难度':<12} {'难度分':>6}  {'炮车':>5}  {'F1错配':>7}  {'F2槽位':>7}  {'F3调度':>7}")
print("-"*62)
for i, r in enumerate(a_rows):
    pred_name = DIFF_NAMES[ya_pred[i]]
    print(f"L{r['level']:<5} {pred_name:<12} {ya_score[i]:>6.2f}  {r['num_tanks']:>5}  {r['f1']:>7.3f}  {r['f2']:>7.3f}  {r['f3']:>7.3f}")

# ── 段四：300 关合并 K-Means 聚类（无监督） ──────────────────────────────────

print("\n====== 全 468 关 K-Means 聚类（k=4）======")
Xall = np.array([[r[k] for k in feat_keys] for r in all_rows])
scaler_all = StandardScaler()
Xalls = scaler_all.fit_transform(Xall)

km = KMeans(n_clusters=4, random_state=42, n_init=20)
labels = km.fit_predict(Xalls)
sil = silhouette_score(Xalls, labels)
print(f"轮廓系数：{sil:.3f}  （0.2+ 有意义，0.5+ 较好）")

# 聚类中心特征均值
print("\n各聚类中心（原始尺度）：")
centers_orig = scaler_all.inverse_transform(km.cluster_centers_)
print(f"{'聚类':<5}", end="")
for fl in feat_labels: print(f"  {fl[:5]:>7}", end="")
print()
for c in range(4):
    print(f"C{c}   ", end="")
    for v in centers_orig[c]: print(f"  {v:>7.2f}", end="")
    print()

# 每个聚类里 B 组的难度标签分布
print("\n各聚类 B 组难度标签分布：")
for c in range(4):
    b_in_c = [all_rows[i]['diff'] for i in range(len(all_rows))
               if labels[i]==c and all_rows[i]['group']=='B']
    cnt = Counter(b_in_c)
    total = len(b_in_c)
    a_in_c = sum(1 for i in range(len(all_rows)) if labels[i]==c and all_rows[i]['group']=='A')
    print(f"  C{c}: B组{total}关 {dict(cnt)}  |  A组{a_in_c}关")
