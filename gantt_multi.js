/**
 * PIXBI Gantt MULTI — вариант для НЕСКОЛЬКИХ отдельных категорий PIX BI.
 *
 * Классическая диаграмма Ганта по трудозатратам:
 *   слева 3 колонки: Номер ЗНИ | Исполнитель | Практика
 *   справа календарь по дням, ячейка дня закрашена по сумме timeworked_h
 *
 * Отличие от gantt.js: рассчитан на режим данных «Все категории», где
 * getItemData возвращает плоскую таблицу
 *   { values: [...], columns: [...] }
 * и каждая категория (dt, zni_number, full_name, practice, qrt, epic_summary)
 * приходит отдельной колонкой. Склейка в gantt_key НЕ требуется.
 *
 * Конфигурация блока PIX BI:
 *   Настройки → режим данных «Все категории».
 *   Категории — отдельные поля:
 *       dt, zni_number, full_name, practice, qrt
 *       (+ epic_summary, если нужно описание ЗНИ в подсказке)
 *   Меры — SUM(timeworked_h) (обязательно).
 *   Серии — пусто.
 *
 * gantt.js (вариант с одной категорией и gantt_key) остаётся без изменений.
 * Этот файл — самостоятельный: копируется в блок вместо gantt.js.
 *
 * Фильтры по остальным полям (status_zni, project_name, epic_status и т.д.)
 * настраиваются штатными фильтрами PIX BI — визуал получает уже
 * отфильтрованные строки. Внутри визуала есть только селектор квартала.
 *
 * BLOCK_ID должен совпадать с ID блока PIX BI (DOM-элементом для рендера).
 */

