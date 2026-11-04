'use strict';

const https = require('https');
const http = require('http');

const MODELS = ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-3.0-pro'];
const TYPES = new Set([
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'
]);
const DIM_DEFAULT = {
  EI: ['E', 'I'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P']
};
const MAX_BODY = 8 * 1024;
const RATE_WINDOW = 600;
const RATE_MAX = 15;
const hits = new Map();

function apiKey() {
  return process.env.AGNES_API_KEY || '';
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === 'https://xueren-ctrl.github.io') return true;
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function cors(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
  if (origin && originAllowed(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function reply(statusCode, obj, origin) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors(origin)),
    body: JSON.stringify(obj),
    isBase64Encoded: false
  };
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW * 1000 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_MAX;
}

function dimLine(key, d) {
  const [a0, b0] = DIM_DEFAULT[key];
  let a = (d && (d.a === a0 || d.a === b0)) ? d.a : a0;
  let b = (d && (d.b === a0 || d.b === b0)) ? d.b : b0;
  if (a === b) b = a === a0 ? b0 : a0;
  const av = Number(d && d.aVal);
  const bv = Number(d && d.bVal);
  const total = (Number.isFinite(av) ? av : 0) + (Number.isFinite(bv) ? bv : 0);
  const ap = total > 0 ? Math.max(0, Math.min(100, Math.round((av / total) * 100))) : 50;
  return `${a}:${ap}% / ${b}:${100 - ap}%`;
}

function buildPrompt(body) {
  const type = TYPES.has(body && body.type) ? body.type : 'INTJ';
  const dims = (body && typeof body.dims === 'object' && body.dims) ? body.dims : {};
  const mode = ['quick', 'detailed', 'full'].includes(body && body.mode) ? body.mode : 'detailed';
  const dimStr = Object.keys(DIM_DEFAULT).map(k => dimLine(k, dims[k])).join('，');
  return `你是一位专业的MBTI性格分析师。用户完成了MBTI测试，请根据以下信息给出深度个性化解读。

用户类型：${type}
维度比例：${dimStr}
测试模式：${mode}

请从以下4个方面分析（共约400字，用中文，分段清晰）：
1. 性格内核：结合维度比例，分析这个人的核心驱动力和思维模式（偏T 70%和偏T 55%的人有什么不同）
2. 独特优势：基于具体维度倾向，指出TA比别人更突出的3个优势
3. 潜在挑战：针对维度比例，提醒TA需要警惕的2个盲区
4. 行动建议：给出3条具体可执行的建议

要求：语言亲切专业，像一位了解TA的朋友在聊天。不要用"你是一个INTJ"这种泛泛的模板话。`;
}

function postJson(urlStr, payload, apiKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function callAgnes(prompt) {
  const url = process.env.AGNES_API_URL || 'https://api.agnes-ai.cn/v1/chat/completions';
  const key = apiKey();
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const resp = await postJson(url, {
        model,
        messages: [
          { role: 'system', content: '你是一位专业的MBTI性格分析师，擅长根据用户的MBTI类型和维度比例给出深度个性化解读。语言风格亲切专业，像一位了解用户的朋友。回复用中文。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 1024
      }, key, 50000);

      if (resp.status < 200 || resp.status >= 300) {
        const retryable = resp.status === 400 || resp.status === 404 || resp.status === 503 ||
          /model_not_found|无可用渠道|无可用/.test(resp.text);
        lastErr = new Error('upstream ' + resp.status);
        if (retryable) continue;
        throw lastErr;
      }
      const data = JSON.parse(resp.text);
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (!content) throw new Error('empty content');
      return { content, model };
    } catch (e) {
      lastErr = e;
      if (e && e.message === 'timeout') break;
    }
  }
  throw lastErr || new Error('AI service unavailable');
}

exports.main_handler = async (event) => {
  const method = String(event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'GET').toUpperCase();
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || '';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors(origin), body: '', isBase64Encoded: false };
  }
  if (!originAllowed(origin)) {
    return reply(403, { error: 'Origin 不被允许' }, origin);
  }
  if (method === 'GET') {
    return reply(200, { ok: true, configured: Boolean(apiKey()) }, origin);
  }
  if (method !== 'POST') {
    return reply(405, { error: '仅支持 POST' }, origin);
  }
  if (!apiKey()) {
    return reply(503, { error: '服务端未配置 AGNES_API_KEY' }, origin);
  }

  const ip = String(headers['x-forwarded-for'] || headers['X-Forwarded-For'] || 'unknown').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return reply(429, { error: '请求过于频繁，请稍后再试' }, origin);
  }

  let raw = event.body || '';
  if (event.isBase64Encoded) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) { raw = ''; }
  }
  if (raw.length > MAX_BODY) {
    return reply(413, { error: '请求体过大' }, origin);
  }
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return reply(400, { error: '请求体不是合法 JSON' }, origin);
  }

  try {
    const result = await callAgnes(buildPrompt(body));
    return reply(200, { content: result.content, model: result.model }, origin);
  } catch (e) {
    console.error('[agnes-proxy]', e && e.message);
    return reply(502, { error: 'AI 服务暂时不可用，请稍后重试' }, origin);
  }
};
