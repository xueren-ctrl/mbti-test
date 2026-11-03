/**
 * Cloudflare Worker - Agnes AI 代理
 *
 * 部署：
 *   1. 新建 Worker，把本文件内容粘进去
 *   2. Settings → Variables → 添加加密变量 AGNES_API_KEY
 *   3. 可选变量 ALLOWED_ORIGINS（逗号分隔）
 *   4. 可选：绑定 KV 命名空间到 RATE_LIMIT，限流才能跨实例生效
 *
 * 注意：*.workers.dev 在中国大陆经常不可直连，建议绑定自己的域名。
 * 地址形如 https://ai.example.com/api/ai-analysis，填到 index.html 的 AI_PROXY_URL。
 */
const MODELS = ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-3.0-pro'];
const TYPES = new Set([
  'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
  'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'
]);
const DIM_DEFAULT = { EI: ['E','I'], SN: ['S','N'], TF: ['T','F'], JP: ['J','P'] };
const MAX_BODY = 8 * 1024;
const RATE_WINDOW = 600;
const RATE_MAX = 15;
const hits = new Map();

function originAllowed(origin, env) {
  if (!origin) return true;
  if (origin === 'https://xueren-ctrl.github.io') return true;
  const extra = String((env && env.ALLOWED_ORIGINS) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function cors(origin, env) {
  const h = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  });
  if (origin && originAllowed(origin, env)) h.set('Access-Control-Allow-Origin', origin);
  return h;
}

function json(body, status, origin, env) {
  const h = cors(origin, env);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function rateLimited(env, ip) {
  if (env && env.RATE_LIMIT && typeof env.RATE_LIMIT.get === 'function') {
    const key = 'rl:' + ip;
    const n = Number((await env.RATE_LIMIT.get(key)) || '0');
    if (n >= RATE_MAX) return true;
    await env.RATE_LIMIT.put(key, String(n + 1), { expirationTtl: RATE_WINDOW });
    return false;
  }
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

async function callAgnes(prompt, env) {
  const url = (env && env.AGNES_API_URL) || 'https://apihub.agnes-ai.com/v1/chat/completions';
  let lastErr = null;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.AGNES_API_KEY,
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
        const err = new Error('upstream ' + resp.status);
        if (retryable) { lastErr = err; continue; }
        throw err;
      }
      const data = JSON.parse(text);
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (!content) throw new Error('empty content');
      return { content, model };
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('AI service unavailable');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: originAllowed(origin, env) ? 204 : 403,
        headers: cors(origin, env)
      });
    }

    if (request.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/health')) {
      return json({ ok: true, configured: Boolean(env.AGNES_API_KEY) }, 200, origin, env);
    }
    if (url.pathname !== '/api/ai-analysis') {
      return json({ error: 'Not found' }, 404, origin, env);
    }
    if (request.method !== 'POST') {
      return json({ error: '仅支持 POST' }, 405, origin, env);
    }
    if (!originAllowed(origin, env)) {
      return json({ error: 'Origin 不被允许' }, 403, origin, env);
    }
    if (!env.AGNES_API_KEY) {
      return json({ error: '服务端未配置 AGNES_API_KEY' }, 503, origin, env);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await rateLimited(env, ip)) {
      return json({ error: '请求过于频繁，请稍后再试' }, 429, origin, env);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) {
      return json({ error: '请求体过大' }, 413, origin, env);
    }
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400, origin, env);
    }

    try {
      const result = await callAgnes(buildPrompt(body), env);
      return json({ content: result.content, model: result.model }, 200, origin, env);
    } catch (e) {
      console.error('[agnes-proxy]', e && e.message);
      return json({ error: 'AI 服务暂时不可用，请稍后重试' }, 502, origin, env);
    }
  }
};
