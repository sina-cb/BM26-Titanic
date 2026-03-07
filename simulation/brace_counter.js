const fs = require('fs');
const lines = fs.readFileSync('Iceberg.js', 'utf8').split('\n');

let depth = 0;
lines.forEach((line, i) => {
  const opens = (line.match(/{/g) || []).length;
  const closes = (line.match(/}/g) || []).length;
  depth += opens - closes;
  if (depth < 0) {
    console.log(`Bracket imbalance at line ${i + 1}: ${line.trim()} (Depth: ${depth})`);
  }
});
console.log(`Final Depth: ${depth}`);
