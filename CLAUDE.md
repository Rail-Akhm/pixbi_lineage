# PIXBI Lineage Visualizer

Интерактивная визуализация lineage данных для дашбордов PIXBI.
Реализация: кастомная визуализация PIX BI на **ECharts** (`series.type: 'graph'`,
`layout: 'none'` — узлы позиционируются вручную по слоям). Файл — `lineage.js`.

---

## 📊 Датасет

**Файл:** `edw_prj_brddwh_v_serv_dashboard_linage_prod_202606031303.csv`
**Строк:** ~15 634
**Разделитель:** `;`

### Поля CSV

| # | Поле | Описание |
|---|------|----------|
| 1 | `ind_name` | Тип подключения дашборда (3 варианта) |
| 2 | `table_schema` | Схема источника (GreenPlum) |
| 3 | `table_name` | Таблица источник |
| 4 | `view_schema` | Схема представления (datamarketbrd и др.) |
| 5 | `view_name` | Имя представления (view) |
| 6 | `adqm_src_table_schema` | База в ADQM (всегда `brd_cds`) |
| 7 | `adqm_src_table_name` | Таблица в ADQM |
| 8 | `adqm_view_schema` | Схема представления ADQM |
| 9 | `adqm_view_name` | Представление ADQM |
| 10 | `app_id` | ID дашборда PIXBI |
| 11 | `app_name` | Название дашборда |
| 12 | `app_author` | Автор дашборда |
| 13 | `dataset_name` | Название датасета (для ADQM) |
| 14 | `sid_domen` | Домен (19 шт.) |
| 15 | `spd_domen` | SP-домен (2 шт.) |
| 16 | `pix_domen` | PIX-домен (2 шт.) |
| 17 | `write_ts` | Время записи |
| 18 | `wf_load_idn` | ID загрузки |

### ⚠️ Формат данных PIX BI (`getItemData`) — ВАЖНО

PIX BI отдаёт данные в кастомную визуализацию **НЕ как плоскую таблицу строк**
(`{values, columns}`), а как двумерную модель графика «категория × серия»:

```js
const itemData = await getItemData(id);
// itemData = {
//   categories: Array(N),        // ← это и есть "строки"
//   referenceLines, conditional_format, isEnabledByCondition, customValues
// }
// categories[i] = {
//   name:   "<значение ПЕРВОГО поля из 'Категории'>",
//   series: [ { name: "<значение Серии>", value: "<мера>", format: null }, ... ],
//   extra_hints: []
// }
```

**Следствие:** в данные попадает только **ПЕРВОЕ** поле из блока «Категории»
(как `categories[i].name`) + поле «Серии» + «Меры». Завести 9 измерений в
«Категории» и получить их все в ответе **невозможно** — модель этого не вмещает.

#### Решение: одно вычисляемое поле `lineage_key`

В датасете PIX BI создаётся calculated field, склеивающий весь путь в одну
строку через разделитель `||`, и кладётся **единственным** полем в «Категории».
Тогда `categories[i].name` = полный путь, а парсер в `lineage.js` разбирает его
обратно по `||`.

**Конфигурация визуализации в PIX BI:**
- **Категории:** только `lineage_key` (одно поле!)
- **Меры:** `COUNT(app_id)` — обязательно, иначе запрос вернёт 0 строк
- **Серии:** пусто

**Формула `lineage_key` (порядок полей фиксирован, индексы 0–9):**
```
concat(
  coalesce(table_schema,''),          '||',  -- 0
  coalesce(table_name,''),            '||',  -- 1
  coalesce(view_schema,''),           '||',  -- 2
  coalesce(view_name,''),             '||',  -- 3
  coalesce(adqm_src_table_schema,''), '||',  -- 4
  coalesce(adqm_src_table_name,''),   '||',  -- 5
  coalesce(adqm_view_schema,''),      '||',  -- 6
  coalesce(adqm_view_name,''),        '||',  -- 7
  coalesce(app_id,''),                '||',  -- 8
  coalesce(app_name,'')                      -- 9
)
```

> `coalesce`/`ifnull` обязателен: иначе пустые поля (view/adqm у прямых ODS)
> дадут `null` и сломают весь конкат.

`lineage.js` берёт `categories[i].name`, делает `split('||')` и строит граф
по индексам 0–9. ID блока (`getItemData(id)`) меняется при пересоздании блока —
обновлять `const id` в начале файла.

### Три типа lineage (ind_name)

