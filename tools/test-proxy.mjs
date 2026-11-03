import worker from '../worker/agnes-proxy.js';
import handler from '../api/ai-analysis.js';

const realFetch = globalThis.fetch;
process.env.AGNES_API_KEY = 'test-key';
let calls = 0;
globalThis.fetch = async (url, opts) => {
  calls++;
  const body = JSON.parse(opts.body);
  if (!String(opts.headers.Authorization || '').startsWith('Bearer ')) {
    return new Response('no token', { status: 401 });
  }
  if (!body.messages?.[1]?.content.includes('维度比例')) {
    return new Response('bad prompt', { status: 400 });
  }
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'mock:' + body.model } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const DIMS = {
  EI: { a: 'E', b: 'I', aVal: 8, bVal: 12 },
  SN: { a: 'S', b: 'N', aVal: 5, bVal: 15 },
  TF: { a: 'T', b: 'F', aVal: 14, bVal: 6 },
  JP: { a: 'J', b: 'P', aVal: 11, bVal: 9 }
};
const payload = JSON.stringify({ type: 'INTJ', dims: DIMS, mode: 'quick' });
const origin = 'https://xueren-ctrl.github.io';

const results = {};

// Worker
let res = await worker.fetch(new Request('https://w/api/ai-analysis', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
  body: payload
}), { AGNES_API_KEY: 'test-key' });
results.worker = { status: res.status, body: await res.json() };

res = await worker.fetch(new Request('https://w/api/ai-analysis', {
  method: 'POST',
  headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
  body: payload
}), { AGNES_API_KEY: 'test-key' });
results.workerEvil = res.status;

res = await worker.fetch(new Request('https://w/api/ai-analysis', {
  method: 'OPTIONS',
  headers: { Origin: origin }
}), { AGNES_API_KEY: 'test-key' });
results.workerPreflight = { status: res.status, acao: res.headers.get('access-control-allow-origin') };

// Worker 限流：同一 IP 第 16 次应 429（前 15 次已用掉 1 次）
let limited = 0;
for (let i = 0; i < 16; i++) {
  const r = await worker.fetch(new Request('https://w/api/ai-analysis', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '8.8.8.8' },
    body: payload
  }), { AGNES_API_KEY: 'test-key' });
  if (r.status === 429) limited++;
}
results.workerRateLimited = limited;

// Vercel handler
function fakeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
    end() { return this; }
  };
}
const req = {
  method: 'POST',
  headers: { origin, 'x-forwarded-for': '7.7.7.7' },
  body: { type: 'ENFP', dims: DIMS, mode: 'full' },
  socket: { remoteAddress: '7.7.7.7' }
};
const res2 = fakeRes();
await handler(req, res2);
results.vercel = { status: res2.code, body: res2.body, acao: res2.headers['Access-Control-Allow-Origin'] };

// Vercel 缺 key
const res3 = fakeRes();
const oldKey = process.env.AGNES_API_KEY;
delete process.env.AGNES_API_KEY;
await handler({ ...req, headers: { origin } }, res3);
if (oldKey) process.env.AGNES_API_KEY = oldKey;
results.vercelNoKey = { status: res3.code, body: res3.body };

// 错误 Origin
const res4 = fakeRes();
await handler({ ...req, headers: { origin: 'https://evil.example' } }, res4);
results.vercelEvil = res4.code;

results.upstreamCalls = calls;
globalThis.fetch = realFetch;
console.log(JSON.stringify(results, null, 2));
