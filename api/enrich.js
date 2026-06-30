// 给单件商品做视觉识别，返回 garmentLabel / colorLabel
// 调用前必须先通过 /api/probe 确定可用模型，通过 body.model 传入

const ENDPOINT = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

const GARMENT_OPTIONS = 'T恤/衬衫/Polo衫/卫衣/连帽衫/毛衣/开衫/圆领衫/背心/夹克/飞行夹克/机车夹克/西装外套/风衣/大衣/羽绒服/马甲/牛仔裤/裤子/短裤/连衣裙/半身裙';
const COLOR_OPTIONS   = '黑/白/米白/灰/深灰/棕/深棕/卡其/蓝/海军蓝/绿/橄榄绿/红/粉/紫/黄/奶油/米色/多色';

async function callVision(apiKey, model, dataUrl, prompt) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 20,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'DASHSCOPE_API_KEY 未配置' });

  const { dataUrl, type, productName, needGarment, needColor, model } = req.body;
  if (!dataUrl) return res.status(400).json({ error: '缺少 dataUrl' });
  if (!model)   return res.status(400).json({ error: '缺少 model，请先调用 /api/probe' });

  const result = { model };

  try {
    if (needGarment && type === '衣') {
      const prompt = `这是一件服装产品图片，产品名（可能被截断）：${productName || ''}。\n只输出一个品类词，从以下选项选：${GARMENT_OPTIONS}。不要解释。`;
      result.garmentLabel = await callVision(apiKey, model, dataUrl, prompt);
    }

    if (needColor) {
      const prompt = `这件商品的主色调是什么？只输出一个颜色词，从以下选项选：${COLOR_OPTIONS}。不要解释。`;
      result.colorLabel = await callVision(apiKey, model, dataUrl, prompt);
    }
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  res.status(200).json(result);
}
