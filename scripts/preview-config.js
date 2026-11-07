// Preview builds: set the background scene tier in dist/config.json (default 'low'); config.json
// in the repo stays 'off'. Usage: node scripts/preview-config.js [tier] [style]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const tier = process.argv[2] ?? 'low';
const style = process.argv[3];
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.backgroundScene = { ...config.backgroundScene, tier, ...(style ? { style } : {}) };
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`${file}: backgroundScene.tier = ${tier}${style ? `, style = ${style}` : ''}`);
