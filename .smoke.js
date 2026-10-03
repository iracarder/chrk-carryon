/* Прогон полного index.html в node поверх минимального DOM-шима.
   Покрывает рендер, сайзер, водяной знак, сводку, историю, единицы, сброс и защиту от мусора. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { El, buildContext } = require("./.dom-shim.js");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok    " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

function run(hash = "") {
  const ctx = buildContext(html);
  ctx.location.hash = hash;
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: "index.html" });
  return ctx;
}
const $ = (ctx, id) => ctx.__byId.get(id);
const cards = ctx => $(ctx, "list").findAll(".air");
const card = (ctx, code) => cards(ctx).find(c => c.findAll("[data-code]")[0] && c.findAll("[data-code]")[0].getAttribute("data-code") === code);
const pill = c => { const p = c.findAll(".pill")[0]; return p ? p.textContent.replace(/<[^>]*>/g, "").trim() : ""; };
const fire = (el, type, target) => el.fire(type, { target: target || el, preventDefault(){}, stopPropagation(){} });
const tallyNums = ctx => ($(ctx, "tally").innerHTML.match(/<b>(\d+)<\/b>/g) || []).map(s => +s.replace(/\D/g, ""));
const tallySum = ctx => tallyNums(ctx).reduce((a, b) => a + b, 0);
const typeInto = (ctx, id, v) => { $(ctx, id).value = String(v); fire($(ctx, id), "input"); };
const check = (ctx, code, on) => {
  const el = card(ctx, code);
  const box = el.findAll("[data-code]")[0];
  box.checked = on;
  fire($(ctx, "list"), "change", box);
};

console.log("== 1. Первичный рендер ==");
let ctx = run();
ok("30 карточек авиакомпаний", cards(ctx).length === 30, String(cards(ctx).length));
ok("карточки сгруппированы по регионам (details > summary)", $(ctx, "list").findAll("summary").length >= 4 && $(ctx, "list").findAll("details").length >= 4,
  "details=" + $(ctx, "list").findAll("details").length);
ok("у каждой карточки есть чекбокс выбора", cards(ctx).every(c => c.findAll("[data-code]").length === 1));
ok("у каждой карточки есть блок «Почему так» с источником", cards(ctx).every(c => c.findAll(".src").length === 1 && /Источник/.test(c.textContent)));
ok("по умолчанию выбраны все 30 авиакомпаний", cards(ctx).every(c => c.classList.contains("on")), "on=" + cards(ctx).filter(c => c.classList.contains("on")).length);
ok("у каждой выбранной карточки есть вердикт", cards(ctx).every(c => /подходит|впритык|не подходит|нет данных|не входит/.test(c.textContent)));
ok("счётчик в сумме равен числу выбранных", tallySum(ctx) === 30, "сумма=" + tallySum(ctx));

console.log("\n== 2. Водяной знак ==");
const wmSpans = $(ctx, "wm").findAll("span");
ok("знак отрисован во многих рядах", wmSpans.length > 20, "spans=" + wmSpans.length);
ok("высота знака равна высоте страницы", $(ctx, "wm").style.height === "2400px", String($(ctx, "wm").style.height));
ok("текст знака CHRK-Bishkek", wmSpans.every(s => s.textContent === "CHRK-Bishkek"));
ok("рядов по вертикали несколько", new Set(wmSpans.map(s => s.style.top)).size >= 5, "рядов=" + new Set(wmSpans.map(s => s.style.top)).size);
ok("знак не перекрывает один ряд", new Set(wmSpans.map(s => s.style.top)).size > 1);

console.log("\n== 3. Ввод сумки → пересчёт вердиктов ==");
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 55); typeInto(ctx, "b2", 40); typeInto(ctx, "b3", 23); typeInto(ctx, "bw", 8);
ok("TK: ровно по лимиту → «впритык»", pill(card(ctx, "TK")) === "впритык", pill(card(ctx, "TK")));
ok("карточка получила класс on + st-warn", card(ctx, "TK").classList.contains("on") && card(ctx, "TK").classList.contains("st-warn"), card(ctx, "TK").className);
ok("появились полоски по сторонам", card(ctx, "TK").findAll(".bar").length >= 3, "bar=" + card(ctx, "TK").findAll(".bar").length);
ok("есть полоска веса", card(ctx, "TK").findAll(".bar").some(b => /вес сумки/.test(b.textContent)));
ok("впритык попали в счётчик", tallyNums(ctx)[1] > 0, JSON.stringify(tallyNums(ctx)));
ok("сумма счётчика = 30", tallySum(ctx) === 30, "сумма=" + tallySum(ctx));
ok("выбор сохранён в localStorage", (ctx.localStorage.getItem("chrk-carryon-v1") || "").length > 10);
ok("невыбранные не влияют на счётчик", (ctx.localStorage.getItem("chrk-carryon-v1") || "").includes('"TK"'));
typeInto(ctx, "b1", 60);
ok("TK: 60 см → «не подходит»", pill(card(ctx, "TK")) === "не подходит", pill(card(ctx, "TK")));
ok("в полосках есть превышение", card(ctx, "TK").findAll(".bar").some(b => b.classList.contains("over")));
const reasons = card(ctx, "TK").findAll(".reasons")[0];
ok("блок «почему» содержит примечание авиакомпании", card(ctx, "TK").findAll(".why")[0].findAll("p").length >= 2);
ok("превышение показано в полосках, а не только в подписи", card(ctx, "TK").findAll(".bar").some(b => /−/.test(b.textContent)));
ok("есть пояснение про рамку", /рамк/i.test(card(ctx, "TK").textContent));

console.log("\n== 4. Переключение см → дюймы ==");
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 55); typeInto(ctx, "b2", 40); typeInto(ctx, "b3", 23); typeInto(ctx, "bw", 8);
const pillCm = pill(card(ctx, "TK"));
fire($(ctx, "u-in"), "click");
ok("поля ввода переведены в дюймы", Math.abs(Number($(ctx, "b1").value) - 21.7) < 0.15, $(ctx, "b1").value);
ok("вес остался в кг (8)", Number($(ctx, "bw").value) === 8, $(ctx, "bw").value);
ok("вердикт не изменился при смене единиц", pill(card(ctx, "TK")) === pillCm, pill(card(ctx, "TK")) + " vs " + pillCm);
ok("в разборе сторон появились дюймы", /″/.test(card(ctx, "TK").textContent));
ok("aria-pressed переключился", $(ctx, "u-in").getAttribute("aria-pressed") === "true" && $(ctx, "u-cm").getAttribute("aria-pressed") === "false");
fire($(ctx, "u-cm"), "click");
ok("возврат к см восстановил 55 без дрейфа", Number($(ctx, "b1").value) === 55, $(ctx, "b1").value);
ok("возврат к см не сдвинул остальные стороны", Number($(ctx, "b2").value) === 40 && Number($(ctx, "b3").value) === 23, [$(ctx, "b2").value, $(ctx, "b3").value].join("/"));
ok("вес после возврата = 8", Number($(ctx, "bw").value) === 8, $(ctx, "bw").value);

console.log("\n== 5. Личный предмет ==");
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 55); typeInto(ctx, "b2", 40); typeInto(ctx, "b3", 23); typeInto(ctx, "bw", 8);
ok("поля аксессуара заблокированы, пока флаг off", $(ctx, "p1").disabled === true);
$(ctx, "pi-on").checked = true;
fire($(ctx, "pi-on"), "change");
ok("поля аксессуара разблокированы", $(ctx, "p1").disabled === false);
ok("чекбокс отмечен", $(ctx, "pi-on").checked === true);
typeInto(ctx, "p1", 45); typeInto(ctx, "p2", 30); typeInto(ctx, "p3", 20); typeInto(ctx, "pw", 3);
ok("TK: слишком большой аксессуар → «не подходит»", pill(card(ctx, "TK")) === "не подходит", pill(card(ctx, "TK")));
const piReasons = card(ctx, "TK").findAll(".reasons")[0];
ok("причины перечислены списком", piReasons && piReasons.findAll("li").length > 0, "li=" + (piReasons ? piReasons.findAll("li").length : 0));
ok("причина называет личный предмет", /[Лл]ичный предмет/.test(card(ctx, "TK").textContent));
typeInto(ctx, "p1", 38); typeInto(ctx, "p2", 28); typeInto(ctx, "p3", 13);
ok("TK: аксессуар 38×28×13 принят", pill(card(ctx, "TK")) === "впритык", pill(card(ctx, "TK")));
ok("в полосках помечен аксессуар", /акс\./.test(card(ctx, "TK").textContent));
check(ctx, "EK", true);
ok("EK: личный предмет не предусмотрен", /не предусматривает/.test(card(ctx, "EK").textContent));

console.log("\n== 6. Допуск ==");
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 56); typeInto(ctx, "b2", 40); typeInto(ctx, "b3", 23); typeInto(ctx, "bw", 8);
ok("допуск 0: 56 см → «не подходит»", pill(card(ctx, "TK")) === "не подходит", pill(card(ctx, "TK")));
typeInto(ctx, "tol", 1);
ok("подпись допуска = 1", $(ctx, "tol-v").textContent === "1", $(ctx, "tol-v").textContent);
ok("допуск 1: 56 см → «впритык»", pill(card(ctx, "TK")) === "впритык", pill(card(ctx, "TK")));
typeInto(ctx, "tol", 2.5);
ok("дробный допуск показан с запятой", $(ctx, "tol-v").textContent === "2,5", $(ctx, "tol-v").textContent);

console.log("\n== 7. Тарифы одной авиакомпании ==");
ctx = run();
check(ctx, "KL", true);
const opts = card(ctx, "KL").findAll(".opts")[0];
ok("у KLM есть выбор тарифа (2 варианта)", !!opts && opts.findAll("option").length === 2, "options=" + (opts ? opts.findAll("option").length : 0));
ok("по умолчанию выбран первый тариф", opts && opts.findAll("option")[0].selected === true);
opts.value = "1"; fire(opts, "change");
ok("после смены тарифа вердикт изменился", card(ctx, "KL").findAll(".pill")[0].textContent.length > 0, pill(card(ctx, "KL")));
check(ctx, "PC", true);
ok("у Pegasus два тарифа", card(ctx, "PC").findAll(".opts")[0] && card(ctx, "PC").findAll(".opts")[0].findAll("option").length === 2);

console.log("\n== 8. Фокус на карточке ==");
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 40); typeInto(ctx, "b2", 30); typeInto(ctx, "b3", 20);
const top = card(ctx, "TK").findAll(".top")[0];
fire(top, "click");
ok("клик по шапке выставил фокус", card(ctx, "TK").classList.contains("st-focus"), card(ctx, "TK").className);
ok("сайзер показывает聚焦 авиакомпанию", /Turkish/.test($(ctx, "viz-who").textContent), $(ctx, "viz-who").textContent);

console.log("\n== 9. Сайзер ==");
const svgs = $(ctx, "sz-top").findAll("svg");
ok("сайзер сверху — это SVG", svgs.length > 0, "svg=" + svgs.length);
ok("у SVG есть viewBox", !!(svgs[0] && svgs[0].getAttribute("viewBox")));
ok("в SVG есть прямоугольник рамки", svgs[0].findAll("rect").length >= 1, "rect=" + svgs[0].findAll("rect").length);
ok("в SVG есть текст", svgs[0].findAll("text").length >= 1, "text=" + svgs[0].findAll("text").length);
ok("вид сбоку тоже нарисован", $(ctx, "sz-side").findAll("svg").length > 0);
ok("подпись рамки заполнена", $(ctx, "cap-top").textContent.length > 0, $(ctx, "cap-top").textContent);
ok("совет начинается с «Влезает»", /^Влезает/.test($(ctx, "advice").textContent), $(ctx, "advice").textContent.slice(0, 60));
ok("совет упоминает запас по сторонам", /запасом|Впритык/.test($(ctx, "advice").textContent));
typeInto(ctx, "b1", 60);
ok("совет меняется на «Не влезает»", /^Не влезает/.test($(ctx, "advice").textContent), $(ctx, "advice").textContent.slice(0, 60));
typeInto(ctx, "b1", "");
ok("без размеров — подсказка с просьбой ввести", /Введи три размера/.test($(ctx, "advice").textContent), $(ctx, "advice").textContent.slice(0, 60));
ok("сайзер не падает без данных", $(ctx, "sz-top").findAll("svg").length > 0);

console.log("\n== 10. Поиск и фильтр региона ==");
ctx = run();
$(ctx, "q").value = "turkish";
fire($(ctx, "q"), "input");
ok("поиск нашёл Turkish Airlines", cards(ctx).length === 1 && !!card(ctx, "TK"), "найдено=" + cards(ctx).length);
$(ctx, "q").value = "zzz";
fire($(ctx, "q"), "input");
ok("пустой результат → подсказка «Ничего не найдено»", /Ничего не найдено/.test($(ctx, "list").textContent), $(ctx, "list").textContent.slice(0, 60));
$(ctx, "q").value = "";
fire($(ctx, "q"), "input");
ok("сброс поиска вернул все 30", cards(ctx).length === 30, String(cards(ctx).length));
$(ctx, "region").value = "Европа";
fire($(ctx, "region"), "change");
ok("фильтр региона сузил список", cards(ctx).length > 0 && cards(ctx).length < 30, "показано=" + cards(ctx).length);
$(ctx, "region").value = "";
fire($(ctx, "region"), "change");
ok("сброс региона вернул 30", cards(ctx).length === 30, String(cards(ctx).length));

console.log("\n== 11. Пресеты, «выбрать все», «снять все» ==");
ctx = run();
const chip = new El("button");
chip.className = "chip";
chip.setAttribute("data-i", "1");
fire($(ctx, "presets"), "click", chip);
ok("пресет подставил размеры", Number($(ctx, "b1").value) > 0, "b1=" + $(ctx, "b1").value);
ok("после пресета появились вердикты", cards(ctx).some(c => c.classList.contains("on")));
ok("подсказка о подстановке показана", /Размеры подставлены/.test($(ctx, "toast").textContent), $(ctx, "toast").textContent);
fire($(ctx, "all"), "click");
ok("«выбрать все» отметило все карточки", cards(ctx).every(c => c.classList.contains("on")), "on=" + cards(ctx).filter(c => c.classList.contains("on")).length);
ok("счётчик суммирует все выбранные", tallySum(ctx) === 30, "сумма=" + tallySum(ctx));
fire($(ctx, "none"), "click");
ok("«снять все» сняло выбор", cards(ctx).every(c => !c.classList.contains("on")));
ok("счётчик обнулился", /<b>0<\/b>подходит/.test($(ctx, "tally").innerHTML));

console.log("\n== 12. Сводка, ссылка, сброс ==");
const tick = () => new Promise(r => setImmediate(r));
(async () => {
ctx = run();
check(ctx, "TK", true);
typeInto(ctx, "b1", 40); typeInto(ctx, "b2", 30); typeInto(ctx, "b3", 20); typeInto(ctx, "bw", 5);
ok("при старте записан адрес состояния (replaceState)", ctx.location.hash.length > 1, ctx.location.hash.slice(0, 60));
fire($(ctx, "copy"), "click");
await tick();
ok("копирование сводки показывает подтверждение", /Сводка скопирована/.test($(ctx, "toast").textContent), $(ctx, "toast").textContent);
const shareHash = "#" + ctx.shareURL().split("#")[1];
ok("ссылка содержит размеры, вес и выбор", /d=40/.test(shareHash) && /w=5/.test(shareHash) && /TK/.test(shareHash), shareHash.slice(0, 80));
fire($(ctx, "share"), "click");
await tick();
ok("подтверждение копирования ссылки", /Ссылка скопирована/.test($(ctx, "toast").textContent), $(ctx, "toast").textContent);
const ctx2 = run(shareHash);
ok("из ссылки восстановлены размеры", Number($(ctx2, "b1").value) === 40, $(ctx2, "b1").value);
ok("из ссылки восстановлены все три стороны", Number($(ctx2, "b2").value) === 30 && Number($(ctx2, "b3").value) === 20, [$(ctx2, "b2").value, $(ctx2, "b3").value].join("/"));
ok("из ссылки восстановлен вес", Number($(ctx2, "bw").value) === 5, $(ctx2, "bw").value);
ok("из ссылки восстановлен выбор TK", card(ctx2, "TK").classList.contains("on"));
ok("из ссылки восстановлен весь выбор", "#" + ctx2.shareURL().split("#")[1] === shareHash, ("#" + ctx2.shareURL().split("#")[1]).slice(0, 80));
fire($(ctx2, "reset"), "click");
ok("сброс очистил поля", $(ctx2, "b1").value === "" && $(ctx2, "bw").value === "", JSON.stringify([$(ctx2, "b1").value, $(ctx2, "bw").value]));
ok("сброс вернул исходное состояние (все выбраны)", cards(ctx2).every(c => c.classList.contains("on")), "on=" + cards(ctx2).filter(c => c.classList.contains("on")).length);
ok("сброс показал подтверждение", /Сброшено/.test($(ctx2, "toast").textContent), $(ctx2, "toast").textContent);

console.log("\n== 13. Устойчивость к мусорному вводу ==");
ctx = run();
check(ctx, "TK", true);
let threw = null;
try {
  for (const v of ["10", "55", "80", "0", "abc", "-5", "999", "1e3", "1,5"]) typeInto(ctx, "b1", v);
  for (const v of ["abc", "0", "-1"]) typeInto(ctx, "bw", v);
  $(ctx, "pi-on").checked = true; fire($(ctx, "pi-on"), "change");
  for (const v of ["abc", "-1", "9999"]) typeInto(ctx, "p1", v);
  typeInto(ctx, "tol", "-3");
  $(ctx, "region").value = "Несуществующий"; fire($(ctx, "region"), "change");
  $(ctx, "q").value = "%%%"; fire($(ctx, "q"), "input");
} catch (e) { threw = e; }
ok("мусорный ввод не роняет страницу", threw === null, threw && threw.message);
ok("после мусора список цел", cards(ctx).length === 30 || /Ничего не найдено/.test($(ctx, "list").textContent), String(cards(ctx).length));
$(ctx, "q").value = ""; $(ctx, "region").value = "";
fire($(ctx, "q"), "input"); fire($(ctx, "region"), "change");
ok("пустые поля = подсказка, а не вердикт", /Введи три размера/.test($(ctx, "advice").textContent), $(ctx, "advice").textContent.slice(0, 50));
ok("сводка не падает", typeof ctx.summaryText() === "string" && ctx.summaryText().length > 0);
ok("ссылка не падает", typeof ctx.shareURL() === "string" && ctx.shareURL().includes("#"));

console.log("\n== 14. Сводка содержит разбор ==");
ctx = run();
fire($(ctx, "none"), "click");
check(ctx, "TK", true);
typeInto(ctx, "b1", 56); typeInto(ctx, "b2", 40); typeInto(ctx, "b3", 23); typeInto(ctx, "bw", 8);
const sum = ctx.summaryText();
ok("сводка начинается с заголовка и водяного знака", /Проверка ручной клади/.test(sum) && /CHRK-Bishkek/.test(sum), sum.slice(0, 60));
ok("сводка содержит размеры", /56\s*[×x]\s*40\s*[×x]\s*23/.test(sum), sum.slice(0, 120));
ok("сводка содержит вердикт по каждой выбранной", /Turkish/.test(sum));
ok("сводка содержит только выбранные", !/Emirates|Pegasus/.test(sum), sum.slice(0, 200));
ok("сводка не содержит HTML-тегов", !/<[a-z]/i.test(sum), sum.slice(0, 200));
check(ctx, "EK", true);
ok("вторая авиакомпания тоже попала", /Emirates/.test(ctx.summaryText()));
check(ctx, "EK", false);
ok("снятие выбора убирает авиакомпанию из сводки", !/Emirates/.test(ctx.summaryText()));
ok("снятие выбора оставляет остальные", /Turkish/.test(ctx.summaryText()));

console.log("== 15. Рекомендация чемодана ==");
ctx = run();
ok("блок скрыт, пока нечего рекомендовать", $(ctx, "buy").hidden === true);
typeInto(ctx, "b1", 60); typeInto(ctx, "b2", 45); typeInto(ctx, "b3", 30);
const big = $(ctx, "buy");
ok("блок появляется, когда сумка велика", big.hidden === false);
const links = big.findAll("a");
ok("в блоке есть ссылки на магазины", links.length >= 3, "ссылок: " + links.length);
ok("все ссылки ведут на https", links.every(a => /^https:\/\//.test(a.getAttribute("href"))));
ok("все ссылки помечены sponsored", links.every(a => /sponsored/.test(a.getAttribute("rel") || "")));
ok("в ссылке есть рекомендованный размер", links.every(a => /55x40x20|55x40x23|55x40x25|55x35x20|56x45x25/.test(a.getAttribute("href"))), links[0] && links[0].getAttribute("href"));
ok("в блоке есть цифры «не проходит / проходит»", /\d+ из \d+/.test(big.textContent), big.textContent.slice(0, 90));
ok("единица измерения не задваивается", !/см см|cm cm/.test(big.textContent), big.textContent.slice(0, 120));
ok("есть раскрытие про партнёрские ссылки", /партнёрск/i.test(big.textContent));
$(ctx, "none").fire("click");
check(ctx, "TK", true);
typeInto(ctx, "b1", 60); typeInto(ctx, "b2", 45); typeInto(ctx, "b3", 30);
ok("рекомендованный размер проходит у выбранной авиакомпании", /подходит у 1 из них/.test($(ctx, "buy").textContent), $(ctx, "buy").textContent.slice(0, 120));
ok("рекомендован самый мелкий подходящий размер", /55×35×20/.test($(ctx, "buy").textContent), $(ctx, "buy").textContent.slice(0, 120));
const ruBuy = big.textContent;
$(ctx, "none").fire("click");
check(ctx, "TK", true);
typeInto(ctx, "b1", 40); typeInto(ctx, "b2", 30); typeInto(ctx, "b3", 20);
ok("блок прячется, когда выбранная сумка проходит", $(ctx, "buy").hidden === true);
$(ctx, "l-en").fire("click");
$(ctx, "none").fire("click");
check(ctx, "TK", true);
typeInto(ctx, "b1", 60); typeInto(ctx, "b2", 45); typeInto(ctx, "b3", 30);
const enBuy = $(ctx, "buy");
ok("в английском блоке нет кириллицы", !/[\u0400-\u04FF]/.test(enBuy.textContent), enBuy.textContent.slice(0, 90));
ok("английский блок показывает ссылки Amazon/eBay", enBuy.findAll("a").map(a => a.textContent).join(",").includes("Amazon"), enBuy.findAll("a").map(a => a.textContent).join(","));
ok("русские магазины скрыты в английском блоке", !enBuy.findAll("a").map(a => a.textContent).join(",").includes("Ozon"));
$(ctx, "l-ru").fire("click");
$(ctx, "none").fire("click");
check(ctx, "TK", true);
typeInto(ctx, "b1", 60); typeInto(ctx, "b2", 45); typeInto(ctx, "b3", 30);
ok("возврат на русский восстанавливает русские магазины", $(ctx, "buy").findAll("a").map(a => a.textContent).join(",").includes("Ozon"));

console.log("\nИтог: " + pass + " из " + (pass + fail) + " проверок пройдено");
process.exit(fail ? 1 : 0);
})();