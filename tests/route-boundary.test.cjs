const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadApiRoute = require('./route-boundary.cjs');

test('framework route exports PUT and forwards every supported method through the same boundary', async () => {
  const calls = [];
  const response = Response.json({ acknowledged: true }, { status: 201 });
  const route = loadApiRoute((request, path) => { calls.push({ request, path }); return response; });
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
  const path = ['workspaces', 'alpha', 'boardProperties', 'field'];
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(typeof route[method], 'function', `${method} must be reachable through Next`);
    const request = new Request('http://test/api/' + path.join('/'), {
      method, headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ expectedRevision: 0 }),
    });
    assert.equal(await route[method](request, { params: Promise.resolve({ path }) }), response);
    assert.equal(calls.at(-1).request, request, 'auth headers/body must reach the trusted boundary unchanged');
    assert.equal(calls.at(-1).path, path);
  }
  assert.equal(calls.length, 5);
});

test('framework route awaits resolved params before dispatch and never substitutes an actor', async () => {
  let invoked = false;
  let resolveParams;
  const route = loadApiRoute(() => { invoked = true; return Response.json({}); });
  const pending = route.PUT(new Request('http://test/api/field', { method: 'PUT' }), {
    params: new Promise(resolve => { resolveParams = resolve; }),
  });
  await Promise.resolve();
  assert.equal(invoked, false);
  resolveParams({ path: ['field'] });
  await pending;
  assert.equal(invoked, true);
});
