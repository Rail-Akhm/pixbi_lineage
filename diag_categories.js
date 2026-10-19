/* ============================================================
 * diag_categories.js — диагностика PIX BI:
 * как платформа отдаёт НЕСКОЛЬКО отдельных категорий.
 *
 * Зачем: в блоке настроены отдельные категории (dt, zni_number,
 * full_name, practice, qrt), а getItemData вернул только одну.
 * Этот скрипт печатает ПРЯМО НА ЭКРАНЕ (DevTools не нужен):
 *   - полную структуру ответа getItemData;
 *   - все места, где могли спрятаться остальные категории;
 *   - какие способы чтения работают, а какие нет;
 *   - что вернёт getItemData при других аргументах;
 *   - нет ли рядом других функций API.
 *
 * Как запустить: вставить содержимое файла как кастомную
 * визуализацию блока PIX BI ВМЕСТО gantt.js. Блок должен быть
 * тем, где настроены 5 отдельных категорий и мера.
 *
 * BLOCK_ID — ID этого блока (он же DOM-элемент для рендера).
 * В локальном стенде можно переопределить window.__DIAG_BLOCK_ID__.
 * ============================================================ */

(async function () {
  'use strict';

  const BLOCK_ID =
    (typeof window !== 'undefined' && window.__DIAG_BLOCK_ID__) ||
    'vv86tlu5j3ljm7amqnvi2sj3nwqx0ax3';

  const MAX_LINES = 2000;

  let panel = null;
  let preEl = null;
  let statusEl = null;
  let busy = false;

  // ---------- панель ----------

  function theme() {
    try {
      const t = window.themeConfigs || {};
      const bg = (t.application && t.application.background &&
        t.application.background.items) || '#ffffff';
      const fg = (t.texts && t.texts.labels && t.texts.labels.font_color) ||
        '#0f172a';
      return { bg: bg, fg: fg };
    } catch (e) {
      return { bg: '#ffffff', fg: '#0f172a' };
    }
  }

  function ensurePanel() {
    const host = document.getElementById(BLOCK_ID);
    const th = theme();

    if (panel && document.body.contains(panel)) {
      panel.style.background = th.bg;
      panel.style.color = th.fg;
      return;
    }

    panel = document.createElement('div');
    panel.setAttribute('data-viz', 'diag-categories');
    panel.style.cssText =
      'display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;' +
      'background:' + th.bg + ';color:' + th.fg + ';' +
      (host
        ? 'width:100%;height:100%;'
        : 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;border:2px solid #ef4444;');

    const head = document.createElement('div');
    head.style.cssText =
      'flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;' +
      'padding:8px 12px;border-bottom:1px solid rgba(128,128,128,.35);' +
      'font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;';

    const title = document.createElement('b');
    title.textContent = 'PIX BI · диагностика категорий';
    head.appendChild(title);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Перепроверить';
    btn.style.cssText =
      'font:12px/1 inherit;padding:5px 12px;border-radius:6px;cursor:pointer;' +
      'border:1px solid currentColor;background:transparent;color:inherit;';
    btn.addEventListener('click', function () { run(); });
    head.appendChild(btn);

    statusEl = document.createElement('span');
    statusEl.style.cssText = 'font-size:12px;opacity:.7;margin-left:auto;';
    head.appendChild(statusEl);

    preEl = document.createElement('pre');
    preEl.style.cssText =
      'flex:1 1 auto;min-height:0;margin:0;overflow:auto;box-sizing:border-box;' +
      'padding:10px 14px;white-space:pre-wrap;word-break:break-word;' +
      'font:12px/1.5 Consolas,"Courier New",monospace;color:inherit;';

    panel.appendChild(head);
    panel.appendChild(preEl);

    if (host) {
      host.innerHTML = '';
      host.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  function render(lines) {
    if (lines.length > MAX_LINES) {
      preEl.textContent = lines.slice(0, MAX_LINES).join('\n') +
        '\n\n… вывод обрезан: ' + (lines.length - MAX_LINES) + ' строк не показано';
    } else {
      preEl.textContent = lines.join('\n');
    }
    panel.scrollTop = 0;
    preEl.scrollTop = 0;
  }

  // ---------- утилиты описания значений ----------

  function typeOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'Array(' + v.length + ')';
    if (v instanceof Date) return 'Date(' + v.toISOString() + ')';
    if (typeof v === 'object') {
      const ctor = v.constructor && v.constructor.name;
      return ctor && ctor !== 'Object' ? ctor : 'Object';
    }
    return typeof v;
  }

  function short(v, max) {
    max = max || 140;
    try {
      if (v === null || v === undefined) return String(v);
      if (typeof v === 'string') {
        return JSON.stringify(v.length > max ? v.slice(0, max) + '…' : v);
      }
      if (typeof v !== 'object') return String(v);
      if (v instanceof Date) return 'Date(' + v.toISOString() + ')';
      if (Array.isArray(v)) {
        if (v.length <= 8 && v.every(function (x) {
          return x === null || typeof x !== 'object';
        })) {
          return JSON.stringify(v);
        }
        return 'Array(' + v.length + ')';
      }
      const keys = Object.keys(v);
      if (keys.length <= 6) {
        return '{' + keys.map(function (k) {
          return k + ': ' + short(v[k], 50);
        }).join(', ') + '}';
      }
      return '{' + keys.join(', ') + '}';
    } catch (e) {
      return '<ошибка описания: ' + e.message + '>';
    }
  }

  // Дерево значения: массивы — первые 3 элемента, объекты — все ключи.
  function dump(v, name, depth, maxDepth, lines, seen) {
    const pad = new Array(depth + 1).join('  ');
    const label = name === null ? '' : name + ': ';
    if (v === null || typeof v !== 'object') {
      lines.push(pad + label + typeOf(v) + ' = ' + short(v));
      return;
    }
    if (seen.indexOf(v) !== -1) {
      lines.push(pad + label + '<циклическая ссылка>');
      return;
    }
    seen.push(v);
    lines.push(pad + label + typeOf(v));
    if (depth >= maxDepth) {
      lines.push(pad + '  … глубже не смотрим');
      seen.pop();
      return;
    }
    if (Array.isArray(v)) {
      const lim = Math.min(v.length, 3);
      for (let i = 0; i < lim; i++) {
        dump(v[i], '[' + i + ']', depth + 1, maxDepth, lines, seen);
      }
      if (v.length > lim) {
        lines.push(new Array(depth + 2).join('  ') +
          '… ещё ' + (v.length - lim) + ' элементов');
      }
    } else {
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        dump(v[keys[i]], keys[i], depth + 1, maxDepth, lines, seen);
      }
    }
    seen.pop();
  }

  // Поиск всех массивов длиннее 1 внутри ответа: там могут прятаться
  // колонки с отдельными категориями.
  function scanArrays(v, path, found, depth, seen, limit) {
    if (found.length >= limit || depth > 8) return;
    if (!v || typeof v !== 'object') return;
    if (seen.indexOf(v) !== -1) return;
    seen.push(v);
    if (Array.isArray(v)) {
      if (depth > 0 && v.length > 1) {
        const prim = v.every(function (x) {
          return x === null || typeof x !== 'object';
        });
        found.push({
          path: path,
          len: v.length,
          kind: prim ? 'примитивы' : 'объекты/массивы',
          sample: prim ? short(v, 100) : short(v[0], 100)
        });
      }
      for (let i = 0; i < Math.min(v.length, 3); i++) {
        scanArrays(v[i], path + '[' + i + ']', found, depth + 1, seen, limit);
      }
    } else {
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) {
        scanArrays(v[keys[i]], path + '.' + keys[i], found, depth + 1,
          seen, limit);
      }
    }
    seen.pop();
  }

  // Поиск упоминаний строки (ID блока, имя датасета) внутри структуры.
  function findPaths(v, needle, path, out, depth, budget, seen) {
    if (out.length >= 12 || budget.n > 6000 || depth > 7) return;
    budget.n++;
    if (typeof v === 'string') {
      if (v.indexOf(needle) !== -1) out.push(path + ' = ' + short(v, 120));
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (seen.indexOf(v) !== -1) return;
    seen.push(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 60; i++) {
        findPaths(v[i], needle, path + '[' + i + ']', out, depth + 1,
          budget, seen);
      }
    } else {
      const ks = Object.keys(v);
      for (let i = 0; i < ks.length && i < 60; i++) {
        if (ks[i].indexOf(needle) !== -1) {
          out.push(path + '.' + ks[i] + ' (ключ)');
        }
        findPaths(v[ks[i]], needle, path + '.' + ks[i], out, depth + 1,
          budget, seen);
      }
    }
    seen.pop();
  }

  function shapeOf(res) {
    if (res === null || res === undefined) return String(res);
    if (Array.isArray(res)) return 'Array(' + res.length + ')';
    if (typeof res !== 'object') return typeof res + ' ' + short(res, 80);
    const parts = ['Object{' + Object.keys(res).join(', ') + '}'];
    ['categories', 'values', 'columns', 'rows', 'data', 'series'].forEach(
      function (k) {
        if (Array.isArray(res[k])) parts.push(k + '=' + res[k].length);
      }
    );
    return parts.join(' · ');
  }

  function uniqueNames(cats) {
    const set = new Set();
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      const n = c && typeof c === 'object' ? c.name : c;
      try { set.add(short(n, 60)); } catch (e) { /* ignore */ }
    }
    return set.size;
  }

  // ---------- основной отчёт ----------

  async function run() {
    if (busy) return;
    busy = true;
    ensurePanel();
    statusEl.textContent = 'запрашиваю данные…';
    preEl.textContent = 'Запрашиваю getItemData(' + BLOCK_ID + ')…';

    const lines = [];
    // Короткий итог — печатается первым, чтобы не искать его в конце отчёта.
    let topVerdict = 'ИТОГ: не удалось определить структуру — смотри разделы ниже.';
    const push = function (s) {
      lines.push(s === undefined || s === null ? '' : String(s));
    };
    const hr = function (t) {
      push('');
      push('=== ' + t + ' ===');
    };
    const ok = function (s) { push('  ✅ ' + s); };
    const no = function (s) { push('  ❌ ' + s); };

    push('PIX BI · диагностика чтения нескольких категорий');
    push('BLOCK_ID: ' + BLOCK_ID);
    push('Время: ' + new Date().toLocaleString('ru-RU'));
    push('Блок: в нём должны быть настроены все отдельные категории + мера.');

    // ---- 1. функция ----
    hr('1. ФУНКЦИЯ getItemData');
    const fn = typeof window.getItemData === 'function'
      ? window.getItemData : null;
    if (!fn) {
      no('getItemData не найдена — скрипт запущен не внутри блока PIX BI?');
      finalize();
      return;
    }
    ok('getItemData найдена в window');
    push('  арность (getItemData.length): ' + fn.length);
    let src = '<недоступно>';
    try { src = String(fn); } catch (e) { src = '<ошибка: ' + e.message + '>'; }
    push('  исходник, первые 400 символов:');
    push('  ' + src.slice(0, 400).replace(/\s+/g, ' '));

    // ---- 2. ответ ----
    let data = null;
    let error = null;
    try {
      data = await fn(BLOCK_ID);
    } catch (e) {
      error = e;
    }
    if (error) {
      hr('2. ОТВЕТ getItemData');
      no('вызов завершился ошибкой: ' + (error && error.message ? error.message : error));
      finalize();
      return;
    }

    // ---- 2a. верхний уровень ----
    hr('2. ВЕРХНИЙ УРОВЕНЬ ОТВЕТА');
    push('тип: ' + typeOf(data) + ' · ' + shapeOf(data));
    if (!data || typeof data !== 'object') {
      no('ответ — не объект, читать нечего');
      finalize();
      return;
    }
    const topKeys = Object.keys(data);
    for (let i = 0; i < topKeys.length; i++) {
      const k = topKeys[i];
      let v;
      try { v = data[k]; } catch (e) { v = '<ошибка: ' + e.message + '>'; }
      push('  ' + k + ': ' + typeOf(v) + ' = ' + short(v, 160));
    }

    const cats = Array.isArray(data.categories) ? data.categories : null;
    const hasTable = Array.isArray(data.values) &&
      Array.isArray(data.columns) && data.columns.length > 0;

    push('');
    push('  categories: ' + (cats ? cats.length + ' строк' : 'нет'));
    if (cats && cats.length) {
      push('  уникальных categories[i].name: ' + uniqueNames(cats));
    }
    if (hasTable) {
      push('  values: ' + data.values.length + ' строк, columns: ' +
        data.columns.length);
    }

    // ---- 2b. дерево ----
    hr('3. СТРУКТУРА ОТВЕТА (первые 3 элемента массивов)');
    const tree = [];
    dump(data, 'data', 0, 6, tree, []);
    for (let i = 0; i < tree.length; i++) push(tree[i]);

    // ---- 2c. нестандартные поля категорий ----
    hr('4. ПОЛЯ, КОТОРЫЕ ПРИСУТСТВУЮТ У КАТЕГОРИЙ');
    if (cats && cats.length) {
      const keyCount = {};
      const lim = Math.min(cats.length, 200);
      for (let i = 0; i < lim; i++) {
        const c = cats[i];
        if (!c || typeof c !== 'object') continue;
        const ks = Object.keys(c);
        for (let j = 0; j < ks.length; j++) {
          keyCount[ks[j]] = (keyCount[ks[j]] || 0) + 1;
        }
      }
      const names = Object.keys(keyCount).sort(function (a, b) {
        return keyCount[b] - keyCount[a];
      });
      for (let i = 0; i < names.length; i++) {
        const k = names[i];
        let sample = '';
        try { sample = short(cats[0][k], 100); } catch (e) { sample = ''; }
        push('  ' + k + ': у ' + keyCount[k] + ' из ' + lim +
          ' строк · пример ' + sample);
      }
      push('');
      push('  keys первого элемента: ' + Object.keys(cats[0] || {}).join(', '));
    } else {
      push('  categories нет');
    }

    // ---- 2d. поиск массивов с несколькими значениями ----
    hr('5. ПОИСК МАССИВОВ ВНУТРИ ОТВЕТА (где могут быть колонки)');
    const found = [];
    scanArrays(data, 'data', found, 0, [], 40);
    if (!found.length) {
      push('  массивов длиннее 1 не найдено');
    } else {
      for (let i = 0; i < found.length; i++) {
        const f = found[i];
        push('  ' + f.path + ' [' + f.len + '] ' + f.kind +
          ' · пример: ' + f.sample);
      }
    }

    // ---- 3. вердикт по способам чтения ----
    hr('6. КАКИЕ СПОСОБЫ ЧТЕНИЯ РАБОТАЮТ');
    if (!cats) {
      no('категорий в ответе нет');
      if (hasTable) {
        ok('D. табличный формат values + columns: ' + data.values.length +
          ' строк, ' + data.columns.length + ' колонок — поля отдельные');
        topVerdict = 'ИТОГ: данные приходят ТАБЛИЦЕЙ values+columns — ' +
          data.columns.length + ' колонок, поля отдельные.';
      }
    } else if (!cats.length) {
      no('categories пуст — нет строк данных (проверь меру в блоке)');
    } else {
      const c0 = cats[0];
      const n0 = c0 && typeof c0 === 'object' ? c0.name : c0;
      const allArrays = cats.every(Array.isArray);
      const allNamesArrays = cats.every(function (c) {
        return c && typeof c === 'object' && Array.isArray(c.name);
      });
      const columnObjects = cats.every(function (c) {
        return c && typeof c === 'object' &&
          (Array.isArray(c.values) || Array.isArray(c.data));
      });

      // A. categories[i].name — массив-кортеж
      if (allNamesArrays) {
        ok('A. categories[i].name — МАССИВ (' +
          (Array.isArray(n0) ? n0.length : '?') + ' полей): ' +
          'несколько категорий читаются напрямую');
      } else if (Array.isArray(n0)) {
        ok('A. categories[i].name — массив (' + n0.length + ' полей)');
      } else {
        no('A. categories[i].name — не массив, а ' + typeOf(n0) +
          (typeof n0 === 'string' ? ' (' + short(n0, 80) + ')' : '') +
          ' — платформа отдала ОДНУ категорию');
      }

      // B. categories[i] — объект-колонка {name, values}
      if (columnObjects) {
        ok('B. categories[i] — объект-колонка с values: ' +
          'поля приходят отдельными колонками');
      } else {
        no('B. объекта-колонки (categories[i].values) нет');
      }

      // C. транспонированный формат: categories = [колонка0, колонка1, ...]
      if (allArrays && cats[0].length > cats.length) {
        ok('C. categories — транспонированные колонки: ' +
          cats.length + ' колонок по ' + cats[0].length + ' значений');
      } else if (allArrays) {
        no('C. categories — массивы, но это не похоже на транспонированные ' +
          'колонки (' + cats.length + ' × ' + cats[0].length + ')');
      } else {
        no('C. транспонированных колонок нет');
      }

      // D. табличный формат
      if (hasTable) {
        ok('D. табличный формат values + columns: ' + data.values.length +
          ' строк, ' + data.columns.length + ' колонок');
        if (data.columns.length <= 20) {
          push('     колонки: ' + data.columns.map(function (col) {
            if (col && typeof col === 'object') {
              return col.name || col.alias || col.id || short(col, 40);
            }
            return String(col);
          }).join(' | '));
        }
      } else {
        no('D. табличного формата values + columns нет');
      }

      // E. мера внутри каждой строки
      if (Array.isArray(c0.series) && c0.series.length) {
        ok('E. меры лежат в categories[i].series: ' + c0.series.length +
          ' шт., пример ' + short(c0.series[0], 100));
      } else if (c0 && typeof c0 === 'object' &&
        ('value' in c0 || 'values' in c0 || 'data' in c0)) {
        ok('E. мера лежит в categories[i].value / values');
      } else {
        no('E. меры внутри строки категории не найдено');
      }

      // Короткий итог для шапки отчёта.
      if (Array.isArray(n0)) {
        topVerdict = 'ИТОГ: категории приходят КОРТЕЖЕМ — в categories[i].name ' +
          n0.length + ' полей, читаются напрямую по индексу.';
      } else if (columnObjects) {
        topVerdict = 'ИТОГ: категории приходят ОТДЕЛЬНЫМИ КОЛОНКАМИ — ' +
          'categories[i].values.';
      } else if (hasTable) {
        topVerdict = 'ИТОГ: данные приходят ТАБЛИЦЕЙ values+columns — ' +
          data.columns.length + ' колонок, поля отдельные.';
      } else if (allArrays && cats[0].length > cats.length) {
        topVerdict = 'ИТОГ: категории приходят ТРАНСПОНИРОВАННЫМИ КОЛОНКАМИ — ' +
          cats.length + ' колонок.';
      } else if (typeof n0 === 'string' || typeof n0 === 'number') {
        topVerdict = 'ИТОГ: платформа отдала ОДНУ категорию (' +
          short(n0, 60) + ') — остальные поля не пришли. Нужен ключ через "|~|".';
      }
    }

    // ---- 4. другие аргументы ----
    hr('7. getItemData С ДРУГИМИ АРГУМЕНТАМИ');
    const hostEl = document.getElementById(BLOCK_ID);
    const variants = [
      ['getItemData()', function () { return fn(); }],
      ['getItemData(' + BLOCK_ID + ')', function () { return fn(BLOCK_ID); }],
      ['getItemData(domElement)', hostEl
        ? function () { return fn(hostEl); }
        : null],
      ['getItemData({id})', function () { return fn({ id: BLOCK_ID }); }]
    ];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v[1]) { push('  ' + v[0] + ': DOM-элемент не найден, пропуск'); continue; }
      try {
        const res = await v[1]();
        push('  ' + v[0] + ' → ' + shapeOf(res));
      } catch (e) {
        push('  ' + v[0] + ' → ошибка: ' +
          (e && e.message ? e.message : String(e)));
      }
    }

    // ---- 5. хранилище данных и другие функции API ----
    hr('8. ХРАНИЛИЩЕ ДАННЫХ И ДРУГИЕ ФУНКЦИИ API');

    // 8a. window.itemsData — судя по исходнику getItemData, ответ берётся
    // оттуда: getItemData = (id) => window.itemsData[id] || {}.
    try {
      const store = window.itemsData;
      if (store && typeof store === 'object') {
        const ks = Object.keys(store);
        push('window.itemsData: ' + typeOf(store) + ', ключей ' + ks.length);

        if (Object.prototype.hasOwnProperty.call(store, BLOCK_ID)) {
          ok('ключ этого блока найден: ' + BLOCK_ID);
          const mine = store[BLOCK_ID];
          push('  значение: ' + typeOf(mine) + ' · ' + shapeOf(mine));
          if (mine && typeof mine === 'object') {
            push('  структура значения:');
            dump(mine, 'itemsData[' + BLOCK_ID + ']', 1, 4, lines, []);
          }
        } else {
          no('ключа этого блока в itemsData нет');
        }

        // Вдруг данные лежат под составными ключами (id + суффикс).
        const containing = ks.filter(function (k) {
          return k !== BLOCK_ID && k.indexOf(BLOCK_ID) !== -1;
        });
        if (containing.length) {
          ok('ключи, содержащие ID блока: ' + containing.join(', '));
          for (let i = 0; i < Math.min(containing.length, 5); i++) {
            const k = containing[i];
            push('  ' + k + ': ' + typeOf(store[k]) + ' · ' +
              shapeOf(store[k]));
          }
        }

        const others = ks.filter(function (k) {
          return k !== BLOCK_ID;
        }).slice(0, 12);
        if (others.length) {
          push('  другие ключи (до 12): ' + others.join(', '));
        }
      } else {
        push('window.itemsData недоступен (' + typeOf(store) + ')');
      }
    } catch (e) {
      push('window.itemsData: ошибка ' + (e && e.message ? e.message : e));
    }

    // 8b. getDataSets — соседняя функция, найденная в window.
    let gds = null;
    try {
      gds = typeof window.getDataSets === 'function' ? window.getDataSets : null;
    } catch (e) { gds = null; }

    push('');
    if (!gds) {
      push('getDataSets не найдена');
    } else {
      push('getDataSets: найдена, арность ' + gds.length);
      try {
        push('  исходник: ' + String(gds).slice(0, 400).replace(/\s+/g, ' '));
      } catch (e) { /* ignore */ }

      const probes = [
        ['getDataSets()', function () { return gds(); }],
        ['getDataSets(BLOCK_ID)', function () { return gds(BLOCK_ID); }],
        ['getDataSets({id:BLOCK_ID})', function () { return gds({ id: BLOCK_ID }); }]
      ];
      for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        try {
          let res = await p[1]();
          if (res && typeof res.then === 'function') res = await res;
          push('  ' + p[0] + ' → ' + shapeOf(res));
          if (res && typeof res === 'object') {
            const before = lines.length;
            dump(res, 'результат', 2, 3, lines, []);
            if (lines.length - before > 120) {
              lines.length = before + 120;
              push('  … структура результата обрезана');
            }
          }
        } catch (e) {
          push('  ' + p[0] + ' → ошибка: ' +
            (e && e.message ? e.message : String(e)));
        }
      }
    }

    // 8c. Прочие хранилища: dataSets, dashboardByIdData, dashboardItems.
    //     Ищем в них ID блока и имя датасета — вдруг там лежат строки,
    //     а не только метаданные.
    const stores = ['dataSets', 'dashboardByIdData', 'dashboardItems'];
    for (let i = 0; i < stores.length; i++) {
      const nm = stores[i];
      let v;
      try { v = window[nm]; } catch (e) { v = undefined; }
      push('');
      if (!v || typeof v !== 'object') {
        push('window.' + nm + ': ' + typeOf(v));
        continue;
      }
      push('window.' + nm + ': ' + typeOf(v) + ' · ' + shapeOf(v));
      const before = lines.length;
      dump(v, nm, 1, 4, lines, []);
      if (lines.length - before > 140) {
        lines.length = before + 140;
        push('  … структура обрезана');
      }

      const needles = [BLOCK_ID, 'v_serv_jira_zni_gant'];
      for (let j = 0; j < needles.length; j++) {
        const hits = [];
        try {
          findPaths(v, needles[j], nm, hits, 0, { n: 0 }, []);
        } catch (e) { /* ignore */ }
        if (hits.length) {
          push('  упоминания "' + needles[j] + '":');
          for (let k = 0; k < hits.length; k++) {
            push('    ' + hits[k]);
          }
        }
      }
    }

    // 8d. прочие глобальные функции с подходящими именами.
    const candidates = [
      'getBlockData', 'getData', 'getBlockItems', 'getItemsData',
      'getCubeData', 'getBlockDataset', 'getDataset', 'getItemDataSimple',
      'getVisualizationData', 'getChartData'
    ];
    let foundFns = 0;
    for (let i = 0; i < candidates.length; i++) {
      const nm = candidates[i];
      if (typeof window[nm] !== 'function') continue;
      foundFns++;
      try {
        const res = await window[nm](BLOCK_ID);
        push('  ' + nm + '(BLOCK_ID) → ' + shapeOf(res));
      } catch (e) {
        push('  ' + nm + ' существует, вызов с BLOCK_ID упал: ' +
          (e && e.message ? e.message : String(e)));
      }
    }
    if (foundFns) {
      push('');
    }

    // 8d. Конфигурация блока: сколько категорий реально сохранено в дашборде.
    //     Если сохранено 5, а пришла одна — виновата платформа. Если сохранена
    //     одна — виновата настройка блока.
    push('');
    push('--- КОНФИГУРАЦИЯ БЛОКА (data_configs) ---');
    try {
      const items0 = Array.isArray(window.dashboardItems)
        ? window.dashboardItems[0] : null;
      const dc = items0 && items0.data_configs;
      if (!dc) {
        push('data_configs недоступен');
      } else {
        const cfgKeys = [
          ['categories', 'КАТЕГОРИИ'],
          ['values', 'МЕРЫ (values)'],
          ['series', 'СЕРИИ']
        ];
        for (let i = 0; i < cfgKeys.length; i++) {
          const key = cfgKeys[i][0];
          const title = cfgKeys[i][1];
          const cfg = dc[key];
          push('');
          push(title + ': ' + typeOf(cfg));
          if (!cfg || typeof cfg !== 'object') continue;
          const before = lines.length;
          dump(cfg, key, 1, 5, lines, []);
          if (lines.length - before > 180) {
            lines.length = before + 180;
            push('  … структура обрезана');
          }
        }
      }
    } catch (e) {
      push('data_configs: ошибка ' + (e && e.message ? e.message : e));
    }

    // 8e. Описание датасета: какие поля в нём вообще есть.
    try {
      const root = window.dataSets && Array.isArray(window.dataSets.data)
        ? window.dataSets.data : [];
      let shown = false;
      for (let i = 0; i < root.length && !shown; i++) {
        const list = root[i] && Array.isArray(root[i].data_sets)
          ? root[i].data_sets : [];
        for (let j = 0; j < list.length; j++) {
          const s = list[j];
          if (!s || s.name !== 'v_serv_jira_zni_gant') continue;
          push('');
          push('--- ДАТАСЕТ v_serv_jira_zni_gant ---');
          push('тип: ' + typeOf(s) + ' · ' + shapeOf(s));
          const before = lines.length;
          dump(s, 'dataset', 1, 4, lines, []);
          if (lines.length - before > 160) {
            lines.length = before + 160;
            push('  … структура обрезана');
          }
          shown = true;
          break;
        }
      }
      if (!shown) push('датасет v_serv_jira_zni_gant в dataSets не найден');
    } catch (e) {
      push('датасет: ошибка ' + (e && e.message ? e.message : e));
    }

    // 8f. любые объекты window, в имени которых есть «data».
    const dataObjects = [];
    const allNames = [];
    try {
      const ws = Object.keys(window);
      for (let i = 0; i < ws.length; i++) {
        const nm = ws[i];
        if (!/data|item|block|cube|pivot|grid|result|row/i.test(nm)) continue;
        allNames.push(nm);
        let val;
        try { val = window[nm]; } catch (e) { continue; }
        if (!val || typeof val !== 'object') continue;
        let len = 0;
        try { len = Object.keys(val).length; } catch (e) { len = 0; }
        if (!len) continue;
        // Интересуют только объекты, где есть ключ нашего блока.
        let hasMine = false;
        try { hasMine = Object.prototype.hasOwnProperty.call(val, BLOCK_ID); } catch (e) { /* ignore */ }
        dataObjects.push({ name: nm, keys: len, mine: hasMine });
      }
    } catch (e) { /* ignore */ }

    if (dataObjects.length) {
      push('  объекты window с «данными» в имени:');
      for (let i = 0; i < Math.min(dataObjects.length, 20); i++) {
        const o = dataObjects[i];
        push('    window.' + o.name + ': ' + o.keys + ' ключей' +
          (o.mine ? ' · СОДЕРЖИТ ID БЛОКА' : ''));
      }
    }
    if (allNames.length) {
      push('  кандидаты по имени: ' + allNames.slice(0, 40).join(', '));
    } else {
      push('  кандидатов по имени в window нет');
    }

    // ---- 6. что делать ----
    hr('9. ВЫВОД');
    const c0 = cats && cats[0];
    const nameIsTuple = !!(c0 && typeof c0 === 'object' &&
      Array.isArray(c0.name));
    const nameIsScalar = !!(c0 && typeof c0 === 'object' &&
      (typeof c0.name === 'string' || typeof c0.name === 'number'));

    if (nameIsTuple) {
      push('Категории приходят кортежем — несколько полей можно читать');
      push('напрямую из categories[i].name:');
      push('  ' + short(c0.name, 200));
      push('Порядок частей — как настроен в блоке.');
    } else if (nameIsScalar) {
      push('Платформа вернула ОДНУ категорию (categories[i].name — строка).');
      push('Остальные поля блока в ответ не попали.');
      push('');
      push('Что проверено: в ответе нет ни массивов-кортежей, ни колонок,');
      push('ни таблицы values+columns. getItemData устроена как');
      push('(id) => window.itemsData[id], и в хранилище для блока тоже только');
      push('эта одна категория. Приходит ПЕРВАЯ категория из настроенных в');
      push('блоке — порядок полей в «Категориях» определяет, какая именно.');
      push('');
      push('Рабочий вариант — одно вычисляемое поле-ключ через "|~|"');
      push('(порядок частей любой, gantt.js распознаёт по форме):');
      push('  concat(coalesce(toString(dt),"") ,\'|~|\',coalesce(zni_number,""),\'|~|\',');
      push('         coalesce(full_name,""),\'|~|\',coalesce(practice,""),\'|~|\',');
      push('         coalesce(qrt,""))');
      push('Если нет toString(dt) — cast(dt as varchar) или to_char(dt,\'YYYY-MM-DD\').');
    } else {
      push('Структура нестандартная — смотри разделы 3 и 5 выше:');
      push('там все поля ответа и все массивы с несколькими значениями.');
    }

    finalize();

    function finalize() {
      busy = false;
      statusEl.textContent = 'готово · ' + new Date().toLocaleTimeString('ru-RU') +
        ' · строк: ' + lines.length;
      // Отдаём текст наружу: удобно скопировать из консоли, если появится.
      try {
        window.__diagCategoriesReport = [topVerdict, ''].concat(lines).join('\n');
      } catch (e) { /* ignore */ }
      render([topVerdict, ''].concat(lines));
      try { console.log('[diag_categories]\n' + lines.join('\n')); } catch (e) { /* ignore */ }
    }
  }

  // ---------- старт ----------

  await run();

  // Данные PIX BI грузятся асинхронно — повторим один раз, чтобы поймать
  // момент, когда блок уже отдал полный ответ.
  setTimeout(function () { run(); }, 2500);

})();
