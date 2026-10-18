// مفتاح داخلي بين أجزاء السيرفر (كروم الرسم، وتشغيل مهام الطابور على Vercel).
// على Vercel لازم يكون ثابت بين كل الأجهزة → مشتق من أسرار البيئة؛ محلياً عشوائي لكل تشغيل.
import crypto from 'node:crypto';
import { cfg } from './config.js';

let tok = '';
export function internalToken() {
  if (!tok) tok = process.env.VERCEL
    ? crypto.createHmac('sha256', `${cfg.sessionSecret}|${process.env.BLOB_READ_WRITE_TOKEN || ''}|${cfg.appPassword}`).update('internal-v1').digest('hex')
    : crypto.randomBytes(24).toString('hex');
  return tok;
}
