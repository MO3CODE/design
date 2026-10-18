// بعد بناء الواجهة: ننسخ المحرك (slide.html + الأصول) لـ web/dist/engine عشان Vercel يخدمها من الـ CDN مباشرة
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web', 'dist', 'engine');

function copyDir(src, dst) {   // نسخ يدوي (fs.cpSync ينهار على ويندوز مع المسارات العربية)
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'engine', 'slide.html'), path.join(out, 'slide.html'));
copyDir(path.join(root, 'engine', 'assets'), path.join(out, 'assets'));
console.log('engine → web/dist/engine ✓');
