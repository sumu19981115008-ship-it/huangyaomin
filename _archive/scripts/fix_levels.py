import json
import os
import math

LEVELS_DIR = os.path.join(os.path.dirname(__file__), 'levels')

def fix_level(data):
    changed = False

    # 修复炮车弹药：向下取整到整十，最低10发
    for tank in data.get('initialTanks', []):
        ammo = tank['ammo']
        new_ammo = max(10, (ammo // 10) * 10)
        if new_ammo != ammo:
            tank['ammo'] = new_ammo
            changed = True

    # 统计方块总数
    total = sum(len(e['cells']) for e in data.get('entities', []) if e.get('type') == 'PixelBlock')
    remainder = total % 10
    if remainder != 0:
        # 需要删掉 remainder 个方块（从后往前跨实体删除）
        to_remove = remainder
        entities = [e for e in data.get('entities', []) if e.get('type') == 'PixelBlock']
        for entity in reversed(entities):
            if to_remove <= 0:
                break
            cells = entity['cells']
            cut = min(to_remove, len(cells))
            entity['cells'] = cells[:-cut] if cut < len(cells) else []
            to_remove -= cut
        changed = True

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

        changed = fix_level(data)
        if changed:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            modified.append(fname)

    print(f'共修改 {len(modified)} 个关卡：')
    for f in modified:
        print(f'  {f}')

if __name__ == '__main__':
    main()
