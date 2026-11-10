// Copies the pose catalogue and the art it names from the cast-art directory.
// The catalogue is the only list of poses the client knows; the art is not committed.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2] ?? '/opt/commons/cast-art/poses';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(readFileSync(join(src, 'catalogue.json'), 'utf8'));

copyFileSync(
  join(src, 'catalogue.json'),
  join(root, 'src/app/components/message/pose/catalogue.json')
);
const files = Object.values(catalogue.minds).flatMap((m) => [
  ...Object.values(m.shared),
  ...Object.values(m.signatures),
]);
files.forEach((f) => {
  const dest = join(root, 'public/poses', f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(src, f), dest);
});
console.log(`synced catalogue and ${files.length} images from ${src}`);
