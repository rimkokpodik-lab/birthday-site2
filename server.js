'use strict';

/* =======================================================================
   САЙТ ПРИЁМА ДАТ РОЖДЕНИЯ  (Node.js, без внешних зависимостей)

   Сценарий работы:
   1. В .bat-файле указан адрес  http://<сайт>/api/upload
   2. Студент запускает .bat, вводит ФИО / группу / дату рождения
   3. .bat отправляет на сайт txt-файл  →  он попадает в «Входящие»
   4. Преподаватель входит в /admin и скачивает файлы (по одному, ZIP или одним TXT)

   Запуск:  node server.js           (порт 3000)
            PORT=8080 node server.js
   ======================================================================= */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
/* Папку с сайтом ищем в нескольких местах: если проект загружен на GitHub
   вместе с лишней вложенной папкой, сервер всё равно её найдёт. */
function resolvePublicDir() {
  const candidates = [
    path.join(ROOT, 'public'),
    path.join(ROOT, 'birthday-site', 'public'),
    path.join(ROOT, 'app', 'public'),
    path.join(ROOT, 'src', 'public'),
    ROOT, // если GitHub «расплющил» папку и index.html лежит в корне
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  // на всякий случай — поиск на один уровень вглубь
  try {
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(ROOT, entry.name, 'public');
      if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
    }
  } catch (_) { /* нет доступа — не важно */ }
  const fallback = path.join(ROOT, 'public');
  return fs.existsSync(fallback) ? fallback : null;
}
let PUBLIC_DIR = resolvePublicDir();
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const INBOX_JSON = path.join(DATA_DIR, 'inbox.json');
const ENTRIES_JSON = path.join(DATA_DIR, 'entries.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

/* ---------------------------------------------------------------- конфиг */
const DEFAULT_BAT_TEXTS = {
  window: 'Отправка даты рождения',
  header: 'ОТПРАВКА ДАТЫ РОЖДЕНИЯ ПРЕПОДАВАТЕЛЮ',
  namePrompt: 'Фамилия и имя',
  groupPrompt: 'Группа (можно пропустить)',
  datePrompt: 'Дата рождения (ДД.ММ.ГГГГ)',
  sending: 'Отправляю файл на сайт...',
  success: 'Готово! Ваши данные получены преподавателем.',
  fail: 'Не удалось отправить файл автоматически.',
};

/* В bat нельзя использовать % ^ < > | & и кавычки — вычищаем.
   Заодно заменяем «умную» типографику на символы, которые есть в CP866. */
function batSafe(str, fallback) {
  const cleaned = String(str == null ? '' : str)
    .replace(/[\u2014\u2013\u2212]/g, '-')
    .replace(/[\u00AB\u00BB\u201E\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[%^<>|&"]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

function batTexts() {
  const src = CONFIG.batTexts || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_BAT_TEXTS)) out[k] = batSafe(src[k], DEFAULT_BAT_TEXTS[k]);
  return out;
}


function loadConfig() {
  const cfg = {
    schoolName: 'Моя школа',
    adminPassword: 'urok2026',
    publicUrl: '',
    groupLabel: 'Группа',
    batTexts: { ...DEFAULT_BAT_TEXTS },
  };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      if (typeof raw.schoolName === 'string' && raw.schoolName.trim()) cfg.schoolName = raw.schoolName.trim();
      if (typeof raw.adminPassword === 'string' && raw.adminPassword.trim()) cfg.adminPassword = raw.adminPassword.trim();
      if (typeof raw.publicUrl === 'string') cfg.publicUrl = raw.publicUrl.trim();
      if (typeof raw.groupLabel === 'string' && raw.groupLabel.trim()) cfg.groupLabel = raw.groupLabel.trim();
      if (raw.batTexts && typeof raw.batTexts === 'object') {
        for (const k of Object.keys(DEFAULT_BAT_TEXTS)) {
          if (typeof raw.batTexts[k] === 'string' && raw.batTexts[k].trim()) cfg.batTexts[k] = raw.batTexts[k];
        }
      }
    }
  } catch (_) { /* файла ещё нет */ }
  if (process.env.ADMIN_PASSWORD) cfg.adminPassword = process.env.ADMIN_PASSWORD;
  if (process.env.SCHOOL_NAME) cfg.schoolName = process.env.SCHOOL_NAME;
  if (process.env.PUBLIC_URL) cfg.publicUrl = String(process.env.PUBLIC_URL).trim().replace(/\/+$/, '');
  return cfg;
}
const CONFIG = loadConfig();

function saveConfig() {
  const data = {
    schoolName: CONFIG.schoolName,
    adminPassword: CONFIG.adminPassword,
    publicUrl: CONFIG.publicUrl,
    groupLabel: CONFIG.groupLabel,
    batTexts: CONFIG.batTexts,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/* Сетевые адреса этого компьютера — чтобы подсказать адрес для bat */
function lanUrls() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // автонастройка, нерабочий адрес
      out.push({ iface: name, ip: net.address, url: 'http://' + net.address + ':' + PORT });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- данные */
let inbox = [];    // полученные файлы: [{id, filename, size, receivedAt, ip, ua, encoding, parsed, preview}]
let entries = [];  // список дней рождения (из файлов + добавленные вручную)

function ensureDirs() {
  fs.mkdirSync(INBOX_DIR, { recursive: true });
}

function loadData() {
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(INBOX_JSON, 'utf8'));
    if (Array.isArray(raw)) inbox = raw;
  } catch (_) { inbox = []; }
  try {
    const raw = JSON.parse(fs.readFileSync(ENTRIES_JSON, 'utf8'));
    if (Array.isArray(raw)) entries = raw.filter((e) => e && e.name && e.day && e.month);
  } catch (_) { entries = []; }
}

function writeJSONSafe(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function saveInbox() { writeJSONSafe(INBOX_JSON, inbox); }
function saveEntries() { writeJSONSafe(ENTRIES_JSON, entries); }

/* --------------------------------------------------------------- утилиты */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d, m, y) { return pad2(d) + '.' + pad2(m) + (y ? '.' + y : ''); }
function fmtDateTime(iso) {
  const dt = new Date(iso);
  return pad2(dt.getDate()) + '.' + pad2(dt.getMonth() + 1) + '.' + dt.getFullYear() +
    ' ' + pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function daysInMonth(year, month) {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function todayUTC() {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
}
function uid() { return crypto.randomBytes(8).toString('hex'); }
function esc(s) { return String(s == null ? '' : s); }
function sanitizeText(s, max) {
  return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* кодировки: UTF-8 / UTF-16 / CP1251 / CP866 — определяем по содержимому */
function textScore(t) {
  let s = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (c === 0xFFFD) s -= 6;
    else if (c < 32 && c !== 9 && c !== 10 && c !== 13) s -= 4;
    else if ((c >= 0x410 && c <= 0x44F) || c === 0x401 || c === 0x451) s += 2;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) s += 1;
  }
  return s;
}
function decodeAny(buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return { text: buf.slice(2).toString('utf16le'), encoding: 'UTF-16LE' };
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) { swapped[i - 2] = buf[i + 1]; swapped[i - 1] = buf[i]; }
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16BE' };
  }
  let text = buf.toString('utf8');
  let encoding = 'UTF-8';
  if (text.indexOf('\uFFFD') !== -1) {
    let best = text, bestScore = textScore(text), bestEnc = 'UTF-8';
    for (const enc of ['windows-1251', 'ibm866']) {
      try {
        const t = new TextDecoder(enc).decode(buf);
        const sc = textScore(t);
        if (sc > bestScore) { best = t; bestScore = sc; bestEnc = enc === 'windows-1251' ? 'CP1251' : 'CP866'; }
      } catch (_) { /* кодировка не поддерживается */ }
    }
    text = best; encoding = bestEnc;
  }
  return { text: text.replace(/^\uFEFF/, ''), encoding };
}

