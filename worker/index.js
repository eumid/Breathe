// Cloudflare Worker: Telegram-бот + API для Mini App.
//   scheduled() — раз в минуту проверяет, чей блок наступил, и шлёт напоминание.
//   fetch()     — вебхук Telegram и /api/* для Mini App; статика отдаётся из public/.
import {
  blocks, blocksFor, slotsFor, endingOn, dayIndex, courseDays, courseEndISO,
  DOCTOR_VISIT, RECAP_TIME, STOP_TIME, TZ_OFFSET_MIN, START, iso, addDays,
} from '../public/schedule.js';
import { sendMessage, editMessage, answerCallback, tg, verifyInitData } from './telegram.js';
import {
  blockMessage, blockKeyboard, recapMessage, stopMessage, visitMessage,
  statusMessage, startMessage, todayMessage,
} from './format.js';

// Крон может пропустить минуту — считаем событие актуальным ещё TOLERANCE_MIN минут.
const TOLERANCE_MIN = 5;

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Локальные дата и время пользователя по смещению в минутах. */
function localNow(offsetMin, now = new Date()) {
  const d = new Date(now.getTime() + offsetMin * 60000);
  return {
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

const due = (nowMin, hhmm) => {
  const diff = nowMin - toMin(hhmm);
  return diff >= 0 && diff < TOLERANCE_MIN;
};

// ——— хранилище ———

const takenSet = async (db, chat, date) => {
  const { results } = await db.prepare('SELECT slot FROM marks WHERE chat_id=? AND date=?')
    .bind(chat, date).all();
  return new Set(results.map((r) => r.slot));
};

async function takenByDate(db, chat, fromISO, toISO) {
  const { results } = await db.prepare(
    'SELECT date, slot FROM marks WHERE chat_id=? AND date BETWEEN ? AND ?')
    .bind(chat, fromISO, toISO).all();
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.date)) map.set(r.date, new Set());
    map.get(r.date).add(r.slot);
  }
  return map;
}

const setMark = (db, chat, date, slot, on) => on
  ? db.prepare('INSERT OR IGNORE INTO marks (chat_id,date,slot,taken_at) VALUES (?,?,?,?)')
      .bind(chat, date, slot, new Date().toISOString()).run()
  : db.prepare('DELETE FROM marks WHERE chat_id=? AND date=? AND slot=?')
      .bind(chat, date, slot).run();

/** true — если это событие ещё не отправляли (защита от дублей при повторном кроне). */
async function claim(db, chat, date, tag) {
  const r = await db.prepare('INSERT OR IGNORE INTO sent (chat_id,date,tag,sent_at) VALUES (?,?,?,?)')
    .bind(chat, date, tag, new Date().toISOString()).run();
  return (r.meta?.changes ?? 0) > 0;
}

const rememberMessage = (db, chat, date, tag, mid) =>
  db.prepare('UPDATE sent SET message_id=? WHERE chat_id=? AND date=? AND tag=?')
    .bind(mid, chat, date, tag).run();

const activeUsers = async (db) => (await db.prepare(
  'SELECT chat_id, tz_offset FROM users WHERE active=1').all()).results;

const upsertUser = (db, chat) =>
  db.prepare(`INSERT INTO users (chat_id,tz_offset,active,created_at) VALUES (?,?,1,?)
              ON CONFLICT(chat_id) DO UPDATE SET active=1`)
    .bind(chat, TZ_OFFSET_MIN, new Date().toISOString()).run();

const setActive = (db, chat, on) =>
  db.prepare('UPDATE users SET active=? WHERE chat_id=?').bind(on ? 1 : 0, chat).run();

// ——— рассылка по расписанию ———

async function tick(env, now = new Date()) {
  const users = await activeUsers(env.DB);
  for (const u of users) {
    const { date, minutes } = localNow(u.tz_offset ?? TZ_OFFSET_MIN, now);
    const i = dayIndex(date);
    if (i < 0 || i >= courseDays) continue;
    try {
      await tickUser(env, u.chat_id, date, minutes);
    } catch (e) {
      console.error('tickUser', u.chat_id, e?.message);
    }
  }
}

async function tickUser(env, chat, date, nowMin) {
  const token = env.BOT_TOKEN;

  for (const b of blocksFor(date)) {
    if (!due(nowMin, b.time)) continue;
    if (!(await claim(env.DB, chat, date, `b:${b.id}`))) continue;
    const taken = await takenSet(env.DB, chat, date);
    const res = await sendMessage(token, chat, blockMessage(date, b, taken),
      { reply_markup: blockKeyboard(date, b, taken) });
    if (res.ok) await rememberMessage(env.DB, chat, date, `b:${b.id}`, res.result.message_id);
  }

  if (due(nowMin, STOP_TIME)) {
    const ending = endingOn(date);
    if (ending.length && await claim(env.DB, chat, date, 'stop'))
      await sendMessage(token, chat, stopMessage(ending));
    const toVisit = dayIndex(DOCTOR_VISIT) - dayIndex(date);
    if (toVisit === 1 && await claim(env.DB, chat, date, 'visit:1'))
      await sendMessage(token, chat, visitMessage('tomorrow'));
  }

  if (due(nowMin, '08:00') && dayIndex(date) === dayIndex(DOCTOR_VISIT)
      && await claim(env.DB, chat, date, 'visit:0'))
    await sendMessage(token, chat, visitMessage('today'));

  if (due(nowMin, RECAP_TIME) && await claim(env.DB, chat, date, 'recap')) {
    const text = recapMessage(date, await takenSet(env.DB, chat, date));
    if (text) await sendMessage(token, chat, text);
  }
}

// ——— вебхук ———

