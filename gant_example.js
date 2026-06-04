(async function () {
  const id = 'CUSTOM_VISUALIZATION_ID';

  // ====== Данные ======
  const itemData = await getItemData(id);
  const rows = Array.isArray(itemData?.values) ? itemData.values : [];
  const columns = Array.isArray(itemData?.columns) ? itemData.columns : [];
  console.log(itemData);

  const get  = (r,k)=> r?.[k]?.value ?? null;
  const getByKeys = (r, ...keys) => {
    for (const k of keys) {
      if (!k) continue;
      const v = get(r, k);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const toTS =(v)=>{
    if (!v) return NaN;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(+m[1], +m[2]-1, +m[3]) : new Date(s).getTime();
  };

  // ---- ключи для Этапа и Задачи берём из columns[0] и columns[1]
  const STAGE_KEY_NAME  = columns[0]?.name  || null;
  const STAGE_KEY_ALIAS = columns[0]?.alias || null;
  const TASK_KEY_NAME   = columns[1]?.name  || null;
  const TASK_KEY_ALIAS  = columns[1]?.alias || null;

  // Удобные геттеры
  const getStage = (r) => getByKeys(r, STAGE_KEY_NAME, STAGE_KEY_ALIAS, 'Этап');
  const getTask  = (r) => getByKeys(r, TASK_KEY_NAME,  TASK_KEY_ALIAS,  'Задача');

  // Ось Y: этапы
  const stages = [...new Set(rows.map(r => getStage(r)).filter(Boolean))];

  // Флаг: выводить ли исполнителя
  const SHOW_EXEC = (() => {
    for (const r of rows) {
      const v1 = get(r, 'Вывод исполнителя');
      const v2 = get(r, 'Вывод исполнитель');
      const val = (v1 ?? v2 ?? '').toString().trim().toLowerCase();
      if (val) return val === 'да';
    }
    return false;
  })();

  // Ответственные по этапам
  const respByStage = new Map();
  for (const r of rows) {
    const stage = getStage(r);
    const resp  = (get(r,'Ответственный') || '').toString().trim();
    if (!stage) continue;
    if (!respByStage.has(stage)) respByStage.set(stage, new Set());
    if (resp) respByStage.get(stage).add(resp);
  }
  const respText = (stage) => {
    const set = respByStage.get(stage);
    if (!set || set.size === 0) return '';
    const s = Array.from(set).join('; ');
    return s.length > 240 ? s.slice(0,237) + '…' : s;
  };

  // Запасные цвета
  const DEFAULTS = { plan: '#5470C6', fact: '#2F4DA1' };

  // Данные серий
  const barsPlan = [];
  const barsFact = [];
  let legendPlanColor = null;
  let legendFactColor = null;

  for (const r of rows) {
    const stage = getStage(r);
    const task  = getTask(r);

    const sP = toTS(get(r,'Дата начала план'));
    const eP = toTS(get(r,'Дата окончания план'));
    const sF = toTS(get(r,'Дата начала факт'));
    const eF = toTS(get(r,'Дата окончания факт'));

    const colorPlan = get(r,'ColorPlan') || DEFAULTS.plan;
    const colorFact = get(r,'ColorFact') || DEFAULTS.fact;

    if (!legendPlanColor && colorPlan) legendPlanColor = colorPlan;
    if (!legendFactColor && colorFact) legendFactColor = colorFact;

    const yIndex = stages.indexOf(stage);
    if (stage && task && yIndex >= 0) {
      if (isFinite(sP) && isFinite(eP)) {
        barsPlan.push({
          value: [Math.min(sP,eP), Math.max(sP,eP), yIndex, task, stage],
          itemStyle: { color: colorPlan }
        });
      }
      if (isFinite(sF) && isFinite(eF)) {
        barsFact.push({
          value: [Math.min(sF,eF), Math.max(sF,eF), yIndex, task, stage],
          itemStyle: { color: colorFact }
        });
      }
    }
  }

  legendPlanColor = legendPlanColor || DEFAULTS.plan;
  legendFactColor = legendFactColor || DEFAULTS.fact;

  const nowTs = Date.now();

  // Диапазон X
  const allTs = [
    ...barsPlan.flatMap(b=>[b.value[0], b.value[1]]),
    ...barsFact.flatMap(b=>[b.value[0], b.value[1]]),
    nowTs
  ].filter(isFinite);
  const xMin = allTs.length ? Math.min(...allTs) : null;
  const xMax = allTs.length ? Math.max(...allTs) : null;

  // Инициализация графика
  const el = document.getElementById(id);
  const chart = echarts.init(el);

  function makeRender(offsetSign) {
    return function renderItem(params, api) {
      const start  = api.value(0);
      const end    = api.value(1);
      const yIndex = api.value(2);

      const p1 = api.coord([start, yIndex]);
      const p2 = api.coord([end,   yIndex]);

      const band = api.size([0,1])[1];
      const subH = Math.min(24, band * 0.38);
      const gap  = Math.min(6,  band * 0.10);
      const centerY = p1[1];

      const top = offsetSign < 0 ? (centerY - gap/2 - subH) : (centerY + gap/2);
      const x = p1[0];
      const w = Math.max(1, p2[0] - p1[0]);

      return { type:'rect', shape:{ x, y: top, width:w, height: subH }, style: api.style({}) };
    };
  }

  // Поля отступов
  const LEFT_SPACE  = 220;
  const RIGHT_SPACE = SHOW_EXEC ? 260 : 20;

  // ========= ТЕМА =========

  function readTheme() {
    const theme      = window.themeConfigs || {};
    const app        = theme.application   || {};
    const applied    = app.applied_filters || {};
    const background = app.background      || {};
    const baseColors = theme.base_colors   || [];
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

    return {
      bgColor,
      textColor,
      baseColors
    };
  }

  function themeSignature(t) {
    return [
      t.bgColor || '',
      t.textColor || '',
      (t.baseColors || []).join(',')
    ].join('|');
  }

  function buildOptionFromTheme(t) {
    const bgColor   = t.bgColor;
    const textColor = t.textColor || '#000000';

    // фон контейнера
    el.style.background = bgColor;

    return {
      backgroundColor: bgColor,

      textStyle: {
        color: textColor
      },

      grid: { left: LEFT_SPACE, right: RIGHT_SPACE, top: 40, bottom: 60 },

      legend: {
        top: 8,
        left: 'center',
        data: [
          { name:'План', icon:'roundRect' },
          { name:'Факт', icon:'roundRect' }
        ],
        textStyle: {
          color: textColor
        }
      },

      xAxis: Object.assign(
        {
          type:'time',
          boundaryGap:[0,0],
          scale:true,
          axisLabel:{
            hideOverlap:true,
            color: textColor
          },
          axisLine: {
            lineStyle: { color: textColor }
          },
          splitLine: {
            show: true,
            lineStyle: { color: 'rgba(128,128,128,0.25)' }
          }
        },
        (xMin!=null && xMax!=null) ? { min:xMin, max:xMax } : {}
      ),

      // Два Y-аксиса
      yAxis: [
        {
          type:'category',
          data: stages,
          axisLabel:{
            interval: 0,
            margin: 12,
            width: LEFT_SPACE - 30,
            overflow: 'truncate',
            color: textColor
          },
          axisLine: {
            lineStyle: { color: textColor }
          },
          splitLine: {
            show: true,
            lineStyle: { width: 1, type: 'solid', color: 'rgba(128,128,128,0.2)' }
          }
        },
        {
          type: 'category',
          position: 'right',
          data: stages,
          axisTick: { show: false },
          splitLine: { show: false },
          axisLine: {
            show: SHOW_EXEC,
            lineStyle: { color: textColor, width: 1 }
          },
          axisLabel: {
            show: SHOW_EXEC,
            margin: 10,
            align: 'left',
            overflow: 'truncate',
            width: SHOW_EXEC ? (RIGHT_SPACE - 30) : 0,
            color: textColor,
            formatter: function (val) { return SHOW_EXEC ? respText(val) : ''; }
          }
        }
      ],

      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter', throttle: 50 },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'weakFilter',
          height: 2,
          bottom: 20,
          borderColor: 'transparent',
          backgroundColor: 'rgba(150,150,150,0.1)',
          dataBackground: {
            lineStyle: { color: 'rgba(150,150,150,0.5)' },
            areaStyle: { color: 'rgba(150,150,150,0.2)' }
          }
        }
      ],

      tooltip: {
        trigger:'item',
        formatter: (p) => {
          const f = ts => new Date(ts).toISOString().slice(0,10);
          return [
            `<b>${p.value[3]}</b>`,
            `${p.seriesName}`,
            `Этап: ${p.value[4]}`,
            `Начало: ${f(p.value[0])}`,
            `Окончание: ${f(p.value[1])}`
          ].join(`<br/>`);
        }
      },

      series: [
        {
          type:'custom',
          name:'План',
          renderItem: makeRender(-1),
          data: barsPlan,
          itemStyle:{ color: legendPlanColor },
          clip: true,
          dimensions: ['start','end','y','task','stage'],
          encode: { x: [0,1], y: 2, tooltip: [3,4,0,1] },
          z:1
        },
        {
          type:'custom',
          name:'Факт',
          renderItem: makeRender(+1),
          data: barsFact,
          itemStyle:{ color: legendFactColor },
          clip: true,
          dimensions: ['start','end','y','task','stage'],
          encode: { x: [0,1], y: 2, tooltip: [3,4,0,1] },
          z:2
        },
        {
          type: 'line',
          name: '',
          data: [],
          silent: true,
          markLine: {
            silent: true,
            symbol: ['none','none'],
            lineStyle: {
              color: t.baseColors?.[0] || '#d62728',
              type: 'dashed',
              width: 2
            },
            label: {
              show: true,
              formatter: () => new Date(nowTs).toISOString().slice(0,10),
              position: 'end',
              color: textColor
            },
            data: [{ xAxis: nowTs }]
          },
          z: 5
        }
      ]
    };
  }

  // ===== первый рендер по теме
  let currentTheme = readTheme();
  let currentSig   = themeSignature(currentTheme);

  chart.setOption(buildOptionFromTheme(currentTheme));

  // ===== адаптивность
  window.addEventListener('resize', () => chart.resize());

  // ===== реакция на смену темы =====
  function applyThemeIfChanged() {
    const t   = readTheme();
    const sig = themeSignature(t);
    if (sig !== currentSig) {
      console.log('Theme change detected, re-render gantt chart');
      currentSig = sig;
      chart.setOption(buildOptionFromTheme(t), true);
    }
  }

  // 1) через изменения class/style у body
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

  // 2) через postMessage({ type: 'THEME_CHANGED' }, '*')
  window.addEventListener('message', function (event) {
    if (event && event.data && event.data.type === 'THEME_CHANGED') {
      applyThemeIfChanged();
    }
  });

})();

