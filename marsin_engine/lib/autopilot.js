import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'config.yaml');

export class Autopilot {
  constructor(listPatternsFn, patternsDir, currentPatternCb, changePatternFn) {
    this.listPatterns = listPatternsFn;
    this.patternsDir = patternsDir;
    this.currentPatternCb = currentPatternCb;
    this.changePattern = changePatternFn;
    this.timer = null;
    this.config = this.loadConfig();
    
    if (!this.config.playlist) {
      this.config.playlist = {
        active: false,
        delay_s: "30",
        shuffle: false
      };
      this.saveConfig();
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
      }
    } catch(e) {}
    return {};
  }

  saveConfig() {
    try {
       fs.writeFileSync(CONFIG_FILE, yaml.dump(this.config));
    } catch(e) {}
  }

  get state() {
    return this.config.playlist || { active: false, delay_s: "30", shuffle: false };
  }

  updateState(newState) {
    if (!this.config.playlist) this.config.playlist = {};
    if (newState.active !== undefined) this.config.playlist.active = newState.active;
    if (newState.delay_s !== undefined) this.config.playlist.delay_s = newState.delay_s.toString();
    if (newState.shuffle !== undefined) this.config.playlist.shuffle = newState.shuffle;
    this.saveConfig();
    this.syncLoop();
  }

  syncLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const st = this.state;
    if (st.active) {
       const delayMs = (parseInt(st.delay_s, 10) || 30) * 1000;
       this.timer = setInterval(() => {
          this.triggerNext();
       }, delayMs);
    }
  }

  start() {
    this.syncLoop();
  }

  triggerNext() {
     const patterns = this.listPatterns(this.patternsDir);
     if (patterns.length === 0) return;
     const st = this.state;
     const active = this.currentPatternCb();
     let nextName = patterns[0];
     
     if (st.shuffle) {
        const others = patterns.filter(p => p !== active);
        nextName = others.length ? others[Math.floor(Math.random() * others.length)] : patterns[0];
     } else {
        const idx = patterns.indexOf(active);
        const nextIdx = (idx + 1) % patterns.length;
        nextName = patterns[nextIdx];
     }

     this.changePattern(nextName);
  }
}
