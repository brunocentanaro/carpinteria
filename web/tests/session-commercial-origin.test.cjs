const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/app/api/sessions/[id]/route.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function check({ quoteBrand, area, body, expected }) {
  const calls = [];
  const exports = {};
  const current = { id: "test", user_id: "juan", brand_id: quoteBrand, client_details_confirmed: true, client_name: "Cliente", client_phone: "123", order_summary: "Mesa" };
  vm.runInNewContext(compiled, {
    exports, Date,
    require(name) {
      if (name === "next/server") return { NextResponse: { json: (data, options = {}) => ({ status: options.status || 200, data }) } };
      if (name === "@/lib/auth") return { AUTH_COOKIE: "test", readSessionToken: () => ({ user: "juan", brandId: "pirone", area }) };
      if (name === "@/lib/python") return { callPython: async (payload) => { calls.push(payload); return { session: current }; } };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  const result = await exports.PATCH({ cookies: { get: () => ({ value: "test" }) }, json: async () => body }, { params: Promise.resolve({ id: "test" }) });
  assert.equal(result.status, expected);
  assert.equal(calls.filter((call) => call.action === "session_commercial_status").length, expected === 200 ? 1 : 0);
}
(async () => {
  await check({ quoteBrand: "pirone", area: "administracion", body: { approval_status: "approved" }, expected: 200 });
  await check({ quoteBrand: "pirone", area: "personal", body: { approval_status: "approved" }, expected: 403 });
  await check({ quoteBrand: "casa", area: "administracion", body: { approval_status: "approved" }, expected: 403 });
  await check({ quoteBrand: "pirone", area: "personal", body: { client_sent: true }, expected: 200 });
  await check({ quoteBrand: "casa", area: "personal", body: { client_sent: true }, expected: 403 });
  console.log("5 commercial-origin authorization checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
