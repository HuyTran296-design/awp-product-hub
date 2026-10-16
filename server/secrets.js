// AES-256-GCM encryption for connector credentials (.p8 keys, service-account JSON).
// Key: env AWP_SECRET_KEY (64 hex chars), else a generated file data/secret.key (mode 0600); an in-memory database
// (no data directory) gets a random key for the life of the process.
// Ciphertext stays in the database; API responses only expose "hasSecret"/file name.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function loadSecretKey(dataDir) {
  if (process.env.AWP_SECRET_KEY) return Buffer.from(process.env.AWP_SECRET_KEY, 'hex');
  if (!dataDir) return crypto.randomBytes(32);
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

export function encryptSecret(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(key, payload) {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