/* кодирование в CP866 (нужно для генерации .bat) */
function cp866Cache() {
  let cache = encodeCp866._cache;
  if (!cache) {
    cache = new Map();
    const dec = new TextDecoder('ibm866');
    for (let b = 0; b < 256; b++) cache.set(dec.decode(Buffer.from([b])), b);
    encodeCp866._cache = cache;
  }
  return cache;
}

/* символы, которых нет в CP866, заменяем понятными аналогами */
const CP866_FALLBACK = {
  '\u2014': '-', '\u2013': '-', '\u2212': '-', '\u2015': '-',
  '\u00AB': '"', '\u00BB': '"', '\u201E': '"', '\u201C': '"', '\u201D': '"',
  '\u2026': '...', '\u2018': "'", '\u2019': "'", '\u2032': "'",
  '\u2022': '*', '\u2116': 'N', '\u2192': '->', '\u2190': '<-',
};

function cp866Safe(text) {
  const cache = cp866Cache();
  let out = '';
  for (const ch of String(text)) {
    if (cache.has(ch)) { out += ch; continue; }
    if (CP866_FALLBACK[ch] !== undefined) { out += CP866_FALLBACK[ch]; continue; }
    out += '?';
  }
  return out;
}

function encodeCp866(str) {
  const cache = cp866Cache();
  const bytes = [];
  for (const ch of String(str)) {
    if (cache.has(ch)) bytes.push(cache.get(ch));
    else if (ch === '\n') bytes.push(10);
    else if (ch === '\r') bytes.push(13);
    else bytes.push(0x3F); // «?»
  }
  return Buffer.from(bytes);
}

/* --------------------------------------------- разбор данных ученика */
const NAME_KEYS = ['фио', 'фамилия и имя', 'имя', 'студент', 'ученик', 'фио студента', 'name', 'student', 'fullname', 'full name'];
const GROUP_KEYS = ['группа', 'класс', 'группа/класс', 'group', 'class'];
const DATE_KEYS = ['дата рождения', 'дата рожд', 'дата', 'др', 'день рождения', 'birthday', 'birth date', 'birthdate', 'bdate'];

function parseDateAny(s) {
  const str = String(s || '');
  let m = str.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
  m = str.match(/\b(\d{1,2})[.\/,](\d{1,2})(?:[.\/,](\d{2,4}))?\b/);
  if (m) {
    let year = m[3] ? Number(m[3]) : null;
    if (year !== null && String(m[3]).length === 2) year += year < 30 ? 2000 : 1900;
    return { day: Number(m[1]), month: Number(m[2]), year };
  }
  return null;
}

