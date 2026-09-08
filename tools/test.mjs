// Прогон логики бота без Telegram и Cloudflare: D1 подменён на node:sqlite,
// Bot API — на перехватчик fetch. Симулируем весь курс поминутно.
// Запуск: node tools/test.mjs
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  blocksFor, slotsFor, medList, perDay, dayIndex, courseDays, START, addDays,
  DOCTOR_VISIT, TZ_OFFSET_MIN,
} from '../public/schedule.js';

// ——— заглушки окружения ———

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

const DB = {
  prepare(sql) {
    return {
      bind(...args) {
        const stmt = sqlite.prepare(sql);
        return {
          all: async () => ({ results: stmt.all(...args) }),
          run: async () => { const r = stmt.run(...args); return { meta: { changes: r.changes } }; },
        };
      },
      all: async () => ({ results: sqlite.prepare(sql).all() }),
    };
  },
};

const sentMessages = [];
let nextMessageId = 1;
globalThis.fetch = async (url, opts) => {
  const method = String(url).split('/').pop();
  const body = JSON.parse(opts.body);
  if (method === 'sendMessage') sentMessages.push({ ...body, message_id: nextMessageId });
  if (method === 'editMessageText') {
    const m = sentMessages.find((x) => x.message_id === body.message_id);
    if (m) Object.assign(m, body);
  }
  return { json: async () => ({ ok: true, result: { message_id: nextMessageId++ } }) };
};

const { tick, localNow } = await import('../worker/index.js');
const { onUpdateForTest } = {};

const env = { DB, BOT_TOKEN: 'test:token', WEBHOOK_SECRET: 's', MINI_APP_URL: '' };
const CHAT = 4242;

// ——— утилиты проверки ———

let failures = 0;
const check = (ok, label, extra = '') => {
  if (!ok) { failures++; console.log(`  ✗ ${label} ${extra}`); }
  return ok;
};

/** UTC-момент, соответствующий локальному времени Ташкента. */
const utcAt = (dateISO, hhmm) =>
  new Date(Date.parse(`${dateISO}T${hhmm}:00Z`) - TZ_OFFSET_MIN * 60000);

// ——— тесты ———

console.log('1. localNow переводит UTC в локальное время');
{
  const { date, minutes } = localNow(TZ_OFFSET_MIN, new Date('2026-09-08T19:30:00Z'));
  check(date === '2026-09-09' && minutes === 30, 'полночь+30 в Ташкенте при 19:30 UTC', `${date} ${minutes}`);
}

console.log('2. Регистрация пользователя');
sqlite.prepare('INSERT INTO users (chat_id,tz_offset,active,created_at) VALUES (?,?,1,?)')
  .run(CHAT, TZ_OFFSET_MIN, new Date().toISOString());

console.log('3. Поминутный прогон всего курса');
const perDaySent = new Map();
for (let d = 0; d < courseDays; d++) {
  const date = addDays(START, d);
  const before = sentMessages.length;
  for (let min = 0; min < 24 * 60; min++) {
    await tick(env, utcAt(date, `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`));
  }
  perDaySent.set(date, sentMessages.length - before);
}

console.log('4. Каждый блок каждого дня отправлен ровно один раз');
for (let d = 0; d < courseDays; d++) {
  const date = addDays(START, d);
  for (const b of blocksFor(date)) {
    const n = sentMessages.filter((m) => m.text.includes(`${b.title}, ${b.time}`)
      && m.text.includes(`день ${d + 1} из`)).length;
    check(n === 1, `${date} блок ${b.id}`, `отправлено ${n}`);
  }
}

console.log('5. Стоп-предупреждения: каждый препарат назван ровно раз, совпавшие даты — одним сообщением');
for (const m of medList) {
  const n = sentMessages.filter((x) => x.text.startsWith('🛑') && x.text.includes(m.name)).length;
  check(n === 1, `стоп ${m.id}`, `отправлено ${n}`);
}
{
  const stops = sentMessages.filter((x) => x.text.startsWith('🛑'));
  check(stops.length === 4, 'четыре стоп-сообщения на четыре даты окончания', `${stops.length}`);
}

