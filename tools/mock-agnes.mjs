/**
 * 本地假上游：模拟 Agnes /chat/completions，不消耗真实额度。
 *   node tools/mock-agnes.mjs
 * 可选：
 *   MOCK_PORT=8898
 *   MOCK_CONTENT="自定义返回内容"   （支持 \n）
 *   MOCK_LOG=./mock-requests.jsonl （把收到的 prompt 落盘，便于核对）
 */
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MOCK_PORT || 8898);
const LOG = process.env.MOCK_LOG || '';
const DEFAULT_CONTENT = [
  '## 性格内核',
  '你更习惯**先想清楚再行动**，在信息不足时会主动补全逻辑链，而不是被情绪推着走。',
  '',
  '## 独特优势',
  '1. 能把模糊问题拆成可执行的步骤',
  '2. 对长期目标有罕见的耐心',
  '3. 在压力下仍能保持判断',
  '',
  '## 潜在挑战',
  '容易把“准备充分”当成开始的前提，错过窗口期。',
  '',
  '## 行动建议',
  '1. 给探索设一个截止时间',
  '2. 每周主动暴露一次不完美输出',
  '3. 把直觉当成待验证的假设'
].join('\n');

const content = process.env.MOCK_CONTENT
  ? process.env.MOCK_CONTENT.replace(/\\n/g, '\n')
  : DEFAULT_CONTENT;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (LOG && raw) {
      try {
        const body = JSON.parse(raw);
        const prompt = body.messages && body.messages[1] ? body.messages[1].content : '';
        fs.appendFileSync(LOG, JSON.stringify({
          at: new Date().toISOString(),
          model: body.model,
          prompt
        }) + '\n');
      } catch (e) { /* ignore */ }
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }));
  });
});

server.listen(PORT, () => {
  console.log('[mock-agnes] http://127.0.0.1:' + PORT + '/v1/chat/completions');
});