/** Извлекаем ФИО / группу / дату из произвольного текста файла */
function parseStudentText(text) {
  const res = { name: '', group: '', bdate: '', day: null, month: null, year: null };
  const lines = String(text || '').split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const kv = line.match(/^([^:=]{2,40}?)\s*[:=]\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase().replace(/ё/g, 'е');
    const val = kv[2].trim();
    if (!res.name && NAME_KEYS.some((k) => key === k || key.startsWith(k))) res.name = val;
    else if (!res.group && GROUP_KEYS.some((k) => key === k || key.startsWith(k))) res.group = val;
    else if (DATE_KEYS.some((k) => key === k || key.startsWith(k)) && !res.day) {
      const d = parseDateAny(val);
      if (d) { res.day = d.day; res.month = d.month; res.year = d.year; res.bdate = fmtDate(d.day, d.month, d.year); }
    }
  }

  // запасной вариант — ищем дату и имя без явных подписей
  if (!res.day) {
    const d = parseDateAny(text);
    if (d) { res.day = d.day; res.month = d.month; res.year = d.year; res.bdate = fmtDate(d.day, d.month, d.year); }
  }
  if (!res.name) {
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /[:=]/.test(line)) continue;
      if (parseDateAny(line) && line.replace(parseDateAny(line) ? '' : '', '').length < 4) continue;
      if (/^\d+[.)]?$/.test(line)) continue;
      res.name = line.slice(0, 120);
      break;
    }
  }

  res.name = sanitizeText(res.name, 120);
  res.group = sanitizeText(res.group, 20);
  if (res.year !== null && (!Number.isInteger(res.year) || res.year < 1900 || res.year > todayUTC().y)) res.year = null;
  const valid = res.day && res.month && res.month >= 1 && res.month <= 12 &&
    res.day >= 1 && res.day <= daysInMonth(res.year || 2000, res.month);
  if (!valid) { res.day = null; res.month = null; res.year = null; res.bdate = ''; }
  return res;
}

/* ------------------------------------------------------- список ДР */
function birthdayInfo(e, t) {
  const day = e.day, month = e.month, year = e.year || null;
  const dimThis = daysInMonth(t.y, month);
  const dimNext = daysInMonth(t.y + 1, month);
  const today = Date.UTC(t.y, t.m - 1, t.d);
  let nextY = t.y;
  let nextTs = Date.UTC(t.y, month - 1, Math.min(day, dimThis));
  if (nextTs < today) { nextY = t.y + 1; nextTs = Date.UTC(t.y + 1, month - 1, Math.min(day, dimNext)); }
  const daysUntil = Math.round((nextTs - today) / 86400000);
  let age = null, turns = null;
  if (year) {
    const had = (t.m > month) || (t.m === month && t.d >= day);
    age = t.y - year - (had ? 0 : 1);
    turns = nextY - year;
  }
  return {
    birthday: fmtDate(day, month, year),
    daysUntil,
    isToday: daysUntil === 0,
    nextDate: fmtDate(Math.min(day, daysInMonth(nextY, month)), month, nextY),
    age, turns,
    monthGen: MONTHS_GEN[month - 1],
  };
}

function decorateEntries() {
  const t = todayUTC();
  return entries
    .map((e) => ({ ...e, ...birthdayInfo(e, t) }))
    .sort((a, b) => (a.daysUntil - b.daysUntil) || a.name.localeCompare(b.name, 'ru'));
}

function sameEntry(a, b) {
  return a.name.toLowerCase() === b.name.toLowerCase() && a.day === b.day && a.month === b.month && (a.year || 0) === (b.year || 0);
}