console.log('6. Напоминания о враче');
check(sentMessages.filter((m) => m.text.includes('Завтра контрольный приём')).length === 1, 'за день до визита');
check(sentMessages.filter((m) => m.text.includes('Сегодня контрольный приём')).length === 1, 'в день визита');

console.log('7. Вечерний догон приходит, пока ничего не отмечено');
check(sentMessages.filter((m) => m.text.includes('Не отмечено за')).length === courseDays,
  'догон каждый день', String(sentMessages.filter((m) => m.text.includes('Не отмечено за')).length));

console.log('8. Нагрузка на пользователя');
const maxPerDay = Math.max(...perDaySent.values());
check(maxPerDay <= 9, 'не больше 9 сообщений в самый плотный день', `максимум ${maxPerDay}`);
console.log(`   пик приходится на ${[...perDaySent].find(([, v]) => v === maxPerDay)[0]}`);
console.log(`   первый день: ${perDaySent.get(START)}, последний: ${perDaySent.get(addDays(START, courseDays - 1))}, всего: ${sentMessages.length}`);

console.log('9. Кнопки: отметка закрывает блок');
{
  const worker = await import('../worker/index.js');
  const date = '2026-09-08';
  const block = blocksFor(date)[0];
  const msg = sentMessages.find((m) => m.text.includes(`${block.title}, ${block.time}`));
  const cb = (medId) => worker.default.fetch(new Request('https://x/tg/s', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 's' },
    body: JSON.stringify({ callback_query: { id: '1', data: `m|${date}|${block.id}|${medId}`,
      message: { message_id: msg.message_id, chat: { id: CHAT } } } }),
  }), env);

  await cb(block.steps[0].med.id);
  let marks = sqlite.prepare('SELECT slot FROM marks WHERE chat_id=? AND date=?').all(CHAT, date);
  check(marks.length === 1, 'одна отметка после одного нажатия', `${marks.length}`);

  await cb(block.steps[0].med.id); // повторное нажатие снимает отметку
  marks = sqlite.prepare('SELECT slot FROM marks WHERE chat_id=? AND date=?').all(CHAT, date);
  check(marks.length === 0, 'повторное нажатие снимает отметку', `${marks.length}`);

  await cb('*');
  marks = sqlite.prepare('SELECT slot FROM marks WHERE chat_id=? AND date=?').all(CHAT, date);
  check(marks.length === block.steps.length, '«Всё принял» закрывает блок', `${marks.length}/${block.steps.length}`);

  const edited = sentMessages.find((m) => m.message_id === msg.message_id);
  check(edited.text.includes('Блок закрыт'), 'текст сообщения обновлён');
}

console.log('10. Дозировки соответствуют назначению');
for (const m of medList) {
  const dosesPerDay = perDay(m.id);
  const expect = { rinoxil: 2, rinse: 4, steroid: 2, montelukast: 1, methyluracil: 3, sinupret: 3 }[m.id];
  check(dosesPerDay === expect, `${m.short}: ${dosesPerDay} раз(а) в день`, `ожидалось ${expect}`);
  const total = Array.from({ length: courseDays }, (_, d) =>
    slotsFor(addDays(START, d)).filter((s) => s.step.med.id === m.id).length).reduce((a, b) => a + b);
  check(total === expect * m.days, `${m.short}: всего доз за курс ${total}`, `ожидалось ${expect * m.days}`);
}

console.log('11. Курс кончается вовремя');
check(slotsFor(addDays(START, courseDays)).length === 0, 'после последнего дня приёмов нет');
check(dayIndex(DOCTOR_VISIT) === 14, 'визит на 15-й день курса (через 14 дней)');

console.log(failures ? `\n❌ Провалено проверок: ${failures}` : '\n✅ Все проверки пройдены');
process.exit(failures ? 1 : 0);
