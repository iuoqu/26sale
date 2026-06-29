import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

// 产品数据会由前端发送过来
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, products } = req.body;

    if (!message || !products) {
      return res.status(400).json({ error: 'Missing message or products' });
    }

    // 构建产品信息摘要
    const productSummary = products.map(p => 
      `${p.productName} (${p.styleCode}) - ${p.category} - ¥${p.discountPrice || p.retailPrice} (库存${p.totalStock}) - 系列:${p.series || '无'}`
    ).join('\n');

    const systemPrompt = `你是一个专业的时尚购物助手。你需要帮助用户从商品列表中找到最适合他们的产品。

当用户描述他们的需求时：
1. 理解他们的具体要求（类型、颜色、价格范围、风格等）
2. 从产品列表中找出最匹配的3-5个产品
3. 为每个推荐的产品解释为什么它适合用户

推荐时要简洁有力，突出产品的优点和为什么选择它。

以下是完整的产品列表：
${productSummary}

请用中文回复用户。`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: message
        }
      ]
    });

    const assistantMessage = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';

    // 从回复中提取推荐的产品 SKU
    const recommendedSkus = [];
    const skuRegex = /([A-Z]{2,3}\d{3})/g;
    const matches = assistantMessage.match(skuRegex) || [];
    matches.forEach(sku => {
      if (!recommendedSkus.includes(sku)) {
        recommendedSkus.push(sku);
      }
    });

    res.status(200).json({
      message: assistantMessage,
      recommendedSkus: recommendedSkus,
      productsCount: products.length
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
}
