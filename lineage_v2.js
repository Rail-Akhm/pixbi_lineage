(async function () {
  // ====== ID блока PIX BI ======
  // ОДИН блок. В «Категориях» — ОДНО вычисляемое поле lineage_key, в котором
  // весь путь склеен через разделитель слоёв '||'. Каждый сегмент между '||'
  // = один слой (по позиции: сегмент 0 → слой 0, сегмент 1 → слой 1, ...).
  //
  // Формат одного сегмента: Название::значение::инфо
  //   Название — метка слоя (легенда). Слой определяется ПОЗИЦИЕЙ, не названием,
  //              поэтому одинаковые названия на разных слоях допустимы.
  //   значение — имя узла (внутри узла и в тултипе)
  //   инфо     — доп. информация для тултипа (может быть пустым)
  //
  // Связи строятся ВНУТРИ строки: сегмент i → сегмент i+1. Отдельный «ключ» не нужен.
  // Пустые сегменты (значение == '') пропускаются — ребро идёт к следующему непустому слою.
  //
  // Пример строки lineage_key:
  //   Схема в GreenPlum::dp_cmn_ods::Домен СИДа||Таблицы в GreenPlum::assets::Домен СИДа||Витрины::v_list::Домен СПДа
  const BLOCK_ID = '82hdt27oq8j739qz6skpqrl1kpvgv9dx';

  // Разделитель слоёв внутри lineage_key
  const LAYER_SEP = '||';

  // ====== Палитра цветов (20 цветов, по одному на каждый возможный слой) ======
  const COLOR_PALETTE = [
    '#22c55e', // зелёный
    '#eab308', // жёлтый
    '#3b82f6', // синий
    '#a855f7', // фиолетовый
    '#ef4444', // красный
    '#f97316', // оранжевый
    '#06b6d4', // циан
    '#ec4899', // розовый
    '#14b8a6', // teal
    '#8b5cf6', // индиго
    '#84cc16', // лайм
    '#f43f5e', // rose
    '#0ea5e9', // sky
    '#d946ef', // fuchsia
    '#e11d48', // crimson
    '#65a30d', // olive-green
    '#0891b2', // dark-cyan
    '#c026d3', // magenta
    '#ea580c', // burnt-orange
    '#2563eb'  // royal-blue
  ];

  // ====== Шрифты и тема ======
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // ====== Загрузка данных из блока ======
  const FIELD_SEP = '::';

  // Парсинг одного сегмента формата "Название::значение::инфо".
  //   1 часть  → "значение"                 (label/info пустые)
  //   2 части  → "Название::значение"
  //   3+ частей→ "Название::значение::инфо"  (лишние части склеиваются обратно в инфо)
  const parseSegment = (raw) => {
    const s = (raw ?? '').toString().trim();
    const parts = s.split(FIELD_SEP);

    let label = '', value = '', info = '';
    if (parts.length === 1) {
      value = parts[0];
    } else if (parts.length === 2) {
      [label, value] = parts;
    } else {
      label = parts[0];
      value = parts[1];
      // Если внутри инфо встретился '::' — собираем хвост обратно
      info = parts.slice(2).join(FIELD_SEP);
    }

    return {
      label: (label ?? '').trim(),
      value: (value ?? '').trim(),
      info:  (info  ?? '').trim()
    };
  };

  // Загружаем единственный блок
  let itemData;
  try {
    itemData = await getItemData(BLOCK_ID);
  } catch (e) {
    console.error(`Lineage v2: не удалось загрузить блок ${BLOCK_ID}:`, e);
    const el = document.getElementById(BLOCK_ID);
    if (el) {
      const chart = echarts.init(el);
      chart.setOption({
        backgroundColor: '#fff',
        graphic: { type: 'text', left: 10, top: 10,
          style: { text: `Ошибка загрузки блока ${BLOCK_ID}:\n${String(e)}`,
            fontSize: 12, fontFamily: 'monospace', fill: '#b91c1c', lineHeight: 16 } }
      });
    }
    return;
  }

  const cats = Array.isArray(itemData?.categories) ? itemData.categories : [];

  // Каждая строка categories[i].name = одна цепочка пути, сегменты разделены '||'.
  // rows[r] = массив сегментов { label, value, info } по позиции слоя.
  const rows = cats
    .map(c => (c?.name ?? '').toString())
    .filter(s => s.trim() !== '')
    .map(line => line.split(LAYER_SEP).map(parseSegment));

  // Число слоёв = позиция последнего НЕПУСТОГО сегмента + 1.
  // Так отсекаются хвостовые пустые слои от завершающего '||' в формуле.
  let layerCount = 0;
  for (const r of rows) {
    for (let li = 0; li < r.length; li++) {
      if (r[li] && r[li].value !== '' && li + 1 > layerCount) layerCount = li + 1;
    }
  }

  // Метки слоёв по позиции: берём первую непустую label на каждом слое.
  const layerLabels = [];
  for (let li = 0; li < layerCount; li++) {
    let lbl = '';
    for (const r of rows) {
      const seg = r[li];
      if (seg && seg.label) { lbl = seg.label; break; }
    }
    layerLabels.push(lbl || `Слой ${li}`);
  }

  // Диагностика для дампа на canvas
  const rawDiag = {
    blockId: BLOCK_ID,
    topKeys: itemData && typeof itemData === 'object' ? Object.keys(itemData).join(',') : typeof itemData,
    cats: cats.length,
    rows: rows.length,
    layerCount,
    layerLabels: layerLabels.join(' → '),
    sample: cats[0] ? JSON.stringify(cats[0].name ?? cats[0]).slice(0, 220) : '(нет категорий)'
  };
  console.log('Lineage v2 diag:', rawDiag);
  console.log(`Rows: ${rows.length}, layers: ${layerCount}, labels: [${layerLabels.join(', ')}]`);

  const totalEntries = rows.reduce((sum, r) => sum + r.filter(s => s.value !== '').length, 0);

  // ====== Защита: слишком много данных (вероятно, не выбран фильтр) ======
  const MAX_ROWS = 1000;
  if (rows.length > MAX_ROWS) {
    const el = document.getElementById(BLOCK_ID);
    if (el) {
      const chart = echarts.init(el);
      chart.clear();
      chart.setOption({
        backgroundColor: '#fff',
        graphic: {
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
            text: 'Выберите какой-нибудь объект (фильтр),\nчтобы отобразить lineage.',
            fontSize: 14,
            fontFamily: FONT_FAMILY,
            fill: '#555',
            textAlign: 'center'
          }
        }
      });
    }
    console.warn(`Lineage v2: слишком много строк (${rows.length}) — похоже, фильтры не применены. Рендер отменён.`);
    return;
  }

  // ====== Диагностика: нет данных ======
  if (totalEntries === 0) {
    const el = document.getElementById(BLOCK_ID);
    if (!el) {
      console.error('Lineage v2: DOM-элемент не найден. Проверь BLOCK_ID.');
      return;
    }
    const chart = echarts.init(el);
    const text =
      `Узлов: 0 — данные не распознаны\n\n` +
      `Блок: ${rawDiag.blockId}\n` +
      `categories = ${rawDiag.cats}, строк (rows) = ${rawDiag.rows}\n` +
      `слоёв = ${rawDiag.layerCount}\n\n` +
      `Пример categories[0].name:\n  ${rawDiag.sample}\n\n` +
      `Проверь:\n` +
      `1) ID блока в BLOCK_ID\n` +
      `2) Что в «Категориях» задано ОДНО поле lineage_key формата:\n` +
      `   Название::значение::инфо || Название::значение::инфо || ...\n` +
      `   (разделитель слоёв '||', внутри слоя '::')\n` +
      `3) Что задана мера (например COUNT), иначе 0 строк`;
    console.warn('LINEAGE V2 DIAG:', rawDiag);
    chart.setOption({
      backgroundColor: '#fff',
      graphic: {
        type: 'text', left: 10, top: 10,
        style: { text, fontSize: 11, fontFamily: 'monospace', fill: '#111', lineHeight: 15 }
      }
    });
    return;
  }

  // ====== Построение графа ======
  const nodeMap = new Map();   // nodeId -> node
  const linkList = [];
  const linkSet = new Set();

  function ensureNode(layerIdx, value, info) {
    const nodeId = `${layerIdx}::${value}`;
    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        id: nodeId,
        name: value,
        layer: layerIdx,
        layerLabel: layerLabels[layerIdx] || `Слой ${layerIdx}`,
        details: { _info: info },
        refCount: 0
      });
    }
    const node = nodeMap.get(nodeId);
    node.refCount++;
    // Дополняем инфо, если у первого вхождения оно было пустым
    if (!node.details._info && info) node.details._info = info;
    return node;
  }

  function addLink(src, tgt) {
    const k = `${src}>>${tgt}`;
    if (!linkSet.has(k)) {
      linkSet.add(k);
      linkList.push({ source: src, target: tgt });
    }
  }

  // Строим узлы и рёбра: внутри КАЖДОЙ строки соединяем непустые сегменты по
  // порядку слоёв (сегмент i → следующий непустой сегмент). Пустые слои
  // пропускаются — ребро идёт к ближайшему непустому справа.
  for (const segs of rows) {
    let prevNodeId = null;
    for (let li = 0; li < segs.length; li++) {
      const seg = segs[li];
      if (!seg || seg.value === '') continue;  // пропускаем пустой слой
      const node = ensureNode(li, seg.value, seg.info);
      if (prevNodeId) addLink(prevNodeId, node.id);
      prevNodeId = node.id;
    }
  }

  console.log(`Nodes: ${nodeMap.size}, Edges: ${linkList.length}`);

  // ====== Диагностика: вырожденный граф (узлы есть, но связей нет) ======
  if (nodeMap.size <= 1 || (layerCount > 1 && linkList.length === 0)) {
    const el = document.getElementById(BLOCK_ID);
    if (el) {
      const chart = echarts.init(el);
      const text =
        `Граф вырожден: узлов=${nodeMap.size}, рёбер=${linkList.length}\n\n` +
        `Блок: ${rawDiag.blockId}\n` +
        `строк (rows) = ${rawDiag.rows}, слоёв = ${rawDiag.layerCount}\n` +
        `метки слоёв: ${rawDiag.layerLabels}\n\n` +
        `Пример строки lineage_key:\n  ${rawDiag.sample}\n\n` +
        `Если слой один (нет '||' в строке) — добавь сегменты через '||':\n` +
        `  Схема::v1::инфо || Таблица::v2::инфо || Дашборд::v3::инфо\n` +
        `Каждый сегмент между '||' = отдельный слой по позиции.`;
      console.warn('LINEAGE V2 DIAG (вырожденный граф):', { nodes: nodeMap.size, edges: linkList.length, rawDiag });
      chart.setOption({
        backgroundColor: '#fff',
        graphic: {
          type: 'text', left: 10, top: 10,
          style: { text, fontSize: 11, fontFamily: 'monospace', fill: '#111', lineHeight: 15 }
        }
      });
      return;
    }
  }

  // ====== Группировка по слоям ======
  const byLayer = {};
  for (const n of nodeMap.values()) {
    if (!byLayer[n.layer]) byLayer[n.layer] = [];
    byLayer[n.layer].push(n);
  }

  // Проверяем, что все слои (0..layerCount-1) существуют
  for (let i = 0; i < layerCount; i++) {
    if (!byLayer[i]) byLayer[i] = [];
  }

  // ====== Позиционирование узлов по слоям ======
  const NODE_W = 160;    // фиксированная ширина узла (не сжимается)
  const NODE_H = 30;
  // Зазоры в реальных координатах графа. Canvas ECharts делается равным размеру
  // графа (см. ниже), поэтому авто-fit ничего не схлопывает — зазоры держатся
  // при любом числе узлов, граф выходит за окно блока (скролл/панорамирование).
  const V_GAP = 24;                       // вертикальный зазор между узлами
  const LAYER_GAP = NODE_W + 80;         // горизонтальный шаг между слоями (>= ширины узла + запас)

  for (const [layer, nodes] of Object.entries(byLayer)) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    const step = NODE_H + V_GAP;          // шаг по вертикали (центр-к-центру)
    const totalH = nodes.length * step - V_GAP;
    const startY = -totalH / 2;
    const xPos = parseInt(layer) * LAYER_GAP;

    nodes.forEach((n, i) => {
      n.x = xPos;
      n.y = startY + i * step + NODE_H / 2;
      n.symbolSize = [NODE_W, NODE_H];
    });
  }

  // ====== Категории ECharts ======
  const categories = [];
  for (let i = 0; i < layerCount; i++) {
    categories.push({
      name: layerLabels[i] || `Слой ${i}`,
      itemStyle: {
        color: COLOR_PALETTE[i % COLOR_PALETTE.length],
        borderColor: '#ffffff',
        borderWidth: 1.5,
        shadowBlur: 6,
        shadowColor: 'rgba(0,0,0,0.12)'
      }
    });
  }

  // ====== Данные узлов для ECharts ======
  const nodeData = [];
  for (const n of nodeMap.values()) {
    nodeData.push({
      id: n.id,
      name: n.name,
      category: n.layer,
      x: n.x,
      y: n.y,
      symbolSize: n.symbolSize,
      _layer: n.layer,
      _layerLabel: n.layerLabel,
      _fullName: n.name,
      _details: n.details,
      _refCount: n.refCount
    });
  }

  // ====== bbox всех узлов ======
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
  for (const n of nodeMap.values()) {
    if (n.x < gMinX) gMinX = n.x;
    if (n.x > gMaxX) gMaxX = n.x;
    if (n.y < gMinY) gMinY = n.y;
    if (n.y > gMaxY) gMaxY = n.y;
  }

  // ====== Сдвигаем граф в положительные координаты от (PAD, PAD) ======
  // Координаты узлов — центры; добавляем половину размера узла в поля.
  const PAD = 80;
  const offsetX = -gMinX + NODE_W / 2 + PAD;
  const offsetY = -gMinY + NODE_H / 2 + PAD;
  for (const n of nodeMap.values()) { n.x += offsetX; n.y += offsetY; }
  for (const nd of nodeData)        { nd.x += offsetX; nd.y += offsetY; }

  // ====== Логический размер canvas = размер графа ======
  // КЛЮЧЕВОЕ: делаем canvas ECharts физически равным размеру всего графа.
  // Тогда авто-fit ECharts (который и схлопывал узлы в кучу) становится
  // тождественным — вписывать в свой же размер нечего, масштаб = 1, узлы
  // натуральные. Граф крупнее окна блока — пользователь прокручивает
  // обёртку (overflow:auto) или панорамирует мышью (roam).
  const logicalW = (gMaxX - gMinX) + NODE_W + PAD * 2;
  const logicalH = (gMaxY - gMinY) + NODE_H + PAD * 2;

  // Центр графа (в новых, сдвинутых координатах).
  const graphCenter = [logicalW / 2, logicalH / 2];

  // ====== Базовая конфигурация серии ======
  const baseSeries = {
    type: 'graph',
    layout: 'none',

    roam: true,
    draggable: true,

    symbol: 'roundRect',
    categories,
    data: nodeData,
    links: linkList,

    edgeSymbol: ['none', 'arrow'],
    edgeSymbolSize: [0, 8],

    label: {
      show: true,
      position: 'inside',
      fontSize: 9,
      color: '#ffffff',
      fontWeight: 600,
      fontFamily: FONT_FAMILY,
      overflow: 'truncate',
      width: NODE_W - 10,
      formatter: (p) => p.data.name || ''
    },

    lineStyle: {
      color: '#94a3b8',
      width: 1.5,
      curveness: 0.3,
      opacity: 0.6,
      cap: 'round'
    },

    edgeLabel: { show: false },
    emphasis: { scale: 1.05 },
    scaleLimit: { min: 0.3, max: 4 },

    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicOut',
    animationDelay: (idx) => idx * 8
  };

  // ====== Инициализация ECharts ======
  // Используем DOM-элемент блока для рендера
  const el = document.getElementById(BLOCK_ID);
  if (!el) {
    console.error(`Lineage v2: DOM-элемент #${BLOCK_ID} не найден. Проверь BLOCK_ID.`);
    return;
  }

  // Окно блока (el) делаем прокручиваемой областью просмотра. Внутрь кладём
  // div логического размера всего графа — на нём и рендерим ECharts. Так
  // canvas физически равен графу, авто-fit не схлопывает узлы, а граф крупнее
  // окна — прокручивается нативным скроллом (или панорамируется мышью).
  el.style.overflow = 'auto';
  const innerEl = document.createElement('div');
  innerEl.style.width  = logicalW + 'px';
  innerEl.style.height = logicalH + 'px';
  el.appendChild(innerEl);

  // ====== Патч addEventListener для wheel (zrender passive → non-passive) ======
  // zrender в старых версиях ECharts регистрирует wheel как passive,
  // тогда preventDefault() внутри roam-обработчика не отменяет нативный скролл.
  // Принудительно делаем wheel non-passive на время init — zrender повесит
  // свой listener правильно, zoom колёсиком заработает, скролл контейнера
  // уйдёт. После init восстанавливаем оригинал.
  const _origAEL = HTMLElement.prototype.addEventListener;
  HTMLElement.prototype.addEventListener = function (type, listener, options) {
    let opts = options;
    if (type === 'wheel') {
      if (typeof opts === 'boolean') {
        opts = { capture: opts, passive: false };
      } else if (typeof opts === 'object' && opts !== null) {
        opts = { ...opts, passive: false };
      } else {
        opts = { passive: false };
      }
    }
    return _origAEL.call(this, type, listener, opts);
  };

  const chart = echarts.init(innerEl);

  // Восстанавливаем после init — нужный listener уже повешан.
  HTMLElement.prototype.addEventListener = _origAEL;

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

  // ====== Схема полей тултипа ======
  const TOOLTIP_FIELDS = [];

  function buildOption(t) {
    const bgColor   = t.bgColor;
    const textColor = t.textColor || '#000000';

    el.style.background = bgColor;
    innerEl.style.background = bgColor;

    return {
      backgroundColor: bgColor,
      textStyle: {
        color: textColor,
        fontFamily: FONT_FAMILY
      },

      legend: {
        data: categories.map(c => ({ name: c.name })),
        top: 6,
        left: 'center',
        textStyle: { color: textColor, fontSize: 11, fontFamily: FONT_FAMILY },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 10
      },

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
          if (det._info) {
            html += `<br><span style="color:#60a5fa;font-weight:500">${det._info}</span>`;
          }
          html += `<br><span style="opacity:0.6">${d._layerLabel} · слой ${d._layer}</span>`;
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

  // ====== Дефолтный фокус: центр графа по центру видимой области ======
  // Граф крупнее окна блока, поэтому прокручиваем обёртку так, чтобы середина
  // отрисовки оказалась по центру. PIX BI грузится асинхронно — clientWidth/
  // Height могут быть ещё нулевыми, поэтому повторяем несколько раз.
  function centerScroll(tries = 20) {
    const vw = el.clientWidth, vh = el.clientHeight;
    if (vw <= 20 || vh <= 20) {
      if (tries > 0) setTimeout(() => centerScroll(tries - 1), 50);
      return;
    }
    el.scrollLeft = Math.max(0, (logicalW - vw) / 2);
    el.scrollTop  = Math.max(0, (logicalH - vh) / 2);
  }
  centerScroll();

  // ====== Кастомная подсветка полного пути ======
  const adjUp   = new Map();
  const adjDown = new Map();
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

  // Текущее состояние zoom/center из модели ECharts. Подмешиваем его в
  // highlight/reset, чтобы replaceMerge серии НЕ сбрасывал ручной зум/пан
  // пользователя обратно к стартовому виду.
  function currentView() {
    try {
      const model = chart.getModel().getSeriesByIndex(0);
      const view = model && model.coordinateSystem;
      if (view && typeof view.getZoom === 'function') {
        return { zoom: view.getZoom(), center: view.getCenter ? view.getCenter() : graphCenter };
      }
    } catch (e) { /* fallback ниже */ }
    return { zoom: 1, center: graphCenter };
  }

  function buildHighlightedOption(nodeId) {
    const upstream   = getAllUpstream(nodeId, new Set());
    const downstream = getAllDownstream(nodeId, new Set());
    const fullPath   = new Set([...upstream, ...downstream]);

    const pathEdges = new Set();
    for (const link of linkList) {
      if (fullPath.has(link.source) && fullPath.has(link.target)) {
        pathEdges.add(`${link.source}||${link.target}`);
      }
    }

    const view = currentView();
    return {
      series: [{
        ...baseSeries,
        zoom: view.zoom,
        center: view.center,
        animation: false,
        data: nodeData.map(n => {
          if (n.id === nodeId) {
            return {
              ...n,
              symbolSize: [NODE_W + 6, NODE_H + 4],
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
            itemStyle: { opacity: 0.15 }
          };
        }),
        links: linkList.map(link => {
          const key = `${link.source}||${link.target}`;
          if (pathEdges.has(key)) {
            return {
              ...link,
              lineStyle: { color: '#60a5fa', width: 3, opacity: 1, curveness: 0.3 }
            };
          }
          return {
            ...link,
            lineStyle: { color: '#94a3b8', width: 1, opacity: 0.06, curveness: 0.3 }
          };
        })
      }]
    };
  }

  function buildResetOption() {
    const view = currentView();
    return {
      series: [{
        ...baseSeries,
        zoom: view.zoom,
        center: view.center,
        animation: false,
        data: nodeData.map(n => ({ ...n, itemStyle: null })),
        links: linkList.map(link => ({ ...link, lineStyle: null }))
      }]
    };
  }

  let lockedNodeId = null;
  let hoveredNodeId = null;

  chart.on('mouseover', (params) => {
    if (!params || !params.data || params.dataType !== 'node') return;
    if (lockedNodeId) return;
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
      if (lockedNodeId) {
        lockedNodeId = null;
        chart.setOption(buildResetOption(), { replaceMerge: ['series'] });
      }
      return;
    }
    const nodeId = params.data.id;
    if (lockedNodeId === nodeId) {
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