// Схема лечения. Назначение: Ибрагимов Ж.Н., 08.09.2026
// Диагноз: острый риносинусит, аллергический ринит.
//
// Единственный источник правды: этим файлом пользуются и приложение (index.html),
// и генератор календаря (tools/gen-ics.mjs). Правки вносить только здесь.

export const START = '2026-09-08';        // первый день приёма
export const DOCTOR_VISIT = '2026-09-22'; // «через 14 дней ко мне»
export const DOCTOR_NAME = 'Ибрагимов Жасур Нодирович';
export const DIAGNOSIS = 'Острый риносинусит. Аллергический ринит.';

export const FOOD_BAN = 'Острое, сладкое, солёное, цитрусовое — нельзя.';

// Порядок утром и вечером важен: Риноксил → через 5 мин носовой душ → сразу гормональный спрей.
export const meds = [
  {
    id: 'rinoxil',
    n: 1,
    name: 'Риноксил 0,05%',
    form: 'спрей',
    dose: 'по 2 дозы в каждую ноздрю',
    times: ['08:00', '20:00'],
    days: 5,
    hint: 'Первый шаг цепочки. Через 5 минут — носовой душ.',
    warn: 'Сосудосуживающий. Строго не дольше 5 дней — дальше начинается медикаментозный ринит (нос перестаёт дышать без капель).',
  },
  {
    id: 'rinse',
    n: 2,
    name: 'Носовой душ',
    form: 'Аквалор софт или Аквамарис норм',
    dose: 'промывание носа',
    times: ['08:05', '13:00', '17:00', '20:05'],
    minPerDay: 3,
    days: 14,
    hint: 'Через 5 минут после Риноксила (пока он действует — промывается лучше). Назначено 3–4 раза в день.',
  },
  {
    id: 'steroid',
    n: 3,
    name: 'Авамис / Флутинекс / Флутел / Фронза',
    form: 'спрей',
    dose: 'по 2 дозы',
    times: ['08:10', '20:10'],
    days: 28,
    hint: 'Сразу после носового душа. Любой один препарат из четырёх — они взаимозаменяемы.',
    warn: 'Работает накопительно: заметный эффект к 5–7 дню, но курс 28 дней. Бросить, когда «стало легче», — вернуть всё назад.',
  },
  {
    id: 'montelukast',
    n: 4,
    name: 'Л-Монтус / Аллервей М',
    form: 'таблетка',
    dose: '1 таблетка',
    times: ['22:30'],
    days: 14,
    hint: 'Перед сном.',
  },
  {
    id: 'methyluracil',
    n: 5,
    name: 'Метилурацил',
    form: 'мазь',
    dose: 'на каждую ноздрю',
    times: ['09:30', '15:00', '22:00'],
    days: 14,
    hint: 'Заживляет слизистую. Ставить между приёмами спрея, не сразу после него.',
  },
  {
    id: 'sinupret',
    n: 6,
    name: 'Синупрет экстракт',
    form: 'таблетки',
    dose: '1 таблетка',
    times: ['09:00', '14:00', '21:00'],
    days: 10,
  },
];

// ——— общие вычисления ———

export const pad = (x) => String(x).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Номер дня курса для даты: 0 = первый день. */
export function dayIndex(dateISO) {
  const ms = parseISO(dateISO) - parseISO(START);
  return Math.round(ms / 86400000);
}

export function isActive(med, dateISO) {
  const i = dayIndex(dateISO);
  return i >= 0 && i < med.days;
}

/** Последний день приёма препарата (ISO). */
export function endISO(med) {
  const d = parseISO(START);
  d.setDate(d.getDate() + med.days - 1);
  return iso(d);
}

/** Сколько раз в день положено (для «душа» — верхняя граница диапазона). */
export const perDay = (med) => med.times.length;

/** Все слоты приёма на дату, отсортированы по времени. */
export function slotsFor(dateISO) {
  const out = [];
  for (const med of meds) {
    if (!isActive(med, dateISO)) continue;
    for (const t of med.times) out.push({ med, time: t, key: `${med.id}@${t}` });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/** Последний день всего курса. */
export function courseEndISO() {
  return meds.map(endISO).sort().at(-1);
}