(async function () {
  'use strict';

  // ====== ID блока PIX BI ======
  // В проде BLOCK_ID = ID блока. В локальном стенде переопределяется
  // через window.__GANTT_MULTI_BLOCK_ID__ (или __GANTT_BLOCK_ID__).
  const BLOCK_ID =
    (typeof window !== 'undefined' && window.__GANTT_MULTI_BLOCK_ID__) ||
    (typeof window !== 'undefined' && window.__GANTT_BLOCK_ID__) ||
    'vv86tlu5j3ljm7amqnvi2sj3nwqx0ax3';

  // ====== Константы ======
  const FONT_FAMILY =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const DAY_MS = 86400000;

  // Разделитель полей устаревшего единого поля gantt_key.
  // В этом варианте не нужен: категории приходят отдельными колонками.
  // Оставлен только как fallback, чтобы старый ключ тоже читался.
  const KEY_SEP = '|~|';

  // Версия скрипта — видна в шапке, чтобы можно было убедиться,
  // что PIX BI подхватил новую версию, а не закешировал старую.
  const GANTT_VERSION = '1.0-multi';

  const ROW_H = 26;          // высота строки, px
  const LEFT_W = 500;        // ширина левой панели (3 колонки)
  const GRID_TOP = 46;       // место под подписи месяцев (ось сверху)
  const GRID_BOTTOM = 44;    // место под слайдер
  const GRID_RIGHT = 24;

  // Ширины колонок левой панели (в сумме LEFT_W - 22)
  const COL_ZNI = 106;
  const COL_DOT = 14;
  const COL_NAME = 190;
  const COL_PRACTICE = 168;

  const MONTHS_SHORT = [
    'янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'
  ];
  const ROMAN_Q = ['I', 'II', 'III', 'IV'];
  const ROMAN_TO_Q = { I: 1, II: 2, III: 3, IV: 4 };

  // Цвета практик (не пересекаются с синей шкалой часов).
  // Запас на будущее: 18 различимых цветов; сейчас в данных 2 практики.
  // Назначаются по алфавиту названий, лишние при появлении новых практик.
  const PRACTICE_COLORS = [
    '#0d9488', '#d97706', '#7c3aed', '#e11d48',
    '#65a30d', '#0891b2', '#c026d3', '#ea580c',
    '#4f46e5', '#059669', '#ca8a04', '#db2777',
    '#0284c7', '#dc2626', '#7e22ce', '#0f766e',
    '#92400e', '#4d7c0f'
  ];

  // ====== Утилиты ======
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function toDayMs(v) {
    if (v instanceof Date) {
      return Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
    }

    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = Math.trunc(v);
      const ns = String(n);
      // yyyymmdd / yyyymmddHHMMSS
      if (/^(19|20)\d{6}$/.test(ns)) {
        return Date.UTC(+ns.slice(0, 4), +ns.slice(4, 6) - 1, +ns.slice(6, 8));
      }
      if (/^(19|20)\d{12}$/.test(ns)) {
        return Date.UTC(+ns.slice(0, 4), +ns.slice(4, 6) - 1, +ns.slice(6, 8));
      }
      // секунды / миллисекунды
      const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
      const d = new Date(ms);
      if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 1900) return NaN;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    const s = String(v == null ? '' : v).trim();
    if (!s) return NaN;

    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);

    // 29.01.2025 / 29/01/2025
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);

    // 2025/01/29
    m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);

    // 20250129
    m = s.match(/^(\d{8})$/);
    if (m && /^(19|20)/.test(s)) {
      return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    }

    const t = Date.parse(s);
    if (Number.isFinite(t)) {
      const d = new Date(t);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    return NaN;
  }

  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  function fmtDayHuman(ms) {
    const d = new Date(ms);
    return (
      String(d.getUTCDate()).padStart(2, '0') + '.' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '.' +
      d.getUTCFullYear()
    );
  }

  function num(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
    return s === '' ? NaN : Number(s);
  }

  /** Распаковка ячейки PIX BI вида { value: 4 }, { name: 'x' } или {value:[4]}. */
  function plain(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('value' in v) {
        const x = v.value;
        return Array.isArray(x) ? x[0] : x;
      }
      if (typeof v.name === 'string' || typeof v.name === 'number') {
        return v.name;
      }
    }
    return v;
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[c]));
  }

  /** JSON для диагностики: без падений на циклах, с ограничением длины. */
  function safeJson(v, max) {
    let s;
    try {
      const seen = new WeakSet();
      s = JSON.stringify(v, function (_k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[circular]';
          seen.add(val);
        }
        return val;
      });
    } catch (e) {
      s = String(v);
    }
    if (s == null) s = String(v);
    const lim = max || 400;
    return s.length > lim ? s.slice(0, lim) + '…' : s;
  }

  /** Текстовая диагностика ответа getItemData — печатается прямо в блоке. */
  function describeData(data) {
    const lines = [];

    if (data == null) {
      lines.push('getItemData вернул: ' + String(data));
      return lines.join('\n');
    }
    if (typeof data !== 'object') {
      lines.push('getItemData вернул ' + typeof data + ': ' + String(data).slice(0, 300));
      return lines.join('\n');
    }

    lines.push('Ключи ответа: ' + Object.keys(data).join(', '));

    const cols = Array.isArray(data.columns) ? data.columns : null;
    if (cols) {
      lines.push('columns (' + cols.length + '):');
      cols.slice(0, 15).forEach(function (c, i) {
        if (c == null) {
          lines.push('  [' + i + '] null');
        } else if (typeof c === 'string') {
          lines.push('  [' + i + '] "' + c + '"');
        } else {
          lines.push('  [' + i + '] name="' + (c.name == null ? '' : c.name) +
            '" alias="' + (c.alias == null ? '' : c.alias) + '"' +
            (c.type ? ' type="' + c.type + '"' : ''));
        }
      });
      if (cols.length > 15) lines.push('  … ещё ' + (cols.length - 15));
    } else {
      lines.push('columns: нет');
    }

    let rows = null;
    let src = '';
    if (Array.isArray(data.values)) { rows = data.values; src = 'values'; }
    else if (Array.isArray(data.data)) { rows = data.data; src = 'data'; }
    else if (Array.isArray(data.rows)) { rows = data.rows; src = 'rows'; }
    else if (Array.isArray(data.categories)) { rows = data.categories; src = 'categories'; }

    if (rows) {
      lines.push(src + ': массив, строк ' + rows.length);
      if (rows.length) lines.push('первая строка: ' + safeJson(rows[0], 600));
      if (rows.length > 1) lines.push('вторая строка: ' + safeJson(rows[1], 600));
    } else if (data.values && typeof data.values === 'object') {
      const keys = Object.keys(data.values);
      lines.push('values: объект, ключи ' + keys.join(', '));
      if (keys.length) {
        const arr = data.values[keys[0]];
        lines.push('values[' + keys[0] + '][0..2]: ' +
          safeJson(Array.isArray(arr) ? arr.slice(0, 3) : arr, 300));
      }
    } else {
      lines.push('values/data/rows/categories: массивов нет');
    }

    if (Array.isArray(data.measures)) {
      lines.push('measures: ' + safeJson(data.measures.slice(0, 2), 400));
    }

    // Прочие служебные ключи: вдруг там лежат остальные категории.
    for (const k of ['metadata', 'variables', 'references', 'referenceLines',
      'customValues', 'conditional_format']) {
      if (data[k] === undefined) continue;
      lines.push(k + ': ' + safeJson(data[k], 700));
    }

    // Что за функция getItemData и нет ли рядом более богатого API.
    try {
      if (typeof getItemData === 'function') {
        lines.push('getItemData: арность ' + getItemData.length +
          ', ' + String(getItemData).slice(0, 200));
      }
      const names = Object.keys(window).filter(function (k) {
        return /^(get|load|fetch|pix)/i.test(k) &&
          /(data|item|block|chart|cube|dataset|query|visual)/i.test(k);
      });
      if (names.length) lines.push('Похожие глобальные функции: ' + names.join(', '));
    } catch (e) { /* ignore */ }

    return lines.join('\n');
  }

  /** Экранирование для rich-текста ECharts: {style|text}. */
  function escRich(s) {
    return String(s == null ? '' : s)
      .replace(/[{}]/g, '')
      .replace(/\|/g, '／');
  }

  function plural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function isDarkColor(c) {
    const s = String(c || '').trim();
    let r, g, b;
    const hex = s.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      const rgb = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
      if (!rgb) return false;
      r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
    }
    if (![r, g, b].every(Number.isFinite)) return false;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
  }

  // ====== Кварталы ======
  function quarterFromDate(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + ROMAN_Q[Math.floor(d.getUTCMonth() / 3)];
  }

  function qrtBounds(qrt) {
    const m = String(qrt || '').match(/^(\d{4})\s*-\s*(IV|III|II|I)$/i);
    if (!m) return null;
    const q = ROMAN_TO_Q[m[2].toUpperCase()];
    if (!q) return null;
    return {
      start: Date.UTC(+m[1], (q - 1) * 3, 1),
      end: Date.UTC(+m[1], q * 3, 0) // последний день квартала
    };
  }

  function qrtSortKey(qrt) {
    const m = String(qrt || '').match(/^(\d{4})\s*-\s*(IV|III|II|I)$/i);
    if (!m) return 0;
    return +m[1] * 10 + ROMAN_TO_Q[m[2].toUpperCase()];
  }

  // ====== Поиск полей в табличном формате ======
  // В блоке PIX BI поля выбираются отдельными колонками, без склейки в один ключ.
  const FIELDS = {
    dt: ['dt', 'work_date', 'date', 'Дата', 'дата'],
    zni: ['zni_number', 'ЗНИ', 'Номер ЗНИ', 'zni', 'nomer_zni'],
    person: ['full_name', 'Исполнитель', 'ФИО', 'Сотрудник', 'person', 'executor'],
    practice: ['practice', 'Практика', 'практика', 'Отдел'],
    qrt: ['qrt', 'Квартал', 'квартал'],
    // Описание ЗНИ: явные имена колонок, затем наиболее вероятные поля датасета.
    zniInfo: [
      'zniInfo', 'zni_name', 'zni_desc', 'zni_info', 'zni_description',
      'Описание ЗНИ', 'Название ЗНИ', 'epic_summary', 'summary'
    ],
    hours: [
      'timeworked_h', 'sum_timeworked_h', 'SUM(timeworked_h)',
      'Сумма timeworked_h', 'Часы', 'часы',
      'Продолжительность работы', 'hours', 'timeworked',
      // legacy categories: мера без имени колонки
      'value'
    ]
  };

  function fieldOf(rec, keys) {
    for (const k of keys) {
      if (rec[k] === undefined || rec[k] === null) continue;
      const v = plain(rec[k]);
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return null;
  }

  // Явные метки частей составного ключа: "zni_name=Описание ЗНИ".
  // Нужны для полей, которые нельзя распознать по форме значения
  // (описания, статусы): иначе их примут за ФИО, практику и т.п.
  const KEY_LABELS = {
    dt: ['dt', 'дата', 'date'],
    zni: ['zni', 'зни', 'номер_зни', 'zni_number'],
    person: ['person', 'фио', 'исполнитель', 'сотрудник', 'executor'],
    practice: ['practice', 'практика', 'отдел'],
    qrt: ['qrt', 'квартал'],
    zniInfo: [
      'zni_name', 'zni_desc', 'zni_info', 'zni_description',
      'desc', 'описание', 'название', 'summary', 'epic_summary'
    ]
  };

  function keyFieldFor(label) {
    const l = String(label).toLowerCase().replace(/ё/g, 'е').trim();
    for (const field of Object.keys(KEY_LABELS)) {
      if (KEY_LABELS[field].indexOf(l) !== -1) return field;
    }
    return null;
  }

  // ====== DOM / состояние ======
  const el = document.getElementById(BLOCK_ID);
  if (!el) {
    console.error('PIXBI Gantt: DOM-элемент #' + BLOCK_ID + ' не найден. Проверь BLOCK_ID.');
    return;
  }

  // Повторный запуск скрипта в том же блоке — освобождаем прошлый instance
  if (el.__pixbiGanttChart) {
    try { el.__pixbiGanttChart.dispose(); } catch (e) { /* ignore */ }
    el.__pixbiGanttChart = null;
  }

  function showMessage(html, color) {
    // Атрибут в одинарных кавычках: FONT_FAMILY содержит "Segoe UI" в двойных.
    el.innerHTML =
      '<div style=\'padding:16px 18px;font:13px/1.55 ' + FONT_FAMILY +
      ';color:' + (color || '#b91c1c') + ';white-space:pre-wrap;overflow:auto;height:100%\'>' +
      html + '</div>';
  }

  // ====== Загрузка данных ======
  if (typeof getItemData !== 'function') {
    showMessage('Ошибка: функция getItemData недоступна. Визуал должен запускаться внутри блока PIX BI.');
    return;
  }

  let itemData;
  try {
    itemData = await getItemData(BLOCK_ID);
  } catch (e) {
    console.error('PIXBI Gantt: ошибка getItemData(' + BLOCK_ID + '):', e);
    showMessage('Не удалось загрузить данные блока ' + escHtml(BLOCK_ID) + ':\n' + escHtml(String(e)));
    return;
  }

  // ====== Нормализация строк ======
  // Внутренняя запись: { dtMs, zni, person, practice, qrt, hours, zniInfo }
  // Каждое поле читается из своей колонки таблицы — без склейки в один ключ.
  let normStats = null; // заполняется в normalizeData, печатается в диагностике
  function normalizeData(data) {
    const out = [];
    const stats = normStats = {
      seen: 0, noDt: 0, noZni: 0, badDt: 0, ok: 0,
      dtSample: null, zniSample: null, hoursSample: null
    };

    function pushRecord(dtMs, zni, person, practice, qrt, hours, zniInfo) {
      if (!Number.isFinite(dtMs) || !zni) return;
      stats.ok++;
      out.push({
        dtMs,
        zni: String(zni).trim(),
        person: String(person == null ? '' : person).trim() || '—',
        practice: String(practice == null ? '' : practice).trim() || '—',
        qrt: String(qrt == null ? '' : qrt).trim(),
        hours: Number.isFinite(hours) ? hours : 0,
        zniInfo: String(zniInfo == null ? '' : zniInfo).trim()
      });
    }

    // Мера в режиме «Все категории» может называться выражением
    // SUM('v_serv_jira_zni_gant'[timeworked_h]) или произвольным алиасом.
    // Если точного имени нет в FIELDS, ищем колонку по подстроке.
    function readHours(rec) {
      const exact = num(fieldOf(rec, FIELDS.hours));
      if (Number.isFinite(exact)) return exact;
      for (const k of Object.keys(rec)) {
        if (!/timeworked|hours|\bчас/i.test(k)) continue;
        const n = num(plain(rec[k]));
        if (Number.isFinite(n)) return n;
      }
      return NaN;
    }

    function readRecord(rec, hoursOverride) {
      stats.seen++;

      const dt = fieldOf(rec, FIELDS.dt);
      const zni = fieldOf(rec, FIELDS.zni);

      if (stats.dtSample === null && dt != null) stats.dtSample = String(dt);
      if (stats.zniSample === null && zni != null) stats.zniSample = String(zni);

      if (dt == null) { stats.noDt++; return; }
      if (zni == null) { stats.noZni++; return; }

      const dtMs = toDayMs(dt);
      if (!Number.isFinite(dtMs)) { stats.badDt++; return; }

      const hours = hoursOverride !== undefined
        ? hoursOverride
        : readHours(rec);

      if (stats.hoursSample === null && Number.isFinite(hours)) {
        stats.hoursSample = String(hours);
      }

      pushRecord(
        dtMs,
        zni,
        fieldOf(rec, FIELDS.person),
        fieldOf(rec, FIELDS.practice),
        fieldOf(rec, FIELDS.qrt),
        hours,
        fieldOf(rec, FIELDS.zniInfo)
      );
    }

    // Имена, под которыми значение колонки доступно в строке.
    function colKeys(c, j) {
      const keys = [];
      if (typeof c === 'string') {
        if (c.trim() !== '') keys.push(c);
      } else if (c && typeof c === 'object') {
        for (const k of [c.name, c.alias, c.id, c.key, c.title]) {
          if (k != null && String(k).trim() !== '') keys.push(k);
        }
      }
      keys.push(String(j));
      return keys;
    }

    // Значение похоже на дату (без ложных срабатываний на номерах ЗНИ).
    function looksLikeDate(s) {
      return /^(19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}([ T]|$)/.test(s) ||
        /^\d{1,2}[./]\d{1,2}[./](19|20)\d{2}/.test(s) ||
        /^(19|20)\d{6}$/.test(s);
    }

    // Универсальный разделитель частей составного ключа.
    // |~| — рекомендуемый; остальные — на случай других формул.
    function splitKey(name) {
      const seps = [KEY_SEP, '\u001F', '§', '||'];
      for (const sep of seps) {
        if (name.indexOf(sep) !== -1) {
          return name.split(sep).map((s) => s.trim());
        }
      }
      return null;
    }

    // Старый формат PIX BI не отдаёт columns — пытаемся распознать поля
    // по форме значений (порядок колонок в блоке может быть любым).
    function guessRecord(vals) {
      const rec = {};
      const rest = [];

      for (const raw of vals) {
        const v = plain(raw);
        if (v == null) continue;
        const s = String(v).trim();
        if (!s) continue;

        // Явная метка части: "zni_name=Описание ЗНИ". Позволяет добавлять
        // в ключ любые текстовые поля, не ломая распознавание по форме.
        const lm = /^([A-Za-zА-Яа-яЁё_]{1,40})\s*=\s*([\s\S]*)$/.exec(s);
        if (lm) {
          const field = keyFieldFor(lm[1]);
          const val = lm[2].trim();
          if (field && val !== '') {
            if (rec[field] === undefined) rec[field] = val;
            continue;
          }
        }

        if (rec.dt === undefined && looksLikeDate(s)) { rec.dt = s; continue; }
        rest.push(s);
      }

      // Квартал: 2026-I / 2026-II / 2026-Q1
      for (let i = 0; i < rest.length; i++) {
        if (rec.qrt === undefined &&
          /^(19|20)\d{2}\s*[-_/]?\s*(I|II|III|IV|Q[1-4])$/i.test(rest[i])) {
          rec.qrt = rest.splice(i, 1)[0];
          break;
        }
      }

      // ЗНИ — обычно длинное число
      for (let i = 0; i < rest.length; i++) {
        if (rec.zni === undefined && /^\d{4,}$/.test(rest[i])) {
          rec.zni = rest.splice(i, 1)[0];
          break;
        }
      }

      // Практика/отдел — по характерным словам
      for (let i = 0; i < rest.length; i++) {
        if (rec.practice === undefined &&
          /практик|отдел|департамент|управлен|направлен|служб|групп/i.test(rest[i])) {
          rec.practice = rest.splice(i, 1)[0];
          break;
        }
      }

      // Исполнитель — ФИО из 2+ слов
      for (let i = 0; i < rest.length; i++) {
        if (rec.person === undefined &&
          rest[i].split(/\s+/).length >= 2 &&
          /[A-Za-zА-Яа-яЁё]/.test(rest[i])) {
          rec.person = rest.splice(i, 1)[0];
          break;
        }
      }

      if (rest.length) {
        if (rec.zni === undefined) rec.zni = rest.shift();
        if (rec.person === undefined && rest.length) rec.person = rest.shift();
        if (rec.practice === undefined && rest.length) rec.practice = rest.shift();
      }

      // Осталось одно числовое значение — это мера (часы).
      if (rest.length === 1 && Number.isFinite(num(rest[0]))) {
        rec.hours = rest[0];
      }

      return rec;
    }

    // Строка-кортеж (массив значений) → запись.
    function readTuple(cells, hours) {
      const rec = {};
      cells.forEach((cell, j) => {
        const v = plain(cell);
        for (const k of colKeys(cols[j], j)) rec[k] = v;
      });

      // columns нет (или имена не совпали) — распознаём по значениям.
      if (!fieldOf(rec, FIELDS.dt) || !fieldOf(rec, FIELDS.zni)) {
        const g = guessRecord(cells);
        for (const k of Object.keys(g)) rec[k] = g[k];
      }

      readRecord(rec, hours);
    }

    // Приводим одну строку таблицы к плоскому объекту { имяКолонки: значение }
    function handleRow(raw, cols) {
      if (raw == null) return;

      const rec = {};

      if (Array.isArray(raw)) {
        raw.forEach((cell, j) => {
          const v = plain(cell);
          for (const k of colKeys(cols[j], j)) rec[k] = v;
        });
      } else if (typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) rec[k] = plain(v);

        // Колонки могут быть keyed по id/alias/name/индексу — пробрасываем
        // значение под все известные имена, чтобы fieldOf нашёл поле.
        cols.forEach((c, j) => {
          const keys = colKeys(c, j).filter((k) => k !== String(j));
          let v;
          for (const k of keys) {
            if (rec[k] !== undefined) { v = rec[k]; break; }
          }
          if (v === undefined && rec[String(j)] !== undefined) v = rec[String(j)];
          if (v === undefined) return;
          for (const k of keys) {
            if (rec[k] === undefined) rec[k] = v;
          }
        });
      }

      readRecord(rec);
    }

    const cols = Array.isArray(data && data.columns) ? data.columns : [];

    // --- 0) легаси-API: одна категория, поля склеены в gantt_key ---
    // getItemData этой версии PIX BI отдаёт только первую категорию:
    //   categories[i] = { name: "dt|~|zni|~|person|~|practice|~|qrt",
    //                     series: [{ name: "SUM(...)", value: "2" }] }
    // Универсально: 2..N частей, порядок и состав определяются по форме значений.
    if (!out.length && data && Array.isArray(data.categories)) {
      for (const c of data.categories) {
        if (!c || typeof c !== 'object') continue;

        const name = plain(c.name);
        if (typeof name !== 'string') continue;

        const parts = splitKey(name);
        if (!parts) continue; // одиночная категория — разбирается ниже

        let h;
        if (Array.isArray(c.series) && c.series.length) {
          const s0 = c.series[0];
          const raw = s0 && typeof s0 === 'object' ? s0.value : s0;
          h = num(Array.isArray(raw) ? raw[0] : raw);
        }

        readRecord(guessRecord(parts), h);
      }
    }

    // --- 1) табличный формат values / data / rows (как в gant_example.js) ---
    let rows = null;
    if (Array.isArray(data)) rows = data;
    else if (data && Array.isArray(data.values)) rows = data.values;
    else if (data && Array.isArray(data.data)) rows = data.data;
    else if (data && Array.isArray(data.rows)) rows = data.rows;

    if (rows) {
      for (const raw of rows) handleRow(raw, cols);
    }

    // --- 2) categories как массив записей с отдельными полями ---
    if (!out.length && data && Array.isArray(data.categories)) {
      for (const c of data.categories) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        if (Array.isArray(c.name)) continue; // legacy-формат, см. п. 5
        readRecord(c);
      }
    }

    // --- 3) categories как объект массивов {dt: [...], zni: [...], ...} ---
    if (!out.length && data && data.categories &&
      !Array.isArray(data.categories) && typeof data.categories === 'object') {
      const cats = data.categories;
      const keys = Object.keys(cats);
      const len = keys.reduce(
        (m, k) => Math.max(m, Array.isArray(cats[k]) ? cats[k].length : 0), 0
      );
      for (let i = 0; i < len; i++) {
        const rec = {};
        for (const k of keys) {
          rec[k] = Array.isArray(cats[k]) ? plain(cats[k][i]) : undefined;
        }
        readRecord(rec);
      }
    }

    // categories-кортежи: обычно строк больше, чем колонок. Если наоборот —
    // значит это массив колонок (транспонированный формат).
    const catsArr = data && Array.isArray(data.categories) ? data.categories : null;
    const transposed = !!(catsArr && catsArr.length > 0 && catsArr.length < 20 &&
      catsArr.every(Array.isArray) && catsArr[0].length > catsArr.length);

    // --- 4a) categories как массив колонок: [[значения колонки 0], [колонки 1], ...] ---
    if (!out.length && transposed) {
      const nRows = catsArr[0].length;
      for (let i = 0; i < nRows; i++) {
        readTuple(catsArr.map((col) => col[i]));
      }
    }

    // --- 4) categories как массив кортежей: [значение0, значение1, ...] ---
    if (!out.length && catsArr && !transposed) {
      for (const c of catsArr) {
        if (Array.isArray(c)) readTuple(c);
      }
    }

    // --- 5) legacy categories: { name: [значения категорий по позициям], value: мера } ---
    if (!out.length && data && Array.isArray(data.categories)) {
      for (const c of data.categories) {
        if (!c || typeof c !== 'object' || !Array.isArray(c.name)) continue;

        // Мера лежит отдельно от категорий.
        let h;
        for (const k of ['value', 'values', 'measure', 'measures']) {
          if (c[k] === undefined) continue;
          h = num(plain(c[k]));
          break;
        }
        if (h === undefined && Array.isArray(c.series)) {
          for (const s of c.series) {
            const raw = s && typeof s === 'object'
              ? (s.value !== undefined ? s.value : (Array.isArray(s.data) ? s.data[0] : s.data))
              : s;
            const n = num(plain(raw));
            if (Number.isFinite(n)) { h = n; break; }
          }
        }

        readTuple(c.name, h);
      }
    }

    // --- 6) values как объект массивов {dt: [...], zni_number: [...], ...} ---
    if (!out.length && data && data.values &&
      !Array.isArray(data.values) && typeof data.values === 'object') {
      const vals = data.values;
      const keys = Object.keys(vals);
      const len = keys.reduce(
        (m, k) => Math.max(m, Array.isArray(vals[k]) ? vals[k].length : 0), 0
      );
      for (let i = 0; i < len; i++) {
        const rec = {};
        for (const k of keys) {
          rec[k] = Array.isArray(vals[k]) ? plain(vals[k][i]) : undefined;
        }
        readRecord(rec);
      }
    }

    // --- 7) categories как массив колонок: [{name, values:[...]}, ...] ---
    if (!out.length && data && Array.isArray(data.categories)) {
      const colData = (c) => {
        if (Array.isArray(c.values)) return c.values;
        if (Array.isArray(c.data)) return c.data;
        if (Array.isArray(c.value)) return c.value;
        if (Array.isArray(c.series) && c.series[0]) {
          const s = c.series[0];
          if (Array.isArray(s.data)) return s.data;
          if (Array.isArray(s.values)) return s.values;
        }
        return null;
      };

      const colCats = data.categories.filter((c) => c && typeof c === 'object' &&
        typeof c.name === 'string' && colData(c));

      if (colCats.length >= 2) {
        const len = colCats.reduce((m, c) => Math.max(m, colData(c).length), 0);

        for (let i = 0; i < len; i++) {
          const rec = {};
          for (const c of colCats) {
            const v = plain(colData(c)[i]);
            rec[c.name] = v;
            const alias = c.alias || c.id || c.key || c.title;
            if (alias) rec[alias] = v;
          }
          readRecord(rec);
        }
      }
    }

    return out;
  }

  const records = normalizeData(itemData);
  if (!records.length) {
    try { console.log('[gantt] getItemData raw:', itemData); } catch (e) { /* ignore */ }

    // Одна категория без разделителя => PIX BI отбросил остальные поля блока.
    let singleCatSample = null;
    try {
      const cats = itemData && itemData.categories;
      if (Array.isArray(cats) && cats.length) {
        const n0 = plain(cats[0] && cats[0].name);
        const hasSep = typeof n0 === 'string' &&
          [KEY_SEP, '\u001F', '§', '||'].some((sep) => n0.indexOf(sep) !== -1);
        if (typeof n0 === 'string' && !hasSep) singleCatSample = n0;
      }
    } catch (e) { /* ignore */ }

    const keyHint = singleCatSample === null ? '' : [
      '⚠ Блок вернул только ОДНУ категорию: "' + escHtml(singleCatSample) + '".',
      'Этот вариант (gantt_multi.js) рассчитан на режим данных «Все категории»,',
      'в котором все поля приходят отдельными колонками таблицы.',
      '',
      'Что проверить в блоке PIX BI:',
      '  1. Настройки → Режим данных → «Все категории» (не «Дриллдаун»).',
      '  2. На полке «Категории» — отдельные поля:',
      '       dt, zni_number, full_name, practice, qrt',
      '       (+ epic_summary для описания ЗНИ).',
      '  3. На полке «Меры» — SUM(timeworked_h), «Серии» — пусто.',
      '  4. Нажми «Выполнить» и перезапусти визуал.',
      '',
      'Если платформа не поддерживает «Все категории», используй gantt.js',
      'и одно вычисляемое поле gantt_key — там описана готовая формула.',
      ''
    ].join('\n');

    showMessage(
      'Нет данных для построения Ганта.\n\n' +
      keyHint +
      'Блок: ' + escHtml(BLOCK_ID) + '\n' +
      'getItemData: ' + escHtml(typeof itemData) +
      (itemData && typeof itemData === 'object'
        ? ', массив: ' + Array.isArray(itemData) : '') + '\n\n' +
      '--- ДИАГНОСТИКА ---\n' +
      (normStats
        ? 'Разбор строк: просмотрено ' + normStats.seen +
          ', принято ' + normStats.ok +
          ', без даты ' + normStats.noDt +
          ', без ЗНИ ' + normStats.noZni +
          ', дата не распознана ' + normStats.badDt + '\n' +
          'Пример даты: ' + (normStats.dtSample === null ? '—' : '"' + escHtml(normStats.dtSample) + '"') +
          ', пример ЗНИ: ' + (normStats.zniSample === null ? '—' : '"' + escHtml(normStats.zniSample) + '"') +
          ', пример часов: ' + (normStats.hoursSample === null ? '—' : escHtml(normStats.hoursSample)) + '\n'
        : '') +
      escHtml(describeData(itemData)) + '\n' +
      '--- /ДИАГНОСТИКА ---\n\n' +
      (singleCatSample === null
        ? 'Проверь настройку блока PIX BI — режим данных «Все категории»,\n' +
          'поля должны идти отдельными колонками:\n' +
          '• Категории: dt, zni_number, full_name, practice, qrt (+ epic_summary)\n' +
          '• Мера: SUM(timeworked_h)\n' +
          '• Серии: пусто\n\n'
        : '') +
      'Пришли текст между «--- ДИАГНОСТИКА ---» и «--- /ДИАГНОСТИКА ---» —\n' +
      'по нему будет видно, какие имена колонок вернул блок.'
    );
    return;
  }

  // ====== Модель: агрегация по (ЗНИ, исполнитель, день) ======
  function buildModel(recs) {
    const cells = new Map(); // zni \u0001 person \u0001 dtMs -> { dtMs, zni, person, practice, hours }
    const qrtSet = new Set();
    let minDay = Infinity;
    let maxDay = -Infinity;
    let maxHours = 0;
    let totalHours = 0;
    let zeroHours = true;
    let hasPersons = false;

    for (const r of recs) {
      if (!Number.isFinite(r.dtMs)) continue;

      if (r.person !== '—') hasPersons = true;

      const qrt = qrtBounds(r.qrt) ? r.qrt : quarterFromDate(r.dtMs);
      qrtSet.add(qrt);

      minDay = Math.min(minDay, r.dtMs);
      maxDay = Math.max(maxDay, r.dtMs);

      const k = r.zni + '\u0001' + r.person + '\u0001' + r.dtMs;
      let cell = cells.get(k);
      if (!cell) {
        cell = {
          dtMs: r.dtMs, zni: r.zni, person: r.person,
          practice: r.practice, hours: 0, zniInfo: r.zniInfo || ''
        };
        cells.set(k, cell);
      } else {
        if (cell.practice === '—' && r.practice !== '—') {
          cell.practice = r.practice;
        }
        if (r.zniInfo && r.zniInfo.length > cell.zniInfo.length) {
          cell.zniInfo = r.zniInfo;
        }
      }
      cell.hours += r.hours;

      totalHours += r.hours;
      if (r.hours > 0) zeroHours = false;
      maxHours = Math.max(maxHours, r.hours);
    }

    const groups = new Map();
    for (const c of cells.values()) {
      let g = groups.get(c.zni);
      if (!g) {
        g = {
          zni: c.zni, zniInfo: '', execs: new Map(),
          agg: new Map(), practices: new Set()
        };
        groups.set(c.zni, g);
      }
      if (c.zniInfo && c.zniInfo.length > g.zniInfo.length) {
        g.zniInfo = c.zniInfo;
      }
      let ex = g.execs.get(c.person);
      if (!ex) {
        ex = { person: c.person, practice: c.practice, cells: new Map() };
        g.execs.set(c.person, ex);
      }
      ex.cells.set(c.dtMs, (ex.cells.get(c.dtMs) || 0) + c.hours);
      g.agg.set(c.dtMs, (g.agg.get(c.dtMs) || 0) + c.hours);
      g.practices.add(c.practice);
    }

    const sortedGroups = [...groups.values()].sort(
      (a, b) => a.zni.localeCompare(b.zni, 'ru', { numeric: true })
    );

    let personCount = 0;
    let aggMax = 0;
    for (const g of sortedGroups) {
      g.execs = [...g.execs.values()].sort(
        (a, b) => a.person.localeCompare(b.person, 'ru')
      );
      personCount += g.execs.length;
      for (const h of g.agg.values()) aggMax = Math.max(aggMax, h);
    }

    const qrts = [...qrtSet]
      .filter((q) => qrtBounds(q))
      .sort((a, b) => qrtSortKey(a) - qrtSortKey(b));

    return {
      cells,
      groups: sortedGroups,
      qrts,
      minDay,
      maxDay,
      maxHours: Math.max(maxHours, aggMax, 1),
      totalHours,
      personCount,
      hasPersons,
      zeroHours,
      cellCount: cells.size
    };
  }

  const model = buildModel(records);
  if (!model.groups.length) {
    showMessage('Не удалось разобрать записи: проверь поля dt, zni_number, full_name и SUM(timeworked_h).');
    return;
  }

  // Цвета практик: сортировка по алфавиту, устойчиво между фильтрами
  const practiceNames = [...new Set(
    model.groups.flatMap((g) => [...g.practices])
  )].sort((a, b) => a.localeCompare(b, 'ru'));

  const practiceColorMap = new Map(
    practiceNames.map((p, i) => [p, PRACTICE_COLORS[i % PRACTICE_COLORS.length]])
  );

  // Описание ЗНИ (необязательная часть gantt_key) — для подсказки слева.
  const zniInfoMap = new Map(
    model.groups.map((g) => [g.zni, g.zniInfo || ''])
  );

  // ====== Тема ======
  function readTheme() {
    const cfg = window.themeConfigs || {};
    const app = cfg.application || {};
    const applied = app.applied_filters || {};
    const background = app.background || {};
    const texts = cfg.texts || {};
    const labels = texts.labels || {};

    const bg = background.items || background.filter_panel || '#ffffff';
    const dark = isDarkColor(bg);

    const text =
      labels.font_color ||
      applied.available_font_color ||
      applied.font_color ||
      (dark ? '#e2e8f0' : '#0f172a');

    return {
      bg,
      dark,
      text,
      muted: dark ? '#94a3b8' : '#64748b',
      faint: dark ? '#64748b' : '#94a3b8',
      axis: dark ? 'rgba(148,163,184,0.55)' : 'rgba(15,23,42,0.45)',
      border: dark ? 'rgba(148,163,184,0.25)' : 'rgba(15,23,42,0.12)',
      groupBand: dark ? 'rgba(56,189,248,0.12)' : 'rgba(37,99,235,0.07)',
      zebra: dark ? 'rgba(148,163,184,0.045)' : 'rgba(15,23,42,0.022)',
      weekend: dark ? 'rgba(148,163,184,0.075)' : 'rgba(100,116,139,0.055)',
      monthLine: dark ? 'rgba(148,163,184,0.32)' : 'rgba(100,116,139,0.28)',
      tooltipBg: dark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.97)',
      sliderBg: dark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.06)',
      sliderFill: dark ? 'rgba(56,189,248,0.22)' : 'rgba(37,99,235,0.16)',
      accent: '#3b82f6'
    };
  }

  // Непрерывная шкала «часы за день»: 0 -> max
  function heatScale(isDark) {
    const stops = isDark
      ? [[0, '#0b3a5c'], [0.25, '#075985'], [0.5, '#0284c7'], [0.75, '#38bdf8'], [1, '#bae6fd']]
      : [[0, '#e8f2fd'], [0.25, '#b6d7f7'], [0.5, '#5aa9e6'], [0.75, '#1d6fd0'], [1, '#123f8c']];

    const rgbStops = stops.map(([pos, hex]) => {
      const h = hex.slice(1);
      return [pos, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    });

    return function colorFor(hours) {
      const t = model.maxHours > 0
        ? clamp(hours / model.maxHours, 0, 1)
        : 0;
      for (let i = 1; i < rgbStops.length; i++) {
        if (t <= rgbStops[i][0]) {
          const [p0, r0, g0, b0] = rgbStops[i - 1];
          const [p1, r1, g1, b1] = rgbStops[i];
          const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
          const r = Math.round(r0 + (r1 - r0) * k);
          const g = Math.round(g0 + (g1 - g0) * k);
          const b = Math.round(b0 + (b1 - b0) * k);
          return 'rgb(' + r + ',' + g + ',' + b + ')';
        }
      }
      const last = rgbStops[rgbStops.length - 1];
      return 'rgb(' + last[1] + ',' + last[2] + ',' + last[3] + ')';
    };
  }

  function gradientCss(isDark) {
    const scale = heatScale(isDark);
    const samples = [];
    for (let i = 0; i <= 4; i++) {
      samples.push(scale(model.maxHours * i / 4));
    }
    return 'linear-gradient(90deg,' + samples.join(',') + ')';
  }

  // ====== Структура DOM ======
  el.innerHTML = '';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.overflow = 'hidden';
  el.style.boxSizing = 'border-box';

  const headerEl = document.createElement('div');
  headerEl.className = 'pg-head';
  el.appendChild(headerEl);

  const chartEl = document.createElement('div');
  chartEl.className = 'pg-chart';
  el.appendChild(chartEl);

  // Вертикальная «крутилка» списка ЗНИ (кастомная, поверх canvas).
  const vbarEl = document.createElement('div');
  vbarEl.className = 'pg-vbar';
  const vthumbEl = document.createElement('div');
  vthumbEl.className = 'pg-vthumb';
  vbarEl.appendChild(vthumbEl);

  // Подсказка с описанием ЗНИ при наведении на левую колонку.
  const ztipEl = document.createElement('div');
  ztipEl.className = 'pg-ztip';

  // Стили (один раз на страницу)
  const STYLE_ID = 'pixbi-gantt-style';
  // Стили перезаписываем на каждом запуске: в SPA PIX BI старый <style>
  // остаётся в <head> после повторного рендера визуала, и без перезаписи
  // новые правила (например, .pg-vbar) не применялись бы.
  const CSS = [
    '.pg-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;',
    'padding:6px 10px;flex-shrink:0;border-bottom:1px solid;font-family:' + FONT_FAMILY + '}',
    '.pg-cap{font-size:11px;white-space:nowrap}',
    '.pg-select{font-family:' + FONT_FAMILY + ';font-size:12px;padding:3px 8px;border-radius:6px;',
    'border:1px solid;outline:none;cursor:pointer;min-width:150px}',
    '.pg-legend{display:flex;align-items:center;gap:6px}',
    '.pg-bar{display:inline-block;width:120px;height:10px;border-radius:3px}',
    '.pg-btn{font-family:' + FONT_FAMILY + ';font-size:11px;padding:3px 9px;border-radius:6px;',
    'border:1px solid;background:transparent;cursor:pointer;white-space:nowrap}',
    '.pg-btn:hover{opacity:.75}',
    '.pg-spacer{flex:1 1 auto}',
    '.pg-stats{white-space:nowrap;font-size:11px}',
    '.pg-range{white-space:nowrap;font-size:11px}',
    '.pg-warn{color:#dc2626;font-size:11px;font-weight:600;white-space:nowrap}',
    '.pg-chart{flex:1 1 auto;min-height:0;width:100%;position:relative}',
    '.pg-vbar{position:absolute;right:2px;z-index:10;width:10px;display:none;',
    'border-radius:5px;touch-action:none;user-select:none}',
    '.pg-vbar:hover,.pg-vbar.pg-vdragging{background:rgba(128,128,128,.12)}',
    '.pg-vthumb{position:absolute;left:1px;width:8px;border-radius:4px;cursor:grab;',
    'background:rgba(100,116,139,.5)}',
    '.pg-vthumb:hover{background:rgba(100,116,139,.75)}',
    '.pg-vdragging .pg-vthumb{cursor:grabbing}',
    '.pg-ztip{position:absolute;z-index:11;display:none;pointer-events:none;',
    'max-width:360px;padding:7px 10px;border-radius:7px;border:1px solid;',
    'box-shadow:0 4px 18px rgba(0,0,0,.18);font-family:' + FONT_FAMILY + ';',
    'font-size:12px;line-height:1.45;white-space:normal;word-break:break-word}'
  ].join('');

  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    document.head.appendChild(st);
  }
  document.getElementById(STYLE_ID).textContent = CSS;

  let chart = null;
  let isRendering = false;

  // ====== Переменные текущего вида ======
  let viewDays = [];
  let viewRows = [];
  let viewCells = [];
  let viewDecor = [];
  let viewStats = { groups: 0, persons: 0, hours: 0 };

  const state = {
    qrt: '__all__',
    collapsed: new Set(),
    yStart: 0,
    xZoom: null,
    theme: readTheme()
  };

  // ====== Дни выбранного периода ======
  function daysFor(qrt) {
    let start;
    let end;

    if (qrt === '__all__') {
      start = model.minDay;
      end = model.maxDay;
    } else {
      const b = qrtBounds(qrt);
      if (!b) { start = model.minDay; end = model.maxDay; }
      else { start = b.start; end = b.end; }
    }

    const days = [];
    if (!Number.isFinite(start) || !Number.isFinite(end)) return days;
    for (let t = start; t <= end; t += DAY_MS) days.push(t);
    return days;
  }

  function visibleRowCount() {
    const h = chartEl.clientHeight || el.clientHeight || 420;
    const avail = Math.max(ROW_H, h - GRID_TOP - GRID_BOTTOM);
    return Math.max(1, Math.floor(avail / ROW_H));
  }

  // ====== Построение строк и ячеек ======
  function buildView(theme, days) {
    const dayIndex = new Map(days.map((ms, i) => [ms, i]));
    const scale = heatScale(theme.dark);

    const rows = [];
    const cells = [];
    const decor = [];

    const periodGroups = new Set();
    const periodPersons = new Set();
    let periodHours = 0;

    const pushCell = (x, y, hours, meta) => {
      cells.push({
        value: [x, y, hours],
        itemStyle: { color: scale(hours) },
        _hours: hours,
        _date: meta.date,
        _zni: meta.zni,
        _person: meta.person,
        _practice: meta.practice,
        _group: !!meta.group
      });
      periodHours += hours;
    };

    for (const g of model.groups) {
      // Режим «категория + дата» (без исполнителей): не показываем
      // бессмысленную подстроку «—», рисуем часы прямо в строке группы.
      const noExecs = g.execs.length === 1 && g.execs[0].person === '—';
      const collapsed = noExecs || state.collapsed.has(g.zni);
      const groupRow = rows.length;
      const practices = [...g.practices];

      rows.push({
        kind: 'group',
        zni: g.zni,
        personCount: noExecs ? 0 : g.execs.length,
        noExecs,
        practices,
        collapsed
      });
      decor.push({ value: [0, groupRow], _kind: 'hband', _fill: theme.groupBand });

      if (collapsed) {
        for (const [ms, h] of g.agg) {
          const x = dayIndex.get(ms);
          if (x == null) continue;
          periodGroups.add(g.zni);
          for (const ex of g.execs) periodPersons.add(ex.person);
          pushCell(x, groupRow, h, {
            date: isoOf(ms),
            zni: g.zni,
            person: noExecs ? '' : g.execs.length + ' ' +
              plural(g.execs.length, 'исполнитель', 'исполнителя', 'исполнителей'),
            practice: practices.join(' · '),
            group: true
          });
        }
      } else {
        let execN = 0;
        for (const ex of g.execs) {
          const y = rows.length;
          rows.push({
            kind: 'exec',
            zni: g.zni,
            person: ex.person,
            practice: ex.practice
          });

          if (execN % 2 === 1) {
            decor.push({ value: [0, y], _kind: 'hband', _fill: theme.zebra });
          }

          for (const [ms, h] of ex.cells) {
            const x = dayIndex.get(ms);
            if (x == null) continue;
            periodGroups.add(g.zni);
            periodPersons.add(ex.person);
            pushCell(x, y, h, {
              date: isoOf(ms),
              zni: g.zni,
              person: ex.person,
              practice: ex.practice,
              group: false
            });
          }
          execN++;
        }
      }
    }

    // Выходные: вертикальные полосы, объединяем подряд идущие сб/вс
    let wStart = -1;
    let wEnd = -1;
    const flushWeekend = () => {
      if (wStart >= 0) {
        decor.push({ value: [wStart, 0], _kind: 'vband', _x1: wEnd, _fill: theme.weekend });
        wStart = -1; wEnd = -1;
      }
    };
    for (let i = 0; i < days.length; i++) {
      const wd = new Date(days[i]).getUTCDay(); // 0 вс, 6 сб
      if (wd === 0 || wd === 6) {
        if (wStart < 0) wStart = i;
        wEnd = i;
      } else {
        flushWeekend();
      }
    }
    flushWeekend();

    // Границы месяцев
    for (let i = 1; i < days.length; i++) {
      if (new Date(days[i]).getUTCDate() === 1) {
        decor.push({ value: [i, 0], _kind: 'vline', _fill: theme.monthLine });
      }
    }

    viewStats = {
      groups: periodGroups.size,
      persons: periodPersons.size,
      hours: periodHours
    };

    return { rows, cells, decor };
  }

  // ====== RenderItem: ячейка дня ======
  function renderCell(_params, api) {
    const x = api.value(0);
    const y = api.value(1);
    const p = api.coord([x, y]);
    const s = api.size([1, 1]);

    const gap = s[0] >= 8 ? 2 : (s[0] >= 4 ? 1 : 0);
    const w = Math.max(1, s[0] - gap);
    const h = Math.max(1, s[1] - gap);

    return {
      type: 'rect',
      shape: {
        x: p[0] - w / 2,
        y: p[1] - h / 2,
        width: w,
        height: h,
        r: w >= 8 ? 2 : 0
      },
      style: api.style()
    };
  }

  // ECharts 5.4 в renderItem не передаёт params.data — берём элемент по dataIndex
  function renderDecor(_params, api) {
    const d = viewDecor[_params.dataIndex];
    if (!d) return null;
    return renderDecorItem(d, api);
  }

  function renderDecorItem(d, api) {
    const nDays = viewDays.length;
    const nRows = viewRows.length;
    if (!nDays || !nRows) return null;

    const s = api.size([1, 1]);

    if (d._kind === 'hband') {
      const y = api.value(1);
      const p0 = api.coord([0, y]);
      const p1 = api.coord([nDays - 1, y]);
      return {
        type: 'rect',
        shape: {
          x: p0[0] - s[0] / 2,
          y: p0[1] - s[1] / 2,
          width: Math.max(1, p1[0] - p0[0] + s[0]),
          height: s[1]
        },
        style: { fill: d._fill }
      };
    }

    if (d._kind === 'vband') {
      const x0 = api.value(0);
      const x1 = d._x1;
      const p0 = api.coord([x0, 0]);
      const p1 = api.coord([x1, 0]);
      const top = api.coord([0, 0])[1] - s[1] / 2;
      const bot = api.coord([0, nRows - 1])[1] + s[1] / 2;
      return {
        type: 'rect',
        shape: {
          x: p0[0] - s[0] / 2,
          y: top,
          width: Math.max(1, p1[0] - p0[0] + s[0]),
          height: bot - top
        },
        style: { fill: d._fill }
      };
    }

    if (d._kind === 'vline') {
      const x = api.value(0);
      const px = api.coord([x, 0])[0];
      const top = api.coord([0, 0])[1] - s[1] / 2;
      const bot = api.coord([0, nRows - 1])[1] + s[1] / 2;
      return {
        type: 'rect',
        shape: { x: px - 0.5, y: top, width: 1, height: bot - top },
        style: { fill: d._fill }
      };
    }

    return null;
  }

  // ====== Форматирование подписи строки (3 колонки) ======
  function buildYAxisLabel(theme) {
    const rich = {
      z: {
        width: COL_ZNI, align: 'left', fontSize: 11,
        color: theme.faint, fontFamily: FONT_FAMILY,
        height: ROW_H, verticalAlign: 'middle'
      },
      n: {
        width: COL_NAME, align: 'left', fontSize: 11,
        color: theme.text, fontFamily: FONT_FAMILY,
        height: ROW_H, verticalAlign: 'middle',
        overflow: 'truncate', ellipsis: '…'
      },
      g: {
        width: COL_ZNI, align: 'left', fontSize: 11, fontWeight: 'bold',
        color: theme.text, fontFamily: FONT_FAMILY,
        height: ROW_H, verticalAlign: 'middle',
        backgroundColor: theme.groupBand
      },
      gm: {
        width: COL_DOT + COL_NAME, align: 'left', fontSize: 10,
        color: theme.muted, fontFamily: FONT_FAMILY,
        padding: [0, 8, 0, 0],
        height: ROW_H, verticalAlign: 'middle',
        backgroundColor: theme.groupBand,
        overflow: 'truncate', ellipsis: '…'
      }
    };

    const practiceRichSuffix = (prefix, color, extra) => {
      rich[prefix] = Object.assign({
        width: COL_PRACTICE, align: 'left', fontSize: 10,
        color: color || theme.muted, fontFamily: FONT_FAMILY,
        padding: [0, 8, 0, 0],
        height: ROW_H, verticalAlign: 'middle',
        overflow: 'truncate', ellipsis: '…'
      }, extra || {});
    };

    practiceNames.forEach((name, i) => {
      const color = practiceColorMap.get(name);
      rich['dot' + i] = {
        width: COL_DOT, align: 'center', fontSize: 8,
        color: color, fontFamily: FONT_FAMILY,
        height: ROW_H, verticalAlign: 'middle'
      };
      practiceRichSuffix('p' + i, color);
      practiceRichSuffix('gp' + i, color, { backgroundColor: theme.groupBand });
    });

    rich.pm = Object.assign({}, rich['p0'] || {}, { color: theme.muted });
    rich.gpm = Object.assign({}, rich['gp0'] || {}, { color: theme.muted });

    function formatter(value) {
      const r = viewRows[Number(value)];
      if (!r) return '';

      if (r.kind === 'group') {
        // Без исполнителей строка не раскрывается — вместо стрелки точка.
        const arrow = r.noExecs ? '·' : (r.collapsed ? '▶' : '▼');
        const pc = r.practices.length === 1 ? r.practices[0] : null;
        // «—» — заглушка, когда практики в данных нет (режим категория + дата).
        const unknownPractice = !pc || pc === '—';
        const pIdx = unknownPractice ? -1 : practiceNames.indexOf(pc);
        const practiceText = unknownPractice
          ? ''
          : (pc || r.practices.length + ' ' +
            plural(r.practices.length, 'практика', 'практики', 'практик'));
        const pStyle = pIdx >= 0 ? 'gp' + pIdx : 'gpm';
        let text = '{g|' + arrow + ' ' + escRich(r.zni) + '}';
        if (r.personCount > 0) {
          text += '{gm|' + r.personCount + ' ' +
            plural(r.personCount, 'исполнитель', 'исполнителя', 'исполнителей') + '}';
        }
        if (practiceText) {
          text += '{' + pStyle + '|' + escRich(practiceText) + '}';
        }
        return text;
      }

      const pIdx = practiceNames.indexOf(r.practice);
      const dotStyle = pIdx >= 0 ? 'dot' + pIdx : 'z';
      const pStyle = pIdx >= 0 ? 'p' + pIdx : 'pm';

      return '{z|' + escRich(r.zni) + '}' +
        '{' + dotStyle + '|■}' +
        '{n|' + escRich(r.person) + '}' +
        '{' + pStyle + '|' + escRich(r.practice) + '}';
    }

    return {
      interval: 0,
      margin: LEFT_W - 16,
      align: 'left',
      rich,
      formatter
    };
  }

  // ====== Подписи оси дат (месяцы сверху + числа) ======
  // При обзоре всего периода показываем только месяцы, при зуме — ещё и числа.
  // Иначе hideOverlap выкидывает сами подписи месяцев из-за плотных чисел.
  let xSpanCache = { n: 0, at: 0 };

  function visibleDaySpan() {
    const now = Date.now();
    if (xSpanCache.n && now - xSpanCache.at < 100) return xSpanCache.n;

    let span = viewDays.length;
    try {
      const dz = (chart.getOption().dataZoom || []).find((d) => d.id === 'dzX');
      if (dz && dz.start != null && dz.end != null) {
        span = Math.round(viewDays.length * (dz.end - dz.start) / 100);
      }
    } catch (e) { /* ignore */ }

    xSpanCache = { n: Math.max(1, span), at: now };
    return xSpanCache.n;
  }

  function buildXAxisLabel(theme) {
    return {
      interval: 0,
      hideOverlap: true,
      margin: 10,
      rich: {
        m: {
          fontSize: 10, fontWeight: 'bold', color: theme.text,
          fontFamily: FONT_FAMILY, padding: [0, 0, 0, 2]
        },
        d: {
          fontSize: 9, color: theme.faint,
          fontFamily: FONT_FAMILY, padding: [0, 0, 0, 2]
        }
      },
      formatter(value, index) {
        const ms = toDayMs(value);
        if (!Number.isFinite(ms)) return '';
        const d = new Date(ms);
        const day = d.getUTCDate();
        const month = d.getUTCMonth();
        const year = d.getUTCFullYear();
        const showDays = visibleDaySpan() <= 140;

        if (day === 1 || index === 0 || (month === 0 && day <= 5)) {
          const suffix = (month === 0 || index === 0) ? ' ' + String(year).slice(2) : '';
          return '{m|' + MONTHS_SHORT[month] + suffix + '}';
        }
        if (showDays && day % 5 === 0 && day <= 25) return '{d|' + day + '}';
        return '';
      }
    };
  }

  // ====== Tooltip ======
  function tooltipFormatter(p, theme) {
    const d = (p && viewCells[p.dataIndex]) || (p && p.data);
    if (!d || d._hours == null) return '';

    const color = practiceColorMap.get(d._practice) || theme.muted;
    const dt = toDayMs(d._date);

    let html = '<div style="font-family:' + FONT_FAMILY + ';min-width:190px">';
    html += '<div style="font-weight:700;font-size:13px;margin-bottom:5px">ЗНИ ' +
      escHtml(d._zni) + '</div>';

    if (d._group) {
      html += '<div style="color:' + theme.muted + '">' + escHtml(d._person) + '</div>';
      html += '<div style="color:' + theme.muted + '">' + escHtml(d._practice) + '</div>';
    } else {
      html += '<div><span style="color:' + color + '">■</span> ' +
        escHtml(d._person) + '</div>';
      html += '<div style="color:' + color + '">' + escHtml(d._practice) + '</div>';
    }

    html += '<div style="margin-top:5px;color:' + theme.muted + '">' +
      fmtDayHuman(dt) + '</div>';
    html += '<div style="margin-top:2px;font-size:15px;font-weight:700">' +
      d._hours.toFixed(2).replace('.', ',') + ' ч</div>';
    html += '</div>';
    return html;
  }

  // ====== Опция ECharts ======
  function buildOption(theme) {
    const nRows = viewRows.length;
    const N = Math.min(nRows, visibleRowCount());
    state.yStart = clamp(state.yStart, 0, Math.max(0, nRows - N));
    const yEnd = Math.min(nRows - 1, state.yStart + N - 1);

    const xZoom = state.xZoom;

    return {
      backgroundColor: theme.bg,
      animation: false,
      textStyle: { fontFamily: FONT_FAMILY, color: theme.text },

      grid: {
        left: LEFT_W,
        right: GRID_RIGHT,
        top: GRID_TOP,
        bottom: GRID_BOTTOM
      },

      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: theme.tooltipBg,
        borderColor: theme.border,
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: theme.text, fontSize: 12, fontFamily: FONT_FAMILY },
        extraCssText: 'box-shadow:0 4px 18px rgba(0,0,0,.18);border-radius:8px;'
      },

      xAxis: {
        type: 'category',
        data: viewDays.map(isoOf),
        position: 'top',
        boundaryGap: true,
        axisLine: { lineStyle: { color: theme.axis } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: buildXAxisLabel(theme)
      },

      yAxis: {
        type: 'category',
        data: viewRows.map((_, i) => String(i)),
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: buildYAxisLabel(theme)
      },

      dataZoom: [
        {
          id: 'dzX',
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseWheel: false,
          moveOnMouseMove: true,
          ...(xZoom ? { start: xZoom.start, end: xZoom.end } : {})
        },
        {
          id: 'dzY',
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseWheel: false,
          moveOnMouseMove: false,
          startValue: state.yStart,
          endValue: yEnd
        },
        {
          id: 'dzXSlider',
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'none',
          height: 16,
          bottom: 8,
          showDetail: false,
          showDataShadow: false,
          borderColor: 'transparent',
          backgroundColor: theme.sliderBg,
          fillerColor: theme.sliderFill,
          dataBackground: {
            lineStyle: { color: 'transparent' },
            areaStyle: { color: 'transparent' }
          },
          selectedDataBackground: {
            lineStyle: { color: 'transparent' },
            areaStyle: { color: 'transparent' }
          },
          handleStyle: { color: theme.accent, borderColor: 'transparent' },
          moveHandleStyle: { color: theme.accent, opacity: 0.35 },
          textStyle: { color: theme.muted, fontSize: 10, fontFamily: FONT_FAMILY },
          ...(xZoom ? { start: xZoom.start, end: xZoom.end } : {})
        }
      ],

      series: [
        {
          type: 'custom',
          name: 'decor',
          coordinateSystem: 'cartesian2d',
          renderItem: renderDecor,
          data: viewDecor,
          encode: { x: 0, y: 1 },
          silent: true,
          clip: true,
          z: 0,
          tooltip: { show: false }
        },
        {
          type: 'custom',
          name: 'Часы',
          coordinateSystem: 'cartesian2d',
          renderItem: renderCell,
          data: viewCells,
          encode: { x: 0, y: 1 },
          clip: true,
          z: 2,
          itemStyle: { opacity: 0.96 },
          tooltip: {
            formatter: (p) => tooltipFormatter(p, theme)
          }
        }
      ]
    };
  }

  // ====== Шапка ======
  function fmtHours(h) {
    const n = Number(h) || 0;
    if (Math.abs(n - Math.round(n)) < 0.005) return Math.round(n) + ' ч';
    return n.toFixed(1).replace('.', ',') + ' ч';
  }

  function rangeText() {
    const days = viewDays;
    if (!days.length) return '';
    return fmtDayHuman(days[0]) + ' – ' + fmtDayHuman(days[days.length - 1]);
  }

  function optionsHtml() {
    let html = '<option value="__all__"' +
      (state.qrt === '__all__' ? ' selected' : '') + '>Весь период</option>';

    for (const q of model.qrts) {
      const qn = q.split('-')[1] || '';
      html += '<option value="' + escHtml(q) + '"' +
        (state.qrt === q ? ' selected' : '') + '>' +
        escHtml(q) + ' — ' + escHtml(qn) + ' квартал</option>';
    }
    return html;
  }

  function renderHeader(theme) {
    const btnStyle = 'color:' + theme.text + ';border-color:' + theme.border + ';';
    const selStyle = 'color:' + theme.text + ';background:' + theme.bg +
      ';border-color:' + theme.border + ';';

    headerEl.style.color = theme.text;
    headerEl.style.borderBottomColor = theme.border;
    headerEl.style.background = theme.bg;

    headerEl.innerHTML =
      '<div class="pg-group">' +
        '<span class="pg-cap" style="color:' + theme.muted + '">Квартал</span> ' +
        '<select class="pg-select" style="' + selStyle + '">' + optionsHtml() + '</select>' +
      '</div>' +
      '<div class="pg-legend" title="Часы за день (сумма по записям за дату)">' +
        '<span class="pg-cap" style="color:' + theme.muted + '">0 ч</span>' +
        '<span class="pg-bar" style="background:' + gradientCss(theme.dark) + '"></span>' +
        '<span class="pg-cap" style="color:' + theme.muted + '">' +
          fmtHours(model.maxHours) + '</span>' +
      '</div>' +
      '<span class="pg-range" style="color:' + theme.muted + '">' + rangeText() + '</span>' +
      (model.zeroHours
        ? '<span class="pg-warn">Внимание: мера времени = 0 — проверь SUM(timeworked_h)</span>'
        : '') +
      '<span class="pg-spacer"></span>' +
      '<button class="pg-btn" data-act="expand" style="' + btnStyle + '">Развернуть все</button>' +
      '<button class="pg-btn" data-act="collapse" style="' + btnStyle + '">Свернуть все</button>' +
      '<span class="pg-stats" style="color:' + theme.muted + '">' +
        viewStats.groups + ' ЗНИ' +
        (model.hasPersons
          ? ' · ' + viewStats.persons + ' ' +
            plural(viewStats.persons, 'исполнитель', 'исполнителя', 'исполнителей')
          : '') +
        ' · ' + fmtHours(viewStats.hours) +
      '</span>' +
      '<span class="pg-ver" style="color:' + theme.faint +
        ';font-size:10px;opacity:.75" title="Версия gantt.js: ' +
        GANTT_VERSION + ' (много категорий, режим «Все категории»)">v' +
        GANTT_VERSION + '</span>';
  }

  // ====== Полный рендер ======
  function render() {
    const theme = state.theme;

    viewDays = daysFor(state.qrt);
    const view = buildView(theme, viewDays);

    viewRows = view.rows;
    viewCells = view.cells;
    viewDecor = view.decor;

    // Приводим вертикальное окно к текущему числу строк
    const N = Math.min(viewRows.length, visibleRowCount());
    state.yStart = clamp(state.yStart, 0, Math.max(0, viewRows.length - N));

    xSpanCache = { n: 0, at: 0 };

    isRendering = true;
    chart.setOption(buildOption(theme), { notMerge: true });
    isRendering = false;

    renderHeader(theme);
    applyYWindow();

    // PIX BI может отдать размеры блока позже — повторяем позиционирование
    setTimeout(function () {
      if (chart) updateVBar(state.theme);
    }, 150);
  }

  // ====== Вертикальное окно ======
  function applyYWindow() {
    hideZTip();
    const nRows = viewRows.length;
    if (!nRows) return;
    const N = Math.min(nRows, visibleRowCount());
    state.yStart = clamp(state.yStart, 0, Math.max(0, nRows - N));
    const yEnd = Math.min(nRows - 1, state.yStart + N - 1);

    // startValue/endValue — индексы категорий; передаём значения оси (строки)
    chart.dispatchAction({
      type: 'dataZoom',
      dataZoomId: 'dzY',
      startValue: String(state.yStart),
      endValue: String(yEnd)
    });

    updateVBar(state.theme);
  }

  // ====== Вертикальная крутилка списка ЗНИ ======
  function rowsWindow() {
    const nRows = viewRows.length;
    const N = Math.min(nRows, visibleRowCount());
    return { nRows, N, maxScroll: Math.max(0, nRows - N) };
  }

  function vbarTrackHeight() {
    return Math.max(0, (chartEl.clientHeight || 0) - GRID_TOP - GRID_BOTTOM);
  }

  function updateVBar(theme) {
    theme = theme || state.theme;
    const w = rowsWindow();
    const trackH = vbarTrackHeight();

    if (!w.nRows || w.nRows <= w.N || trackH <= 0) {
      vbarEl.style.display = 'none';
      return;
    }

    vbarEl.style.display = 'block';
    vbarEl.style.top = GRID_TOP + 'px';
    vbarEl.style.height = trackH + 'px';

    const thumbH = Math.max(28, Math.round(trackH * w.N / w.nRows));
    const maxTop = Math.max(0, trackH - thumbH);
    const top = w.maxScroll > 0
      ? Math.round(maxTop * state.yStart / w.maxScroll)
      : 0;

    vthumbEl.style.height = thumbH + 'px';
    vthumbEl.style.top = top + 'px';
    vthumbEl.style.background = theme.dark
      ? 'rgba(148,163,184,.5)'
      : 'rgba(100,116,139,.5)';
  }

  function scrollRows(delta) {
    const w = rowsWindow();
    state.yStart = clamp(state.yStart + delta, 0, w.maxScroll);
    applyYWindow();
  }

  // ====== Подсказка с описанием ЗНИ (левая колонка) ======
  function hideZTip() {
    if (ztipEl.style.display !== 'none') ztipEl.style.display = 'none';
  }

  function showZTip(row, pt) {
    const info = row ? zniInfoMap.get(row.zni) : '';
    if (!info) { hideZTip(); return; }

    const theme = state.theme;
    ztipEl.innerHTML =
      '<div style="font-weight:700;font-size:13px;margin-bottom:2px">ЗНИ ' +
        escHtml(row.zni) + '</div>' +
      '<div style="color:' + theme.muted + '">' + escHtml(info) + '</div>';
    ztipEl.style.background = theme.tooltipBg;
    ztipEl.style.borderColor = theme.border;
    ztipEl.style.color = theme.text;
    ztipEl.style.display = 'block';

    // Позиция у курсора с прижатием к краям блока.
    const maxW = chartEl.clientWidth || 0;
    const maxH = chartEl.clientHeight || 0;
    const w = ztipEl.offsetWidth;
    const h = ztipEl.offsetHeight;
    let left = pt.x + 14;
    let top = pt.y + 14;
    if (left + w > maxW - 4) left = Math.max(4, pt.x - w - 12);
    if (top + h > maxH - 4) top = Math.max(4, pt.y - h - 10);
    ztipEl.style.left = Math.round(left) + 'px';
    ztipEl.style.top = Math.round(top) + 'px';
  }

  // ====== Инициализация ECharts ======
  // Патч passive, иначе wheel нельзя preventDefault (как в lineage_v2)
  const _origAEL = HTMLElement.prototype.addEventListener;
  HTMLElement.prototype.addEventListener = function (type, listener, options) {
    let opts = options;
    if (type === 'wheel' || type === 'mousewheel') {
      if (typeof opts === 'boolean') opts = { capture: opts, passive: false };
      else if (typeof opts === 'object' && opts !== null) opts = { ...opts, passive: false };
      else opts = { passive: false };
    }
    return _origAEL.call(this, type, listener, opts);
  };

  try {
    chart = echarts.init(chartEl);
  } finally {
    HTMLElement.prototype.addEventListener = _origAEL;
  }

  chartEl.appendChild(vbarEl);
  chartEl.appendChild(ztipEl);

  el.__pixbiGanttChart = chart;

  // Отладочный API для локального стенда debug_gantt.html
  el.__pixbiGanttApi = {
    setQrt(q) {
      state.qrt = q || '__all__';
      state.xZoom = null;
      state.yStart = 0;
      xSpanCache = { n: 0, at: 0 };
      render();
    },
    setCollapsed(collapsed) { setAllCollapsed(!!collapsed); },
    scrollTo(y) {
      const w = rowsWindow();
      state.yStart = clamp(Math.round(Number(y) || 0), 0, w.maxScroll);
      applyYWindow();
    },
    getTipCell() {
      const visN = visibleRowCount();
      let best = -1;
      let bestH = -1;
      viewCells.forEach((c, i) => {
        const h = Number(c._hours) || 0;
        if (c.value[1] < visN && h > bestH) { bestH = h; best = i; }
      });
      return best;
    },
    // Стенд: показать подсказку описания для строки (без реального hover).
    zTipAt(rowIndex) {
      const row = viewRows[Number(rowIndex)];
      if (!row) return false;
      let y = 40;
      try {
        const py = chart.convertToPixel({ yAxisIndex: 0 }, Number(rowIndex));
        if (Number.isFinite(py)) y = py;
      } catch (e) { /* ось ещё не готова */ }
      showZTip(row, { x: 40, y: y });
      return ztipEl.style.display !== 'none';
    },
    getState() {
      return {
        qrt: state.qrt,
        collapsed: Array.from(state.collapsed),
        yStart: state.yStart
      };
    }
  };

  // ====== События ======
  chart.on('datazoom', function () {
    if (isRendering) return;
    const opt = chart.getOption();
    const dz = (opt.dataZoom || []);
    const dx = dz.find((d) => d.id === 'dzX');
    if (dx && dx.start != null && dx.end != null) {
      state.xZoom = { start: dx.start, end: dx.end };

      // Подписи дат: при переходе через порог (обзор ↔ зум)
      // перерисовываем ось, чтобы включить/убрать числа дней.
      const prev = xSpanCache.n;
      xSpanCache = { n: 0, at: 0 };
      const span = Math.max(1, Math.round(viewDays.length * (dx.end - dx.start) / 100));
      if (prev && (prev <= 140) !== (span <= 140)) {
        chart.setOption({ xAxis: { axisLabel: buildXAxisLabel(state.theme) } });
      }
    }
    const dy = dz.find((d) => d.id === 'dzY');
    if (dy) {
      const sv = Number(dy.startValue);
      if (Number.isFinite(sv)) state.yStart = sv;
    }
  });

  // Клик по левой панели: сворачивание группы
  chart.getZr().on('click', function (e) {
    if (e.offsetX >= LEFT_W) return;

    const pt = chart.convertFromPixel({ yAxisIndex: 0 }, e.offsetY);
    let idx = Math.round(Number(pt));
    if (!Number.isFinite(idx)) return;

    const row = viewRows[idx];
    if (!row || row.kind !== 'group' || row.noExecs) return;

    toggleGroup(row.zni, idx);
  });

  // Курсор над сворачиваемыми группами
  chart.getZr().on('mousemove', function (e) {
    if (e.offsetX >= LEFT_W) {
      hideZTip();
      if (chartEl.style.cursor) chartEl.style.cursor = '';
      return;
    }
    const pt = chart.convertFromPixel({ yAxisIndex: 0 }, e.offsetY);
    let idx = Math.round(Number(pt));
    const row = Number.isFinite(idx) ? viewRows[idx] : null;

    // Описание ЗНИ — только над первой колонкой (номер ЗНИ).
    if (row && e.offsetX <= COL_ZNI + 12) {
      showZTip(row, { x: e.offsetX, y: e.offsetY });
    } else {
      hideZTip();
    }

    chartEl.style.cursor = row && row.kind === 'group' && !row.noExecs
      ? 'pointer' : '';
  });

  chart.getZr().on('globalout', hideZTip);

  // Колесо: вертикальный скролл; Ctrl/Cmd + колесо — зум по времени
  chart.getZr().on('mousewheel', function (e) {
    const ev = e.event;
    if (!ev) return;

    const nRows = viewRows.length;
    const N = Math.min(nRows, visibleRowCount());

    if (ev.ctrlKey || ev.metaKey) {
      if (ev.preventDefault) ev.preventDefault();
      const factor = ev.deltaY > 0 ? 1.22 : 1 / 1.22;
      zoomX(factor);
      return;
    }

    if (ev.preventDefault) ev.preventDefault();
    const step = Math.max(1, Math.round((Math.abs(ev.deltaY) || 100) > 60 ? 3 : 1));
    state.yStart = clamp(
      state.yStart + (ev.deltaY > 0 ? step : -step),
      0,
      Math.max(0, nRows - N)
    );
    applyYWindow();
  });

  // ====== Крутилка: колесо, перетаскивание, клик по треку ======
  vbarEl.addEventListener('wheel', function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    const step = Math.max(1,
      Math.round((Math.abs(ev.deltaY) || 100) > 60 ? 3 : 1));
    scrollRows(ev.deltaY > 0 ? step : -step);
  }, { passive: false });

  let vDrag = null;

  vthumbEl.addEventListener('pointerdown', function (ev) {
    const w = rowsWindow();
    if (!w.maxScroll) return;
    if (ev.preventDefault) ev.preventDefault();
    const trackH = vbarTrackHeight();
    vDrag = {
      y: ev.clientY,
      start: state.yStart,
      maxScroll: w.maxScroll,
      range: Math.max(1, trackH - vthumbEl.offsetHeight)
    };
    vbarEl.classList.add('pg-vdragging');
    try { vthumbEl.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });

  vthumbEl.addEventListener('pointermove', function (ev) {
    if (!vDrag) return;
    const delta = Math.round(
      (ev.clientY - vDrag.y) / vDrag.range * vDrag.maxScroll
    );
    state.yStart = clamp(vDrag.start + delta, 0, vDrag.maxScroll);
    applyYWindow();
  });

  function endVDrag() {
    if (!vDrag) return;
    vDrag = null;
    vbarEl.classList.remove('pg-vdragging');
  }

  vthumbEl.addEventListener('pointerup', endVDrag);
  vthumbEl.addEventListener('pointercancel', endVDrag);

  // Клик по треку — прыжок к позиции
  vbarEl.addEventListener('pointerdown', function (ev) {
    if (ev.target === vthumbEl) return;
    const w = rowsWindow();
    if (!w.maxScroll) return;
    if (ev.preventDefault) ev.preventDefault();
    const rect = vbarEl.getBoundingClientRect();
    const ratio = clamp((ev.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    state.yStart = Math.round(ratio * w.maxScroll);
    applyYWindow();
  });

  function zoomX(factor) {
    const opt = chart.getOption();
    const dz = (opt.dataZoom || []).find((d) => d.id === 'dzX');
    let start = dz && dz.start != null ? dz.start : 0;
    let end = dz && dz.end != null ? dz.end : 100;

    const center = (start + end) / 2;
    let half = ((end - start) / 2) * factor;
    half = clamp(half, 1.5, 50);

    start = center - half;
    end = center + half;
    if (start < 0) { end -= start; start = 0; }
    if (end > 100) { start -= end - 100; end = 100; }
    start = clamp(start, 0, 100);
    end = clamp(end, 0, 100);

    state.xZoom = { start, end };
    chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'dzX', start, end });
    chart.dispatchAction({ type: 'dataZoom', dataZoomId: 'dzXSlider', start, end });
  }

  // ====== Сворачивание / разворачивание ======
  function toggleGroup(zni, oldIdx) {
    const offset = oldIdx - state.yStart;

    if (state.collapsed.has(zni)) state.collapsed.delete(zni);
    else state.collapsed.add(zni);

    render();

    const newIdx = viewRows.findIndex((r) => r.kind === 'group' && r.zni === zni);
    if (newIdx >= 0) {
      const N = Math.min(viewRows.length, visibleRowCount());
      state.yStart = clamp(
        newIdx - offset,
        0,
        Math.max(0, viewRows.length - N)
      );
      applyYWindow();
    }
  }

  function setAllCollapsed(collapsed) {
    state.collapsed = new Set(
      collapsed ? model.groups.map((g) => g.zni) : []
    );
    state.yStart = 0;
    render();
    applyYWindow();
  }

  // Делегирование событий шапки (навешивается один раз)
  headerEl.addEventListener('change', function (e) {
    const sel = e.target.closest ? e.target.closest('.pg-select') : null;
    if (!sel) return;

    state.qrt = sel.value || '__all__';
    state.xZoom = null;
    state.yStart = 0;
    render();
  });

  headerEl.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('.pg-btn') : null;
    if (!btn) return;

    if (btn.getAttribute('data-act') === 'expand') setAllCollapsed(false);
    if (btn.getAttribute('data-act') === 'collapse') setAllCollapsed(true);
  });

  // ====== Первый рендер ======
  render();

  // ====== Resize ======
  let resizeTimer = null;
  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      if (!chart) return;
      chart.resize();
      applyYWindow();
    }, 80);
  }

  window.addEventListener('resize', scheduleResize);
  if (window.ResizeObserver) {
    try {
      const ro = new ResizeObserver(scheduleResize);
      ro.observe(el);
      ro.observe(chartEl);
    } catch (e) { /* ignore */ }
  }

  // ====== Тема ======
  function themeSignature(t) {
    return [t.bg, t.text, t.dark ? '1' : '0'].join('|');
  }

  let themeSig = themeSignature(state.theme);

  function applyThemeIfChanged() {
    const t = readTheme();
    const sig = themeSignature(t);
    if (sig === themeSig) return;

    themeSig = sig;
    state.theme = t;
    el.style.background = t.bg;
    chartEl.style.background = t.bg;
    render();
  }

  if (window.MutationObserver && document.body) {
    const observer = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        if (m.type === 'attributes' &&
          (m.attributeName === 'class' || m.attributeName === 'style')) {
          applyThemeIfChanged();
          break;
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  window.addEventListener('message', function (event) {
    if (event && event.data && event.data.type === 'THEME_CHANGED') {
      applyThemeIfChanged();
    }
  });

  // Базовые стили контейнера
  el.style.background = state.theme.bg;
  el.style.fontFamily = FONT_FAMILY;
  chartEl.style.background = state.theme.bg;
  renderHeader(state.theme);
})();
