// Помощник установки. Проводит через все шаги и объясняет, что происходит.
// Запуск: npm run setup
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const rootDir = fileURLToPath(root); // на Windows URL.pathname даёт /C:/... — так безопаснее
const TOML = new URL('wrangler.toml', root);

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  acc: (s) => `\x1b[36m${s}\x1b[0m`,
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(`\n${c.acc('?')} ${q}\n  > `)).trim();
const pause = (q = 'Нажми Enter, когда будет готово') => rl.question(`\n${c.dim(q)} `);

let step = 0;
const title = (t, explain) => {
  console.log(`\n${c.b(`━━ Шаг ${++step}. ${t}`)}`);
  if (explain) console.log(c.dim(`   ${explain}`));
};
const die = (msg, hint) => {
  console.log(`\n${c.err('✖ ' + msg)}`);
  if (hint) console.log(c.dim(`  ${hint}`));
  rl.close();
  process.exit(1);
};

const isWin = process.platform === 'win32';

/** Запуск wrangler. interactive=true — когда команда может спросить что-то сама. */
function wr(args, { interactive = false, input } = {}) {
  const r = spawnSync('npx', ['--yes', 'wrangler', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: isWin,
    input,
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (!interactive && out.trim()) console.log(c.dim(out.trim().split('\n').map((l) => '   ' + l).join('\n')));
  return { code: r.status, out };
}

const readToml = () => readFileSync(TOML, 'utf8');
const writeToml = (s) => writeFileSync(TOML, s);

// ——————————————————————————————————————————————

console.log(c.b('\n🫁 Breathe — установка бота'));
console.log(c.dim('Я задам несколько вопросов и всё настрою сам. Займёт минут 15.'));
console.log(c.dim('Если что-то пойдёт не так — просто запусти этот помощник ещё раз,'));
console.log(c.dim('он продолжит с того места, где остановился.\n'));

// ——— 1. Node ———
title('Проверяю окружение', 'Node.js — программа, которая умеет запускать этот код.');
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) die(`Нужен Node.js версии 18 или новее, у тебя ${process.versions.node}.`,
  'Скачай свежий с nodejs.org, кнопка LTS, и запусти помощник заново.');
console.log(`   ${c.ok('✓')} Node.js ${process.versions.node}`);

// ——— 2. Cloudflare ———
title('Вход в Cloudflare',
  'Cloudflare — компания, на серверах которой будет жить бот. Бесплатно.');
let who = wr(['whoami']);
if (!/You are logged in|Account Name|account_id/i.test(who.out)) {
  console.log('\n   Сейчас откроется браузер — войди или зарегистрируйся, потом нажми Allow.');
  await pause('Enter, чтобы открыть браузер');
  wr(['login'], { interactive: true });
  who = wr(['whoami']);
  if (!/You are logged in|Account Name|account_id/i.test(who.out))
    die('Вход не получился.', 'Запусти помощник заново и повтори шаг с браузером.');
}
console.log(`   ${c.ok('✓')} Вход выполнен`);

// ——— 3. Токен бота ———
title('Токен бота',
  'Токен — длинный пароль, которым твоя программа доказывает Telegram, что она и есть твой бот.');
console.log(`
   1. Открой Telegram, найди ${c.b('@BotFather')} (с синей галочкой).
   2. Отправь ему ${c.b('/newbot')}.
   3. Он спросит имя — напиши любое, например ${c.b('Breathe')}.
   4. Потом спросит username — он должен заканчиваться на ${c.b('bot')},
      например ${c.b('umid_breathe_bot')}. Если занят — придумай другой.
   5. В ответ придёт строка вида ${c.dim('8123456789:AAF...')} — это и есть токен.`);

let token = '', botName = '';
while (!token) {
  const t = await ask('Вставь сюда токен целиком:');
  if (!/^\d+:[\w-]{30,}$/.test(t)) { console.log(c.err('   Это не похоже на токен. Он выглядит как цифры, двоеточие, длинная строка.')); continue; }
  const res = await fetch(`https://api.telegram.org/bot${t}/getMe`).then((r) => r.json()).catch(() => null);
  if (!res?.ok) { console.log(c.err('   Telegram не признал этот токен. Проверь, что скопировал целиком.')); continue; }
  token = t; botName = res.result.username;
  console.log(`   ${c.ok('✓')} Бот @${botName} на связи`);
}

// ——— 4. База данных ———
title('База данных',
  'D1 — база на серверах Cloudflare. В ней хранятся твои отметки о приёме. Тоже бесплатно.');
let dbId = (readToml().match(/database_id\s*=\s*"([0-9a-f-]{30,})"/) || [])[1];
if (!dbId) {
  wr(['d1', 'create', 'breathe']);
  const list = wr(['d1', 'list', '--json']);
  try {
    const json = JSON.parse(list.out.slice(list.out.indexOf('[')));
    dbId = json.find((d) => d.name === 'breathe')?.uuid;
  } catch { /* разберём ниже */ }
  if (!dbId) die('Не смог создать или найти базу «breathe».',
    'Открой dash.cloudflare.com → Storage & Databases → D1, создай базу с именем breathe,\n  скопируй её Database ID и впиши в файл wrangler.toml вместо ЗАПОЛНИТЬ_ПОСЛЕ_...');
  writeToml(readToml().replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${dbId}"`));
}
console.log(`   ${c.ok('✓')} База подключена`);

console.log(c.dim('   Создаю таблицы...'));
if (wr(['d1', 'execute', 'breathe', '--remote', '--file=schema.sql', '-y']).code !== 0)
  die('Не удалось создать таблицы в базе.', 'Проверь интернет и запусти помощник заново.');
console.log(`   ${c.ok('✓')} Таблицы готовы`);

// ——— 5. Секреты ———
title('Пароли', 'Токен и секретное слово кладу в защищённое хранилище Cloudflare, а не в файлы.');
const secret = randomBytes(24).toString('hex');
for (const [name, value] of [['BOT_TOKEN', token], ['WEBHOOK_SECRET', secret]]) {
  if (wr(['secret', 'put', name], { input: value + '\n' }).code !== 0)
    die(`Не удалось сохранить ${name}.`, 'Запусти помощник заново.');
}
console.log(`   ${c.ok('✓')} Сохранено`);

// ——— 6. Публикация ———
title('Публикация', 'Заливаю код на серверы Cloudflare. Это называется «деплой».');
let dep = wr(['deploy']);
let url = (dep.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0];
if (!url) die('Публикация не удалась.', 'Прочитай сообщение выше — там написана причина. Потом запусти помощник заново.');
console.log(`   ${c.ok('✓')} Опубликовано: ${c.acc(url)}`);

// Второй деплой: теперь известен адрес Mini App.
if (!readToml().includes(`MINI_APP_URL = "${url}/"`)) {
  writeToml(readToml().replace(/MINI_APP_URL\s*=\s*"[^"]*"/, `MINI_APP_URL = "${url}/"`));
  console.log(c.dim('   Публикую второй раз — теперь с адресом мини-приложения...'));
  if (wr(['deploy']).code !== 0) die('Второй деплой не прошёл.', 'Запусти помощник заново.');
}
console.log(`   ${c.ok('✓')} Мини-приложение подключено`);

// ——— 7. Связка с Telegram ———
title('Связка с Telegram',
  'Вебхук — адрес, на который Telegram будет присылать твои нажатия кнопок.');
const setup = await fetch(`${url}/setup?key=${secret}`).then((r) => r.json()).catch(() => null);
if (!setup?.webhook?.ok) die('Telegram не принял адрес бота.',
  `Открой в браузере ${url}/setup?key=${secret} и посмотри, что там написано.`);
console.log(`   ${c.ok('✓')} Вебхук, команды и кнопка меню настроены`);

const health = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
if (health?.ok) console.log(`   ${c.ok('✓')} Бот отвечает. Сейчас в Ташкенте ${health.now.date}, день курса ${health.day}`);

// ——— готово ———
console.log(`\n${c.b(c.ok('━━ Готово'))}

   1. Открой ${c.acc(`https://t.me/${botName}`)}
   2. Нажми ${c.b('Старт')} (или отправь /start)
   3. Бот пришлёт блоки за сегодня, которые уже прошли —
      отметь кнопками то, что реально принял.

   Дальше он сам будет писать в 08:00, 10:00, 13:30, 16:00, 20:00 и 22:00.

   ${c.dim('Команды: /status — сводка, /today — план дня,')}
   ${c.dim('/catchup — отметить задним числом, /pause — тишина, /resume — обратно.')}
`);
rl.close();
