/* Тесты двуязычности: словарь, статическая разметка, данные авиакомпаний,
   переключение RU/EN, сохранение языка и главное — в английском режиме
   на странице не остаётся ни одной русской буквы. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { buildContext } = require("./.dom-shim.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* константы объявлены через const, наружу не видны — отдаём их наружу пробником */
const probe = script + `
globalThis.__x = { S, t, I18N, AIRLINES, PRESETS, REGIONS, setLang, applyI18n, summaryText, shareURL, nameOf, noteOf, srcOf, optLabel };
`;
function run(hash = "") {
  const ctx = buildContext(html);
  ctx.location.hash = hash;
  vm.createContext(ctx);
  vm.runInContext(probe, ctx, { filename: "index.html" });
  return ctx;
}
const CYR = /[\u0400-\u04FF]/;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};
const section = s => console.log("== " + s + " ==");

/* весь текст документа, включая скрытые узлы */
function allText(ctx) {
  const out = [];
  const walk = n => {
    if (n.textContent && !n.childNodes.length) out.push(n.textContent);
    for (const c of n.childNodes || []) walk(c);
  };
  walk(ctx.document.documentElement);
  return out.join("\n");
}
const strip = s => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const base = run();
const { I18N, AIRLINES, PRESETS, REGIONS } = base.__x;

section("1. Словарь переводов");
const keys = Object.keys(I18N);
ok("словарь не пуст", keys.length > 80, String(keys.length));
ok("у каждого ключа есть ru и en", keys.every(k => I18N[k].ru && I18N[k].en),
  keys.filter(k => !I18N[k].ru || !I18N[k].en).join(", "));
ok("в en нет кириллицы", keys.every(k => !CYR.test(I18N[k].en)),
  keys.filter(k => CYR.test(I18N[k].en)).join(", "));
ok("ru и en не совпадают", keys.every(k => I18N[k].ru !== I18N[k].en),
  keys.filter(k => I18N[k].ru === I18N[k].en).join(", "));
ok("плейсхолдеры {v} совпадают в ru и en",
  keys.every(k => (I18N[k].ru.match(/\{[a-z]+\}/g) || []).sort().join() === (I18N[k].en.match(/\{[a-z]+\}/g) || []).sort().join()),
  keys.filter(k => (I18N[k].ru.match(/\{[a-z]+\}/g) || []).sort().join() !== (I18N[k].en.match(/\{[a-z]+\}/g) || []).sort().join()).join(", "));

