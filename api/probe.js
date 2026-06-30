// 探测哪个视觉模型可用，maxDuration=60s 允许逐个试完所有模型
// admin.html 在开始批量识别前调用一次，拿到模型名后传给 /api/enrich

const ENDPOINT = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

const MODELS = [
  'qwen3.6-flash', 'qwen3.5-flash', 'qwen3.6-plus',
  'qwen3.5-plus',  'qwen3.7-plus',  'qwen-vl-plus', 'qwen-vl-max',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DASHSCOPE_API_KEY 未配置' });

  const { dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: '缺少 dataUrl' });

  for (const model of MODELS) {
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: '这是什么颜色？只回答一个词。' },
          ]}],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) {
        return res.status(200).json({ model });
      }
    } catch {
      // 继续下一个
    }
  }

  res.status(502).json({ error: '没有找到可用的视觉模型，请检查 API Key 和端点配置' });
}
