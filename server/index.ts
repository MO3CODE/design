// تشغيل محلي: node/tsx server/index.ts — نفس التطبيق اللي يشتغل على Vercel (server/app.ts)
import { cfg } from './config.js';
import { app } from './app.js';
import { getSettings, loadSettings } from './settings.js';
import { checkCutout } from './photos.js';
import { closeRenderer } from './render.js';
import { resetStaleStates } from './jobs.js';

resetStaleStates().catch(() => {});
const server = app.listen(cfg.port, async () => {
  await loadSettings(0).catch(() => {});
  const s = getSettings();
  console.log(`\n  استوديو بوابة المستثمر  →  http://localhost:${cfg.port}`);
  console.log(`  AI: ${s.provider} ${(s.provider === 'anthropic' ? s.anthropicKey : s.radoxKey) ? '✓' : '✗ (أضف المفتاح من الإعدادات)'} · التوجيه: ${s.routing}`);
  checkCutout().then(ok => console.log(`  قص الخلفية (rembg): ${ok ? '✓' : '✗ — ارفع الأصول PNG مقصوصة'}\n`));
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await closeRenderer(); server.close(); process.exit(0); });
