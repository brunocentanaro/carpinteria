const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/compras-estatales.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
vm.runInNewContext(compiled, { exports: moduleExports, require, fetch, URL, console });

const html = `
  <h3>
    <a href="/consultas/detalle/mostrar-llamado/1/id/1383536">
      Licitaci&oacute;n Abreviada 35&sol;2026
      <span class="sr-only">Universidad de la Rep&uacute;blica | Rectorado</span>
    </a>
  </h3>
  <p class="buy-object">Adquisici&oacute;n de mobiliario</p>
  <span>Recepci&oacute;n de ofertas hasta:</span>
  &nbsp;<strong>16&sol;11&sol;2026 11:00hs</strong>
  <span class="text-muted">Publicado:&nbsp;04&sol;11&sol;2026 16:45hs&nbsp;|&nbsp;&Uacute;ltima Modificaci&oacute;n: 04&sol;11&sol;2026</span>
`;

const calls = moduleExports.parseCalls(html, "Mobiliario de madera", "wood");
assert.equal(calls.length, 1);
assert.equal(calls[0].id, "1383536");
assert.equal(calls[0].title, "Licitación Abreviada 35/2026");
assert.equal(calls[0].description, "Adquisición de mobiliario");
assert.equal(calls[0].deadline, "16/11/2026 11:00hs");
console.log("Compras Estatales: el parser acepta el HTML actual de ARCE");