function upsertEntry(parsed, source, fileId) {
  if (!parsed.day || !parsed.month || !parsed.name) return { entry: null, duplicate: false };
  const candidate = {
    name: parsed.name, group: parsed.group || '', day: parsed.day, month: parsed.month, year: parsed.year || null,
  };
  const existing = entries.find((e) => sameEntry(e, candidate));
  if (existing) {
    if (candidate.group) existing.group = candidate.group;
    if (fileId && !existing.fileId) existing.fileId = fileId;
    return { entry: existing, duplicate: true };
  }
  const entry = {
    id: uid(), ...candidate, source: source || 'file', fileId: fileId || null,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  return { entry, duplicate: false };
}

/* ------------------------------------------------------- приём файлов */
function saveIncomingFile(buf, opts) {
  ensureDirs();
  const id = uid();
  const ext = '.txt';
  const fileName = id + ext;
  fs.writeFileSync(path.join(INBOX_DIR, fileName), buf);

  const decoded = decodeAny(buf);
  const parsed = parseStudentText(decoded.text);
  const { entry, duplicate } = upsertEntry(parsed, 'file', id);

  const item = {
    id,
    filename: opts.filename || 'birthday.txt',
    stored: fileName,
    size: buf.length,
    receivedAt: new Date().toISOString(),
    ip: opts.ip || '',
    ua: (opts.ua || '').slice(0, 200),
    encoding: decoded.encoding,
    parsed,
    entryId: entry ? entry.id : null,
    duplicate: !!duplicate,
    preview: decoded.text.slice(0, 800),
  };
  inbox.unshift(item);
  saveInbox();
  if (entry) saveEntries();
  return item;
}

/* ------------------------------------------------------- ZIP (без зависимостей) */
function crc32(buf) {
  let table = crc32._table;
  if (!table) {
    table = crc32._table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1F);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  return { time, date };
}

function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(f.date || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version
    local.writeUInt16LE(0x0800, 6);   // UTF-8 flag
    local.writeUInt16LE(0, 8);        // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ------------------------------------------------------- экспорт TXT/CSV */
function buildExportTxt(list, sortMode) {
  const t = todayUTC();
  const head = [
    'СПИСОК ДНЕЙ РОЖДЕНИЯ — ' + CONFIG.schoolName,
    'Выгружено: ' + fmtDate(t.d, t.m, t.y) + '. Всего: ' + list.length,
    'Сортировка: ' + (sortMode === 'date' ? 'по дате рождения (январь → декабрь)'
      : sortMode === 'name' ? 'по алфавиту' : 'по ближайшему дню рождения'),
    '='.repeat(70),
    '',
  ].join('\r\n');

  const rows = list.map((e, i) => {
    const extra = [];
    if (e.age !== null) extra.push(e.age + ' ' + plural(e.age, 'год', 'года', 'лет'));
    extra.push(e.isToday ? 'СЕГОДНЯ ДЕНЬ РОЖДЕНИЯ' : 'через ' + e.daysUntil + ' ' + plural(e.daysUntil, 'день', 'дня', 'дней') + ' (' + e.nextDate + ')');
    return String(i + 1).padStart(3, ' ') + '. ' + e.name + (e.group ? ' — ' + e.group : '') + ' — ' + e.birthday + '  [' + extra.join(', ') + ']';
  });

  return head + rows.join('\r\n') + (rows.length ? '\r\n' : '');
}

function buildCsv(list) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['№', 'ФИО', CONFIG.groupLabel, 'Дата рождения', 'Возраст', 'Ближайший ДР', 'Через дней']];
  list.forEach((e, i) => rows.push([
    i + 1, e.name, e.group || '', e.birthday, e.age === null ? '' : e.age, e.nextDate, e.daysUntil,
  ]));
  return '\uFEFF' + rows.map((r) => r.map(q).join(';')).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------- .BAT генератор */
function buildBat(siteUrl, cp, customTexts) {
  const url = String(siteUrl || '').replace(/\/+$/, '');
  const isUtf8 = cp === 65001;
  const chcp = isUtf8 ? 65001 : 866;
  const T = Object.assign({}, DEFAULT_BAT_TEXTS, customTexts || {});

  /* PowerShell: TLS 1.2 (для https), «прогрев» сайта, 3 попытки отправки */
  const psScript =
    "$ErrorActionPreference='Stop'; " +
    "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12}catch{}; " +
    "$enc=[Text.Encoding]::GetEncoding(" + chcp + "); " +
    "$t=[IO.File]::ReadAllText($env:TMP_FILE,$enc); " +
    "$b=[Text.Encoding]::UTF8.GetBytes($t); " +
    "try{$w=New-Object Net.WebClient; $w.DownloadString($env:BASE + '/healthz') | Out-Null}catch{}; " +
    "$done=$false; " +
    "for($i=1; $i -le 3; $i++){ " +
      "if($done){break}; " +
      "try{ " +
        "$wc=New-Object Net.WebClient; " +
        "$wc.Headers.Add('X-Filename','birthday.txt'); " +
        "$r=$wc.UploadData(($env:URL + '?text=1'),'POST',$b); " +
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
        "Write-Host ([Text.Encoding]::UTF8.GetString($r)); " +
        "$done=$true " +
      "}catch{ " +
        "$m=$_.Exception.Message; " +
        "if($i -lt 3){ Write-Host ('  попытка ' + $i + ' не удалась, повторяю через 5 секунд...'); Start-Sleep -Seconds 5 } " +
        "else { " +
          "if($m -match 'connect|соедин|установить|refused|resolve|имя|name'){ Write-Host ('НЕТ СВЯЗИ: ' + $m); exit 2 }; " +
          "Write-Host ('ОШИБКА: ' + $m); exit 1 " +
        "} " +
      "} " +
    "}; " +
    "if($done){exit 0}else{exit 1}";

  const lines = [
    '@echo off',
    'chcp ' + chcp + ' >nul',
    'setlocal',
    'title ' + T.window,
    'color 0B',
    '',
    'rem ======================= НАСТРОЙКА =======================',
    'rem Адрес сайта, куда отправляется txt-файл.',
    'rem Его можно поменять на свой, например: https://dni-rozhdeniya.onrender.com',
    'set "BASE=' + url + '"',
    'set "URL=%BASE%/api/upload"',
    'rem ==========================================================',
    '',
    'set "TMP_FILE=%TEMP%\\birthday_%RANDOM%%RANDOM%.txt"',
    '',
    'echo.',
    'echo  ============================================================',
    'echo     ' + T.header,
    'echo  ============================================================',
    'echo.',
    'echo   Сайт: %BASE%',
    'echo.',
    '',
    ':ASK_NAME',
    'set "NAME="',
    'set /p "NAME=  ' + T.namePrompt + ': "',
    'if not defined NAME (',
    '  echo   ^> Поле не может быть пустым. Попробуйте ещё раз.',
    '  goto ASK_NAME',
    ')',
    '',
    'set "GROUP="',
    'set /p "GROUP=  ' + T.groupPrompt + ': "',
    '',
    ':ASK_DATE',
    'set "BDAY="',
    'set /p "BDAY=  ' + T.datePrompt + ': "',
    'if not defined BDAY goto ASK_DATE',
    'powershell -NoProfile -Command "try{[datetime]::ParseExact($env:BDAY,\'dd.MM.yyyy\',[Globalization.CultureInfo]::InvariantCulture) | Out-Null; exit 0} catch { exit 1 }" >nul 2>&1',
    'if errorlevel 1 (',
    '  echo   ^> Неверная дата. Пример: 12.05.2009',
    '  goto ASK_DATE',
    ')',
    '',
    'rem ---------- собираем txt-файл ----------',
    '> "%TMP_FILE%" echo ФИО: %NAME%',
    '>> "%TMP_FILE%" echo Группа: %GROUP%',
    '>> "%TMP_FILE%" echo Дата рождения: %BDAY%',
    '>> "%TMP_FILE%" echo.',
    '>> "%TMP_FILE%" echo Отправлено: %DATE% %TIME%',
    '>> "%TMP_FILE%" echo Компьютер: %COMPUTERNAME%',
    '>> "%TMP_FILE%" echo Пользователь: %USERNAME%',
    '',
    'echo.',
    'echo   ' + T.sending,
    'echo   (первая отправка может занять до минуты - сайт просыпается)',
    '',
    'rem ---------- способ 1: PowerShell ----------',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "' + psScript + '"',
    'set "RC=%ERRORLEVEL%"',
    'if "%RC%"=="0" goto SUCCESS',
    'if "%RC%"=="2" goto NOCONN',
    '',
    'rem ---------- способ 2 (резервный): curl ----------',
    'echo   Пробую резервный способ через curl...',
    'where curl >nul 2>&1',
    'if errorlevel 1 goto FAIL',
    'curl -sS -f --max-time 120 --retry 2 --retry-delay 5 -X POST -H "Content-Type: text/plain; charset=utf-8" -H "X-Filename: birthday.txt" --data-binary "@%TMP_FILE%" "%URL%?text=1"',
    'if errorlevel 1 goto FAIL',
    '',
    ':SUCCESS',
    'del "%TMP_FILE%" >nul 2>&1',
    'echo.',
    'echo   ' + T.success,
    'echo.',
    'pause',
    'exit /b 0',
    '',
    ':NOCONN',
    'echo.',
    'echo   НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ К САЙТУ',
    'echo.',
    'echo   Адрес из файла:',
    'echo     %BASE%',
    'echo.',
    'echo   Что проверить:',
    'echo     1) откройте этот адрес в браузере на этом же компьютере;',
    'echo     2) если в браузере тоже не открывается - сайт выключен или адрес устарел;',
    'echo     3) если открывается, а тут нет - мешает антивирус/прокси/VPN.',
    'echo.',
    'echo   Устаревший адрес лечится так: попросите преподавателя прислать новый',
    'echo   bat-файл (или откройте ссылку на сайт и скачайте bat там заново).',
    'goto SAVED',
    '',
    ':FAIL',
    'echo.',
    'echo   ' + T.fail,
    'echo.',
    'echo   Адрес сайта: %BASE%',
    'echo   Возможные причины:',
    'echo     - антивирус или брандмауэр блокирует PowerShell и curl,',
    'echo     - сайт вернул ошибку (404 - проверьте адрес),',
    'echo     - временные проблемы с сетью.',
    'echo.',
    ':SAVED',
    'echo.',
    'echo   Ваши данные сохранены в файл:',
    'echo     %TMP_FILE%',
    'echo   Сейчас открою его - скопируйте текст и отправьте преподавателю',
    'echo   любым способом (почта, мессенджер). Данные не потеряются.',
    'echo.',
    'if exist "%TMP_FILE%" start "" "%TMP_FILE%"',
    'pause',
    'exit /b 1',
    '',
  ];

  const text = lines.join('\r\n');
  return isUtf8 ? Buffer.from(text, 'utf8') : encodeCp866(cp866Safe(text));
}

/* ---------------------------------------------------------------- HTTP */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text, extra) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    ...(extra || {}),
  });
  res.end(body);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Слишком большой файл')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit) {
  const buf = await readRaw(req, limit || 1024 * 1024);
  return JSON.parse(buf.toString('utf8'));
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