const used = [...new Set([...script.matchAll(/\bt\(\s*"([^"]+)"/g)].map(m => m[1]))];
ok("все используемые ключи есть в словаре", used.every(k => I18N[k]),
  used.filter(k => !I18N[k]).join(", "));
ok("t() никогда не падает на неизвестном ключе", base.__x.t("нет.такого.ключа") === "Nothing found." || base.__x.t("нет.такого.ключа") === I18N.none.ru);

section("2. Статическая разметка");
const i18nNodes = base.document.querySelectorAll("[data-i18n]");
ok("в разметке есть узлы data-i18n", i18nNodes.length > 30, String(i18nNodes.length));
ok("все ключи разметки есть в словаре",
  i18nNodes.every(n => I18N[n.getAttribute("data-i18n")]),
  i18nNodes.filter(n => !I18N[n.getAttribute("data-i18n")]).map(n => n.getAttribute("data-i18n")).join(", "));
ok("русский текст в разметке совпадает со словарём",
  i18nNodes.every(n => strip(n.textContent) === strip(I18N[n.getAttribute("data-i18n")].ru)),
  i18nNodes.filter(n => strip(n.textContent) !== strip(I18N[n.getAttribute("data-i18n")].ru))
    .map(n => n.getAttribute("data-i18n") + ": в HTML «" + strip(n.textContent) + "»").join(" | "));
const attrNodes = base.document.querySelectorAll("[data-i18n-attr]");
ok("есть узлы с переводимыми атрибутами", attrNodes.length >= 3, String(attrNodes.length));
ok("aria-label и placeholder переведены в разметке",
  base.__byId.get("lang").getAttribute("aria-label") === "Язык" &&
  base.__byId.get("q").getAttribute("placeholder") === "Поиск: TK, Turkish, Pegasus…",
  base.__byId.get("lang").getAttribute("aria-label") + " / " + base.__byId.get("q").getAttribute("placeholder"));

section("3. Данные авиакомпаний переведены");
const cyrName = AIRLINES.filter(a => CYR.test(a.name));
ok("русские названия авиакомпаний имеют nameEn", cyrName.every(a => a.nameEn && !CYR.test(a.nameEn)),
  cyrName.filter(a => !a.nameEn).map(a => a.code).join(", "));
ok("у всех 30 авиакомпаний есть noteEn", AIRLINES.every(a => a.noteEn && !CYR.test(a.noteEn)),
  AIRLINES.filter(a => !a.noteEn || CYR.test(a.noteEn)).map(a => a.code).join(", "));
const opts = AIRLINES.flatMap(a => a.opts.map(o => ({ a, o })));
ok("у всех тарифов есть labelEn", opts.every(x => x.o.labelEn),
  opts.filter(x => !x.o.labelEn).map(x => x.a.code).join(", "));
ok("в labelEn нет кириллицы", opts.every(x => !CYR.test(x.o.labelEn || "")),
  opts.filter(x => CYR.test(x.o.labelEn || "")).map(x => x.a.code + ":" + x.o.labelEn).join(", "));
ok("у всех пресетов есть labelEn без кириллицы",
  PRESETS.every(p => p.labelEn && !CYR.test(p.labelEn)));
const cyrSrc = AIRLINES.filter(a => CYR.test(a.src));
ok("русские подписи источников имеют srcEn", cyrSrc.every(a => a.srcEn && !CYR.test(a.srcEn)),
  cyrSrc.filter(a => !a.srcEn).map(a => a.code).join(", "));
ok("регионы переведены", Object.keys(REGIONS).every(r => REGIONS[r].en && !CYR.test(REGIONS[r].en)));

section("4. Режим по умолчанию — русский");
ok("S.lang === ru", base.__x.S.lang === "ru", base.__x.S.lang);
ok("documentElement.lang === ru", base.document.documentElement.lang === "ru");
ok("заголовок страницы русский", /Поместится/.test(base.document.title), base.document.title);
ok("на странице есть русский текст", CYR.test(allText(base)));
ok("вердикты русские", /подходит|впритык|не подходит/.test(allText(base)));
ok("поиск находит «Аэрофлот» по-русски",
  base.__x.AIRLINES.some(a => (a.name + " " + (a.nameEn || "")).toLowerCase().includes("аэрофлот")));

section("5. Переключение на английский");
const en = run();
en.__x.setLang("en");
const enText = allText(en);
ok("S.lang === en", en.__x.S.lang === "en");
ok("documentElement.lang === en", en.document.documentElement.lang === "en");
ok("заголовок страницы английский", /Will it fit/.test(en.document.title), en.document.title);
ok("meta description английская", /Check your bag/.test(
  en.document.querySelector('meta[name="description"]').getAttribute("content")));
const cyrLeft = enText.split("\n").filter(l => CYR.test(l)).slice(0, 8);
ok("в английском режиме нет кириллицы", !CYR.test(enText), cyrLeft.join(" ||| "));
ok("переведены все 30 примечаний", AIRLINES.every(a => !CYR.test(en.__x.noteOf(a))));
ok("английские имена авиакомпаний", !CYR.test(en.__x.nameOf(AIRLINES.find(a => a.code === "SU"))));
ok("тарифы переведены", /underseat|bin|bag/i.test(enText));
ok("счётчик вердиктов английский", /fits|tight fit|does not fit/.test(enText));
ok("список регионов английский", /Middle East|CIS|Europe|Asia/.test($region(en)));
ok("кнопка юнитов переведена", en.__byId.get("u-in").textContent === "inches");
ok("подписи сайзера английские", /sizer|dimensions/.test(enText));

function $region(c) {
  return c.__byId.get("region").findAll("option").map(o => o.textContent).join("|");
}

section("6. Клик по переключателю");
const click = run();
click.__byId.get("l-en").fire("click", { target: click.__byId.get("l-en") });
ok("клик по EN включает английский", click.__x.S.lang === "en" && click.document.documentElement.lang === "en");
ok("после клика на странице нет кириллицы", !CYR.test(allText(click)));
click.__byId.get("l-ru").fire("click", { target: click.__byId.get("l-ru") });
ok("клик по RU возвращает русский", click.__x.S.lang === "ru" && CYR.test(allText(click)));
ok("состояние сохранилось в localStorage", JSON.parse(click.localStorage.getItem("chrk-carryon-v1")).lang === "ru");

section("7. Переключение не меняет расчёты");
const ru2 = run();
ru2.__byId.get("b1").value = "55"; ru2.__byId.get("b2").value = "40"; ru2.__byId.get("b3").value = "23";
ru2.__byId.get("bw").value = "9";
ru2.__byId.get("b1").fire("input");
ru2.__x.setLang("ru");
const en2 = run("#d=55%2C40%2C23&w=9&l=en");
const pills = c => c.__byId.get("list").findAll(".pill").map(p => p.textContent.replace(/<[^>]*>/g, "").trim());
const MAP = {
  "подходит":"OK", "fits":"OK", "впритык":"TIGHT", "tight fit":"TIGHT",
  "не подходит":"NO", "does not fit":"NO", "нет данных":"NA", "no data":"NA",
  "сумка не входит":"BIN", "no cabin bag":"BIN", "не выбрана":"OFF", "not selected":"OFF"
};
const norm = a => a.map(x => MAP[x] || x);
ok("вердикты совпадают в RU и EN", JSON.stringify(norm(pills(ru2))) === JSON.stringify(norm(pills(en2))),
  JSON.stringify(norm(pills(ru2)).slice(0, 6)) + " vs " + JSON.stringify(norm(pills(en2)).slice(0, 6)));
ok("размеры сохранились при смене языка", en2.__x.S.bag.join(",") === "55,40,23", en2.__x.S.bag.join(","));

section("8. Сохранение и ссылки");
const en3 = run();
en3.__x.setLang("en");
ok("язык сохранён в localStorage", JSON.parse(en3.localStorage.getItem("chrk-carryon-v1")).lang === "en");
ok("в ссылке есть l=en", en3.__x.shareURL().includes("l=en"));
const ru3 = run();
ru3.__x.setLang("ru");
ok("в ссылке есть l=ru", ru3.__x.shareURL().includes("l=ru"));
const fromLink = run("#d=50%2C35%2C20&l=en");
ok("язык восстановлен из ссылки", fromLink.__x.S.lang === "en");
ok("страница сразу открылась по-английски", fromLink.document.documentElement.lang === "en" && !CYR.test(allText(fromLink)));
ok("старая ссылка без l открывается по-русски", run("#d=55%2C40%2C23").__x.S.lang === "ru");
ok("смена языка не ломает сводку", !CYR.test(en3.__x.summaryText()));
ok("в английской сводке есть все авиакомпании",
  AIRLINES.every(a => en3.__x.summaryText().includes(a.code)) || en3.__x.S.sel && Object.keys(en3.__x.S.sel).length === 0);

console.log("");
console.log(fail ? "Итог: " + pass + " из " + (pass + fail) + " проверок, ПРОВАЛЕНО " + fail
                  : "Итог: " + pass + " из " + pass + " проверок пройдено");
process.exit(fail ? 1 : 0);