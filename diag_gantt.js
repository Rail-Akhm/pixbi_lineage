/* ============================================================
 * diag_gantt.js — короткая диагностика диаграммы Ганта.
 *
 * Вставляется в блок PIX BI ВМЕСТО gantt.js. Ничего не рисует,
 * только печатает отчёт на экране (DevTools не нужен):
 * сколько строк пришло, как разбирается gantt_key, что в итоге
 * попадёт на диаграмму и где проблемы.
 *
 * BLOCK_ID — ID блока Ганта. В локальном стенде можно
 * переопределить через window.__DIAG_GANTT_BLOCK_ID__.
 * ============================================================ */

(async function () {
  'use strict';

  const BLOCK_ID =
    (typeof window !== 'undefined' && window.__DIAG_GANTT_BLOCK_ID__) ||
    'vv86tlu5j3ljm7amqnvi2sj3nwqx0ax3';

  // Ожидаемые значения по датасету serv_jira_zni_gant_202610191223.csv.
  // Обновить, если датасет или фильтры изменятся.
  const EXPECTED = {
    rows: 1373,
    zni: 69,
    persons: 21,
    practices: 2,
    hours: 3601.55,
    from: '2025-01-29',
    to: '2026-10-16'
  };

  const SEPS = ['|~|', '\u001F', '§', '||'];
  const SEP_NAMES = { '|~|': '|~|', '\u001F': '\\u001F', '§': '§', '||': '||' };

  const FONT =
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';

  let panel = null;
  let preEl = null;
  let statusEl = null;
  let busy = false;

  // ---------- панель ----------

  function theme() {
    try {
      const t = window.themeConfigs || {};
      return {
        bg: (t.application && t.application.background &&
          t.application.background.items) || '#ffffff',
        fg: (t.texts && t.texts.labels && t.texts.labels.font_color) || '#0f172a'
      };
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
    panel.setAttribute('data-viz', 'diag-gantt');
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
      'font:13px/1.3 ' + FONT + ';';

    const title = document.createElement('b');
    title.textContent = 'Ганта · диагностика данных';
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

  // ---------- разбор ----------

  function typeOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'Array(' + v.length + ')';
    if (typeof v === 'object') return 'Object{' + Object.keys(v).join(', ') + '}';
    return typeof v;
  }

  function short(v, max) {
    max = max || 160;
    try {
      if (v === null || v === undefined) return String(v);
      if (typeof v === 'string') {
        return JSON.stringify(v.length > max ? v.slice(0, max) + '…' : v);
      }
      if (typeof v !== 'object') return String(v);
      if (v instanceof Date) return v.toISOString();
      return JSON.stringify(v);
    } catch (e) {
      return '<error>';
    }
  }

  function plain(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('value' in v) {
        const x = v.value;
        return Array.isArray(x) ? x[0] : x;
      }
      if (typeof v.name === 'string' || typeof v.name === 'number') return v.name;
    }
    return v;
  }

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  function looksLikeDate(s) {
    return /^(19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}([ T]|$)/.test(s) ||
      /^\d{1,2}[./]\d{1,2}[./](19|20)\d{2}/.test(s) ||
      /^(19|20)\d{6}$/.test(s);
  }

  function isoOf(s) {
    let m = /^((19|20)\d{2})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
    if (m) {
      return m[1] + '-' + ('0' + m[3]).slice(-2) + '-' + ('0' + m[4]).slice(-2);
    }
    m = /^(\d{1,2})[./](\d{1,2})[./]((19|20)\d{2})/.exec(s);
    if (m) {
      return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    m = /^((19|20)\d{2})(\d{2})(\d{2})$/.exec(s);
    if (m) return m[1] + '-' + m[3] + '-' + m[4];
    return null;
  }

  function splitKey(name) {
    for (let i = 0; i < SEPS.length; i++) {
      if (name.indexOf(SEPS[i]) !== -1) {
        return { sep: SEPS[i], parts: name.split(SEPS[i]) };
      }
    }
    return { sep: null, parts: [name] };
  }

  // Повторяет логику gantt.js: части ключа распознаются по форме.
  function parseKey(name) {
    const sp = splitKey(name);
    const parts = sp.parts.map(function (p) {
      return String(p == null ? '' : p).trim();
    }).filter(function (p) { return p !== ''; });

    const rec = { dt: null, zni: null, person: null, practice: null, qrt: null };
    const rest = [];
    const dateIdx = [];

    for (let i = 0; i < parts.length; i++) {
      if (!rec.dt && looksLikeDate(parts[i])) {
        rec.dt = parts[i];
        dateIdx.push(i);
        continue;
      }
      rest.push(parts[i]);
    }

    for (let i = 0; i < rest.length; i++) {
      if (/^(19|20)\d{2}\s*[-_/]?\s*(I|II|III|IV|Q[1-4])$/i.test(rest[i])) {
        rec.qrt = rest.splice(i, 1)[0];
        break;
      }
    }
    for (let i = 0; i < rest.length; i++) {
      if (/^\d{4,}$/.test(rest[i])) { rec.zni = rest.splice(i, 1)[0]; break; }
    }
    for (let i = 0; i < rest.length; i++) {
      if (/практик|отдел|департамент|управлен|направлен|служб|групп/i
        .test(rest[i])) {
        rec.practice = rest.splice(i, 1)[0];
        break;
      }
    }
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].split(/\s+/).length >= 2 && /[A-Za-zА-Яа-яЁё]/.test(rest[i])) {
        rec.person = rest.splice(i, 1)[0];
        break;
      }
    }
    if (rest.length) {
      if (rec.zni === null) rec.zni = rest.shift();
      if (rec.person === null && rest.length) rec.person = rest.shift();
      if (rec.practice === null && rest.length) rec.practice = rest.shift();
    }

    return { rec: rec, sep: sp.sep, parts: parts, rest: rest };
  }

  // ---------- отчёт ----------

  async function run() {
    if (busy) return;
    busy = true;
    ensurePanel();
    statusEl.textContent = 'читаю данные…';
    preEl.textContent = 'Запрашиваю getItemData(' + BLOCK_ID + ')…';

    const lines = [];
    const push = function (s) {
      lines.push(s === undefined || s === null ? '' : String(s));
    };
    const hr = function (t) { push(''); push('--- ' + t + ' ---'); };

    push('Ганта · диагностика данных');
    push('BLOCK_ID: ' + BLOCK_ID);
    push('Время: ' + new Date().toLocaleString('ru-RU'));

    const fn = typeof window.getItemData === 'function'
      ? window.getItemData : null;
    if (!fn) {
      push('');
      push('❌ getItemData недоступна — скрипт запущен не внутри блока PIX BI.');
      finish();
      return;
    }

    let data = null;
    try {
      data = await fn(BLOCK_ID);
    } catch (e) {
      push('');
      push('❌ getItemData упала: ' + (e && e.message ? e.message : e));
      finish();
      return;
    }

    if (!data || typeof data !== 'object') {
      push('');
      push('❌ Ответ пустой или не объект: ' + typeOf(data));
      finish();
      return;
    }

    const cats = Array.isArray(data.categories) ? data.categories : null;

    hr('ОТВЕТ getItemData');
    push('ключи: ' + Object.keys(data).join(', '));
    push('categories: ' + (cats ? cats.length + ' строк' : 'нет'));
    if (cats && cats.length) {
      push('первая строка: ' + short(cats[0], 400));
    }

    if (!cats || !cats.length) {
      push('');
      push('❌ Нет строк. В блоке должна быть категория gantt_key и мера');
      push('   SUM(timeworked_h).');
      finish();
      return;
    }

    // ---- разбор всех строк ----
    const stats = {
      rows: 0, ok: 0, noSep: 0, noDt: 0, noZni: 0,
      noPractice: 0, noPerson: 0, noHours: 0,
      seps: {},
      partCounts: {},
      zni: new Set(), persons: new Set(), practices: new Set(),
      qrts: new Set(), days: new Set(),
      minDay: null, maxDay: null, hours: 0,
      samples: [], bad: []
    };

    for (let i = 0; i < cats.length; i++) {
      const c = cats[i];
      if (!c || typeof c !== 'object') continue;
      const name = plain(c.name);
      if (typeof name !== 'string' || !name) continue;
      stats.rows++;

      const pk = parseKey(name);
      stats.seps[pk.sep === null ? 'нет' : SEP_NAMES[pk.sep]] =
        (stats.seps[pk.sep === null ? 'нет' : SEP_NAMES[pk.sep]] || 0) + 1;
      const pc = pk.parts.length;
      stats.partCounts[pc] = (stats.partCounts[pc] || 0) + 1;

      if (pk.sep === null) stats.noSep++;

      let hours = NaN;
      if (Array.isArray(c.series) && c.series.length) {
        const s0 = c.series[0];
        const raw = s0 && typeof s0 === 'object' ? s0.value : s0;
        hours = num(Array.isArray(raw) ? raw[0] : raw);
      } else if ('value' in c) {
        hours = num(c.value);
      }
      if (!Number.isFinite(hours)) stats.noHours++;

      const r = pk.rec;
      if (!r.dt) stats.noDt++;
      if (!r.zni) stats.noZni++;
      if (!r.practice) stats.noPractice++;
      if (!r.person) stats.noPerson++;

      const day = r.dt ? isoOf(r.dt) : null;
      if (r.dt && !day) stats.noDt++;

      if (r.zni) stats.zni.add(r.zni);
      if (r.person) stats.persons.add(r.person);
      if (r.practice) stats.practices.add(r.practice);
      if (r.qrt) stats.qrts.add(r.qrt);
      if (day) {
        stats.days.add(day);
        if (!stats.minDay || day < stats.minDay) stats.minDay = day;
        if (!stats.maxDay || day > stats.maxDay) stats.maxDay = day;
      }
      if (Number.isFinite(hours)) stats.hours += hours;

      // Принятой считаем строку с датой, ЗНИ и часами.
      if (day && r.zni && Number.isFinite(hours)) {
        stats.ok++;
        if (stats.samples.length < 3) {
          stats.samples.push({
            dt: day, zni: r.zni,
            person: r.person || '—', practice: r.practice || '—',
            qrt: r.qrt || '—', hours: hours
          });
        }
      } else if (stats.bad.length < 5) {
        stats.bad.push({ name: short(name, 180), dt: r.dt, zni: r.zni, hours: hours });
      }
    }

    // ---- вывод ----
    const sepList = Object.keys(stats.seps).map(function (k) {
      return k + ' — ' + stats.seps[k];
    }).join(', ');
    const partsList = Object.keys(stats.partCounts).map(function (k) {
      return k + ' (' + stats.partCounts[k] + ')';
    }).join(', ');

    hr('РАЗБОР КЛЮЧА');
    push('строк: ' + stats.rows);
    push('разделитель: ' + (sepList || 'нет'));
    push('частей в ключе: ' + (partsList || '—'));
    push('принято: ' + stats.ok +
      ', без даты: ' + stats.noDt +
      ', без ЗНИ: ' + stats.noZni +
      ', без часов: ' + stats.noHours);

    hr('ЧТО ПОПАДЁТ НА ДИАГРАММУ');
    push('строк с датой и ЗНИ: ' + stats.ok);
    push('ЗНИ: ' + stats.zni.size + ' · исполнителей: ' + stats.persons.size +
      ' · практик: ' + stats.practices.size + ' · кварталов: ' + stats.qrts.size);
    push('дней: ' + stats.days.size +
      (stats.minDay ? ' · период: ' + stats.minDay + ' .. ' + stats.maxDay : ''));
    push('сумма часов: ' + (Math.round(stats.hours * 100) / 100));

    if (stats.samples.length) {
      push('');
      push('первые разобранные строки:');
      for (let i = 0; i < stats.samples.length; i++) {
        const s = stats.samples[i];
        push('  ' + s.dt + ' · ЗНИ ' + s.zni + ' · ' + s.person +
          ' · ' + s.practice + ' · ' + s.qrt + ' · ' + s.hours + ' ч');
      }
    }

    // ---- сверка с ожиданием ----
    hr('СВЕРКА С ДАТАСЕТОМ');
    const checks = [
      ['строк', stats.rows, EXPECTED.rows],
      ['ЗНИ', stats.zni.size, EXPECTED.zni],
      ['исполнителей', stats.persons.size, EXPECTED.persons],
      ['практик', stats.practices.size, EXPECTED.practices],
      ['дней', stats.days.size, null],
      ['период с', stats.minDay, EXPECTED.from],
      ['период по', stats.maxDay, EXPECTED.to]
    ];
    let mismatches = 0;
    for (let i = 0; i < checks.length; i++) {
      const label = checks[i][0];
      const got = checks[i][1];
      const want = checks[i][2];
      if (want === null) {
        push('  ' + label + ': ' + got);
        continue;
      }
      const same = String(got) === String(want);
      if (!same) mismatches++;
      push('  ' + (same ? '✅' : '⚠️') + ' ' + label + ': ' + got +
        (same ? '' : ' (ожидается ' + want + ')'));
    }

    const hoursOk = Math.abs(stats.hours - EXPECTED.hours) < 0.5;
    if (!hoursOk) mismatches++;
    push('  ' + (hoursOk ? '✅' : '⚠️') + ' сумма часов: ' +
      (Math.round(stats.hours * 100) / 100) +
      (hoursOk ? '' : ' (ожидается ' + EXPECTED.hours + ')'));

    // ---- итог ----
    hr('ИТОГ');
    const singleCat = stats.noSep > 0 && stats.ok === 0;
    if (stats.rows === 0) {
      push('❌ Строк нет. Проверь категорию и меру в блоке.');
    } else if (singleCat) {
      push('❌ Пришла одна категория без разделителя — платформа отдала');
      push('   только первое поле. Нужно вычисляемое поле gantt_key:');
      push('');
      push('  concat(coalesce(toString(dt),""),\'|~|\',coalesce(zni_number,""),\'|~|\',');
      push('         coalesce(full_name,""),\'|~|\',coalesce(practice,""),\'|~|\',');
      push('         coalesce(qrt,""))');
      push('');
      push('В блоке: Категории = только gantt_key, Меры = SUM(timeworked_h).');
    } else if (stats.ok === 0) {
      push('❌ Ни одна строка не разобрана. Пример проблемной строки:');
      if (stats.bad.length) push('   ' + stats.bad[0].name);
      push('   Проверь: первая часть ключа — дата, где-то есть ЗНИ.');
    } else {
      push('✅ Данные разбираются. Строк: ' + stats.ok +
        ', ЗНИ: ' + stats.zni.size +
        ', исполнителей: ' + stats.persons.size +
        ', часов: ' + (Math.round(stats.hours * 100) / 100) + '.');
      if (mismatches) {
        push('⚠️ Есть расхождения со ожидаемыми значениями — см. сверку.');
        push('   Если в блоке стоят фильтры PIX BI, часть строк может');
        push('   отсекаться — это нормально.');
      } else {
        push('Диаграмма должна построиться без предупреждений.');
      }
      if (stats.bad.length) {
        push('');
        push('Не разобраны (первые ' + stats.bad.length + '):');
        for (let i = 0; i < stats.bad.length; i++) {
          push('  ' + stats.bad[i].name);
        }
      }
    }

    finish();

    function finish() {
      busy = false;
      statusEl.textContent = 'готово · ' +
        new Date().toLocaleTimeString('ru-RU') + ' · строк: ' + lines.length;
      try { window.__diagGanttReport = lines.join('\n'); } catch (e) { /* ignore */ }
      preEl.textContent = lines.join('\n');
      preEl.scrollTop = 0;
    }
  }

  await run();
  setTimeout(function () { run(); }, 2500);
})();