async function onUpdate(env, update) {
  if (update.callback_query) return onCallback(env, update.callback_query);
  const msg = update.message;
  if (!msg?.text) return;

  const chat = msg.chat.id;
  const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
  const today = localNow(TZ_OFFSET_MIN).date;

  if (cmd === '/start') {
    await upsertUser(env.DB, chat);
    await sendMessage(env.BOT_TOKEN, chat, startMessage(), miniAppButton(env));
    return;
  }
  if (cmd === '/status') {
    const map = await takenByDate(env.DB, chat, addDays(today, -6), today);
    await sendMessage(env.BOT_TOKEN, chat, statusMessage(today, map), miniAppButton(env));
    return;
  }
  if (cmd === '/today') {
    await sendMessage(env.BOT_TOKEN, chat, todayMessage(today, await takenSet(env.DB, chat, today)));
    return;
  }
  if (cmd === '/pause') {
    await setActive(env.DB, chat, false);
    await sendMessage(env.BOT_TOKEN, chat, 'Напоминания выключены. /resume — включить обратно.');
    return;
  }
  if (cmd === '/resume') {
    await upsertUser(env.DB, chat);
    await sendMessage(env.BOT_TOKEN, chat, 'Напоминания включены.');
    return;
  }
  await sendMessage(env.BOT_TOKEN, chat, 'Команды: /status, /today, /pause, /resume');
}

async function onCallback(env, q) {
  const chat = q.message?.chat?.id;
  const [kind, date, blockId, medId] = String(q.data || '').split('|');
  if (kind !== 'm' || !chat) return answerCallback(env.BOT_TOKEN, q.id);

  const block = blocksFor(date).find((b) => b.id === blockId);
  if (!block) return answerCallback(env.BOT_TOKEN, q.id, 'Блок уже неактуален');

  let taken = await takenSet(env.DB, chat, date);
  const targets = medId === '*'
    ? block.steps.filter((s) => !taken.has(s.key))
    : block.steps.filter((s) => s.med.id === medId);

  for (const s of targets) await setMark(env.DB, chat, date, s.key, medId === '*' || !taken.has(s.key));
  taken = await takenSet(env.DB, chat, date);

  await editMessage(env.BOT_TOKEN, chat, q.message.message_id, blockMessage(date, block, taken),
    { reply_markup: blockKeyboard(date, block, taken) });

  const left = block.steps.filter((s) => !taken.has(s.key)).length;
  await answerCallback(env.BOT_TOKEN, q.id, left ? `Осталось ${left}` : 'Блок закрыт ✓');
}

const miniAppButton = (env) => env.MINI_APP_URL
  ? { reply_markup: { inline_keyboard: [[{ text: '📊 Прогресс', web_app: { url: env.MINI_APP_URL } }]] } }
  : {};

// ——— HTTP ———

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function authed(req, env) {
  const initData = req.headers.get('X-Init-Data') || '';
  const user = await verifyInitData(initData, env.BOT_TOKEN);
  return user?.id ?? null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === `/tg/${env.WEBHOOK_SECRET}` && req.method === 'POST') {
      if (env.WEBHOOK_SECRET !== req.headers.get('X-Telegram-Bot-Api-Secret-Token'))
        return new Response('forbidden', { status: 403 });
      try {
        await onUpdate(env, await req.json());
      } catch (e) {
        console.error('onUpdate', e?.stack || e);
      }
      return new Response('ok'); // Telegram не должен ретраить из-за нашей ошибки
    }

    if (url.pathname === '/api/marks' && req.method === 'GET') {
      const chat = await authed(req, env);
      if (!chat) return json({ error: 'unauthorized' }, 401);
      const to = url.searchParams.get('to') || courseEndISO();
      const map = await takenByDate(env.DB, chat, url.searchParams.get('from') || START, to);
      return json({ marks: Object.fromEntries([...map].map(([d, s]) => [d, [...s]])) });
    }

    if (url.pathname === '/api/mark' && req.method === 'POST') {
      const chat = await authed(req, env);
      if (!chat) return json({ error: 'unauthorized' }, 401);
      const { date, key, on } = await req.json();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^[a-z0-9]+:[a-z]+$/.test(key || ''))
        return json({ error: 'bad request' }, 400);
      if (!slotsFor(date).some((s) => s.key === key)) return json({ error: 'unknown slot' }, 400);
      await setMark(env.DB, chat, date, key, Boolean(on));
      return json({ ok: true });
    }

    // Однократная настройка: вебхук, команды, кнопка меню.
    if (url.pathname === '/setup' && url.searchParams.get('key') === env.WEBHOOK_SECRET) {
      const results = {};
      results.webhook = await tg(env.BOT_TOKEN, 'setWebhook', {
        url: `${url.origin}/tg/${env.WEBHOOK_SECRET}`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      results.commands = await tg(env.BOT_TOKEN, 'setMyCommands', {
        commands: [
          { command: 'status', description: 'Сводка по курсу' },
          { command: 'today', description: 'План на день' },
          { command: 'pause', description: 'Выключить напоминания' },
          { command: 'resume', description: 'Включить напоминания' },
        ],
      });
      if (env.MINI_APP_URL)
        results.menu = await tg(env.BOT_TOKEN, 'setChatMenuButton', {
          menu_button: { type: 'web_app', text: 'Прогресс', web_app: { url: env.MINI_APP_URL } },
        });
      return json(results);
    }

    if (url.pathname === '/health')
      return json({ ok: true, now: localNow(TZ_OFFSET_MIN), day: dayIndex(localNow(TZ_OFFSET_MIN).date) + 1 });

    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};

export { tick, localNow, due, blocks, iso };
