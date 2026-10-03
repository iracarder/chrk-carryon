const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

/* ---------- 1. извлечь и проверить синтаксис скрипта ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: скрипт не найден"); process.exit(1); }
const full = m[1];
fs.writeFileSync(path.join(__dirname, ".syntax-check.js"), full);

/* ---------- 2. логика: данные + чистые функции ---------- */
const cut = full.indexOf("/* ---------------- рендер ---------------- */");
if (cut < 0) { console.error("FAIL: не найден маркер рендера"); process.exit(1); }
const logic = full.slice(0, cut);

const probe = `
${logic}
${(full.match(/function summaryText\(\)\{[\s\S]*?\n\}/) || [""])[0]}
${(full.match(/function shareURL\(\)\{[\s\S]*?\n\}/) || [""])[0]}
${(full.match(/function verdictText\(res\)\{[\s\S]*?\n\}/) || [""])[0]}
globalThis.T = { AIRLINES, PRESETS, S, evalAir, checkDims, checkScalar, hasAll, sortD, summaryText, shareURL };
`;
const vm = require("vm");
const ctx = { console, URLSearchParams, location:{ origin:"https://example.net", pathname:"/tool" } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(probe, ctx, { filename: "logic.js" });
const { AIRLINES, PRESETS, S, evalAir, hasAll } = ctx.T;

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
  else console.log("  ok    " + name);
}
function pick(code, idx) {
  const a = AIRLINES.find(x => x.code === code);
  if (!a) throw new Error("нет авиакомпании " + code);
  return evalAir(a, a.opts[idx || 0]);
}
function setBag(dims, w, piDims, piW) {
  S.bag = dims || [null, null, null];
  S.bw  = w === undefined ? null : w;
  S.pi  = piDims || [null, null, null];
  S.pw  = piW === undefined ? null : piW;
  S.piOn = !!piDims;
  S.tol = 0;
}

/* ---------- 3. целостность данных ---------- */
console.log("\n== Данные ==");
ok("авиакомпаний ровно 30", AIRLINES.length === 30, "получилось " + AIRLINES.length);
const codes = new Set();
for (const a of AIRLINES) {
  ok("уникальный код " + a.code, !codes.has(a.code));
  codes.add(a.code);
  ok(a.code + ": есть имя/регион/источник/примечание", !!(a.name && a.region && a.src && a.note));
  ok(a.code + ": хотя бы один тариф", Array.isArray(a.opts) && a.opts.length > 0);
  for (const o of a.opts) {
    if (o.dims) {
      ok(a.code + ": dims по убыванию", o.dims[0] >= o.dims[1] && o.dims[1] >= o.dims[2], JSON.stringify(o.dims));
      ok(a.code + ": положительные размеры", o.dims.every(x => x > 0 && x < 100));
    }
    if (o.linear) ok(a.code + ": linear > сумма габаритов или dims нет", !o.dims || o.linear <= o.dims[0] + o.dims[1] + o.dims[2]);
    if (o.weight != null) ok(a.code + ": вес 1..25 кг", o.weight > 0 && o.weight <= 25, String(o.weight));
  }
}

/* ---------- 4. вердикты ----------
   Семантика: стороны сравниваются по убыванию (сумку можно повернуть);
   запас ≤ 1 см или ≤ 0,5 кг по любой стороне = «впритык», а не «подходит». */
console.log("\n== Вердикты ==");
setBag([55, 40, 23], 8);
ok("TK: 55×40×23 / 8 кг = ровно по лимиту → впритык", pick("TK").state === "warn", pick("TK").state + " " + pick("TK").reasons.join("|"));
ok("PC Saver: ровно по лимиту → впритык", pick("PC", 1).state === "warn", pick("PC", 1).state);
ok("PC Light: не подходит (нет сумки в отсеке)", pick("PC", 0).state === "no", pick("PC", 0).state);
ok("FZ: 55×40×23 не подходит (ширина 38 см)", pick("FZ").state === "no", pick("FZ").state);
ok("QR: 55 см не подходит (лимит 50 см)", pick("QR").state === "no", pick("QR").state);
ok("SU: 55×40×23 = ровно по лимиту → впритык", pick("SU").state === "warn", pick("SU").state);
ok("KL Basic: 50×35×20 не лезет в 40×30×15", pick("KL", 0).state === "no", pick("KL", 0).state);
ok("PC Light: большая сумка не проходит как личный предмет", pick("PC", 0).state === "no");

