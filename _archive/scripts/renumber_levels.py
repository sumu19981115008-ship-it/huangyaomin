import json
import os

LEVELS_DIR = os.path.join(os.path.dirname(__file__), 'levels')

# 找出所有关卡，按编号排序
files = sorted(
    [f for f in os.listdir(LEVELS_DIR) if f.startswith('level') and f.endswith('.json')],
    key=lambda f: int(f.replace('level', '').replace('.json', ''))
)

# 过滤掉空关卡（无 PixelBlock 实体的）
to_delete = []
remaining = []
for fname in files:
    path = os.path.join(LEVELS_DIR, fname)
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    has_blocks = any(e.get('type') == 'PixelBlock' for e in data.get('entities', []))
    if not has_blocks:
        to_delete.append(fname)
    else:
        remaining.append(fname)

print(f'删除空关卡 {len(to_delete)} 个：{to_delete}')
print(f'剩余关卡 {len(remaining)} 个，重新编号 1~{len(remaining)}')

# 删除空关卡
for fname in to_delete:
    os.remove(os.path.join(LEVELS_DIR, fname))

# 先重命名为临时名，避免冲突（如 level10 和新的 level10 冲突）
for i, fname in enumerate(remaining):
    os.rename(
        os.path.join(LEVELS_DIR, fname),
        os.path.join(LEVELS_DIR, f'_tmp_{i+1}.json')
    )

# 再从临时名重命名为最终名
for i in range(len(remaining)):
    os.rename(
        os.path.join(LEVELS_DIR, f'_tmp_{i+1}.json'),
        os.path.join(LEVELS_DIR, f'level{i+1}.json')
    )

print('完成，关卡已重新编号')
