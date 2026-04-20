#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 converted_levels.js 拆分为 game2/levels/levelN.json
converted_levels.js 格式：
  { boardWidth, boardHeight, blocks:[{x,y,color}...], turrets:[{color,ammo,lane}...] }
目标格式（与原 game/public/levels/ 一致）：
  { boardWidth, boardHeight, boardSize, numberOfLanes,
    entities:[{type:"PixelBlock", color, cells:[{x,y}...]}...],
    initialTanks:[{color,ammo,lane,position,...}...] }
"""

import re, json, os, ast

SRC  = r"D:\fixelflow\game\converted_levels.js"
DEST = r"D:\fixelflow\game2\levels"
# 原来 levels/1-8 已存在，converted_levels 从第 9 关开始编号
START_IDX = 9

def parse_js_array(text):
    # 去掉头尾注释和 const CONVERTED_LEVELS = [...];
    text = re.sub(r'//[^\n]*', '', text)               # 去行注释
    text = re.sub(r'^.*?=\s*\[', '[', text, flags=re.DOTALL)  # 去 const ... =
    text = re.sub(r'\];?\s*$', ']', text, flags=re.DOTALL)    # 去结尾 ];
    # 给无引号的 key 加引号
    text = re.sub(r'(\b)([a-zA-Z_]\w*)(\s*:)', r'"\2"\3', text)
    # 修复尾随逗号
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return json.loads(text)

def convert_level(raw):
    bw = raw.get("boardWidth",  20)
    bh = raw.get("boardHeight", 20)

    # blocks → entities（按颜色分组）
    color_cells = {}
    for b in raw.get("blocks", []):
        c = b["color"].upper()
        color_cells.setdefault(c, []).append({"x": b["x"], "y": b["y"]})

    entities = [
        {"type": "PixelBlock", "color": color, "cells": cells}
        for color, cells in color_cells.items()
    ]

    # turrets → initialTanks（按 lane 内出现顺序确定 position）
    lane_pos = {}
    tanks = []
    for t in raw.get("turrets", []):
        lane = t.get("lane", 0)
        pos  = lane_pos.get(lane, 0)
        lane_pos[lane] = pos + 1
        tanks.append({
            "color": t["color"].upper(),
            "ammo":  t["ammo"],
            "lane":  lane,
            "position": pos,
            "isLinked": False, "linkedGroupId": -1,
            "isMystery": False, "isLock": False,
            "stoneData": {"amount": 0}, "isHammer": False,
        })

    num_lanes = max((t["lane"] for t in tanks), default=0) + 1

    return {
        "boardWidth":  bw,
        "boardHeight": bh,
        "boardSize":   max(bw, bh),
        "numberOfLanes": num_lanes,
        "entities":     entities,
        "initialTanks": tanks,
        "shooterPipes": [],
        "maxTanksOnConveyor": 5,
    }

def main():
    os.makedirs(DEST, exist_ok=True)

    print("读取 converted_levels.js ...")
    with open(SRC, "r", encoding="utf-8") as f:
        raw_text = f.read()

    print("解析 JS 数组 ...")
    try:
        levels = parse_js_array(raw_text)
    except Exception as e:
        print(f"解析失败：{e}")
        return

    print(f"共 {len(levels)} 个关卡，从 level{START_IDX}.json 开始写入 ...")
    for i, raw in enumerate(levels):
        idx = START_IDX + i
        out = convert_level(raw)
        path = os.path.join(DEST, f"level{idx}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    total = START_IDX - 1 + len(levels)
    print(f"完成！levels/ 共 {total} 个关卡（level1 ~ level{total}）")

if __name__ == "__main__":
    main()
