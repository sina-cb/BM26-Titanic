const fs = require('fs');
const acorn = require('acorn');

try {
  const code = fs.readFileSync('Iceberg.js', 'utf8');
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  console.log("No syntax errors found!");
} catch (e) {
  console.error("Syntax Error found in Iceberg.js at:");
  console.error(e.message);
}
