(async function () {
  const id = '82hdt27oq8j739qz6skpqrl1kpvgv9dx';

  // ====== Данные ======
  // PIX BI отдаёт данные как модель "категория × серия":
  //   itemData.categories[i] = { name: "<lineage_key>", series: [...], ... }
  // В блоке "Категории" задано ОДНО поле — вычисляемое lineage_key,
  // склеивающее весь путь через разделитель '||' (см. CLAUDE.md).
  const itemData = await getItemData(id);
  console.log('ITEMDATA:', itemData);

  const dataCategories = Array.isArray(itemData?.categories) ? itemData.categories : [];

  // Разбор lineage_key по '||'. Порядок полей фиксирован (индексы 0–9).
  // Каждое поле может иметь формат "значение::инфо" — часть после :: показывается в тултипе.
  const KEY_SEP = '||';
  const F = {
    SRC_SCHEMA: 0, SRC_TABLE: 1,
    V_SCHEMA: 2,   V_NAME: 3,
    A_DB: 4,       A_TBL: 5,
    AV_SCHEMA: 6,  AV_NAME: 7,
    APP_ID: 8,     APP_NAME: 9
  };

  // Парсинг поля формата "значение::инфо"
  const parseField = (raw) => {
    const s = (raw ?? '').toString().trim();
    const idx = s.indexOf('::');
    if (idx === -1) return { value: s, info: '' };
    return { value: s.slice(0, idx).trim(), info: s.slice(idx + 2).trim() };
  };

  // Превращаем categories -> массив "строк" (массивов полей)
  const rows = dataCategories.map(c => {
    const key = (c?.name ?? '').toString();
    const parts = key.split(KEY_SEP).map(s => (s ?? '').trim());
    return parts;
  });

  // Доступ к полю строки: значение (до ::) и инфо (после ::)
  const col = (r, idx) => parseField(r[idx]).value;
  const inf = (r, idx) => parseField(r[idx]).info;

  // ====== Константы слоёв ======
  const LAYER_COLORS = {
    source:     '#22c55e',
    view:       '#eab308',
    adqm:       '#3b82f6',
    adqm_view:  '#a855f7',
    dashboard:  '#ef4444'
  };
  const LAYER_LABELS = {
    source:     '🗄  Source',
    view:       '👁  View',
    adqm:       '🗃  ADQM',
    adqm_view:  '🔮  ADQM View',
    dashboard:  '📊  Dashboard'
  };
  const LAYER_ORDER = ['source', 'view', 'adqm', 'adqm_view', 'dashboard'];
  // Горизонтальный зазор между слоями (слева направо).
  const LAYER_GAP = 600;
  const LAYER_X = {};
  LAYER_ORDER.forEach((l, i) => { LAYER_X[l] = i * LAYER_GAP; });

  // ====== Шрифты и тема ======
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // ====== Схема полей тултипа (расширяемая) ======
  // Чтобы добавить новое поле в тултип:
  //   1) положить значение в details при ensureNode (n.details.<key> = ...)
  //   2) добавить сюда строку { key, label }
  // Поле показывается, только если в details есть непустое значение.
  // Если поле приходит из lineage_key — сперва расширить формулу и индексы F.
  const TOOLTIP_FIELDS = [
    { key: 'schema',   label: 'Схема' },
    { key: 'database', label: 'База' },
    { key: 'fullName', label: 'Полное имя', skipIfEqualsName: true }
  ];

  // ====== Построение графа ======
  const nodeMap = new Map();
  const linkList = [];
  const linkSet = new Set();

  function ensureNode(id, name, type, layer, details = {}) {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, name, type, layer, details, refCount: 0 });
    }
    nodeMap.get(id).refCount++;
    return nodeMap.get(id);
  }

  function addLink(src, tgt) {
    const k = `${src}||${tgt}`;
    if (!linkSet.has(k)) {
      linkSet.add(k);
      linkList.push({ source: src, target: tgt });
    }
  }

  for (const r of rows) {
    const srcSchema = col(r, F.SRC_SCHEMA);
    const srcTable  = col(r, F.SRC_TABLE);
    const vSchema   = col(r, F.V_SCHEMA);
    const vName     = col(r, F.V_NAME);
    const aDb       = col(r, F.A_DB);
    const aTbl      = col(r, F.A_TBL);
    const avSchema  = col(r, F.AV_SCHEMA);
    const avName    = col(r, F.AV_NAME);
    const appId     = col(r, F.APP_ID);
    const appName   = col(r, F.APP_NAME);

    // Информация для тултипа (часть после :: у каждого поля)
    const info = {
      srcSchema: inf(r, F.SRC_SCHEMA),
      srcTable:  inf(r, F.SRC_TABLE),
      vSchema:   inf(r, F.V_SCHEMA),
      vName:     inf(r, F.V_NAME),
      aDb:       inf(r, F.A_DB),
      aTbl:      inf(r, F.A_TBL),
      avSchema:  inf(r, F.AV_SCHEMA),
      avName:    inf(r, F.AV_NAME),
      app:       inf(r, F.APP_NAME) || inf(r, F.APP_ID)
    };

    // Идентификатор дашборда: app_id, иначе fallback на app_name
    const dashKey = appId || appName;

    // Пропускаем строки без обязательных полей
    if (!srcSchema || !srcTable || !dashKey) continue;

    const srcTblFull = `${srcSchema}.${srcTable}`;

    // ---- Source Schema ----
    ensureNode(`s_schema:${srcSchema}`, srcSchema, 'source_schema', 'source', {
      fullName: srcSchema,
      _info: info.srcSchema
    });
    // ---- Source Table ----
    ensureNode(`s_table:${srcTblFull}`, srcTable, 'source_table', 'source', {
      schema: srcSchema,
      fullName: srcTblFull,
      _info: info.srcTable
    });
    addLink(`s_schema:${srcSchema}`, `s_table:${srcTblFull}`);

    let tail = `s_table:${srcTblFull}`;

    // ---- View Schema + View (если есть) ----
    if (vSchema && vName) {
      ensureNode(`v_schema:${vSchema}`, vSchema, 'view_schema', 'view', {
        fullName: vSchema,
        _info: info.vSchema
      });
      ensureNode(`view:${vSchema}.${vName}`, vName, 'view', 'view', {
        schema: vSchema,
        fullName: `${vSchema}.${vName}`,
        _info: info.vName
      });
      addLink(tail, `v_schema:${vSchema}`);
      addLink(`v_schema:${vSchema}`, `view:${vSchema}.${vName}`);
      tail = `view:${vSchema}.${vName}`;
    }

    // ---- ADQM (если есть) ----
    if (aDb && aTbl) {
      ensureNode(`adqm_db:${aDb}`, aDb, 'adqm_db', 'adqm', {
        fullName: aDb,
        _info: info.aDb
      });
      const aTblFull = `${aDb}.${aTbl}`;
      ensureNode(`adqm_table:${aTblFull}`, aTbl, 'adqm_table', 'adqm', {
        database: aDb,
        fullName: aTblFull,
        _info: info.aTbl
      });
      addLink(tail, `adqm_db:${aDb}`);
      addLink(`adqm_db:${aDb}`, `adqm_table:${aTblFull}`);
      tail = `adqm_table:${aTblFull}`;

      // ---- ADQM View Schema + View (если есть) ----
      if (avSchema && avName) {
        ensureNode(`av_schema:${avSchema}`, avSchema, 'adqm_view_db', 'adqm_view', {
          fullName: avSchema,
          _info: info.avSchema
        });
        const avFull = `${avSchema}.${avName}`;
        ensureNode(`av_view:${avFull}`, avName, 'adqm_view', 'adqm_view', {
          schema: avSchema,
          fullName: avFull,
          _info: info.avName
        });
        addLink(tail, `av_schema:${avSchema}`);
        addLink(`av_schema:${avSchema}`, `av_view:${avFull}`);
        tail = `av_view:${avFull}`;
      }
    }

    // ---- Dashboard ----
    const dashLabel = appName || `Дашборд #${dashKey}`;
    ensureNode(`dash:${dashKey}`, dashLabel, 'dashboard', 'dashboard', {
      id: appId,
      _info: info.app
    });
    addLink(tail, `dash:${dashKey}`);
  }

  console.log(`Nodes: ${nodeMap.size}, Edges: ${linkList.length}`);

  // ====== Группировка по слоям ======
  const byLayer = {};
  for (const n of nodeMap.values()) {
    if (!byLayer[n.layer]) byLayer[n.layer] = [];
    byLayer[n.layer].push(n);
  }

  // ====== Позиционирование узлов по слоям (горизонтально) ======
  // Теперь слои располагаются слева направо (x по слою, y внутри слоя —
  // вертикальным рядом).
  const V_GAP = 16;
  const NODE_MIN_W = 90;
  const NODE_MAX_W = 180;
  const NODE_H = 30;

  // Оцениваем "эталонную" высоту — исходя из самого загруженного слоя
  let maxCount = 0;
  for (const nodes of Object.values(byLayer)) {
    if (nodes.length > maxCount) maxCount = nodes.length;
  }

  // Чтобы весь самый высокий слой умещался в ~4000px (комфортный zoom)
  const TARGET_TOTAL_H = 4000;
  const nodeW = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W,
    Math.floor((TARGET_TOTAL_H - (maxCount - 1) * V_GAP) / maxCount)
  ));

  for (const [layer, nodes] of Object.entries(byLayer)) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    const totalH = nodes.length * NODE_H + (nodes.length - 1) * V_GAP;
    const startY = -totalH / 2;
    const xPos = LAYER_X[layer] ?? 0;

    nodes.forEach((n, i) => {
      n.x = xPos;
      n.y = startY + i * (NODE_H + V_GAP) + NODE_H / 2;
      n.symbolSize = [nodeW, NODE_H];
    });
  }

  // ====== Категории ======
  const catIndex = {};
  LAYER_ORDER.forEach((l, i) => catIndex[l] = i);

  const categories = LAYER_ORDER.map(l => ({
    name: LAYER_LABELS[l],
    itemStyle: {
      color: LAYER_COLORS[l],
      borderColor: '#ffffff',
      borderWidth: 1.5,
      shadowBlur: 6,
      shadowColor: 'rgba(0,0,0,0.12)'
    }
  }));

  // ====== Данные узлов для ECharts ======
  const nodeData = [];
  for (const n of nodeMap.values()) {
    const nameParts = n.name.split('.');
    const shortName = nameParts[nameParts.length - 1];

    nodeData.push({
      id: n.id,
      name: shortName,            // отображаем короткое имя
      category: catIndex[n.layer] ?? 0,
      x: n.x,
      y: n.y,
      symbolSize: n.symbolSize,
      // метаданные для тултипа
      _type: n.type,
      _layer: n.layer,
      _fullName: n.name,
      _details: n.details,
      _refCount: n.refCount
    });
  }

  // ====== Базовая конфигурация серии (общая для рендера и подсветки) ======
  // Вынесено в одно место, чтобы buildHighlightedOption/buildResetOption
  // отдавали ПОЛНУЮ серию. Иначе replaceMerge:['series'] отбросит type/layout/
  // categories/symbol и сломает кастомную подсветку (останется только реакция
  // ECharts на соседние узлы — ровно тот баг, что был раньше).
  const baseSeries = {
    type: 'graph',
    layout: 'none',

    // Интерактивность
    roam: true,
    draggable: true,

    // Узлы
    symbol: 'roundRect',
    categories,
    data: nodeData,
    links: linkList,

    // Направленные стрелки
    edgeSymbol: ['none', 'arrow'],
    edgeSymbolSize: [0, 8],

    // Подпись узла (внутри)
    label: {
      show: true,
      position: 'inside',
      fontSize: 9,
      color: '#ffffff',
      fontWeight: 600,
      fontFamily: FONT_FAMILY,
      overflow: 'truncate',
      width: nodeW - 10,
      formatter: (p) => p.data.name || ''
    },

    // Стиль ребра по умолчанию
    lineStyle: {
      color: '#94a3b8',
      width: 1.5,
      curveness: 0.3,
      opacity: 0.6,
      cap: 'round'
    },

    // Подпись ребра (скрыта)
    edgeLabel: { show: false },

    // Подсветка пути управляется кастомно (mouseover / click)
    emphasis: { scale: 1.05 },

    // Ограничение зума
    scaleLimit: { min: 0.3, max: 4 },

    // Анимация (только начальный рендер)
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
    animationDelay: (idx) => idx * 8
  };

  // ====== Инициализация ECharts ======
  const el = document.getElementById(id);
  const chart = echarts.init(el);

  // ====== ДИАГНОСТИКА: если узлов нет — показать что реально пришло ======
  if (nodeData.length === 0) {
    // Дамп верхнего уровня itemData: ключ -> тип/длина/превью
    const dumpVal = (v) => {
      if (Array.isArray(v)) return `Array(${v.length})` + (v.length ? ` пример: ${JSON.stringify(v[0])}`.slice(0, 300) : '');
      if (v && typeof v === 'object') return `Object{${Object.keys(v).join(',')}}`;
      return JSON.stringify(v);
    };
    const itemDump = (itemData && typeof itemData === 'object')
      ? Object.entries(itemData).map(([k, v]) => `  ${k}: ${dumpVal(v)}`).join('\n')
      : JSON.stringify(itemData);
    const cat0 = dataCategories[0] ? JSON.stringify(dataCategories[0]).slice(0, 400) : '(нет)';
    const rowSample = rows[0] ? JSON.stringify(rows[0]) : '(нет строк)';
    const text =
      `Узлов: 0 — данные не распознаны\n\n` +
      `typeof itemData = ${typeof itemData}\n` +
      `itemData ключи верхнего уровня:\n${itemDump}\n\n` +
      `dataCategories.length = ${dataCategories.length}\n` +
      `rows (распарсенных) = ${rows.length}\n\n` +
      `categories[0] (сырое):\n${cat0}\n\n` +
      `rows[0] (после split '||', полей ${rows[0]?.length ?? 0}):\n${rowSample}\n\n` +
      `Ожидается 10 полей (каждое может быть в формате "значение::инфо"): srcSchema|srcTable|vSchema|vName|aDb|aTbl|avSchema|avName|appId|appName\n` +
      `Если полей мало — проверь формулу lineage_key в PIX BI (разделитель '||').`;
    chart.setOption({
      backgroundColor: '#fff',
      graphic: {
        type: 'text',
        left: 10,
        top: 10,
        style: {
          text,
          fontSize: 11,
          fontFamily: 'monospace',
          fill: '#111',
          lineHeight: 15
        }
      }
    });
    console.warn('LINEAGE DIAG:\n' + text);
    return;
  }

  // ====== Тема ======
  function readTheme() {
    const theme      = window.themeConfigs || {};
    const app        = theme.application   || {};
    const applied    = app.applied_filters || {};
    const background = app.background      || {};
    const texts      = theme.texts         || {};
    const labels     = texts.labels        || {};

    const bgColor =
      background.items ||
      background.filter_panel ||
      'rgba(255, 255, 255, 1)';

    const textColor =
      labels.font_color ||
      applied.available_font_color ||
      applied.font_color ||
      '#000000';

    return { bgColor, textColor };
  }

  function themeSignature(t) {
    return [t.bgColor || '', t.textColor || ''].join('|');
  }

  function buildOption(t) {
    const bgColor   = t.bgColor;
    const textColor = t.textColor || '#000000';

    el.style.background = bgColor;

    return {
      backgroundColor: bgColor,
      textStyle: {
        color: textColor,
        fontFamily: FONT_FAMILY
      },

      // Легенда
      legend: {
        data: categories.map(c => ({ name: c.name })),
        top: 6,
        left: 'center',
        textStyle: { color: textColor, fontSize: 11, fontFamily: FONT_FAMILY },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 10
      },

      // Tooltip
      tooltip: {
        trigger: 'item',
        backgroundColor: bgColor === 'rgba(255, 255, 255, 1)'
          ? 'rgba(255,255,255,0.95)'
          : 'rgba(30,30,50,0.95)',
        borderColor: 'rgba(128,128,128,0.3)',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: {
          color: textColor,
          fontSize: 12,
          fontFamily: FONT_FAMILY
        },
        formatter: (p) => {
          if (p.dataType !== 'node') return '';
          const d = p.data;
          const det = d._details || {};
          let html = `<b style="font-size:14px">${d._fullName || d.name}</b>`;
          // Информация после :: показывается отдельной строкой
          if (det._info) {
            html += `<br><span style="color:#60a5fa;font-weight:500">${det._info}</span>`;
          }
          html += `<br><span style="opacity:0.6">${d._type} · ${d._layer}</span>`;
          // Поля выводятся декларативно из TOOLTIP_FIELDS (см. определение выше)
          for (const f of TOOLTIP_FIELDS) {
            const val = det[f.key];
            if (val == null || val === '') continue;
            if (f.skipIfEqualsName && val === d.name) continue;
            html += `<br>${f.label}: ${val}`;
          }
          if (d._refCount > 1) html += `<br><span style="opacity:0.5">Упоминаний: ${d._refCount}</span>`;
          return html;
        }
      },

      series: [baseSeries]
    };
  }

  // ====== Первый рендер ======
  let currentTheme = readTheme();
  let currentSig   = themeSignature(currentTheme);
  chart.setOption(buildOption(currentTheme));

  // ====== Адаптивность ======
  window.addEventListener('resize', () => chart.resize());

  // ====== Кастомная подсветка полного пути (upstream + downstream) ======
  // Строим индексы для быстрого поиска предков/потомков
  const adjUp   = new Map(); // nodeId -> Set of upstream node ids
  const adjDown = new Map(); // nodeId -> Set of downstream node ids
  for (const link of linkList) {
    if (!adjDown.has(link.source)) adjDown.set(link.source, new Set());
    adjDown.get(link.source).add(link.target);
    if (!adjUp.has(link.target))   adjUp.set(link.target, new Set());
    adjUp.get(link.target).add(link.source);
  }

  function getAllUpstream(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return visited;
    visited.add(nodeId);
    const parents = adjUp.get(nodeId);
    if (parents) {
      for (const p of parents) getAllUpstream(p, visited);
    }
    return visited;
  }

  function getAllDownstream(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return visited;
    visited.add(nodeId);
    const children = adjDown.get(nodeId);
    if (children) {
      for (const c of children) getAllDownstream(c, visited);
    }
    return visited;
  }

  // Вспомогательная функция: помечает узлы и рёбра, лежащие на пути nodeId
  function buildHighlightedOption(nodeId) {
    const upstream   = getAllUpstream(nodeId, new Set());
    const downstream = getAllDownstream(nodeId, new Set());
    const fullPath   = new Set([...upstream, ...downstream]);

    // Рёбра, которые лежат на пути (оба конца в fullPath и есть связь)
    const pathEdges = new Set();
    for (const link of linkList) {
      if (fullPath.has(link.source) && fullPath.has(link.target)) {
        pathEdges.add(`${link.source}||${link.target}`);
      }
    }

    const opt = {
      series: [{
        ...baseSeries,
        animation: false,            // без переанимации при наведении
        data: nodeData.map(n => {
          if (n.id === nodeId) {
            return {
              ...n,
              symbolSize: [nodeW + 6, NODE_H + 4],
              itemStyle: {
                shadowBlur: 18,
                shadowColor: 'rgba(255,255,255,0.4)',
                borderColor: '#ffffff',
                borderWidth: 2.5
              }
            };
          }
          if (fullPath.has(n.id)) {
            const isUp = upstream.has(n.id);
            return {
              ...n,
              itemStyle: {
                borderColor: isUp ? '#3b82f6' : '#22c55e',
                borderWidth: 2,
                shadowBlur: 10,
                shadowColor: isUp
                  ? 'rgba(59,130,246,0.3)'
                  : 'rgba(34,197,94,0.3)'
              }
            };
          }
          return {
            ...n,
            itemStyle: {
              opacity: 0.15
            }
          };
        }),
        links: linkList.map(link => {
          const key = `${link.source}||${link.target}`;
          if (pathEdges.has(key)) {
            return {
              ...link,
              lineStyle: {
                color: '#60a5fa',
                width: 3,
                opacity: 1,
                curveness: 0.3
              }
            };
          }
          return {
            ...link,
            lineStyle: {
              color: '#94a3b8',
              width: 1,
              opacity: 0.06,
              curveness: 0.3
            }
          };
        })
      }]
    };
    return opt;
  }

  // Сброс к исходному виду
  function buildResetOption() {
    return {
      series: [{
        ...baseSeries,
        animation: false,
        data: nodeData.map(n => ({ ...n, itemStyle: null })),
        links: linkList.map(link => ({ ...link, lineStyle: null }))
      }]
    };
  }

  // Переменная для «закрепления» подсветки по клику
  let lockedNodeId = null;
  let hoveredNodeId = null;

  chart.on('mouseover', (params) => {
    if (!params || !params.data || params.dataType !== 'node') return;
    if (lockedNodeId) return;          // при закреплении hover не ломает картинку
    const nodeId = params.data.id;
    if (nodeId === hoveredNodeId) return;
    hoveredNodeId = nodeId;
    chart.setOption(buildHighlightedOption(nodeId), { replaceMerge: ['series'] });
  });

  chart.on('mouseout', (params) => {
    if (lockedNodeId) return;
    hoveredNodeId = null;
    chart.setOption(buildResetOption(), { replaceMerge: ['series'] });
  });

  chart.on('click', (params) => {
    if (!params || !params.data || params.dataType !== 'node') {
      // Клик по пустому месту → сброс
      if (lockedNodeId) {
        lockedNodeId = null;
        chart.setOption(buildResetOption(), { replaceMerge: ['series'] });
      }
      return;
    }

    const nodeId = params.data.id;
    if (lockedNodeId === nodeId) {
      // Повторный клик по тому же узлу → снимаем закрепление
      lockedNodeId = null;
      chart.setOption(buildResetOption(), { replaceMerge: ['series'] });
    } else {
      lockedNodeId = nodeId;
      chart.setOption(buildHighlightedOption(nodeId), { replaceMerge: ['series'] });
    }
  });

  chart.on('dblclick', () => {
    lockedNodeId = null;
    hoveredNodeId = null;
    chart.setOption(buildResetOption(), { replaceMerge: ['series'] });
  });

  // ====== Реакция на смену темы ======
  function applyThemeIfChanged() {
    const t   = readTheme();
    const sig = themeSignature(t);
    if (sig !== currentSig) {
      console.log('Theme change detected, re-render lineage graph');
      currentSig = sig;
      chart.setOption(buildOption(t), true);
    }
  }

  if (window.MutationObserver && document.body) {
    const observer = new MutationObserver(function (mutationsList) {
      for (let i = 0; i < mutationsList.length; i++) {
        const m = mutationsList[i];
        if (
          m.type === 'attributes' &&
          (m.attributeName === 'class' || m.attributeName === 'style')
        ) {
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

})();