#### 1. Прямые ODS таблицы (2 350 строк)
`Дашборды на данных ODS таблиц GreenPlum`
```
Source Schema → Source Table → Dashboard
```
- **Только** table_schema + table_name + app_id/app_name
- view_schema, view_name, adqm_* — пустые
- 64 схемы, 299 таблиц

#### 2. Через DM-представления (1 523 строки)
`Дашборды на представлениях витрин DM слоя GreenPlum`
```
Source Schema → Source Table → View Schema → View → Dashboard
```
- Всегда есть table_schema, table_name, view_schema, view_name
- adqm_* — пустые
- 8 схем представлений, 137 вьюх

#### 3. Через ADQM (1 891 строк)
`Дашборды на датасетах в ADQM`
```
Source Schema → Source Table → View Schema → View → ADQM DB → ADQM Table → ADQM View Schema → ADQM View → Dashboard
```
- Всегда заполнен весь путь (source → view → adqm_table → adqm_view → app)
- 3 ADQM базы, 85 таблиц ADQM, 26 схем ADQM-представлений, 79 вьюх ADQM

### Общая статистика

| Сущность | Уникальных |
|----------|-----------|
| Схемы источников (GreenPlum) | 64 |
| Таблицы источники | 299 |
| Схемы представлений | 8 |
| Представления | 137 |
| Базы ADQM | 3 (всегда `brd_cds`) |
| Таблицы ADQM | 85 |
| Схемы представлений ADQM | 26 |
| Представления ADQM | 79 |
| Дашборды (app_id) | 191 |
| Дашборды (названия) | 174 |
| Датасеты (dataset_name) | 463 |
| Домены (sid_domen) | 19 |

---

## 🏗 Архитектура графа

### Слои

| Слой | Цвет | Типы узлов | Описание |
|------|------|-------------|----------|
| **Source** | 🟢 `#22c55e` | `source_schema`, `source_table` | Исходные данные |
| **View** | 🟡 `#eab308` | `view_schema`, `view` | Представления |
| **ADQM** | 🔵 `#3b82f6` | `adqm_db`, `adqm_table` | Хранилище ADQM |
| **ADQM View** | 🟣 `#a855f7` | `adqm_view_db`, `adqm_view` | Представления ADQM |
| **Dashboard** | 🔴 `#ef4444` | `dashboard` | Дашборды PIXBI |

### Связи (Edge)

Тип ребра всегда `uses`. Граф направленный — от источников к дашбордам.

### Три возможных пути (сценарии)

```
Прямой:    Source_Schema → Source_Table → Dashboard
Через DM:  Source_Schema → Source_Table → View_Schema → View → Dashboard
Через ADQM: Source_Schema → Source_Table → View_Schema → View → ADQM_DB → ADQM_Table → ADQM_View_Schema → ADQM_View → Dashboard
```

---

## 🛠 Технический стек

| Компонент | Технология |
|-----------|------------|
| Граф | ECharts `series.type: 'graph'` |
| Layout | `layout: 'none'` — ручное позиционирование по слоям (`LAYER_X`) |
| Рендер | ECharts (Canvas), узлы `symbol: 'roundRect'` |
| Взаимодействие | `roam`/`draggable` + кастомные обработчики `click`/`dblclick` |
| Данные | `getItemData(id)` → `categories[i].name` (`lineage_key`) |
| Тема | адаптивная, читается из `window.themeConfigs` |

> Реализация — **единый файл `lineage.js`**, встраиваемый как кастомная
> визуализация в блок PIX BI. Отдельных `index.html`/`app.js`/`lineage.json`
> в рантайме нет — граф строится в памяти на лету из `getItemData`.

## 📁 Структура проекта

```
pixbi_lineage/
├── lineage.js        # Кастомная визуализация PIX BI (ECharts graph) — основной файл
├── <dataset>.csv     # Исходный датасет (для анализа, в рантайме не используется)
└── CLAUDE.md         # Этот файл
```

## 🧩 Модель данных (в памяти `lineage.js`)

Граф строится в `nodeMap` (узлы) и `linkList` (рёбра) из распарсенного
`lineage_key`. В ECharts уходит `nodeData` (короткое имя + метаданные для
тултипа) и `linkList`.

### Node (`nodeMap`)
```js
{
  id,                 // напр. "s_table:schema.table", "dash:<app_id>"
  name,               // полное имя (в тултипе — _fullName)
  type,               // source_schema | source_table | view_schema | view |
                      // adqm_db | adqm_table | adqm_view_db | adqm_view | dashboard
  layer,              // source | view | adqm | adqm_view | dashboard
  details: { schema?, database?, fullName?, id?, author?, domain?, dataset? },
  refCount            // сколько раз узел встретился (показывается в тултипе)
}
```
В `nodeData` (для ECharts) `name` — **короткое** имя (`fullName.split('.').pop()`),
полное лежит в `_fullName`.

