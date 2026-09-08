// Генерирует breathe.ics из public/schedule.js.
// Календарь — страховка на случай, если Telegram замьючен: те же блоки приёмов,
// стоп-напоминания и, главное, визит к врачу.
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

push('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breathe//Medication Schedule//RU',
  'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  `X-WR-CALNAME:${esc('Лечение — риносинусит')}`, `X-WR-TIMEZONE:${TZ}`,
  'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'TZNAME:+05', 'END:STANDARD', 'END:VTIMEZONE');

function event({ uid, start, minutes, summary, description, rrule, alarms = ['-PT0M'] }) {
  const [y, mo, d] = [+start.slice(0, 4), +start.slice(4, 6), +start.slice(6, 8)];
  const end = new Date(y, mo - 1, d, +start.slice(9, 11), +start.slice(11, 13) + minutes);
  const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`
    + `T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${STAMP}`,
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
  alarms: ['-P1D', '-PT0M'],
});

push('END:VCALENDAR');
const ics = lines.map(fold).join('\r\n') + '\r\n';
writeFileSync(new URL('../breathe.ics', import.meta.url), ics);
console.log(`breathe.ics: ${lines.filter((l) => l === 'BEGIN:VEVENT').length} событий, ${ics.length} байт`);
