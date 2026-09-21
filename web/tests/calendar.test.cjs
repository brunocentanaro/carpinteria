const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const route = compile('../src/app/api/calendar/route.ts');
async function check({ auth, brand = 'casa', method = 'GET', body, expected }) {
  const exports = {};
  const calls = [];
  vm.runInNewContext(route, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } };
    if (name === '@/lib/auth') return { AUTH_COOKIE: 'test', readSessionToken: () => auth };
    if (name === '@/lib/brand-environments') return { isBrandEnvironmentId: (id) => ['casa', 'pirone'].includes(id) };
    if (name === '@/lib/python') return { callPython: async (payload) => { calls.push(payload); return {}; } };
    throw Error(name);
  } });
  const result = await exports[method]({ method, cookies: { get: () => ({ value: 'test' }) }, nextUrl: new URL(`http://localhost/api/calendar?brandId=${brand}&month=2026-09`), json: async () => body });
  assert.equal(result.status, expected);
  assert.equal(calls.length, expected === 200 ? 1 : 0);
  if (calls.length) { assert.equal(calls[0].brand_id, brand); assert.equal(calls[0].actor, auth.user); }
}
(async () => {
  const auth = { user: 'juan', brandId: 'casa', area: 'administracion' };
  await check({ auth: null, expected: 401 });
  await check({ auth, brand: 'pirone', expected: 403 });
  await check({ auth, brand: 'other', expected: 400 });
  await check({ auth, expected: 200 });
  await check({ auth: { ...auth, allAccess: true }, brand: 'pirone', expected: 200 });
  await check({ auth, method: 'POST', body: { employee_id: 'daniel', title: 'Tarea', date: '2026-09-22' }, expected: 200 });
  await check({ auth, method: 'PATCH', body: { status: 'completed' }, expected: 400 });
  await check({ auth, method: 'PATCH', body: { id: 'one', status: 'completed' }, expected: 200 });
  const exports = {};
  vm.runInNewContext(compile('../src/features/calendar/api.ts'), { exports, require });
  const valid = { employee_id: 'daniel', title: 'Preparar pedido', date: '2026-09-22', start_time: '', end_time: '', notes: '', status: 'pending' };
  assert.ok(exports.taskValuesSchema.safeParse(valid).success);
  assert.ok(!exports.taskValuesSchema.safeParse({ ...valid, date: '2026-02-29' }).success);
  assert.ok(!exports.taskValuesSchema.safeParse({ ...valid, start_time: '10:00', end_time: '09:00' }).success);
  assert.ok(exports.calendarSchema.safeParse({ employees: [{ id: 'daniel', name: 'Daniel' }], tasks: [{ ...valid, id: 'one', brand_id: 'casa' }] }).success);
  console.log('Calendar: 8 API authorization/input checks and 4 form/schema checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
