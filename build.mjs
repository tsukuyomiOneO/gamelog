// Сборка сайта. Копирует статические файлы в dist/ и создаёт config.js из переменных окружения.
// Так один и тот же код работает на тестовом и боевом стенде с разными базами.
//
// Переменные:
//   SUPABASE_URL        адрес проекта Supabase (обязательно)
//   SUPABASE_ANON_KEY   публичный ключ anon или publishable (обязательно)
//   GOOGLE_LOGIN        "true", чтобы показать вход через Google (по желанию)
//   APP_ENV             "production" или любое другое имя стенда; по умолчанию берётся
//                       из CONTEXT Netlify (production, deploy-preview, branch-deploy)

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const env = process.env;
const url = (env.SUPABASE_URL || '').trim();
const key = (env.SUPABASE_ANON_KEY || '').trim();

function fail(msg) {
  console.error('Ошибка сборки: ' + msg);
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) fail('SUPABASE_URL должен выглядеть как https://xxxx.supabase.co');
if (!key) fail('не задан SUPABASE_ANON_KEY');

// Защита от случайной утечки секретного ключа в публичный сайт
function jwtRole(k) {
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role; } catch { return null; }
}
if (jwtRole(key) === 'service_role' || key.startsWith('sb_secret_')) {
  fail('в SUPABASE_ANON_KEY указан секретный ключ. Нужен публичный (anon или publishable).');
}

const appEnv = (env.APP_ENV || env.CONTEXT || 'production').trim();

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of ['index.html', 'styles.css', 'app.js', 'theme.js', 'favicon.svg', '_headers']) {
  cpSync(f, 'dist/' + f);
}

const config = {
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: key,
  GOOGLE_LOGIN: env.GOOGLE_LOGIN === 'true',
  APP_ENV: appEnv
};
writeFileSync('dist/config.js', 'window.QUESTLOG_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');

console.log('Сборка готова: dist/ (стенд: ' + appEnv + ', проект: ' + url + ')');
