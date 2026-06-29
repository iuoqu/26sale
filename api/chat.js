import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

// Coach 系列背景知识库
const seriesKnowledge = {
  'Tabby': {
    type: '经典百搭系列',
    description: '采用Coach标志性的Tabby纹样，融合传统与现代设计。轮廓简洁、实用性强，适合日常搭配。',
    aesthetic: '简约优雅',
    occasion: '日常通勤、日常穿搭'
  },
  'Brooklyn': {
    type: '都市时尚系列',
    description: '以纽约Brooklyn街头文化灵感，设计风格更年轻、个性。结构感强，充满都市气息。',
    aesthetic: '年轻个性',
    occasion: '街头风、休闲时尚'
  },
  'Chain Tabby': {
    type: '精选限定系列',
    description: 'Tabby系列的升级版，加入链条元素，增加视觉层次感。更显气质和品味。',
    aesthetic: '精致优雅',
    occasion: '聚会、出街'
  },
  'Horse & Carriage': {
    type: '品牌标志系列',
    description: 'Coach最经典的马车logo元素，代表品牌历史与传统。简洁耐看，适合各年龄段。',
    aesthetic: '经典传统',
    occasion: '百搭日常'
  }
};

function extractProductType(productName) {
  const types = ['T SHIRT', 'SWEATSHIRT', 'JACKET', 'SHIRT', 'COAT', 'DRESS', 'SKIRT', 'PANTS', 'SHORTS'];
  for (const type of types) {
    if (productName.toUpperCase().includes(type)) {
      return type;
    }
  }
  return null;
}

const colorMap = {
  'BLK': ['黑', '黑色'], 'WHT': ['白', '白色'], 'BLU': ['蓝', '蓝色'], 'RED': ['红', '红色'],
  'GRN': ['绿', '绿色'], 'HGR': ['灰绿', '灰绿色'], 'BRN': ['棕', '棕色'], 'GRY': ['灰', '灰色'],
  'NAV': ['深蓝', '海军蓝'], 'BEI': ['米色', '米'], 'PRP': ['紫', '紫色'], 'YEL': ['黄', '黄色'],
  'PNK': ['粉', '粉色'], 'LHBLK': ['浅黑', '浅黑色'], 'B4': ['驼色', '驼'], 'BK': ['黑'],
  'MPL': ['枫叶色', '枫叶']
};

function matchesColor(colorCode, userQuery) {
  if (!colorCode) return false;
  const upperQuery = userQuery.toUpperCase();
  if (colorCode.includes(upperQuery.substring(0, 3))) return true;
  for (const [code, names] of Object.entries(colorMap)) {
    if (colorCode.includes(code)) {
      for (const name of names) {
        if (userQuery.includes(name)) return true;
      }
    }
  }
  return false;
}

