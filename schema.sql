-- D1: состояние бота. Применить: wrangler d1 execute breathe --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  chat_id    INTEGER PRIMARY KEY,
  tz_offset  INTEGER NOT NULL DEFAULT 300,  -- смещение от UTC в минутах (Ташкент = 300)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

-- Отметки приёма. slot = '<блок>:<препарат>', например 'am:rinoxil'.
CREATE TABLE IF NOT EXISTS marks (
  chat_id  INTEGER NOT NULL,
  date     TEXT    NOT NULL,
  slot     TEXT    NOT NULL,
  taken_at TEXT    NOT NULL,
  PRIMARY KEY (chat_id, date, slot)
);

-- Что уже отправлено: защита от дублей, если крон отработал дважды.
CREATE TABLE IF NOT EXISTS sent (
  chat_id    INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  tag        TEXT    NOT NULL,  -- 'b:<блок>' | 'stop:<препарат>' | 'recap' | 'visit:0' | 'visit:1'
  message_id INTEGER,
  sent_at    TEXT,
  PRIMARY KEY (chat_id, date, tag)
);

CREATE INDEX IF NOT EXISTS marks_by_chat_date ON marks (chat_id, date);
