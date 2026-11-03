/**
 * Vercel Serverless Function - Agnes AI 代理
 *
 * 路径: POST /api/ai-analysis
 * 环境变量（Vercel → Settings → Environment Variables）:
 *   AGNES_API_KEY   必填
 *   ALLOWED_ORIGINS 可选，逗号分隔，例如 https://xueren-ctrl.github.io
 *   AGNES_API_URL   可选，默认 https://apihub.agnes-ai.com/v1/chat/completions
 *
 * 安全要点：
 * - Key 只存在服务端环境变量，前端拿不到。
 * - 前端只提交 { type, dims, mode }，提示词由服务端生成，不能当通用 LLM 代理刷。
 * - 限制请求体大小、模型列表、输出 token，并做简单的按 IP 限流。
 */
const AGNES_API_URL = process.env.AGNES_API_URL || 'https://apihub.agnes-ai.com/v1/chat/completions';
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
  if (!origin) return true;
  if (origin === 'https://xueren-ctrl.github.io') return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
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

async function callAgnes(prompt, apiKey) {
  let lastErr = null;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(AGNES_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });

  const origin = req.headers.origin || '';
  if (!originAllowed(origin)) return res.status(403).json({ error: 'Origin 不被允许' });

  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) return res.status(503).json({ error: '服务端未配置 AGNES_API_KEY' });

  const ip = (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body || typeof body !== 'object') body = {};
  } catch (e) {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  if (JSON.stringify(body).length > MAX_BODY) {
    return res.status(413).json({ error: '请求体过大' });
  }

  try {
    const result = await callAgnes(buildPrompt(body), apiKey);
    return res.status(200).json({ content: result.content, model: result.model });
  } catch (e) {
    console.error('[api/ai-analysis]', e && e.message);
    return res.status(502).json({ error: 'AI 服务暂时不可用，请稍后重试' });
  }
}
