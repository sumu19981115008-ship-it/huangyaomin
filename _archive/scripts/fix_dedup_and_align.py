import json
import os

LEVELS_DIR = os.path.join(os.path.dirname(__file__), 'levels')

def fix_level(data):
    pixel_entities = [e for e in data.get('entities', []) if e.get('type') == 'PixelBlock']
    if not pixel_entities:
        return False

    changed = False

    # 先去重：每个实体内部按坐标去重
    for entity in pixel_entities:
        seen = set()
        deduped = []
        for c in entity['cells']:
            key = (c['x'], c['y'])
            if key not in seen:
                seen.add(key)
                deduped.append(c)
        if len(deduped) != len(entity['cells']):
            entity['cells'] = deduped
            changed = True

    # 再对齐：方块总数 == 子弹总数
    total_blocks = sum(len(e['cells']) for e in pixel_entities)
    total_ammo = sum(t['ammo'] for t in data.get('initialTanks', []))

    if total_blocks == total_ammo:
        return changed

    diff = total_ammo - total_blocks

    if diff < 0:
        # 方块多于子弹，从后往前删
        to_remove = -diff
        for entity in reversed(pixel_entities):
            if to_remove <= 0:
                break
            cells = entity['cells']
            cut = min(to_remove, len(cells))
            entity['cells'] = cells[:-cut] if cut < len(cells) else []
            to_remove -= cut
    else:
        # 方块少于子弹，从第一个实体循环追加不重复坐标
        # 收集全局已用坐标
        used = set()
        for e in pixel_entities:
            for c in e['cells']:
                used.add((c['x'], c['y']))

        # 扩大搜索空间：从现有坐标的边界框向外延伸找空位
        all_coords = list(used)
        xs = [c[0] for c in all_coords]
        ys = [c[1] for c in all_coords]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)

        # 生成候补坐标（同行列扩展）
        candidates = []
        for x in range(max(0, x_min - 20), x_max + 21):
            for y in range(max(0, y_min - 20), y_max + 21):
                if (x, y) not in used:
                    candidates.append({'x': x, 'y': y})

        to_add = diff
        target_entity = pixel_entities[0]
        for coord in candidates:
            if to_add <= 0:
                break
            target_entity['cells'].append(coord)
            used.add((coord['x'], coord['y']))
            to_add -= 1

    return True

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
    dup_errors = []
    align_errors = []
    for fname in files:
        path = os.path.join(LEVELS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for e in data.get('entities', []):
            if e.get('type') != 'PixelBlock': continue
            coords = [(c['x'], c['y']) for c in e['cells']]
            if len(coords) != len(set(coords)):
                dup_errors.append(f'{fname} color={e["color"]}')
        blocks = sum(len(e['cells']) for e in data.get('entities', []) if e.get('type') == 'PixelBlock')
        ammo = sum(t['ammo'] for t in data.get('initialTanks', []))
        if blocks != ammo:
            align_errors.append(f'{fname}: 方块={blocks} 子弹={ammo}')

    if dup_errors:
        print(f'仍有重叠 {len(dup_errors)} 个实体：')
        for e in dup_errors: print(f'  {e}')
    else:
        print('重叠检查通过：无重复坐标')

    if align_errors:
        print(f'仍有数量不一致 {len(align_errors)} 个：')
        for e in align_errors: print(f'  {e}')
    else:
        print('数量对齐通过：所有关卡方块数 == 子弹数')

if __name__ == '__main__':
    main()