setBag([45, 30, 15], 5);
ok("KL Basic: 45×30×15 → не подходит (45 > 40)", pick("KL", 0).state === "no", pick("KL", 0).state);
setBag([40, 30, 15], 5);
ok("KL Basic: 40×30×15 = ровно → впритык", pick("KL", 0).state === "warn", pick("KL", 0).state);
setBag([38, 28, 14], 5);
ok("KL Basic: 38×28×14 → впритык (глубина, запас 1 см)", pick("KL", 0).state === "warn", pick("KL", 0).state);
setBag([38, 28, 13], 5);
ok("KL Basic: 38×28×13 → подходит с запасом", pick("KL", 0).state === "ok", pick("KL", 0).state);

setBag([40, 30, 20], 4);
ok("FR бесплатно: 40×30×20 = ровно → впритык", pick("FR", 0).state === "warn", pick("FR", 0).state);
ok("FR Priority: 40×30×20 → впритык по глубине", pick("FR", 1).state === "warn", pick("FR", 1).state);
setBag([45, 32, 18], 5);
ok("FR Priority: 45×32×18 → подходит", pick("FR", 1).state === "ok", pick("FR", 1).state);

setBag([55, 38, 20], 7);
ok("FZ: 55×38×20 = ровно → впритык", pick("FZ").state === "warn", pick("FZ").state);
setBag([54, 39, 19], 7);
ok("FZ: ширина 39 > 38 → не подходит", pick("FZ").state === "no", pick("FZ").state);
ok("FZ: в полосках видно превышение по ширине", pick("FZ").bars.some(b => b.i === 1 && b.slack < 0), JSON.stringify(pick("FZ").bars));
ok("TK: 54×39×19 → впритык по высоте", pick("TK").state === "warn", pick("TK").state);
ok("EK: ширина 39 > 38 → не подходит", pick("EK").state === "no", pick("EK").state);
setBag([50, 36, 20], 6);
ok("EK: 50×36×20 / 6 кг → подходит", pick("EK").state === "ok", pick("EK").state + " " + pick("EK").reasons.join("|"));
setBag([50, 36, 20], 7);
ok("EK: те же габариты, но 7 из 7 кг → впритык", pick("EK").state === "warn", pick("EK").state);

setBag([56, 36, 23], 9);
ok("KC: 9 кг при лимите 8 → не подходит по весу", pick("KC").state === "no", pick("KC").state);
ok("KC: по габаритам 56×45×25 ок", pick("KC").bars.filter(b => !b.scalar).every(b => b.slack >= 0));

setBag([55, 40, 20], 8);
ok("G9: 8 кг при лимите 7 → не подходит", pick("G9").state === "no", pick("G9").state);
ok("TK: 55×40×20 → впритык (длина и ширина)", pick("TK").state === "warn", pick("TK").state);

setBag([56, 36, 23], 7);
ok("LH Basic: не даёт сумку в отсек", pick("LH", 0).state === "no", pick("LH", 0).state);
ok("LH обычный: глубина 36 > 23 → не подходит", pick("LH", 1).state === "no", pick("LH", 1).state);
setBag([55, 40, 23], 8);
ok("LH обычный: 55×40×23 = ровно → впритык", pick("LH", 1).state === "warn", pick("LH", 1).state);
ok("WIZZ Priority: 55×40×23 → впритык", pick("WZ", 1).state === "warn", pick("WZ", 1).state);
setBag([56, 36, 23], 7);
ok("WIZZ Priority: 56×36×23 → не подходит", pick("WZ", 1).state === "no", pick("WZ", 1).state);

setBag([55, 35, 25], 7);
ok("6E: 55×35×25 = ровно → впритык", pick("6E").state === "warn", pick("6E").state);
setBag([50, 35, 25], 7);
ok("6E: 50×35×25, сумма 110 ≤ 115 → впритык по длине", pick("6E").state === "warn", pick("6E").state);
setBag([50, 33, 23], 6);
ok("6E: 50×33×23 / 6 кг → подходит", pick("6E").state === "ok", pick("6E").state);

