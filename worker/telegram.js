// Тонкая обёртка над Bot API + проверка подписи Telegram Mini App.

const API = 'https://api.telegram.org/bot';

export async function tg(token, method, payload) {
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) console.error(`tg ${method}: ${data.error_code} ${data.description}`);
  return data;
}

export const sendMessage = (t, chat_id, text, extra = {}) =>
  tg(t, 'sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });

export const editMessage = (t, chat_id, message_id, text, extra = {}) =>
  tg(t, 'editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', ...extra });

export const answerCallback = (t, id, text) =>
  tg(t, 'answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });

/**
 * Проверка initData из Mini App (Telegram WebApp).
 * Ключ = HMAC-SHA256("WebAppData") по токену бота, дальше сверяем hash строки данных.
 * Без этого любой мог бы дёргать API от чужого имени.
 */
export async function verifyInitData(initData, token, maxAgeSec = 86400) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', secretKey, enc.encode(token));
  const dataKey = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', dataKey, enc.encode(checkString));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(hex, hash)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
