const y = require('js-yaml');
const f = require('fs');
const cp = require('child_process');
const path = require('path');

try {
  const configPath = path.join(__dirname, '..', 'config', 'server_config.yaml');
  const c = y.load(f.readFileSync(configPath, 'utf8'));
  
  const http_port = parseInt(c.http_port, 10);
  const save_port = c.save_port ? parseInt(c.save_port, 10) : http_port + 1;
  const sacn_port = c.sacn_port ? parseInt(c.sacn_port, 10) : http_port + 2;

  const ports = [http_port, save_port, sacn_port].filter(p => !isNaN(p));
  
  if (ports.length > 0) {
    console.log(`Killing ports: ${ports.join(', ')}`);
    try {
      // Use child_process to invoke npx kill-port across OS
      cp.execSync(`npx -y kill-port ${ports.join(' ')}`, { stdio: 'ignore' });
    } catch (e) {
      // Ignore errors, port might not be in use
    }
  }
} catch (e) {
  console.error("Warning: Failed to kill ports:", e.message);
}
