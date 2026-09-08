// Сборка текстов и клавиатур для бота.
import {
  meds, medList, blocksFor, dayIndex, isActive, endISO, perDay, courseDays,
  slotsFor, endingOn, DOCTOR_VISIT, DOCTOR_NAME, FOOD_BAN, parseISO, START,
} from '../public/schedule.js';

const NUM = ['①', '②', '③', '④', '⑤'];
const RU_M = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const fmtDate = (dateISO) => {
  const d = parseISO(dateISO);
  return `${d.getDate()} ${RU_M[d.getMonth()]}`;
};

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const plural = (n, a, b, c) => {
  const m = n % 100, k = n % 10;
  return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c;
};

/** Сообщение-напоминание по блоку. `taken` — Set отмеченных ключей слотов. */
export function blockMessage(dateISO, block, taken) {
  const day = dayIndex(dateISO) + 1;
  const lines = [
    `${block.icon} <b>${esc(block.title)}, ${block.time}</b> · день ${day} из ${courseDays}`,
    '',
  ];
  block.steps.forEach((s, i) => {
    const done = taken.has(s.key);
    const head = `${done ? '✅' : NUM[i]} ${esc(s.med.name)}`;
    lines.push(done ? `<s>${head}</s>` : `<b>${head}</b>`);
    const detail = [s.when, s.med.dose].filter(Boolean).join(' — ');
    lines.push(`<i>${esc(detail)}</i>`);
  });

  const left = block.steps.filter((s) => !taken.has(s.key)).length;
  if (!left) lines.push('', '<i>Блок закрыт.</i>');
  return lines.join('\n');
}

export function blockKeyboard(dateISO, block, taken) {
  const rows = [];
  const btns = block.steps.map((s, i) => ({
    text: taken.has(s.key) ? `✅ ${s.med.short}` : `${NUM[i]} ${s.med.short}`,
    callback_data: `m|${dateISO}|${block.id}|${s.med.id}`,
  }));
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  if (block.steps.some((s) => !taken.has(s.key)))
    rows.push([{ text: 'Всё принял ✓', callback_data: `m|${dateISO}|${block.id}|*` }]);
  return { inline_keyboard: rows };
}

/** Вечерний догон: что осталось неотмеченным. */
export function recapMessage(dateISO, taken) {
  const missed = slotsFor(dateISO).filter((s) => !taken.has(s.key));
  if (!missed.length) return null;
  const byBlock = new Map();
  for (const s of missed) {
    if (!byBlock.has(s.block.id)) byBlock.set(s.block.id, { b: s.block, items: [] });
    byBlock.get(s.block.id).items.push(s.step.med.short);
  }
  const lines = [`🌗 <b>Не отмечено за ${fmtDate(dateISO)}</b>`, ''];
  for (const { b, items } of byBlock.values()) lines.push(`${b.time} ${esc(b.title)} — ${esc(items.join(', '))}`);
  lines.push('', '<i>Отметь кнопками в сообщениях выше, если принимал.</i>');
  return lines.join('\n');
}

