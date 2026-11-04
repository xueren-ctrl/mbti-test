/**
 * Deno Deploy - Agnes AI 代理
 * 路由：/api/ai-analysis（同时支持 /api/health）
 * 环境变量：AGNES_API_KEY（必须），可选 AGNES_API_URL、ALLOWED_ORIGINS
 */
const MODELS = ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-3.0-pro'];
const TYPES = new Set([
  'INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP',
  'ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'
]);
const DIM_DEFAULT: Record<string, [string, string]> = {
  EI: ['E', 'I'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P']
};
const MAX_BODY = 8 * 1024;
const RATE_WINDOW = 600;
const RATE_MAX = 15;
const hits = new Map<string, { count: number; reset: number }>();

function apiKey(): string {
  return Deno.env.get('AGNES_API_KEY') || '';
}

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  if (origin === 'https://xueren-ctrl.github.io') return true;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.deno\.dev$/i.test(origin)) return true;
  const extra = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function cors(origin: string): Headers {
  const h = new Headers({
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  });
  if (origin && originAllowed(origin)) h.set('Access-Control-Allow-Origin', origin);
  return h;
}

function json(body: unknown, status: number, origin: string): Response {
  const h = cors(origin);
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function rateLimited(ip: string): boolean {
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

function dimLine(key: string, d: any): string {
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

function buildPrompt(body: any): string {
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

async function callAgnes(prompt: string): Promise<{ content: string; model: string }> {
  const url = Deno.env.get('AGNES_API_URL') || 'https://api.agnes-ai.cn/v1/chat/completions';
  const key = apiKey();
  let lastErr: Error | null = null;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
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
      lastErr = e as Error;
      if ((e as Error).name === 'AbortError') break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('AI service unavailable');
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin') || '';
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: originAllowed(origin) ? 204 : 403,
      headers: cors(origin)
    });
  }

  if (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/health')) {
    return json({ ok: true, configured: Boolean(apiKey()) }, 200, origin);
  }
  if (url.pathname !== '/api/ai-analysis') {
    return json({ error: 'Not found' }, 404, origin);
  }
  if (req.method !== 'POST') {
    return json({ error: '仅支持 POST' }, 405, origin);
  }
  if (!originAllowed(origin)) {
    return json({ error: 'Origin 不被允许' }, 403, origin);
  }
  if (!apiKey()) {
    return json({ error: '服务端未配置 AGNES_API_KEY' }, 503, origin);
  }

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429, origin);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return json({ error: '请求体过大' }, 413, origin);
  }
  let body: any;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400, origin);
  }

  try {
    const result = await callAgnes(buildPrompt(body));
    return json({ content: result.content, model: result.model }, 200, origin);
  } catch (e) {
    console.error('[agnes-proxy]', (e as Error)?.message);
    return json({ error: 'AI 服务暂时不可用，请稍后重试' }, 502, origin);
  }
});
