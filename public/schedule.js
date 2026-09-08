// Схема лечения. Назначение: Ибрагимов Ж.Н., 08.09.2026
// Диагноз: острый риносинусит, аллергический ринит.
//
// Единственный источник правды: этим файлом пользуются Mini App, бот и генератор календаря.
// Правки вносить только здесь.

export const START = '2026-09-08';        // первый день приёма
export const DOCTOR_VISIT = '2026-09-22'; // «через 14 дней ко мне»
export const DOCTOR_NAME = 'Ибрагимов Жасур Нодирович';
export const DIAGNOSIS = 'Острый риносинусит. Аллергический ринит.';
export const FOOD_BAN = 'Острое, сладкое, солёное, цитрусовое — нельзя.';

export const TZ = 'Asia/Tashkent';
export const TZ_OFFSET_MIN = 300; // UTC+5, перехода на летнее время нет

export const meds = {
  rinoxil: {
    id: 'rinoxil', n: 1,
    name: 'Риноксил 0,05%', short: 'Риноксил', form: 'спрей',
    dose: 'по 2 дозы в каждую ноздрю',
    days: 5,
    hint: 'Первый шаг цепочки. Через 5 минут — носовой душ.',
    warn: 'Сосудосуживающий. Строго не дольше 5 дней — дальше начинается медикаментозный ринит (нос перестаёт дышать без капель).',
  },
  rinse: {
    id: 'rinse', n: 2,
    name: 'Носовой душ', short: 'Душ', form: 'Аквалор софт или Аквамарис норм',
    dose: 'промывание носа',
    days: 14,
    hint: 'Назначено 3–4 раза в день. Всегда до гормонального спрея, не после.',
  },
  steroid: {
    id: 'steroid', n: 3,
    name: 'Авамис / Флутинекс / Флутел / Фронза', short: 'Спрей', form: 'спрей',
    dose: 'по 2 дозы',
    days: 28,
    hint: 'Любой один препарат из четырёх — они взаимозаменяемы.',
    warn: 'Работает накопительно: заметный эффект к 5–7 дню, но курс 28 дней. Бросить, когда «стало легче», — вернуть всё назад.',
  },
  montelukast: {
    id: 'montelukast', n: 4,
    name: 'Л-Монтус / Аллервей М', short: 'Монтус', form: 'таблетка',
    dose: '1 таблетка',
    days: 14,
    hint: 'Перед сном.',
  },
  methyluracil: {
    id: 'methyluracil', n: 5,
    name: 'Метилурацил', short: 'Мазь', form: 'мазь',
    dose: 'на каждую ноздрю',
    days: 14,
    hint: 'Заживляет слизистую. Не сразу после гормонального спрея — иначе мешает всасыванию.',
  },
  sinupret: {
    id: 'sinupret', n: 6,
    name: 'Синупрет экстракт', short: 'Синупрет', form: 'таблетки',
    dose: '1 таблетка',
    days: 10,
  },
};

export const medList = Object.values(meds).sort((a, b) => a.n - b.n);

// Приёмы сгруппированы в блоки: одно напоминание на блок, а не на каждый препарат.
// Внутри блока порядок шагов обязателен к соблюдению.
// Врач конкретных часов не назначал — время подобрано так, чтобы выдержать
// цепочку «Риноксил → душ → спрей» и развести мазь со спреем.
export const blocks = [
  {
    id: 'am', time: '08:00', title: 'Утро', icon: '🌅',
    steps: [
      { med: 'rinoxil' },
      { med: 'rinse', when: 'через 5 минут' },
      { med: 'steroid', when: 'сразу после душа' },
      { med: 'sinupret' },
    ],
  },
  { id: 'am2', time: '10:00', title: 'Мазь', icon: '🧴', steps: [{ med: 'methyluracil' }] },
  { id: 'day', time: '13:30', title: 'День', icon: '🕐', steps: [{ med: 'rinse' }, { med: 'sinupret' }] },
  { id: 'aft', time: '16:00', title: 'Полдник', icon: '🕓', steps: [{ med: 'rinse' }, { med: 'methyluracil', when: 'после душа' }] },
  {
    id: 'pm', time: '20:00', title: 'Вечер', icon: '🌆',
    steps: [
      { med: 'rinoxil' },
      { med: 'rinse', when: 'через 5 минут' },
      { med: 'steroid', when: 'сразу после душа' },
      { med: 'sinupret' },
    ],
  },
  { id: 'night', time: '22:00', title: 'Ночь', icon: '🌙', steps: [{ med: 'methyluracil' }, { med: 'montelukast' }] },
];

export const RECAP_TIME = '23:00'; // вечерний догон по неотмеченному
export const STOP_TIME = '21:30';  // «завтра НЕ принимать» в последний день курса

// ——— даты ———

export const pad = (x) => String(x).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateISO, n) {
  const d = parseISO(dateISO);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Номер дня курса: 0 = первый день. */
export function dayIndex(dateISO) {
  return Math.round((parseISO(dateISO) - parseISO(START)) / 86400000);
}

export const isActive = (med, dateISO) => {
  const i = dayIndex(dateISO);
  return i >= 0 && i < med.days;
};

/** Последний день приёма препарата. */
export const endISO = (med) => addDays(START, med.days - 1);

export const courseDays = Math.max(...medList.map((m) => m.days));
export const courseEndISO = () => addDays(START, courseDays - 1);

// ——— блоки и слоты ———

export const slotKey = (blockId, medId) => `${blockId}:${medId}`;

/** Времена приёма препарата за день (из блоков, где он участвует). */
export const timesOf = (medId) =>
  blocks.filter((b) => b.steps.some((s) => s.med === medId)).map((b) => b.time);

export const perDay = (medId) => timesOf(medId).length;

/** Блоки на дату, где остался хотя бы один активный препарат. */
export function blocksFor(dateISO) {
  if (dayIndex(dateISO) < 0 || dayIndex(dateISO) >= courseDays) return [];
  return blocks
    .map((b) => ({
      ...b,
      steps: b.steps
        .filter((s) => isActive(meds[s.med], dateISO))
        .map((s) => ({ ...s, med: meds[s.med], key: slotKey(b.id, s.med) })),
    }))
    .filter((b) => b.steps.length);
}

/** Плоский список слотов дня, по времени. */
export const slotsFor = (dateISO) =>
  blocksFor(dateISO).flatMap((b) => b.steps.map((s) => ({ block: b, step: s, key: s.key, time: b.time })));

/** Препараты, у которых сегодня последний день курса. */
export const endingOn = (dateISO) =>
  medList.filter((m) => dayIndex(dateISO) === m.days - 1);

/**
 * Отрезки курса, внутри которых состав блоков не меняется.
 * Нужны календарю: одно повторяющееся событие не умеет менять текст на ходу.
 */
export function segments() {
  const bounds = [...new Set([0, courseDays, ...medList.map((m) => m.days)])]
    .filter((x) => x >= 0 && x <= courseDays)
    .sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    out.push({ from: bounds[k], to: bounds[k + 1], days: bounds[k + 1] - bounds[k], startISO: addDays(START, bounds[k]) });
  }
  return out;
}
