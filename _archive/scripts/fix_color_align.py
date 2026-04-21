import json
import os
from collections import defaultdict

LEVELS_DIR = os.path.join(os.path.dirname(__file__), 'levels')

def fix_level(data):
    pixel_entities = [e for e in data.get('entities', []) if e.get('type') == 'PixelBlock']
    if not pixel_entities:
        return False

    # 统计每种颜色的方块数和子弹数
    block_by_color = defaultdict(list)  # color -> [(entity, cell_index), ...]
    for e in pixel_entities:
        color = e['color'].upper()
        for c in e['cells']:
            block_by_color[color].append((e, c))

    ammo_by_color = defaultdict(int)
    for t in data.get('initialTanks', []):
        color = t['color'].upper()
        ammo_by_color[color] += t['ammo']

    # 收集全局已用坐标
    used = set()
    for e in pixel_entities:
        for c in e['cells']:
            used.add((c['x'], c['y']))

    changed = False
    all_colors = set(block_by_color) | set(ammo_by_color)

    for color in all_colors:
        blocks = block_by_color[color]
        ammo = ammo_by_color[color]
        diff = len(blocks) - ammo

        if diff == 0:
            continue

        changed = True

        if diff > 0:
            # 方块多于子弹，删除多余的（从列表末尾删）
            to_remove = blocks[ammo:]  # 保留前 ammo 个，删后面的
            for e, c in to_remove:
                e['cells'].remove(c)
                used.discard((c['x'], c['y']))

        else:
            # 方块少于子弹，找该颜色对应的实体补坐标（不存在则新建）
            target_entity = next((e for e in pixel_entities if e['color'].upper() == color), None)
            if target_entity is None:
                target_entity = {'type': 'PixelBlock', 'color': color, 'cells': [], 'pixelCount': 0, 'colorRanges': []}
                data['entities'].append(target_entity)
                pixel_entities.append(target_entity)

            # 计算现有方块的边界框用于生成候补坐标
            all_coords = list(used)
            if all_coords:
                xs = [c[0] for c in all_coords]
                ys = [c[1] for c in all_coords]
                x_min, x_max = max(0, min(xs) - 20), max(xs) + 21
                y_min, y_max = max(0, min(ys) - 20), max(ys) + 21
            else:
                x_min, x_max, y_min, y_max = 0, 40, 0, 40

            to_add = -diff
            for x in range(x_min, x_max):
                if to_add <= 0:
                    break
                for y in range(y_min, y_max):
                    if to_add <= 0:
                        break
                    if (x, y) not in used:
                        target_entity['cells'].append({'x': x, 'y': y})
                        used.add((x, y))
                        to_add -= 1

    return changed

def main():
    files = sorted(
        [f for f in os.listdir(LEVELS_DIR) if f.startswith('level') and f.endswith('.json')],
        key=lambda f: int(f.replace('level', '').replace('.json', ''))
    )

    modified = []
    for fname in files:
        path = os.path.join(LEVELS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if fix_level(data):
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            modified.append(fname)

    print(f'共修改 {len(modified)} 个关卡')

    # 验证
    errors = []
    for fname in files:
        path = os.path.join(LEVELS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        bc = defaultdict(int)
        for e in data.get('entities', []):
            if e.get('type') != 'PixelBlock': continue
            for c in e['cells']:
                bc[e['color'].upper()] += 1
        ac = defaultdict(int)
        for t in data.get('initialTanks', []):
            ac[t['color'].upper()] += t['ammo']
        for color in set(bc) | set(ac):
            if bc[color] != ac[color]:
                errors.append(f'{fname} {color}: 方块={bc[color]} 子弹={ac[color]}')

    if errors:
        print(f'仍有不一致 {len(errors)} 处：')
        for e in errors[:20]: print(f'  {e}')
    else:
        print('验证通过：所有关卡每种颜色方块数 == 子弹数')

if __name__ == '__main__':
    main()
