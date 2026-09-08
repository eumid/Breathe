// Генерирует public/breathe.ics из public/schedule.js.
// Календарь — страховка на случай, если Telegram замьючен: те же блоки приёмов,
// стоп-напоминания и, главное, визит к врачу.
// Лежит в public/, поэтому воркер отдаёт его по адресу /breathe.ics: открытая
// в Safari ссылка передаётся Календарю напрямую, без возни с файловыми смотрелками.
// Запуск: node tools/gen-ics.mjs
import { writeFileSync } from 'node:fs';
import {
  meds, medList, blocks, blocksFor, segments, addDays, endISO, endingOn,
  START, DOCTOR_VISIT, DOCTOR_NAME, DIAGNOSIS, FOOD_BAN, TZ, STOP_TIME, pad,
} from '../public/schedule.js';

const STAMP = '20260908T000000Z';
const nodash = (s) => s.replaceAll('-', '');
const at = (dateISO, hhmm) => `${nodash(dateISO)}T${hhmm.replace(':', '')}00`;

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;')
  .replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** Сворачивание длинных строк в 75 октетов по RFC 5545, не разрывая UTF-8. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (out.length ? 74 : 75), bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? ' ' : '') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

const lines = [];
const push = (...ls) => lines.push(...ls);

// Ни METHOD, ни X-WR-CALNAME здесь быть не должно: с ними iOS считает файл
// опубликованным календарём для подписки и не показывает кнопку «Добавить все».
// Без них это обычный набор событий, который импортируется в существующий календарь.
push('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breathe//Medication Schedule//RU',
  'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'TZNAME:+05', 'END:STANDARD', 'END:VTIMEZONE');

function event({ uid, start, minutes, summary, description, rrule, alarms = ['-PT0S'] }) {
  const [y, mo, d] = [+start.slice(0, 4), +start.slice(4, 6), +start.slice(6, 8)];
  const end = new Date(y, mo - 1, d, +start.slice(9, 11), +start.slice(11, 13) + minutes);
  const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`
    + `T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${STAMP}`, 'SEQUENCE:0', 'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT', // напоминание, а не занятое время в расписании
    `DTSTART;TZID=${TZ}:${start}`, `DTEND;TZID=${TZ}:${endStr}`);
  if (rrule) push(`RRULE:${rrule}`);
  push(`SUMMARY:${esc(summary)}`);
  if (description) push(`DESCRIPTION:${esc(description)}`);
  for (const a of alarms)
    push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:${a}`, 'END:VALARM');
  push('END:VEVENT');
}

// Состав блока меняется, когда заканчивается очередной препарат, — поэтому
// на каждый отрезок постоянного состава своя серия событий со своим текстом.
for (const seg of segments()) {
  for (const b of blocksFor(seg.startISO)) {
    const steps = b.steps.map((s, i) =>
      `${i + 1}. ${s.med.name}${s.when ? ` (${s.when})` : ''} — ${s.med.dose}`);
    event({
      uid: `breathe-${b.id}-${nodash(seg.startISO)}@breathe.local`,
      start: at(seg.startISO, b.time), minutes: 15,
      summary: `${b.icon} ${b.title}: ${b.steps.map((s) => s.med.short).join(' → ')}`,
      description: [`Порядок обязателен:`, ...steps, '', FOOD_BAN].join('\n'),
      rrule: `FREQ=DAILY;COUNT=${seg.days}`,
    });
  }
}

// Стоп-напоминания: разнесены по минутам, чтобы совпавшие даты не слиплись.
let k = 0;
for (const med of medList) {
  event({
    uid: `breathe-stop-${med.id}@breathe.local`,
    start: at(endISO(med), `${STOP_TIME.slice(0, 3)}${pad(+STOP_TIME.slice(3) + k++)}`), minutes: 5,
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
  alarms: ['-P1D', '-PT0S'],
});

push('END:VCALENDAR');
const ics = lines.map(fold).join('\r\n') + '\r\n';
writeFileSync(new URL('../public/breathe.ics', import.meta.url), ics);
console.log(`breathe.ics: ${lines.filter((l) => l === 'BEGIN:VEVENT').length} событий, ${ics.length} байт`);

// Запасной файл: только визит к врачу и отмена Риноксила — то, что нельзя пропустить.
// Если основной импорт где-то упрётся, этот пройдёт: два события, без повторов.
const KEY_UIDS = ['breathe-doctor-visit@breathe.local', 'breathe-stop-rinoxil@breathe.local'];
const text = lines.join('\n');
const vtimezone = text.slice(text.indexOf('BEGIN:VTIMEZONE'),
  text.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE'.length);
const keyEvents = text.split('BEGIN:VEVENT').slice(1)
  .map((b) => 'BEGIN:VEVENT' + b.slice(0, b.indexOf('END:VEVENT') + 'END:VEVENT'.length))
  .filter((b) => KEY_UIDS.some((u) => b.includes(`UID:${u}`)));
const keyIcs = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breathe//Key Dates//RU', 'CALSCALE:GREGORIAN',
  vtimezone,               // события ссылаются на TZID — без этого блока файл невалиден
  ...keyEvents, 'END:VCALENDAR',
].join('\n').split('\n').map(fold).join('\r\n') + '\r\n';
writeFileSync(new URL('../public/breathe-glavnoe.ics', import.meta.url), keyIcs);
console.log(`breathe-glavnoe.ics: ${keyEvents.length} события, ${keyIcs.length} байт`);
