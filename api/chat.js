import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, products } = req.body;

    if (!message || !products) {
      return res.status(400).json({ error: 'Missing message or products' });
    }

    // 按系列分组产品
    const seriesByGroup = {};
    products.forEach(p => {
      const series = p.series || '其他';
      if (!seriesByGroup[series]) {
        seriesByGroup[series] = [];
      }
      seriesByGroup[series].push(p);
    });

    // 构建系列信息摘要
    const seriesSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const categories = [...new Set(items.map(p => p.category))].join(',');
      const priceRange = items.map(p => p.discountPrice || p.retailPrice);
      return `系列: ${series} | 款数: ${items.length} | 分类: ${categories} | 价格范围: ¥${Math.min(...priceRange)}-¥${Math.max(...priceRange)}`;
    }).join('\n');

    // 构建产品列表（按系列组织）
    const productsBySeriesSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const productsList = items.slice(0, 3).map(p =>
        `  - ${p.productName} (${p.styleCode}) - ${p.category}`
      ).join('\n');
      return `${series}:\n${productsList}`;
    }).join('\n\n');

    const systemPrompt = `你是一个专业的时尚购物顾问。你的目标是帮助用户找到他们最喜欢的产品系列和款式。

**重要：优先推荐系列，而不是单个产品。价格和库存不是主要考虑因素。**

当用户描述需求时：
1. 理解他们的风格偏好、产品类型、设计特点等
2. 推荐最匹配的系列（2-3个最适合的系列）
3. 对每个推荐的系列，说明为什么它适合用户
4. 在推荐文案中明确提到系列名称

推荐要点：
- 重点关注款式、设计风格、产品类型
- 系列名称必须准确（如：Tabby、Brooklyn、Chain Tabby等）
- 简洁有力，突出每个系列的独特特点

系列列表和代表款式：
${productsBySeriesSummary}

请用中文回复用户，推荐2-3个最匹配的系列。`;

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

    // 从回复中提取系列名称
    const recommendedSeries = [];
    Object.keys(seriesByGroup).forEach(series => {
      if (assistantMessage.includes(series) && !recommendedSeries.includes(series)) {
        recommendedSeries.push(series);
      }
    });

    // 为每个推荐的系列获取代表产品
    const seriesWithProducts = [];
    recommendedSeries.forEach(series => {
      const seriesProducts = seriesByGroup[series] || [];
      seriesWithProducts.push({
        name: series,
        count: seriesProducts.length,
        products: seriesProducts.slice(0, 3)
      });
    });

    res.status(200).json({
      message: assistantMessage,
      recommendedSeries: recommendedSeries,
      seriesWithProducts: seriesWithProducts
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  }
}
