// Настройки подключения. Эти значения публичные по замыслу Supabase:
// ключ anon безопасен в браузере, пока включены правила доступа (RLS) из supabase/schema.sql.
// НИКОГДА не вставляйте сюда ключ service_role.
// Для локальной проверки скопируйте этот файл в config.js (он в .gitignore).
// На стендах config.js создаёт сборка (build.mjs) из переменных окружения.
window.QUESTLOG_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  // Включите после настройки Google в Supabase (Authentication -> Providers -> Google)
  GOOGLE_LOGIN: false,
  APP_ENV: 'local'
};
