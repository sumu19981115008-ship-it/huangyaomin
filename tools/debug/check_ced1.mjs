import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('d:/fixelflow/game2/levels_a2/level100.json','utf8'));
const {colorTable, boardWidth:W, boardHeight:H, PixelImageData} = data;
const grid = Array.from({length:H},()=>Array(W).fill(null));
for(const p of PixelImageData.pixels) grid[p.y][p.x] = colorTable[p.material];

const TARGET = '#00CED1';
let blocks = [];
for(let r=0;r<H;r++) for(let c=0;c<W;c++) if(grid[r][c]===TARGET) blocks.push({r,c});
console.log(`${TARGET} 总方块数: ${blocks.length}`);
console.log('前5个坐标:', blocks.slice(0,5));

// 逐边检查是否出现在外层
console.log('\nBOTTOM 边（各列从下往上第一个）:');
for(let col=0;col<W;col++){
  for(let row=H-1;row>=0;row--){
    if(grid[row][col]!=null){ if(grid[row][col]===TARGET) console.log(`  col=${col} row=${row}`); break; }
  }
}
console.log('TOP 边（各列从上往下第一个）:');
for(let col=0;col<W;col++){
  for(let row=0;row<H;row++){
    if(grid[row][col]!=null){ if(grid[row][col]===TARGET) console.log(`  col=${col} row=${row}`); break; }
  }
}
console.log('RIGHT 边（各行从右往左第一个）:');
for(let row=0;row<H;row++){
  for(let col=W-1;col>=0;col--){
    if(grid[row][col]!=null){ if(grid[row][col]===TARGET) console.log(`  row=${row} col=${col}`); break; }
  }
}
console.log('LEFT 边（各行从左往右第一个）:');
for(let row=0;row<H;row++){
  for(let col=0;col<W;col++){
    if(grid[row][col]!=null){ if(grid[row][col]===TARGET) console.log(`  row=${row} col=${col}`); break; }
  }
}