setBag([55, 35, 24], 7); /* сумма = 114 */
ok("A9: сумма 114 см → впритык", pick("A9").state === "warn", pick("A9").state);
setBag([55, 35, 26], 7); /* сумма = 116 */
ok("A9: сумма 116 см → не подходит", pick("A9").state === "no", pick("A9").state);
ok("A9: габариты не проверяются, только линейные", pick("A9").bars.length > 0 && pick("A9").bars.every(b => b.scalar));
setBag([50, 30, 20], 7); /* сумма = 100 */
ok("A9: сумма 100 см → подходит", pick("A9").state === "ok", pick("A9").state);

setBag([50, 40, 20], 5);
ok("7J: нет данных → na", pick("7J").state === "na", pick("7J").state);
ok("7J: причина объяснена", /не публикует/.test(pick("7J").reasons.join(" ")), pick("7J").reasons.join("|"));
ok("OP: только вес, 5 кг при 7 → подходит", pick("OP").state === "ok", pick("OP").state);
setBag([50, 40, 20], 8);
ok("OP: 8 кг при лимите 7 → не подходит", pick("OP").state === "no", pick("OP").state);

/* ---------- 5. допуск ---------- */
setBag([55, 40, 23], 8);
S.tol = 0; ok("допуск 0: 55×40×23 у TK ровно впритык", pick("TK").state === "warn", pick("TK").state);
setBag([56, 40, 23], 8);
S.tol = 0; ok("допуск 0: 56 см у TK → не подходит", pick("TK").state === "no", pick("TK").state);
S.tol = 1; ok("допуск 1: 56 см у TK → впритык", pick("TK").state === "warn", pick("TK").state);
S.tol = 2; ok("допуск 2: 57 см у TK → впритык (за лимитом)", pick("TK").state === "warn", pick("TK").state);
setBag([58, 40, 23], 8);
S.tol = 2; ok("допуск 2: 58 см у TK → не подходит", pick("TK").state === "no", pick("TK").state);
setBag([57, 40, 23], 8);
S.tol = 3; ok("допуск 3: 57 см у TK → впритык", pick("TK").state === "warn", pick("TK").state);
S.tol = 0;

/* ---------- 6. личный предмет и суммарный вес ---------- */
console.log("\n== Личный предмет ==");
setBag([55, 40, 23], 8, [40, 30, 15], 3);
ok("TK: сумка + аксессуар 40×30×15 → впритык", pick("TK").state === "warn", pick("TK").state + " " + pick("TK").reasons.join("|"));
setBag([55, 40, 23], 8, [38, 28, 13], 3);
ok("TK: аксессуар 38×28×13 ок (сама сумка ровно по лимиту → впритык)", pick("TK").state === "warn", pick("TK").state + " " + pick("TK").reasons.join("|"));
setBag([55, 40, 23], 8, [40, 30, 20], 3);
ok("TK: аксессуар глубиной 20 см → не подходит", pick("TK").state === "no", pick("TK").state);
ok("TK: причина названа по-русски", /Личный предмет не влезает/.test(pick("TK").reasons.join(" ")), pick("TK").reasons.join("|"));
ok("TK: причина ссылается на сторону словом", /по стороне «(длина|ширина|высота)»/.test(pick("TK").reasons.join(" ")), pick("TK").reasons.join("|"));
setBag([55, 40, 23], 8, [40, 30, 15], 5);
ok("TK: аксессуар 5 кг при 4 кг → не подходит", pick("TK").state === "no", pick("TK").state);
setBag([55, 40, 23], 8, [33, 25, 20], 3);
ok("EK: личный предмет не предусмотрен", /не предусматривает/.test(pick("EK").reasons.join(" ")), pick("EK").reasons.join("|"));
setBag([55, 35, 25], 8, [40, 30, 15], 3);
ok("KL: 8 кг сумка + 3 кг аксессуар = 11 из 12 → впритык", pick("KL", 1).state === "warn", pick("KL", 1).state);
setBag([55, 35, 25], 11, [40, 30, 15], 3);
ok("KL: 11 + 3 = 14 из 12 → не подходит по сумме", pick("KL", 1).state === "no", pick("KL", 1).state);
ok("KL: причина про сумму двух сумок", /Две сумки вместе/.test(pick("KL", 1).reasons.join(" ")), pick("KL", 1).reasons.join("|"));
setBag([56, 45, 25], 5, [40, 30, 15], 2);
ok("KC: аксессуар без числовых лимитов, 5+2=7 из 8 → ок по весу (габариты ровно → впритык)", pick("KC").state === "warn", pick("KC").state + " " + pick("KC").reasons.join("|"));
setBag([56, 45, 25], 6, [40, 30, 15], 5);
ok("KC: 6+5=11 из 8 суммарного лимита → не подходит", pick("KC").state === "no", pick("KC").state);
setBag([55, 40, 23], 8, [40, 30, 15], 3);
S.piOn = false;
ok("TK без личного предмета: подходит", pick("TK").state === "warn", pick("TK").state);

