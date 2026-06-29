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

// 分析系列的流行度和新鲜度
function analyzeTrendingSeries(products) {
  const seriesStats = {};

  products.forEach(p => {
    const series = p.series || '其他';
    if (!seriesStats[series]) {
      seriesStats[series] = {
        name: series,
        count: 0,
        totalStock: 0,
        avgStock: 0,
        colors: new Set(),
        categories: new Set(),
        types: new Set(),
        isNew: false,
        isTrending: false
      };
    }
    seriesStats[series].count++;
    seriesStats[series].totalStock += p.totalStock;
    seriesStats[series].colors.add(p.colorCode);
    seriesStats[series].categories.add(p.category);
    seriesStats[series].types.add(extractProductType(p.productName));
  });

  // 计算平均库存和热度指标
  Object.values(seriesStats).forEach(stats => {
    stats.avgStock = stats.totalStock / stats.count;
    stats.colorCount = stats.colors.size;
    stats.categoryCount = stats.categories.size;

    // 判断是否为新款（款式少但库存新鲜）
    if (stats.count <= 3 && stats.avgStock <= 5) {
      stats.isNew = true;
    }

    // 判断是否为热销款（库存少，说明销售快）
    if (stats.avgStock < 3 && stats.count >= 3) {
      stats.isTrending = true;
    }
  });

  return seriesStats;
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

    // 分析趋势
    const trendingAnalysis = analyzeTrendingSeries(products);

    // 找出最新款和最流行款
    const newSeries = Object.values(trendingAnalysis)
      .filter(s => s.isNew)
      .sort((a, b) => a.count - b.count);

    const trendingSeries = Object.values(trendingAnalysis)
      .filter(s => s.isTrending)
      .sort((a, b) => a.avgStock - b.avgStock);

    // 构建系列信息摘要，包含热度标签
    const seriesSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const stats = trendingAnalysis[series];
      const tag = stats.isTrending ? '🔥热销' : stats.isNew ? '✨新款' : '';
      const categories = [...new Set(items.map(p => p.category))].join(',');
      const types = [...new Set(items.map(p => extractProductType(p.productName)).filter(Boolean))];
      const colors = [...new Set(items.map(p => p.colorCode).filter(Boolean))];
      return `${tag} ${series}: ${items.length}件 (人均库存${stats.avgStock.toFixed(1)}) | 分类: ${categories} | 款式: ${types.join(',')} | 颜色: ${colors.join(',')}`;
    }).join('\n');

    const systemPrompt = `你是一个专业的时尚购物顾问。用户会描述他们想要的产品，你的任务是理解需求并提供精准推荐。

用户可能会问：
- "白色的T恤"
- "黑色的Tabby包"
- "最新最流行的包是什么"
- "有哪些新款系列"
- "最热销的夹克"
- "推荐一些库存充足的衣服"

重要信息：
- 🔥热销：库存少，销售快
- ✨新款：款式少，刚上市

根据用户需求分析并推荐：
1. 识别关键词：颜色、款式、系列、是否问最新/最流行
2. 如果问最新/最流行，优先推荐带🔥或✨标签的系列
3. 在回复中明确列出推荐的系列和产品SKU

系列热度信息：
${seriesSummary}

用中文回复。`;

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

    // 解析用户需求
    const userQueryLower = message.toLowerCase();
    const isAskingTrending = /最新|最流行|热销|新款|推荐什么|什么最/.test(userQueryLower);

    // 如果问最新最流行，优先返回相关系列的产品
    let matchedProducts = [];

    if (isAskingTrending && (userQueryLower.includes('包') || userQueryLower.includes('包包'))) {
      // 返回最热销的包包系列
      const bagSeries = trendingSeries
        .filter(s => Object.values(seriesByGroup[s.name] || []).some(p => p.category && p.category.includes('包')))
        .slice(0, 3);

      bagSeries.forEach(s => {
        matchedProducts.push(...(seriesByGroup[s.name] || []));
      });

      // 如果没有热销包，返回所有包
      if (matchedProducts.length === 0) {
        matchedProducts = products.filter(p => p.category && p.category.includes('包'));
      }
    } else if (isAskingTrending && (userQueryLower.includes('衣') || userQueryLower.includes('衣服'))) {
      // 返回最热销的衣服系列
      const clothingSeries = trendingSeries
        .filter(s => Object.values(seriesByGroup[s.name] || []).some(p => p.category && p.category.includes('衣')))
        .slice(0, 3);

      clothingSeries.forEach(s => {
        matchedProducts.push(...(seriesByGroup[s.name] || []));
      });

      if (matchedProducts.length === 0) {
        matchedProducts = products.filter(p => p.category && p.category.includes('衣'));
      }
    } else if (isAskingTrending && (userQueryLower.includes('鞋') || userQueryLower.includes('shoes'))) {
      // 返回最热销的鞋类系列
      const shoeSeries = trendingSeries
        .filter(s => Object.values(seriesByGroup[s.name] || []).some(p => p.category && p.category.includes('鞋')))
        .slice(0, 3);

      shoeSeries.forEach(s => {
        matchedProducts.push(...(seriesByGroup[s.name] || []));
      });

      if (matchedProducts.length === 0) {
        matchedProducts = products.filter(p => p.category && p.category.includes('鞋'));
      }
    } else {
      // 常规搜索逻辑
      const hasColorQuery = /黑|白|蓝|红|绿|灰|棕|米|粉|紫|黄|蓝色|黑色|白色|绿色|红色|灰色|棕色|米色|粉色|紫色|黄色/.test(userQueryLower);

      products.forEach(p => {
        let matches = false;

        if (hasColorQuery) {
          if (matchesColor(p.colorCode, userQueryLower)) {
            matches = true;
          }
        } else {
          const series = p.series || '其他';

          if (userQueryLower.includes(series.toLowerCase())) {
            matches = true;
          }

          const productType = extractProductType(p.productName);
          if (productType && userQueryLower.includes(productType.toLowerCase())) {
            matches = true;
          }

          if (p.category && userQueryLower.includes(p.category.toLowerCase())) {
            matches = true;
          }

          if (!matches && !userQueryLower.includes('系列') && !userQueryLower.includes('包') &&
              !userQueryLower.includes('衣') && !userQueryLower.includes('鞋')) {
            matches = true;
          }
        }

        if (matches) {
          matchedProducts.push(p);
        }
      });
    }

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
    const uniqueSkus = [...new Set(matchedProducts.map(p => p.styleCode))];

    res.status(200).json({
      message: assistantMessage,
      matchedProducts: matchedProducts,
      matchCount: matchedProducts.length,
      uniqueSkus: uniqueSkus,
      groupedBySeriesAndColor: resultBySeriesAndColor,
      userQuery: message,
      trending: {
        newSeries: newSeries.slice(0, 5),
        trendingSeries: trendingSeries.slice(0, 5)
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  }
}
