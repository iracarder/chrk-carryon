/*
 * Генератор посадочных страниц по авиакомпаниям: airlines/<код>.html
 *
 * Зачем: страница index.html — инструмент, а не документ. Поисковые запросы
 * приходят с именем авиакомпании ("Ryanair cabin bag 55x40x23"), а не с
 * "проверить сумку". Одна страница на все 30 перевозчиков под эти запросы не
 * отвечает и в выдачу не попадает.
 *
 * Источник данных — массив AIRLINES в index.html. Ничего не дублируется:
 * правила, заметки, источники и дата проверки берутся оттуда же, поэтому
 * правка в index.html и повторный запуск этого скрипта не разойдутся.
 *
 * Уникальный хлеб каждой страницы — таблица "подойдёт ли типовой размер",
 * посчитанная тем же checkDims, что и основная проверка. Это не пересказ
 * данных, это ответ на вопрос, ради которого страницу открывают.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

/* ---------- извлечь логику, как это делает test-logic.js ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: скрипт не найден"); process.exit(1); }
const full = m[1];
const cut = full.indexOf("/* ---------------- рендер ---------------- */");
if (cut < 0) { console.error("FAIL: не найден маркер рендера"); process.exit(1); }
const logic = full.slice(0, cut);

const probe = `
${logic}
globalThis.T = { AIRLINES, BAG_SIZES, SHOPS, checkDims, sortD, hasAll, DATA_CHECKED };
`;
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(probe, ctx, { filename: "logic.js" });
const { AIRLINES, BAG_SIZES, DATA_CHECKED, checkDims } = ctx.T;

const MARKER = "785373.Zzf0807c4d502f49289bd406c-785373";
const SITE = "https://iracarder.github.io/chrk-carryon/";
const checked = DATA_CHECKED();

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = v => String(v).replace(".", ",");
const dstr = d => d ? d.join("×") + " см" : null;

/* slug для URL и имя для заголовков.
 * У SU и LO поле name кириллическое, поэтому slug и заголовок берут nameEn —
 * так страница попадает и в латинский, и в русский запрос. */
