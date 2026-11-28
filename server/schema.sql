-- AI 整理次数（用来限额和看花了多少 token）。不存简历，也不存整理结果；ip 是当天加盐后的哈希。
CREATE TABLE IF NOT EXISTS parses (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  install TEXT NOT NULL,
  ip TEXT NOT NULL,
  ok INTEGER,
  ms INTEGER,
  in_tokens INTEGER,
  out_tokens INTEGER,
  err TEXT
);
CREATE INDEX IF NOT EXISTS parses_install_at ON parses (install, at);
CREATE INDEX IF NOT EXISTS parses_ip_at ON parses (ip, at);
CREATE INDEX IF NOT EXISTS parses_at ON parses (at);

-- 匿名使用统计：install 是扩展第一次打开时随机生成的编号，和任何资料都对不上。
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  install TEXT NOT NULL,
  event TEXT NOT NULL,
  props TEXT,
  v TEXT
);
CREATE INDEX IF NOT EXISTS events_event_at ON events (event, at);
CREATE INDEX IF NOT EXISTS events_install ON events (install);

-- 扩展右下角「反馈」：用户写的话，联系方式是用户自己选填的
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  install TEXT NOT NULL,
  ip TEXT NOT NULL,
  text TEXT NOT NULL,
  contact TEXT,
  page TEXT,
  v TEXT
);
CREATE INDEX IF NOT EXISTS feedback_at ON feedback (at);