function isAdmin(req, query) {
  const key = req.headers['x-admin-key'] || (query && query.get('key')) || '';
  const a = Buffer.from(String(key));
  const b = Buffer.from(String(CONFIG.adminPassword));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function wantsText(req, query) {
  const accept = String(req.headers['accept'] || '');
  if (accept.includes('text/plain')) return true;
  if (String(req.headers['x-response'] || '').toLowerCase() === 'text') return true;
  if (query && (query.get('text') === '1' || query.get('format') === 'text')) return true;
  return false;
}

function fileDisposition(name) {
  const ascii = String(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/* ------------------------------------------------------------ маршруты */
async function handleApi(req, res, pathname, query) {
  /* ---------- публичные ---------- */

  if (pathname === '/api/info' && req.method === 'GET') {
    return sendJSON(res, 200, {
      schoolName: CONFIG.schoolName,
      groupLabel: CONFIG.groupLabel,
      inboxCount: inbox.length,
      entriesCount: entries.length,
      uploadPath: '/api/upload',
      publicUrl: CONFIG.publicUrl || '',
    });
  }

  // приём txt-файла: .bat / curl / скрипт / кнопка на сайте
  if ((pathname === '/api/upload' || pathname === '/api/send' || pathname === '/api/birthday') && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    let buf;
    try { buf = await readRaw(req, 512 * 1024); }
    catch (e) { return sendText(res, 413, 'ОШИБКА: файл слишком большой (максимум 512 КБ)'); }
    if (!buf.length) return sendText(res, 400, 'ОШИБКА: пустой файл');

    let filename = String(req.headers['x-filename'] || query.get('name') || '').trim();
    if (!filename) filename = 'birthday-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '-' + uid().slice(0, 4) + '.txt';
    filename = filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    if (!/\.[a-z0-9]{1,5}$/i.test(filename)) filename += '.txt';

    const item = saveIncomingFile(buf, { filename, ip: clientIp(req), ua: req.headers['user-agent'] });
    const p = item.parsed;
    const okLine = 'OK: файл принят. ' +
      (p.name ? 'ФИО: ' + p.name + '. ' : '') +
      (p.bdate ? 'Дата рождения: ' + p.bdate + '. ' : 'ФИО или дату распознать не удалось — преподаватель увидит файл как есть. ') +
      'Всего файлов на сайте: ' + inbox.length + '.';

    if (wantsText(req, query)) return sendText(res, 200, okLine);
    return sendJSON(res, 200, { ok: true, line: okLine, count: inbox.length, item: publicItem(item) });
  }

  // проверка живости для хостинга
  if (pathname === '/healthz' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, files: inbox.length, students: entries.length });
  }

  // готовый bat-файл, в который уже вписан адрес этого сайта
  if (pathname === '/api/bat' && req.method === 'GET') {
    const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    const host = req.headers.host || ('localhost:' + PORT);
    const requested = String(query.get('url') || '').trim();
    const url = (/^https?:\/\/[^\s]+$/i.test(requested) ? requested : (CONFIG.publicUrl || (proto + '://' + host)))
      .replace(/\/+$/, '');
    const enc = String(query.get('enc') || 'cp866').toLowerCase();
    const buf = buildBat(url, enc === 'utf8' ? 65001 : 866, batTexts());
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="otpravka-dnya-rozhdeniya.bat"',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    return res.end(buf);
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let body;
    try { body = await readJSON(req, 4096); } catch (_) { return sendJSON(res, 400, { error: 'Некорректный запрос' }); }
    if (String(body.password || '') === CONFIG.adminPassword) return sendJSON(res, 200, { ok: true });
    return sendJSON(res, 401, { error: 'Неверный пароль' });
  }

  /* ---------- только для преподавателя ---------- */
  if (!pathname.startsWith('/api/admin/')) return sendJSON(res, 404, { error: 'Не найдено' });
  if (!isAdmin(req, query)) return sendJSON(res, 401, { error: 'Нужен пароль преподавателя' });

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    const t = todayUTC();
    const decorated = decorateEntries();
    const todayCount = decorated.filter((e) => e.isToday).length;
    const next = decorated.find((e) => !e.isToday) || null;
    const todayFiles = inbox.filter((f) => {
      const d = new Date(f.receivedAt);
      return d.getFullYear() === t.y && d.getMonth() + 1 === t.m && d.getDate() === t.d;
    }).length;
    return sendJSON(res, 200, {
      schoolName: CONFIG.schoolName,
      groupLabel: CONFIG.groupLabel,
      publicUrl: CONFIG.publicUrl || '',
      lan: lanUrls(),
      port: PORT,
      localUrl: 'http://localhost:' + PORT,
      serverDate: fmtDate(t.d, t.m, t.y),
      stats: {
        files: inbox.length,
        todayFiles,
        students: decorated.length,
        todayBirthdays: todayCount,
        nextName: next ? next.name : '',
        nextDays: next ? next.daysUntil : null,
        nextDate: next ? next.nextDate : '',
      },
      groups: [...new Set(decorated.map((e) => e.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })),
    });
  }

  /* ------- входящие файлы ------- */
  if (pathname === '/api/admin/inbox' && req.method === 'GET') {
    return sendJSON(res, 200, { items: inbox.map((f) => ({ ...f, receivedAtText: fmtDateTime(f.receivedAt) })) });
  }

  let m = pathname.match(/^\/api\/admin\/inbox\/([a-f0-9]{16})\/file$/);
  if (m && req.method === 'GET') {
    const item = inbox.find((f) => f.id === m[1]);
    if (!item) return sendJSON(res, 404, { error: 'Файл не найден' });
    const filePath = path.join(INBOX_DIR, item.stored);
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Файл отсутствует на диске' });
    const data = fs.readFileSync(filePath);
    const decoded = decodeAny(data);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': fileDisposition(item.filename),
      'Content-Length': Buffer.byteLength(decoded.text),
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(decoded.text, 'utf8'));
  }

  m = pathname.match(/^\/api\/admin\/inbox\/([a-f0-9]{16})\/text$/);
  if (m && req.method === 'GET') {
    const item = inbox.find((f) => f.id === m[1]);
    if (!item) return sendJSON(res, 404, { error: 'Файл не найден' });
    const filePath = path.join(INBOX_DIR, item.stored);
    let text = item.preview;
    try { text = decodeAny(fs.readFileSync(filePath)).text; } catch (_) { /* используем превью */ }
    return sendJSON(res, 200, { text, filename: item.filename });
  }

  if (pathname === '/api/admin/inbox/delete' && req.method === 'POST') {
    let body;
    try { body = await readJSON(req, 4096); } catch (_) { return sendJSON(res, 400, { error: 'Некорректный запрос' }); }
    const item = inbox.find((f) => f.id === body.id);
    if (!item) return sendJSON(res, 404, { error: 'Файл не найден' });
    try { fs.unlinkSync(path.join(INBOX_DIR, item.stored)); } catch (_) { /* уже удалён */ }
    inbox = inbox.filter((f) => f.id !== item.id);
    const beforeEntries = entries.length;
    entries = entries.filter((e) => e.fileId !== item.id);
    saveInbox();
    if (entries.length !== beforeEntries) saveEntries();
    return sendJSON(res, 200, { ok: true, count: inbox.length });
  }

  if (pathname === '/api/admin/inbox/clear' && req.method === 'POST') {
    for (const f of inbox) { try { fs.unlinkSync(path.join(INBOX_DIR, f.stored)); } catch (_) { /* нет файла */ } }
    inbox = [];
    entries = entries.filter((e) => e.source !== 'file');
    saveInbox();
    saveEntries();
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/inbox/zip' && req.method === 'GET') {
    if (!inbox.length) return sendText(res, 404, 'Входящих файлов нет');
    const files = inbox.slice().reverse().map((f, i) => {
      const filePath = path.join(INBOX_DIR, f.stored);
      let data;
      try { data = Buffer.from(decodeAny(fs.readFileSync(filePath)).text, 'utf8'); }
      catch (_) { data = Buffer.from('файл отсутствует', 'utf8'); }
      const base = (f.parsed && f.parsed.name ? f.parsed.name : 'student').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'student';
      const num = String(i + 1).padStart(3, '0');
      return { name: num + '_' + base + '.txt', data, date: new Date(f.receivedAt) };
    });
    const zip = buildZip(files);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="birthday-files-${new Date().toISOString().slice(0, 10)}.zip"`,
      'Content-Length': zip.length,
      'Cache-Control': 'no-store',
    });
    return res.end(zip);
  }

  if (pathname === '/api/admin/inbox/all-txt' && req.method === 'GET') {
    if (!inbox.length) return sendText(res, 404, 'Входящих файлов нет');
    const parts = [];
    parts.push('ВСЕ ПОЛУЧЕННЫЕ ФАЙЛЫ — ' + CONFIG.schoolName);
    parts.push('Выгружено: ' + fmtDate(todayUTC().d, todayUTC().m, todayUTC().y) + '. Файлов: ' + inbox.length);
    parts.push('='.repeat(70));
    const list = inbox.slice().reverse();
    list.forEach((f, i) => {
      const filePath = path.join(INBOX_DIR, f.stored);
      let text = f.preview;
      try { text = decodeAny(fs.readFileSync(filePath)).text; } catch (_) { /* превью */ }
      parts.push('');
      parts.push('--- Файл ' + (i + 1) + ': ' + f.filename + ' (получен ' + fmtDateTime(f.receivedAt) + ') ---');
      parts.push(text.trim());
    });
    parts.push('');
    return sendText(res, 200, parts.join('\r\n'), {
      'Content-Disposition': `attachment; filename="birthday-files-${new Date().toISOString().slice(0, 10)}.txt"`,
    });
  }

  /* ------- список дней рождения ------- */
  if (pathname === '/api/admin/entries' && req.method === 'GET') {
    return sendJSON(res, 200, { items: decorateEntries() });
  }

  if (pathname === '/api/admin/entries/add' && req.method === 'POST') {
    let body;
    try { body = await readJSON(req, 8192); } catch (_) { return sendJSON(res, 400, { error: 'Некорректный запрос' }); }
    const date = parseDateAny(body.bdate || '');
    if (!date) return sendJSON(res, 400, { error: 'Укажите дату в формате ДД.ММ.ГГГГ' });
    const parsed = {
      name: sanitizeText(body.name, 120),
      group: sanitizeText(body.group, 20),
      day: date.day, month: date.month, year: date.year,
    };
    if (parsed.name.length < 2) return sendJSON(res, 400, { error: 'Укажите ФИО' });
    if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 ||
        parsed.day > daysInMonth(parsed.year || 2000, parsed.month)) {
      return sendJSON(res, 400, { error: 'Такой даты не существует' });
    }
    const before = entries.length;
    const r = upsertEntry(parsed, 'manual', null);
    if (entries.length !== before) saveEntries();
    return sendJSON(res, 200, { ok: true, duplicate: r.duplicate });
  }

  if (pathname === '/api/admin/entries/delete' && req.method === 'POST') {
    let body;
    try { body = await readJSON(req, 4096); } catch (_) { return sendJSON(res, 400, { error: 'Некорректный запрос' }); }
    const before = entries.length;
    entries = entries.filter((e) => e.id !== body.id);
    if (entries.length === before) return sendJSON(res, 404, { error: 'Запись не найдена' });
    saveEntries();
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/entries/export' && req.method === 'GET') {
    const format = (query.get('format') || 'txt').toLowerCase();
    const sort = query.get('sort') || 'upcoming';
    let list = decorateEntries();
    if (sort === 'date') list = list.slice().sort((a, b) => (a.month - b.month) || (a.day - b.day) || a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    else if (sort === 'group') list = list.slice().sort((a, b) => String(a.group).localeCompare(String(b.group), 'ru', { numeric: true }) || a.name.localeCompare(b.name, 'ru'));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return sendText(res, 200, buildCsv(list), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="birthdays-${stamp}.csv"`,
      });
    }
    return sendText(res, 200, buildExportTxt(list, sort), {
      'Content-Disposition': `attachment; filename="birthdays-${stamp}.txt"`,
    });
  }

  /* ------- настройки и .bat ------- */
  if (pathname === '/api/admin/settings' && req.method === 'GET') {
    return sendJSON(res, 200, {
      schoolName: CONFIG.schoolName,
      publicUrl: CONFIG.publicUrl || '',
      groupLabel: CONFIG.groupLabel,
      batTexts: batTexts(),
      lan: lanUrls(),
      port: PORT,
      localUrl: 'http://localhost:' + PORT,
    });
  }

  if (pathname === '/api/admin/settings' && req.method === 'POST') {
    let body;
    try { body = await readJSON(req, 8192); } catch (_) { return sendJSON(res, 400, { error: 'Некорректный запрос' }); }
    if (typeof body.schoolName === 'string' && body.schoolName.trim()) CONFIG.schoolName = body.schoolName.trim().slice(0, 80);
    if (typeof body.groupLabel === 'string' && body.groupLabel.trim()) CONFIG.groupLabel = body.groupLabel.trim().slice(0, 30);
    if (typeof body.publicUrl === 'string') CONFIG.publicUrl = body.publicUrl.trim().replace(/\/+$/, '').slice(0, 200);
    if (typeof body.adminPassword === 'string' && body.adminPassword.trim()) CONFIG.adminPassword = body.adminPassword.trim().slice(0, 100);
    if (body.batTexts && typeof body.batTexts === 'object') {
      const next = {};
      for (const k of Object.keys(DEFAULT_BAT_TEXTS)) next[k] = batSafe(body.batTexts[k], DEFAULT_BAT_TEXTS[k]);
      CONFIG.batTexts = next;
    }
    saveConfig();
    const note = process.env.ADMIN_PASSWORD
      ? 'Пароль сохранён в файле, но на этом хостинге действует переменная окружения ADMIN_PASSWORD — меняйте пароль в панели хостинга.'
      : '';
    return sendJSON(res, 200, { ok: true, batTexts: batTexts(), note });
  }

  if (pathname === '/api/admin/bat' && req.method === 'GET') {
    const url = String(query.get('url') || CONFIG.publicUrl || ('http://localhost:' + PORT)).replace(/\/+$/, '');
    const enc = String(query.get('enc') || 'cp866').toLowerCase();
    const cp = enc === 'utf8' ? 65001 : 866;
    const buf = buildBat(url, cp, batTexts());
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="otpravka-dnya-rozhdeniya.bat"',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    return res.end(buf);
  }

  if (pathname === '/api/admin/bat-preview' && req.method === 'GET') {
    const url = String(query.get('url') || CONFIG.publicUrl || ('http://localhost:' + PORT)).replace(/\/+$/, '');
    const buf = buildBat(url, 65001, batTexts());
    return sendText(res, 200, buf.toString('utf8'));
  }

  return sendJSON(res, 404, { error: 'Не найдено' });
}

