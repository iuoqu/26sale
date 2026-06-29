import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

// 从productName中提取款式类型
function extractProductType(productName) {
  const types = ['T SHIRT', 'SWEATSHIRT', 'JACKET', 'SHIRT', 'COAT', 'DRESS', 'SKIRT', 'PANTS', 'SHORTS'];
  for (const type of types) {
    if (productName.toUpperCase().includes(type)) {
      return type;
    }
  }
  return null;
}

// 颜色代码到颜色名称的映射
const colorMap = {
  'BLK': ['黑', '黑色'],
  'WHT': ['白', '白色'],
  'BLU': ['蓝', '蓝色'],
  'RED': ['红', '红色'],
  'GRN': ['绿', '绿色'],
  'HGR': ['灰绿', '灰绿色'],
  'BRN': ['棕', '棕色'],
  'GRY': ['灰', '灰色'],
  'NAV': ['深蓝', '海军蓝'],
  'BEI': ['米色', '米'],
  'PRP': ['紫', '紫色'],
  'YEL': ['黄', '黄色'],
  'PNK': ['粉', '粉色']
};

// 判断颜色是否匹配
function matchesColor(colorCode, userQuery) {
  if (!colorCode) return false;
  const upperQuery = userQuery.toUpperCase();

  // 精确匹配colorCode
  if (colorCode.includes(upperQuery.substring(0, 3))) {
    return true;
  }

  // 根据颜色代码查找中文名称
  for (const [code, names] of Object.entries(colorMap)) {
    if (colorCode.includes(code)) {
      for (const name of names) {
        if (userQuery.includes(name)) {
          return true;
        }
      }
    }
  }

  return false;
}

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

    // 构建系列和产品类型摘要
    const seriesSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const categories = [...new Set(items.map(p => p.category))].join(',');
      const types = [...new Set(items.map(p => extractProductType(p.productName)).filter(Boolean))];
      const colors = [...new Set(items.map(p => p.colorCode).filter(Boolean))];
      return `${series}: ${items.length}件 | 分类: ${categories} | 款式: ${types.join(',')} | 颜色: ${colors.join(',')}`;
    }).join('\n');

    const systemPrompt = `你是一个专业的时尚购物顾问。用户会描述他们想要的产品（包括款式、颜色、类型等），你的任务是理解他们的需求并提供精准的推荐。

用户可能会说：
- "我要白色的T恤"
- "黑色的Tabby系列包包"
- "有没有蓝色的衣服"
- "推荐一些夹克"
- "Horse & Carriage系列的所有款式"

根据用户需求：
1. 识别关键词：颜色（黑、白、蓝等）、款式（T恤、夹克、卫衣等）、系列、类别
2. 基于这些关键词过滤产品
3. 总结用户需要的产品特征
4. 推荐所有匹配的产品

在你的回复中，明确列出：
- 匹配的系列名称
- 匹配的颜色
- 匹配的款式类型
- 产品SKU（styleCode）

系列和产品类型信息：
${seriesSummary}

用中文回复，并在推荐中包含所有匹配的SKU代码。`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
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

    // 解析用户需求（颜色、类型等）
    const userQueryLower = message.toLowerCase();

    // 提取所有匹配的产品
    const matchedProducts = [];

    products.forEach(p => {
      let matches = false;

      // 检查是否匹配用户的颜色需求
      const hasColorQuery = /黑|白|蓝|红|绿|灰|棕|米|粉|紫|黄|蓝色|黑色|白色|绿色|红色|灰色|棕色|米色|粉色|紫色|黄色/.test(userQueryLower);

      if (hasColorQuery) {
        // 如果用户提到了颜色，只返回颜色匹配的产品
        if (matchesColor(p.colorCode, userQueryLower)) {
          matches = true;
        }
      } else {
        // 如果没有提到颜色，检查其他维度
        const series = p.series || '其他';

        // 检查系列是否匹配
        if (userQueryLower.includes(series.toLowerCase())) {
          matches = true;
        }

        // 检查款式类型是否匹配
        const productType = extractProductType(p.productName);
        if (productType && userQueryLower.includes(productType.toLowerCase())) {
          matches = true;
        }

        // 检查类别是否匹配
        if (p.category && userQueryLower.includes(p.category.toLowerCase())) {
          matches = true;
        }

        // 如果既没有系列也没有款式也没有类别，说明是模糊查询，返回更多结果
        if (!matches && !userQueryLower.includes('系列') && !userQueryLower.includes('包') &&
            !userQueryLower.includes('衣') && !userQueryLower.includes('鞋')) {
          matches = true;
        }
      }

      if (matches) {
        matchedProducts.push(p);
      }
    });

    // 按系列和颜色组织结果
    const resultBySeriesAndColor = {};
    matchedProducts.forEach(p => {
      const series = p.series || '其他';
      const color = p.colorCode || '未指定';
      const key = `${series}|${color}`;

      if (!resultBySeriesAndColor[key]) {
        resultBySeriesAndColor[key] = [];
      }
      resultBySeriesAndColor[key].push(p);
    });

    // 提取所有匹配产品的SKU
    const skus = matchedProducts.map(p => p.styleCode);
    const uniqueSkus = [...new Set(skus)];

    res.status(200).json({
      message: assistantMessage,
      matchedProducts: matchedProducts,
      matchCount: matchedProducts.length,
      uniqueSkus: uniqueSkus,
      groupedBySeriesAndColor: resultBySeriesAndColor,
      userQuery: message
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  }
}
