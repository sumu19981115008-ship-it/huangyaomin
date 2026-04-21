import json
import os

LEVELS_DIR = os.path.join(os.path.dirname(__file__), 'levels')

def fix_level(data):
    pixel_entities = [e for e in data.get('entities', []) if e.get('type') == 'PixelBlock']
    if not pixel_entities:
        return False

    total_blocks = sum(len(e['cells']) for e in pixel_entities)
    total_ammo = sum(t['ammo'] for t in data.get('initialTanks', []))

    if total_blocks == total_ammo:
        return False

    diff = total_ammo - total_blocks

    if diff < 0:
        # 方块多于子弹，从后往前跨实体删除
        to_remove = -diff
        for entity in reversed(pixel_entities):
            if to_remove <= 0:
                break
            cells = entity['cells']
            cut = min(to_remove, len(cells))
            entity['cells'] = cells[:-cut] if cut < len(cells) else []
            to_remove -= cut
    else:
        # 方块少于子弹，循环复制现有 cells 补齐
        # 收集所有现有 cells（带实体引用）
        all_cells = [(e, c) for e in pixel_entities for c in e['cells']]
        to_add = diff
        i = 0
        while to_add > 0:
            src_entity, src_cell = all_cells[i % len(all_cells)]
            src_entity['cells'].append(dict(src_cell))
            to_add -= 1
            i += 1

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
    errors = []
    for fname in files:
        path = os.path.join(LEVELS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        blocks = sum(len(e['cells']) for e in data.get('entities', []) if e.get('type') == 'PixelBlock')
        ammo = sum(t['ammo'] for t in data.get('initialTanks', []))
        if blocks != ammo:
            errors.append(f'{fname}: 方块={blocks} 子弹={ammo}')

    if errors:
        print(f'验证失败 {len(errors)} 个：')
        for e in errors: print(f'  {e}')
    else:
        print('验证通过：所有关卡方块数 == 子弹数')

if __name__ == '__main__':
    main()
