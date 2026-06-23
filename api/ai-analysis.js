/**
 * Vercel Serverless Function - Agnes AI 代理
 * 部署后路径: /api/ai-analysis
 * API Key 通过 Vercel 环境变量 AGNES_API_KEY 配置，不暴露在代码里
 */

const AGNES_API_URL = "https://apihub.agnes-ai.com/v1/chat/completions";

export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== "POST") {
    return res.status(405).json({ error: "仅支持POST请求" });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "缺少prompt参数" });
    }

    // 从环境变量读取API Key
    const apiKey = process.env.AGNES_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "服务器未配置AGNES_API_KEY环境变量" });
    }

    // 调用 Agnes API
    const response = await fetch(AGNES_API_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "agnes-2.0-flash",
        messages: [
          {
            role: "system",
            content: "你是一位专业的MBTI性格分析师，擅长根据用户的MBTI类型和维度比例给出深度个性化解读。语言风格亲切专业，像一位了解用户的朋友。回复用中文。"
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Agnes API错误:", response.status, errText);
      return res.status(502).json({ error: "AI服务返回错误: " + response.status });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({ content, usage: data.usage });
  } catch (e) {
    console.error("AI分析异常:", e.message);
    return res.status(500).json({ error: "AI分析服务暂时不可用: " + e.message });
  }
}