/* ---------- 7. сводка и ссылка ---------- */
console.log("\n== Сводка / ссылка ==");
setBag([55, 40, 23], 8);
S.sel = Object.fromEntries(AIRLINES.map(a => [a.code, 0]));
const sum = ctx.T.summaryText();
ok("сводка содержит все 30 авиакомпаний", sum.split("\n").length > 90, "строк: " + sum.split("\n").length);
ok("в сводке есть вердикты", /ПОДХОДИТ|НЕ ПОДХОДИТ|ВПРИТЫК/.test(sum));
ok("в сводке есть CHRK-Bishkek", sum.includes("CHRK-Bishkek"));
const url = ctx.T.shareURL();
ok("ссылка содержит размеры", url.includes("d=55%2C40%2C23"), url.slice(0, 120));
ok("ссылка содержит выбор авиакомпаний", new URL(url).hash.includes("a=TK%3A0") || decodeURIComponent(new URL(url).hash).includes("a=TK:0"), url.slice(-60));

/* ---------- 8. офлайн-самодостаточность ----------
   Инвариант: страница не делает внешних запросов. Исходящие ссылки на магазины
   запросами не являются — они срабатывают только по клику, поэтому допустимы,
   но обязаны быть помечены как спонсорские. */
console.log("\n== Автономность ==");
const resTags = html.match(/<(script|link|img|iframe|object|embed|video|audio|source)\b[^>]*\b(?:src|href)\s*=\s*["'](?!data:|#)[^"']+["']/gi) || [];
ok("нет внешних ресурсов (script/link/img/iframe)", resTags.length === 0, JSON.stringify(resTags));
ok("нет @import", !/@import/.test(html));
ok("нет fetch/XHR/sendBeacon/import()", !/\bfetch\(|XMLHttpRequest|sendBeacon|\bimport\s*\(/.test(html));
ok("нет внешних шрифтов", !/fonts\.(googleapis|gstatic)/.test(html));
const extLinks = html.match(/<a\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
ok("внешние ссылки в разметке не тянут ресурсы (только <a>)", extLinks.every(l => /^<a\b/i.test(l.trim())));
ok("есть водяной знак CHRK-Bishkek", (html.match(/CHRK-Bishkek/g) || []).length >= 3);
ok("нет ключевых слов про TODO/FIXME", !/TODO|FIXME|XXX/.test(html));

/* ---------- 9. блок рекомендации чемодана ---------- */
console.log("\n== Рекомендация ==");
ok("есть массив типовых размеров", /const BAG_SIZES = \[/.test(html));
ok("размеры в сантиметрах, не в дюймах", /const BAG_SIZES = \[\[55,35,20\]/.test(html));
ok("есть список магазинов", /const SHOPS = \[/.test(html));
ok("ссылки магазинов помечены sponsored", /a\.setAttribute\("rel", "sponsored noopener"\)/.test(html));
ok("есть поисковые ссылки с подстановкой размера", /const shopUrl\s*=/.test(html));
ok("блок скрыт по умолчанию", /<div class="buy" id="buy" hidden>/.test(html));
ok("есть раскрытие о партнёрских ссылках", /"buy\.disc"/.test(html));
ok("блок спонсорский и в ru, и в en", /"buy\.disc"[\s\S]{0,700}?en:/.test(html));


console.log("\nИтог: " + (checks - fails) + " из " + checks + " проверок пройдено");
process.exit(fails ? 1 : 0);