#!/usr/bin/env node
/**
 * Agnes AI 代理（零依赖，Node 18+）
 *
 * 作用：浏览器只请求这个服务，真正的 API Key 只存在于本机/服务器的环境变量里。
 *
 * 启动：
 *   AGNES_API_KEY=sk-xxx node server-ai.js
 *   # Windows PowerShell:
 *   $env:AGNES_API_KEY="sk-xxx"; node server-ai.js
 *
 * 可选环境变量：
 *   PORT=8787
 *   AGNES_API_URL=https://apihub.agnes-ai.com/v1/chat/completions
 *   ALLOWED_ORIGINS=https://your.site,https://www.your.site
 *
 * 健康检查：GET /api/health
 * 代理地址：POST /api/ai-analysis
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const API_URL = process.env.AGNES_API_URL || 'https://apihub.agnes-ai.com/v1/chat/completions';
const API_KEY = process.env.AGNES_API_KEY || '';
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MODELS = ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-3.0-pro'];
const TYPES = new Set([
  'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
  'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'
]);
const DIM_DEFAULT = { EI: ['E','I'], SN: ['S','N'], TF: ['T','F'], JP: ['J','P'] };
const MAX_BODY = 8 * 1024;
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = 15;
const hits = new Map();

function originAllowed(origin) {
  if (!origin) return true; // curl / 服务端调用
  if (origin === 'https://xueren-ctrl.github.io') return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (origin && originAllowed(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW });
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
  // 前端可能传的是计数（如 8/4），这里统一换算成百分比
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

async function callAgnes(prompt) {
  let lastErr = null;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一位专业的MBTI性格分析师，擅长根据用户的MBTI类型和维度比例给出深度个性化解读。语言风格亲切专业，像一位了解用户的朋友。回复用中文。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.8,
          max_tokens: 1024
        }),
        signal: controller.signal
      });
      const text = await resp.text();
      if (!resp.ok) {
        const retryable = resp.status === 400 || resp.status === 404 || resp.status === 503 ||
          /model_not_found|无可用渠道|无可用/.test(text);
        const err = new Error('上游返回 ' + resp.status);
        if (retryable) { lastErr = err; continue; }
        throw err;
      }
      const data = JSON.parse(text);
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (!content) throw new Error('上游返回内容为空');
      return { content, model };
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('AI 服务暂不可用');
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const path = (req.url || '').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(originAllowed(origin) ? 204 : 403, corsHeaders(origin));
    return res.end();
  }

  if (req.method === 'GET' && (path === '/api/health' || path === '/health')) {
    return send(res, 200, { ok: true, configured: Boolean(API_KEY) }, origin);
  }

  if (path !== '/api/ai-analysis') {
    return send(res, 404, { error: 'Not found' }, origin);
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: '仅支持 POST' }, origin);
  }
  if (!originAllowed(origin)) {
    return send(res, 403, { error: 'Origin 不被允许' }, origin);
  }
  if (!API_KEY) {
    return send(res, 503, { error: '服务端未配置 AGNES_API_KEY' }, origin);
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  if (rateLimited(ip)) {
    return send(res, 429, { error: '请求过于频繁，请稍后再试' }, origin);
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return send(res, e.status || 400, { error: e.status === 413 ? e.message : '请求体不是合法 JSON' }, origin);
  }

  try {
    const result = await callAgnes(buildPrompt(body));
    return send(res, 200, { content: result.content, model: result.model }, origin);
  } catch (e) {
    console.error('[agnes-proxy]', e && e.message);
    return send(res, 502, { error: 'AI 服务暂时不可用，请稍后重试' }, origin);
  }
});

if (!API_KEY) {
  console.warn('[agnes-proxy] 警告：未设置 AGNES_API_KEY，/api/ai-analysis 会返回 503');
}
server.listen(PORT, () => {
  console.log(`[agnes-proxy] http://127.0.0.1:${PORT}/api/ai-analysis`);
});
