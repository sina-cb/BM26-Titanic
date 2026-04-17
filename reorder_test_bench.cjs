const fs = require('fs');

function reorder() {
  let t = fs.readFileSync('marsin_engine/models/test_bench.js', 'utf8');
  let lines = t.split('\n');
  let p4 = -1, vS = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("name: 'Par 4")) p4 = i;
    if (lines[i].includes("name: 'Vintage Left") && vS === -1) vS = i;
  }
  
  if (p4 !== -1 && vS !== -1) {
    let el = lines.splice(p4, 1)[0];
    lines.splice(vS, 0, el);
    
    let c = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('{ i: ')) {
        lines[i] = lines[i].replace(/{ i: \d+,/, '{ i: ' + c + ',');
        c++;
      }
    }
    fs.writeFileSync('marsin_engine/models/test_bench.js', lines.join('\n'));
    console.log('Fixed test_bench.js');
  } else {
    console.log('Target lines not found in file');
  }
}

reorder();