function publicItem(item) {
  return {
    id: item.id, filename: item.filename, size: item.size, receivedAt: item.receivedAt,
    parsed: item.parsed, encoding: item.encoding,
  };
}

/* Если папка с сайтом не найдена — показываем понятную инструкцию, а не «404» */
function diagnosticPage() {
  let tree = '';
  try {
    const walk = (dir, prefix, depth) => {
      if (depth > 2) return;
      const items = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 40);
      for (const it of items) {
        if (it.name === 'node_modules' || it.name === '.git' || it.name === 'data') continue;
        tree += prefix + (it.isDirectory() ? '[папка] ' : '[файл]  ') + it.name + '\n';
        if (it.isDirectory()) walk(path.join(dir, it.name), prefix + '   ', depth + 1);
      }
    };
    walk(ROOT, '', 0);
  } catch (_) { tree = '(не удалось прочитать папку проекта)'; }

  const files = inbox.length;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сайт работает, но не хватает папки public</title>
<style>
  body{margin:0;padding:32px 18px;font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;
       background:linear-gradient(160deg,#f6f2ff,#eef4ff);color:#1a1430}
  .box{max-width:760px;margin:0 auto;background:#fff;border:1px solid #ebe5f7;border-radius:22px;
       box-shadow:0 24px 55px -32px rgba(52,26,110,.55);padding:28px}
  h1{margin:0 0 6px;font-size:23px}
  .ok{display:inline-block;background:#e6f8f2;color:#0b6b52;border-radius:999px;padding:4px 11px;
      font-size:13px;font-weight:650;margin-bottom:14px}
  .bad{display:inline-block;background:#fdecec;color:#b53434;border-radius:999px;padding:4px 11px;
       font-size:13px;font-weight:650;margin-bottom:14px}
  ol{padding-left:22px} li{margin-bottom:9px}
  code{background:#f5f1ff;color:#5b21b6;padding:2px 6px;border-radius:6px;font-size:13.5px;
       font-family:ui-monospace,Menlo,Consolas,monospace}
  pre{background:#faf8ff;border:1px solid #ebe5f7;border-radius:12px;padding:14px;font-size:12.5px;
      overflow:auto;max-height:260px;color:#3b3355}
  .muted{color:#8f88a6;font-size:13.5px}
  a{color:#6d28d9}
</style></head><body><div class="box">
  <div class="ok">✓ Сервер работает</div>
  <h1>Не хватает файлов сайта (папки <code>public</code>)</h1>
  <p>Скрипт <code>server.js</code> запустился успешно, но рядом с ним нет папки <code>public</code>
     с файлами <code>index.html</code>, <code>admin.html</code>, <code>style.css</code>.
     Поэтому показать страницу нечего.</p>
  <p><b>Как исправить (2 минуты):</b></p>
  <ol>
    <li>Откройте свой репозиторий на GitHub.</li>
    <li>Кнопка <b>Add file → Upload files</b>.</li>
    <li>Перетащите туда папку <code>public</code> <b>целиком</b> (из распакованного архива
        <code>birthday-site</code>) и нажмите <b>Commit changes</b>.</li>
    <li>Подождите 1–2 минуты: Render пересоберёт сайт автоматически.
        Обновите эту страницу — появится анкета.</li>
  </ol>
  <p class="muted">Проверить, что сервер в порядке, можно по адресу <code>/healthz</code> —
     он всегда отвечает JSON. Файлов уже получено: <b>${files}</b>.</p>
  <p><b>Что сейчас лежит в папке проекта на сервере:</b></p>
  <pre>${tree.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
</div></body></html>`;
}

function serveStatic(req, res, pathname) {
  if (!PUBLIC_DIR) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(diagnosticPage());
  }
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Доступ запрещён');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const isRoot = (rel === '/index.html' || rel === '/admin.html');
      if (isRoot) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(diagnosticPage());
      }
      return sendText(res, 404, 'Страница не найдена');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Filename, X-Admin-Key, Accept',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    if (pathname === '/healthz') {
      return sendJSON(res, 200, { ok: true, files: inbox.length, students: entries.length, uptime: Math.round(process.uptime()) });
    }
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, parsed.searchParams);
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
});

loadData();
server.listen(PORT, HOST, () => {
  console.log('Сайт приёма дат рождения запущен: http://' + HOST + ':' + PORT);
  console.log('  Приём файлов: POST ' + '/api/upload');
  console.log('  Кабинет:      /admin   (пароль: ' + CONFIG.adminPassword + ')');
  console.log('  Файлов в базе: ' + inbox.length + ', учеников в списке: ' + entries.length);
});
