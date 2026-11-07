// Preview builds: set the background scene tier in dist/config.json (default 'low'); config.json
// in the repo stays 'off'. With --demo it also switches on the pretend homeserver (src/preview-demo):
// previewDemo true, and the pretend server as the only homeserver. Usage:
//   node scripts/preview-config.js [tier] [--demo]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const tier = args.find((a) => !a.startsWith('--')) ?? 'low';
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.backgroundScene = { ...config.backgroundScene, tier };
if (demo) {
  config.previewDemo = true;
  config.defaultHomeserver = 0;
  config.homeserverList = ['demo.invalid'];
  config.allowCustomHomeservers = false;
  config.featuredCommunities = {
    openAsDefault: false,
    spaces: ['#gamecult:demo.invalid'],
    rooms: [],
    servers: ['demo.invalid'],
  };
}
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`${file}: backgroundScene.tier = ${tier}${demo ? ', previewDemo on' : ''}`);