function analyzeSeriesCharacteristics(products) {
  const seriesStats = {};
  products.forEach(p => {
    const series = p.series || '其他';
    if (!seriesStats[series]) {
      seriesStats[series] = { name: series, count: 0, colors: new Set(), categories: new Set(), types: new Set() };
    }
    seriesStats[series].count++;
    seriesStats[series].colors.add(p.colorCode);
    seriesStats[series].categories.add(p.category);
    seriesStats[series].types.add(extractProductType(p.productName));
  });
  Object.values(seriesStats).forEach(stats => {
    stats.colorCount = stats.colors.size;
    stats.categoryCount = stats.categories.size;
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

    const seriesByGroup = {};
    products.forEach(p => {
      const series = p.series || '其他';
      if (!seriesByGroup[series]) seriesByGroup[series] = [];
      seriesByGroup[series].push(p);
    });

    const seriesStats = analyzeSeriesCharacteristics(products);

    const seriesDetailedSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const stats = seriesStats[series];
      const knowledge = seriesKnowledge[series];
      const categories = [...new Set(items.map(p => p.category))].join(',');
      const types = [...new Set(items.map(p => extractProductType(p.productName)).filter(Boolean))];
      if (knowledge) {
        return `【${series}】类型: ${knowledge.type} | 设计理念: ${knowledge.description} | 美学特征: ${knowledge.aesthetic} | 适用场景: ${knowledge.occasion} | 产品构成: ${items.length}款`;
      } else {
        return `【${series}】${items.length}款 | 分类: ${categories} | 款式: ${types.join(',')}`;
      }
    }).join('\n');

    const systemPrompt = `你是Coach品牌的专业购物顾问。深入了解Coach的设计理念和每个系列的特点。

Coach品牌特点：源于1941年美国纽约，以精湛工艺著称，融合经典与现代设计。

推荐原则：理解用户的风格需求，根据系列的设计理念匹配用户需求，考虑颜色搭配和场景适用性，推荐所有匹配的具体产品SKU。

系列背景知识与产品信息：
${seriesDetailedSummary}

用中文回复，专业且贴心。`;

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }]
    });

    const assistantMessage = response.content[0].type === 'text' ? response.content[0].text : '';
    const userQueryLower = message.toLowerCase();
    const matchedProducts = [];

    const hasColorQuery = /黑|白|蓝|红|绿|灰|棕|米|粉|紫|黄|蓝色|黑色|白色|绿色|红色|灰色|棕色|米色|粉色|紫色|黄色|驼|浅黑/.test(userQueryLower);
    const hasTypeQuery = /t恤|shirt|jacket|coat|衣|裤|鞋|包|dress|skirt|pants|shorts|sweatshirt/.test(userQueryLower);
    const hasSeriesQuery = /tabby|brooklyn|carriage|heritage|jacket|clot/.test(userQueryLower);
    const hasCategoryQuery = /男包|女包|男衣|女衣|男鞋|女鞋/.test(userQueryLower);

    if (hasColorQuery && (hasTypeQuery || hasSeriesQuery || hasCategoryQuery)) {
      products.forEach(p => {
        let colorMatches = matchesColor(p.colorCode, userQueryLower);
        let typeMatches = false, seriesMatches = false, categoryMatches = false;
        if (hasTypeQuery) {
          const productType = extractProductType(p.productName);
          typeMatches = productType && userQueryLower.includes(productType.toLowerCase());
        }
        if (hasSeriesQuery) {
          const series = p.series || '其他';
          seriesMatches = userQueryLower.includes(series.toLowerCase());
        }
        if (hasCategoryQuery) {
          categoryMatches = p.category && userQueryLower.includes(p.category.toLowerCase());
        }
        if (colorMatches && (typeMatches || seriesMatches || categoryMatches)) {
          matchedProducts.push(p);
        }
      });
    } else if (hasColorQuery) {
      products.forEach(p => {
        if (matchesColor(p.colorCode, userQueryLower)) {
          matchedProducts.push(p);
        }
      });
    } else {
      products.forEach(p => {
        let matches = false;
        const series = p.series || '其他';
        if (userQueryLower.includes(series.toLowerCase())) matches = true;
        const productType = extractProductType(p.productName);
        if (productType && userQueryLower.includes(productType.toLowerCase())) matches = true;
        if (p.category && userQueryLower.includes(p.category.toLowerCase())) matches = true;
        if (matches) matchedProducts.push(p);
      });
      if (matchedProducts.length === 0 && /推荐|最新|最流行|什么|哪个/.test(userQueryLower)) {
        const bigSeries = Object.entries(seriesStats)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 3);
        bigSeries.forEach(([seriesName]) => {
          matchedProducts.push(...(seriesByGroup[seriesName] || []));
        });
      }
    }

    const resultBySeriesAndColor = {};
    matchedProducts.forEach(p => {
      const series = p.series || '其他';
      const color = p.colorCode || '未指定';
      const key = `${series}|${color}`;
      if (!resultBySeriesAndColor[key]) resultBySeriesAndColor[key] = [];
      resultBySeriesAndColor[key].push(p);
    });

    const uniqueSkus = [...new Set(matchedProducts.map(p => p.styleCode))];

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