/** Стоп-предупреждение вечером последнего дня курса. Все препараты — одним сообщением. */
export function stopMessage(meds) {
  const list = [].concat(meds);
  const head = list.length === 1
    ? `🛑 <b>Завтра НЕ принимать: ${esc(list[0].name)}</b>`
    : `🛑 <b>Завтра НЕ принимать ${list.length} препарата:</b>`;
  const lines = [head, ''];
  for (const m of list) {
    if (list.length > 1) lines.push(`• <b>${esc(m.name)}</b>`);
    lines.push(`Курс ${m.days} ${plural(m.days, 'день', 'дня', 'дней')} закончен сегодня.`);
    if (m.warn) lines.push(`<i>${esc(m.warn)}</i>`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function visitMessage(when) {
  return when === 'tomorrow'
    ? `🏥 <b>Завтра контрольный приём</b>\n${esc(DOCTOR_NAME)}, ${fmtDate(DOCTOR_VISIT)}.\n\n<i>Взять: что принимал, чем заменял препараты, какие жалобы остались.</i>`
    : `🏥 <b>Сегодня контрольный приём</b>\n${esc(DOCTOR_NAME)}.`;
}

/** Сводка курса: /status */
export function statusMessage(dateISO, takenByDate) {
  const i = dayIndex(dateISO);
  const today = takenByDate.get(dateISO) || new Set();
  const lines = [`📊 <b>День ${i + 1} из ${courseDays}</b> · ${fmtDate(dateISO)}`, ''];

  for (const m of medList) {
    if (i >= m.days) {
      lines.push(`✔️ <s>${esc(m.name)}</s> — курс закрыт ${fmtDate(endISO(m))}`);
      continue;
    }
    if (!isActive(m, dateISO)) continue;
    const target = perDay(m.id);
    const got = [...today].filter((k) => k.endsWith(`:${m.id}`)).length;
    const left = m.days - 1 - i;
    const tail = left === 0 ? ' · <b>последний день</b>' : ` · ещё ${left} ${plural(left, 'день', 'дня', 'дней')}`;
    lines.push(`${got >= target ? '✅' : '▫️'} <b>${esc(m.name)}</b> — ${got}/${target} сегодня${tail}`);
  }

  // Соблюдение за последние 7 дней курса.
  const days = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(parseISO(dateISO)); d.setDate(d.getDate() - k);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const total = slotsFor(ds).length;
    if (!total || dayIndex(ds) < 0) continue;
    const got = (takenByDate.get(ds) || new Set()).size;
    days.push(got >= total ? '🟩' : got >= total * 0.6 ? '🟨' : got ? '🟧' : '⬜️');
  }
  if (days.length) lines.push('', `Неделя: ${days.join('')}`);

  const toVisit = dayIndex(DOCTOR_VISIT) - i;
  lines.push('', toVisit > 0
    ? `🏥 До приёма ${toVisit} ${plural(toVisit, 'день', 'дня', 'дней')} — ${fmtDate(DOCTOR_VISIT)}`
    : toVisit === 0 ? '🏥 Приём сегодня' : '🏥 Приём прошёл');
  lines.push(`\n<i>${esc(FOOD_BAN)}</i>`);
  return lines.join('\n');
}

/** Заголовок к догоняющим блокам при первом запуске. */
export function catchUpMessage(dateISO, n) {
  return [
    `⏪ <b>Курс уже идёт — отметь, что успел принять</b>`,
    '',
    `За ${fmtDate(dateISO)} ${n === 1 ? 'остался' : 'осталось'} ${n} ${plural(n, 'блок', 'блока', 'блоков')} без отметок.`,
    'Ниже придут они же с кнопками. Что не принимал — просто не трогай.',
  ].join('\n');
}

export function startMessage() {
  return [
    '🫁 <b>Breathe</b> — учёт лечения по назначению от 08.09.2026.',
    '',
    'Напоминания приходят блоками: утро, мазь, день, полдник, вечер, ночь.',
    'Отмечай приём кнопкой прямо под сообщением.',
    '',
    'Когда препарат нужно прекратить — придёт отдельное предупреждение.',
    '',
    '/status — сводка по курсу',
    '/today — план на день',
    '/catchup — отметить задним числом за сегодня',
    '/pause — выключить напоминания, /resume — включить',
    '',
    `<i>${esc(FOOD_BAN)}</i>`,
  ].join('\n');
}

export function todayMessage(dateISO, taken) {
  const bs = blocksFor(dateISO);
  if (!bs.length) return `На ${fmtDate(dateISO)} приёмов нет.`;
  const lines = [`🗓 <b>${fmtDate(dateISO)}</b> · день ${dayIndex(dateISO) + 1} из ${courseDays}`, ''];
  for (const b of bs) {
    const items = b.steps.map((s) => (taken.has(s.key) ? `<s>${esc(s.med.short)}</s>` : esc(s.med.short)));
    lines.push(`${b.time} ${b.icon} ${esc(b.title)} — ${items.join(', ')}`);
  }
  const ending = endingOn(dateISO);
  if (ending.length)
    lines.push('', `🛑 Последний день: <b>${ending.map((m) => esc(m.name)).join(', ')}</b>`);
  return lines.join('\n');
}
