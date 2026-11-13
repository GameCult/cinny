// Preview builds: set the background scene tier in dist/config.json (default 'low'); config.json
// in the repo is the live chat.gamecult.org config (style ridge), and previews pin the style too, ridge unless
// given. Previews are static directories with no SPA fallback, so they also switch
// to the hash router: a reload on /login/matrix.org would otherwise be an nginx 404. With --demo it
// also switches on the pretend homeserver (src/preview-demo): previewDemo true, and the pretend
// server as the only homeserver. Usage:
//   node scripts/preview-config.js [tier] [style] [--demo]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const [tier = 'low', style = 'ridge'] = args.filter((a) => !a.startsWith('--'));
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'config.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.hashRouter = { enabled: true, basename: '/' };
config.backgroundScene = { ...config.backgroundScene, tier, style };
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
console.log(
  `${file}: backgroundScene.tier = ${tier}, style = ${style}${demo ? ', previewDemo on' : ''}`
);