### Edge (`linkList`)
```js
{ source: "<node-id-from>", target: "<node-id-to>" }  // без label, дедуп через linkSet
```

---

## 🎨 Дизайн и поведение

### Узлы
- `symbol: 'roundRect'`, размер `[nodeW, NODE_H]` (NODE_H = 30)
- Ширина `nodeW` динамическая: самый загруженный слой умещается в ~4000px
  (`TARGET_TOTAL_H`), в диапазоне `NODE_MIN_W..NODE_MAX_W` (90..180)
- Цвет — по слою (`LAYER_COLORS`), обводка `#fff`, подпись внутри (короткое имя)
- Слои по горизонтали (слева направо: Source → Dashboard). `LAYER_X` вычисляется
  из `LAYER_ORDER` × `LAYER_GAP` (по умолчанию 600px) — большой зазор, чтобы
  слои не сливались в одну полосу при сотнях узлов. Узлы внутри слоя идут
  вертикально (один столбец). Сортировка внутри слоя по имени.

### Рёбра
- Направленные (`edgeSymbol: ['none', 'arrow']`), `curveness: 0.3`
- По умолчанию `#94a3b8`, при выделении пути — `#60a5fa`

### Взаимодействие
- **Hover / клик по узлу** → кастомная подсветка **полного пути** (upstream +
  downstream через `adjUp`/`adjDown` + рекурсивный обход `getAllUpstream`/
  `getAllDownstream`): узел увеличивается, предки — синяя обводка `#3b82f6`,
  потомки — зелёная `#22c55e`, рёбра пути жирные/синие, остальное гаснет.
  Hover подсвечивает временно, клик — **закрепляет** (`lockedNodeId`); повторный
  клик по тому же узлу или клик по пустому месту снимает закрепление.
- **Двойной клик** → сброс к исходному состоянию.
- ⚠️ **Подсветка строит ПОЛНУЮ серию** через `...baseSeries`, а не частичную.
  Причина: применяется через `setOption(..., { replaceMerge: ['series'] })`,
  который **полностью заменяет** компонент серии. Если отдать только
  `data`/`links`, ECharts потеряет `type: 'graph'`, `layout: 'none'`,
  `categories`, `symbol` и подсветка сломается (выделятся только соседи). Поэтому
  конфиг серии вынесен в общий объект `baseSeries`, а `buildOption`,
  `buildHighlightedOption` и `buildResetOption` строят серию через spread от него
  (с `animation: false` в подсветке/сбросе, чтобы граф не переанимировался).
  Штатный `focusNodeAdjacency` не используется — подсветкой управляем сами.
- **Hover** → тултип с `_fullName`, типом/слоем, `refCount` и полями из
  `details`. Набор полей — декларативная схема `TOOLTIP_FIELDS`
  (`{ key, label, skipIfEqualsName? }`). Поле показывается, только если в
  `details` есть непустое значение.

  **Как добавить поле в тултип:**
  1. Положить значение в `details` при `ensureNode` (напр. `author`, `domain`,
     `dataset` у узла Dashboard).
  2. Добавить строку в `TOOLTIP_FIELDS`: `{ key: '<ключ details>', label: '<подпись>' }`.
  3. Если данные приходят из CSV — сперва **расширить формулу `lineage_key`**
     (добавить поле в `concat` и индекс в `F`), т.к. сейчас в ключе только путь
     (10 полей), а `app_author`/`sid_domen`/`dataset_name` в нём НЕТ.
- `roam` (zoom/pan) + `draggable`, `scaleLimit` 0.3..4.

### Тема
- `readTheme()` берёт `bgColor`/`textColor` из `window.themeConfigs`.
- Смена темы отслеживается через `MutationObserver` (class/style на `body`) и
  `postMessage` (`type: 'THEME_CHANGED'`) → `applyThemeIfChanged()`.

### Диагностика
- Если `nodeData.length === 0`, на canvas выводится дамп `itemData` (ключи,
  `categories[0]`, `rows[0]` после split) — для отладки формулы `lineage_key`.

---

## 📐 Конвенции

- ECharts, `series.type: 'graph'`, `layout: 'none'` (не D3, не Dagre)
- Один файл `lineage.js`, без сборщиков и фреймворков
- Язык интерфейса: русский
- Тема адаптивная (наследуется от PIX BI), **не** хардкод тёмной
- `const id` в начале файла — ID блока PIX BI, **обновлять при пересоздании блока**