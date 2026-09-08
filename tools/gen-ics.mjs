// Генерирует breathe.ics из schedule.js: приёмы, стоп-напоминания, визит к врачу.
// Запуск: node tools/gen-ics.mjs
import { writeFileSync } from 'node:fs';
import { meds, START, DOCTOR_VISIT, DOCTOR_NAME, DIAGNOSIS, FOOD_BAN,
         pad, endISO } from '../schedule.js';

const TZ = 'Asia/Tashkent';
const STAMP = '20260908T000000Z';
const nodash = (s) => s.replaceAll('-', '');
const at = (dateISO, hhmm) => `${nodash(dateISO)}T${hhmm.replace(':', '')}00`;

// Экранирование по RFC 5545 и сворачивание длинных строк в 75 октетов.
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
  .replace(/,/g, '\\,').replace(/\n/g, '\\n');

function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = out.length ? 74 : 75;         // продолжения начинаются с пробела
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // не рвём UTF-8
    out.push((out.length ? ' ' : '') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

const lines = [];
const push = (...ls) => lines.push(...ls);

push(
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Breathe//Medication Schedule//RU',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  `X-WR-CALNAME:${esc('Лечение — риносинусит')}`,
  `X-WR-TIMEZONE:${TZ}`,
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0500',
  'TZOFFSETTO:+0500',
  'TZNAME:+05',
  'END:STANDARD',
  'END:VTIMEZONE',
);

function event({ uid, start, minutes, summary, description, rrule, alarms = [0] }) {
  // start в компактном виде YYYYMMDDTHHMMSS
  const y = +start.slice(0, 4), mo = +start.slice(4, 6), d = +start.slice(6, 8);
  const h = +start.slice(9, 11), mi = +start.slice(11, 13);
  const end = new Date(y, mo - 1, d, h, mi + minutes);
  const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`
    + `T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${STAMP}`,
    `DTSTART;TZID=${TZ}:${start}`, `DTEND;TZID=${TZ}:${endStr}`);
  if (rrule) push(`RRULE:${rrule}`);
  push(`SUMMARY:${esc(summary)}`);
  if (description) push(`DESCRIPTION:${esc(description)}`);
  for (const a of alarms) {
    push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`,
      `TRIGGER:${a === 0 ? '-PT0M' : a}`, 'END:VALARM');
  }
  push('END:VEVENT');
}

let n = 0;
let stopSlot = 0;
for (const med of meds) {
  const label = `${med.name} — ${med.dose}`;
  const desc = [
    `${med.form}, ${med.dose}.`,
    med.minPerDay ? `Назначено ${med.minPerDay}–${med.times.length} раза в день.` : null,
    `Курс ${med.days} дн., по ${endISO(med)} включительно.`,
    med.hint, med.warn ? `Внимание: ${med.warn}` : null, FOOD_BAN,
  ].filter(Boolean).join('\n');

  for (const t of med.times) {
    event({
      uid: `breathe-${med.id}-${t.replace(':', '')}-${++n}@breathe.local`,
      start: at(START, t), minutes: 10, summary: label, description: desc,
      rrule: `FREQ=DAILY;COUNT=${med.days}`,
    });
  }

  // Явное стоп-напоминание вечером последнего дня.
  // Разносим на минуту, чтобы совпавшие даты окончания не слиплись в одно уведомление.
  const stopAt = `21:${pad(40 + stopSlot++)}`;
  event({
    uid: `breathe-stop-${med.id}@breathe.local`,
    start: at(endISO(med), stopAt), minutes: 5,
    summary: `Завтра НЕ принимать: ${med.name}`,
    description: `Курс ${med.days} дн. закончен сегодня (${endISO(med)}). Приём прекратить.`
      + (med.warn ? `\n${med.warn}` : ''),
  });
}

event({
  uid: 'breathe-doctor-visit@breathe.local',
  start: at(DOCTOR_VISIT, '10:00'), minutes: 60,
  summary: `Контрольный приём — ${DOCTOR_NAME}`,
  description: `${DIAGNOSIS}\nНазначено 08.09.2026, явка через 14 дней.\n`
    + 'Взять с собой: список принятого, чем заменяли препараты, что осталось из жалоб.',
  alarms: ['-P1D', 0],
});

push('END:VCALENDAR');

const ics = lines.map(fold).join('\r\n') + '\r\n';
writeFileSync(new URL('../breathe.ics', import.meta.url), ics);
console.log(`breathe.ics: ${lines.length} строк, ${ics.length} байт`);