const slugOf = a => {
  const s = String(a.nameEn || a.name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || a.code.toLowerCase();
};
/* бренд для H1: латиница + русское название, если они различаются */
const brand = a => (a.nameEn && a.nameEn !== a.name)
  ? a.nameEn + " (" + a.name + ")"
  : (a.nameEn || a.name);
const optName = (a, o) => o.labelEn || o.label;

/* сколько типовых размеров подходит под каждый тариф */
function sizeTable(a) {
  const rows = [];
  for (const cand of BAG_SIZES) {
    let okCount = 0;
    for (const o of a.opts) {
      if (!o.dims) continue;
      const s = [];
      checkDims(cand, o.dims, 0, s);
      if (s.length && s.every(x => x.slack >= 0)) okCount++;
    }
    rows.push({ d: cand, n: okCount, of: a.opts.filter(o => o.dims).length });
  }
  return rows;
}

/* части страницы */
function hero(a) {
  const rows = sizeTable(a);
  const withDims = rows.filter(r => r.of > 0);
  return `
  <p class="flagline">${esc(a.flag || "")} ${esc(a.region || "")}</p>
  <h1>Ручная кладь ${esc(brand(a))}: размеры, вес, что влезет</h1>
  <p class="lead">${esc(a.nameEn || a.name)} · код ${esc(a.code)}${a.opts.length > 1
    ? ` — правила зависят от тарифа, их ${a.opts.length}.`
    : " — правила одинаковы на всех тарифах."}
    Ниже — опубликованные нормы и проверка: влезет ли твоя сумка.</p>
  <p class="cta"><a class="btn" href="../index.html#a=${esc(a.code)}:0">Проверить свою сумку →</a></p>
  ${withDims.length ? `<p class="fact">${esc(sizeFact(a, withDims))}</p>` : ""}`;
}

/* одну фразу вместо тавтологии «4 безусловно и 4 хотя бы под один» */
function sizeFact(a, withDims) {
  const total = BAG_SIZES.length;
  const any = withDims.filter(r => r.n > 0).length;
  const universal = withDims.filter(r => r.n === r.of).length;
  if (!any) return `Из ${total} типовых размеров ни один не проходит под опубликованные нормы.`;
  if (universal === total)
    return `Все ${total} типовых размеров проходят под опубликованные нормы ${brand(a)}.`;
  if (universal === any)
    return `Из ${total} типовых размеров проходят ${any}: остальные превышают норму хотя бы по одной стороне.`;
  const extra = any - universal;
  return `Из ${total} типовых размеров проходят ${universal} под все тарифы `
    + `и ещё ${extra} — хотя бы под один.`;
}

function fareTable(a) {
  const body = a.opts.map(o => {
    const lim = [];
    lim.push(o.onlyPi && !o.dims
      ? "<b>в багажное отделение не пускают</b>, только под сидень"
      : (dstr(o.dims) ? `<b>${esc(dstr(o.dims))}</b>` : "габариты поштучно не публикуются"));
    if (o.linear) lim.push(`сумма трёх сторон не больше <b>${fmt(o.linear)} см</b>`);
    if (o.weight != null) lim.push(`вес <b>${fmt(o.weight)} кг</b>`);
    if (o.pieces > 1) lim.push(`предметов: <b>${o.pieces}</b>`);
    if (o.totalWeight != null) lim.push(`две сумки вместе: <b>${fmt(o.totalWeight)} кг</b>`);
    if (o.pi) {
      if (o.pi.free) lim.push("маленькая сумка — <b>без отдельных числовых лимитов</b>");
      else {
        const p = [];
        if (o.pi.dims) p.push(esc(dstr(o.pi.dims)));
        if (o.pi.weight != null) p.push(`до ${fmt(o.pi.weight)} кг`);
        if (p.length) lim.push(`под сиденье: <b>${p.join(" / ")}</b>`);
      }
    }
    return `      <tr>
        <th scope="row">${esc(optName(a, o))}</th>
        <td>${lim.join("; ")}</td>
      </tr>`;
  }).join("\n");
  return `
  <h2>Нормы по тарифам</h2>
  <table>
    <caption class="sr">${esc(brand(a))}: правила ручной клади по тарифам</caption>
    <thead><tr><th scope="col">Тариф</th><th scope="col">Что разрешено</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
}

function sizeSection(a) {
  const rows = sizeTable(a);
  if (!rows.filter(r => r.of > 0).length) return "";
  const body = rows.map(r => {
    const verdict = !r.of ? "—"
      : r.n === 0 ? "<span class=\"no\">не проходит ни под один тариф</span>"
      : r.n === r.of ? "<span class=\"yes\">подходит под все тарифы</span>"
      : `подходит под ${r.n} из ${r.of}`;
    return `      <tr>
        <th scope="row">${r.d.join("×")} см</th>
        <td>${verdict}</td>
      </tr>`;
  }).join("\n");
  return `
  <h2>Какой типовой чемодан взять</h2>
  <p>Пять размеров, которые чаще всего покупают, против опубликованных норм
    ${esc(a.name)}. Считано тем же кодом, что и основная проверка, без запаса.</p>
  <table>
    <thead><tr><th scope="col">Размер</th><th scope="col">Результат</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="note">Измерения сравниваются по убыванию: длина, ширина, высота. Сумку можно
    поворачивать, поэтому 40×23×55 и 55×40×23 — один и тот же размер.</p>`;
}

function notes(a) {
  return `
  <h2>Что стоит знать</h2>
  <p>${esc(a.note)}</p>`;
}

function related(a) {
  const same = AIRLINES.filter(x => x.region === a.region && x.code !== a.code);
  if (!same.length) return "";
  const items = same.slice(0, 8).map(x =>
    `<li><a href="./${esc(slugOf(x))}.html">${esc(x.nameEn || x.name)}</a></li>`).join("\n      ");
  return `
  <h2>Другие перевозчики${esc(a.region ? " — " + a.region : "")}</h2>
  <ul class="rel">
      ${items}
  </ul>`;
}

function allAirlines() {
  const byRegion = {};
  for (const a of AIRLINES) (byRegion[a.region] = byRegion[a.region] || []).push(a);
  const block = Object.keys(byRegion).map(rg =>
    `    <li><b>${esc(rg)}</b>: ${byRegion[rg].map(a =>
      `<a href="./${esc(slugOf(a))}.html">${esc(a.nameEn || a.name)}</a>`).join(", ")}</li>`).join("\n");
  return `
  <h2>Все авиакомпании в проверке</h2>
  <ul class="all">
${block}
  </ul>`;
}

function page(a) {
  const slug = slugOf(a);
  const title = `Ручная кладь ${brand(a)} ${a.code} — размеры и вес`;
  const main = a.opts.find(o => o.dims) || a.opts[0] || {};
  const mainBits = [dstr(main.dims), main.weight != null ? `вес ${fmt(main.weight)} кг` : null]
    .filter(Boolean).join(", ");
  const desc = `${brand(a)}: ручная кладь${mainBits ? " " + mainBits : ""}`
    + `. Правила по тарифам, источник и дата проверки. Свою сумку проверить можно за 10 секунд.`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}airlines/${esc(slug)}.html">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article">
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
  <p class="crumbs"><a href="../index.html">← к проверке сумки</a></p>
${hero(a)}
${fareTable(a)}
${sizeSection(a)}
${notes(a)}
  <h2>Купить билет</h2>
  <p>Билеты на ${esc(a.nameEn || a.name)} — через Aviasales. Это партнёрская ссылка: при покупке
    мы получаем небольшую комиссию, на цену билета это не влияет.</p>
  <p class="cta"><a class="btn" rel="sponsored noopener" target="_blank"
    href="https://www.aviasales.com/?marker=${MARKER}">Сравнить цены на ${esc(a.nameEn || a.name)} →</a></p>
  <h2>Где взяты данные</h2>
  <p class="src">Источник: ${esc(a.src)}. Проверено ${esc(checked)}.
    Правила перевозчиков меняются по тарифам и типам самолётов — сверься со своим билетом.
    Это не baggage approval.</p>
${related(a)}
${allAirlines()}
  <p class="foot"><a href="../index.html">Проверить свою сумку</a> ·
    <a href="https://github.com/iracarder/chrk-carryon">исходный код</a> ·
    данные правил проверены ${esc(checked)}</p>
</main>
</body>
</html>
`;
}

const CSS = `
:root{--fg:#12211e;--mut:#5b6b67;--line:#d8e0dd;--acc:#0f766e;--no:#c02626;--yes:#15803d;--bg:#fff}
@media(prefers-color-scheme:dark){:root{--fg:#e7efec;--mut:#9aaba6;--line:#2a3a36;--acc:#5eead4;--no:#f87171;--yes:#4ade80;--bg:#0d1512}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 60px}
a{color:var(--acc)}
.crumbs{font-size:.9rem;margin:0 0 18px}
.flagline{color:var(--mut);font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;margin:0 0 4px}
h1{font-size:clamp(1.5rem,4vw,2.1rem);line-height:1.2;margin:0 0 12px}
h2{font-size:1.15rem;margin:34px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
.lead{color:var(--mut);margin:0 0 16px}
.fact{background:color-mix(in srgb,var(--acc) 8%,transparent);border-left:3px solid var(--acc);
  padding:10px 14px;margin:16px 0;border-radius:0 6px 6px 0}
.note,.src{color:var(--mut);font-size:.92rem}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.95rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
thead th{background:color-mix(in srgb,var(--fg) 5%,transparent);font-weight:600}
tbody th{font-weight:500}
.no{color:var(--no)}
.yes{color:var(--yes);font-weight:600}
.btn{display:inline-block;background:var(--acc);color:var(--bg);padding:10px 16px;
  border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem}
.cta{margin:18px 0}
ul.rel,ul.all{padding-left:20px}
ul.all li{margin:6px 0}
.foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--mut);font-size:.88rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

/* ---------- запись ---------- */
const outDir = path.join(root, "airlines");
fs.mkdirSync(outDir, { recursive: true });

let written = 0;
const slugs = new Set();
for (const a of AIRLINES) {
  const slug = slugOf(a);
  if (slugs.has(slug)) { console.error("FAIL: дубль slug " + slug + " у " + a.code); process.exit(1); }
  slugs.add(slug);
  fs.writeFileSync(path.join(outDir, slug + ".html"), page(a), "utf8");
  written++;
}

/* sitemap: главная + все страницы */
const urls = [`  <url><loc>${SITE}</loc><changefreq>monthly</changefreq></url>`]
  .concat(AIRLINES.map(a =>
    `  <url><loc>${SITE}airlines/${slugOf(a)}.html</loc><changefreq>monthly</changefreq></url>`));
fs.writeFileSync(path.join(root, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.join("\n") + "\n</urlset>\n", "utf8");

/* ---------- индекс авиакомпаний в index.html ----------
 * 30 страниц без ссылок с главной — сироты, в выдачу не попадут. Блок живёт
 * между маркерами и пересобирается отсюда же, чтобы список не разошёлся с
 * AIRLINES при добавлении перевозчика. Вне маркеров файл не трогаем. */
const START = "<!-- AIRLINES_INDEX:START -->";
const END = "<!-- AIRLINES_INDEX:END -->";

function indexBlock() {
  const items = AIRLINES.slice()
    .sort((x, y) => (x.nameEn || x.name).localeCompare(y.nameEn || y.name))
    .map(a => `<li><a href="airlines/${slugOf(a)}.html">${esc(a.nameEn || a.name)}</a></li>`)
    .join("\n    ");
  return `${START}
<details class="airidx">
  <summary data-i18n="air.head">Правила по авиакомпаниям</summary>
  <p data-i18n="air.note">Отдельная страница на каждого перевозчика: габариты и вес по тарифам, какой типовой чемодан проходит, источник и дата проверки.</p>
  <ul>
    ${items}
  </ul>
</details>
${END}`;
}

const idxPath = path.join(root, "index.html");
const before = fs.readFileSync(idxPath, "utf8");
if (!before.includes(START) || !before.includes(END)) {
  console.error("FAIL: в index.html нет маркеров " + START + " / " + END);
  process.exit(1);
}
const head = before.slice(0, before.indexOf(START));
const tail = before.slice(before.indexOf(END) + END.length);
fs.writeFileSync(idxPath, head + indexBlock() + tail, "utf8");

/* ---------- зеркало в dist/ ----------
 * Netlify публикуется через `--dir=dist`, поэтому в dist должен лежать ровно
 * то же, что в корне. Раньше index.html копировался руками, и про airlines/
 * просто забыли бы — зеркало делает это одним шагом вместе со сборкой. */
const dist = path.join(root, "dist");
fs.mkdirSync(path.join(dist, "airlines"), { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(dist, "index.html"));
fs.copyFileSync(path.join(root, "sitemap.xml"), path.join(dist, "sitemap.xml"));
for (const a of AIRLINES) {
  fs.copyFileSync(path.join(outDir, slugOf(a) + ".html"),
    path.join(dist, "airlines", slugOf(a) + ".html"));
}
/* старый .netlify/netlify.toml внутри dist указывал publish на абсолютный путь
 * корня проекта — на другой машине он бы сломал деплой. */
const stale = path.join(dist, ".netlify", "netlify.toml");
if (fs.existsSync(stale)) fs.unlinkSync(stale);

console.log("готово: " + written + " страниц + sitemap.xml + индекс в index.html + зеркало в dist/, "
  + "авиакомпаний в AIRLINES: " + AIRLINES.length);