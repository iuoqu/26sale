import Anthropic from '@anthropic-ai/sdk';

const USE_QWEN = !!process.env.DASHSCOPE_API_KEY;
const USE_CLAUDE = !!process.env.CLAUDE_API_KEY && !USE_QWEN;

let claudeClient = null;

if (USE_CLAUDE) {
  try {
    claudeClient = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });
    console.log('Using Claude API');
  } catch (e) {
    console.error('Failed to initialize Claude:', e.message);
  }
}

if (USE_QWEN) {
  console.log('Using Qwen API (qwen-plus)');
} else if (!USE_CLAUDE) {
  console.error('Warning: Neither DASHSCOPE_API_KEY nor CLAUDE_API_KEY is set');
}

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

  if (colorCode.includes(upperQuery.substring(0, 3))) {
    return true;
  }

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

// 分析系列特性（款式丰富度、颜色多样性等）
function analyzeSeriesCharacteristics(products) {
  const seriesStats = {};

  products.forEach(p => {
    const series = p.series || '其他';
    if (!seriesStats[series]) {
      seriesStats[series] = {
        name: series,
        count: 0,
        colors: new Set(),
        categories: new Set(),
        types: new Set()
      };
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

    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    // 如果没有products，也能工作
    const productList = products || [];

    // 按系列分组产品
    const seriesByGroup = {};
    productList.forEach(p => {
      const series = p.series || '其他';
      if (!seriesByGroup[series]) {
        seriesByGroup[series] = [];
      }
      seriesByGroup[series].push(p);
    });

    // 分析系列特性
    const seriesStats = analyzeSeriesCharacteristics(productList);

    // 构建系列信息摘要（不涉及库存）
    const seriesSummary = Object.entries(seriesByGroup).map(([series, items]) => {
      const stats = seriesStats[series];
      const categories = [...new Set(items.map(p => p.category))].join(',');
      const types = [...new Set(items.map(p => extractProductType(p.productName)).filter(Boolean))];
      return `${series}: ${items.length}款 | 分类: ${categories} | 款式: ${types.join(',')} | 颜色数: ${stats.colorCount}`;
    }).join('\n');

    let systemPrompt;

    if (productList.length > 0) {
      systemPrompt = `你是一个专业的时尚购物顾问。用户会描述他们想要的产品，你的任务是理解需求并推荐。

这是一个特卖活动，包含众多设计师品牌的精选商品。

用户可能会问：
- "白色的T恤"
- "黑色的Tabby包"
- "最新最流行的包系列是什么"
- "有哪些新款夹克"
- "推荐一些经典系列"
- "Horse & Carriage系列有什么"

你的推荐策略：
1. 如果问具体颜色/款式，精准过滤并返回所有匹配产品
2. 如果问"最新最流行"，基于系列的知名度和款式丰富度推荐
3. Tabby、Brooklyn等大系列（款式多、颜色全）通常是热门
4. 小系列（款式少）可能是特别推出或限定款
5. 在回复中包含推荐的系列名称和产品SKU

系列特性（款式数、分类、颜色丰富度）：
${seriesSummary}

用中文回复，直接推荐产品SKU。`;
    } else {
      systemPrompt = `你是一个专业的时尚购物顾问。这是Coach品牌的特卖活动。

主要系列包括：
- Tabby: 经典包款系列，款式丰富，颜色多样
- Brooklyn: 现代设计系列
- Chain Tabby: 链条设计款
- Horse & Carriage: 传统纹样系列
- Heritage C: 经典C元素

用户可能会问关于产品、系列推荐、颜色、款式等。
用中文回复，友好热情地回答问题。`;
    }

    let assistantMessage = '';

    // 使用Qwen或Claude
    if (USE_QWEN) {
      // 调用Qwen API - 使用OpenAI兼容模式
      const qwenUrl = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

      console.log('Calling Qwen OpenAI compatible API...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const qwenResponse = await fetch(qwenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: message
            }
          ],
          max_tokens: 1500,
          temperature: 0.7,
          enable_thinking: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('Qwen response status:', qwenResponse.status);

      if (!qwenResponse.ok) {
        const errorText = await qwenResponse.text();
        console.error('Qwen API error response:', errorText);
        throw new Error(`Qwen API error ${qwenResponse.status}: ${errorText}`);
      }

      const qwenData = await qwenResponse.json();
      console.log('Qwen full response:', JSON.stringify(qwenData, null, 2));

      // 尝试多种可能的响应格式
      if (qwenData.choices?.[0]?.message?.content) {
        assistantMessage = qwenData.choices[0].message.content;
        console.log('✓ Found in choices[0].message.content');
      } else if (qwenData.output?.text) {
        assistantMessage = qwenData.output.text;
        console.log('✓ Found in output.text');
      } else if (qwenData.choices?.[0]?.text) {
        assistantMessage = qwenData.choices[0].text;
        console.log('✓ Found in choices[0].text');
      } else if (qwenData.data?.text) {
        assistantMessage = qwenData.data.text;
        console.log('✓ Found in data.text');
      } else if (qwenData.choices?.[0]?.message?.reasoning_content) {
        assistantMessage = qwenData.choices[0].message.reasoning_content;
        console.log('✓ Found in choices[0].message.reasoning_content');
      } else {
        console.error('Qwen response structure:', Object.keys(qwenData));
        console.error('Choices:', qwenData.choices);
        throw new Error(`Qwen 格式未知。返回数据: ${JSON.stringify(qwenData)}`);
      }
    } else if (USE_CLAUDE && claudeClient) {
      // 调用Claude API
      const response = await claudeClient.messages.create({
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

      assistantMessage = response.content[0].type === 'text'
        ? response.content[0].text
        : '';
    } else {
      throw new Error('No LLM API configured. Please set DASHSCOPE_API_KEY or CLAUDE_API_KEY');
    }

    // 解析用户需求（颜色、类型等）
    const userQueryLower = message.toLowerCase();

    // 提取所有匹配的产品
    const matchedProducts = [];

    // 检查用户是否指定了颜色和类型
    const hasColorQuery = /黑|白|蓝|红|绿|灰|棕|米|粉|紫|黄|蓝色|黑色|白色|绿色|红色|灰色|棕色|米色|粉色|紫色|黄色/.test(userQueryLower);
    const hasTypeQuery = /卫衣|夹克|t恤|外套|大衣|连衣裙|裙子|裤子|短裤|衬衣|包|鞋/.test(userQueryLower);

    // 如果同时指定了颜色和类型，需要都匹配
    if (hasColorQuery && hasTypeQuery) {
      productList.forEach(p => {
        // 先检查颜色
        if (!matchesColor(p.colorCode, userQueryLower)) return;

        let typeMatches = false;
        const productType = extractProductType(p.productName);

        // 英文类型匹配
        if (productType && userQueryLower.includes(productType.toLowerCase())) {
          typeMatches = true;
        }

        // 中文类型匹配
        if (!typeMatches) {
          const typeMap = {
            '卫衣': 'SWEATSHIRT',
            '夹克': 'JACKET',
            't恤': 'T SHIRT',
            '外套': 'JACKET',
            '大衣': 'COAT',
            '连衣裙': 'DRESS',
            '裙子': 'SKIRT',
            '裤子': 'PANTS',
            '短裤': 'SHORTS',
            '衬衣': 'SHIRT'
          };

          for (const [cn, en] of Object.entries(typeMap)) {
            if (userQueryLower.includes(cn) && p.productName.toUpperCase().includes(en)) {
              typeMatches = true;
              break;
            }
          }
        }

        // 包和鞋的特殊匹配
        if (!typeMatches && userQueryLower.includes('包') && p.category && p.category.includes('包')) {
          typeMatches = true;
        }
        if (!typeMatches && userQueryLower.includes('鞋') && p.category && p.category.includes('鞋')) {
          typeMatches = true;
        }

        if (typeMatches) {
          matchedProducts.push(p);
        }
      });
    } else if (hasColorQuery) {
      // 只指定了颜色
      productList.forEach(p => {
        if (matchesColor(p.colorCode, userQueryLower)) {
          matchedProducts.push(p);
        }
      });
    } else {
      // 检查系列、款式类型、类别
      productList.forEach(p => {
        let matches = false;
        const series = p.series || '其他';

        // 系列匹配
        if (userQueryLower.includes(series.toLowerCase())) {
          matches = true;
        }

        // 款式类型匹配
        const productType = extractProductType(p.productName);
        if (productType && userQueryLower.includes(productType.toLowerCase())) {
          matches = true;
        }

        // 类别匹配
        if (p.category && userQueryLower.includes(p.category.toLowerCase())) {
          matches = true;
        }

        if (matches) {
          matchedProducts.push(p);
        }
      });

      // 如果没有找到匹配（比如问"最新最流行"），返回大系列的产品
      if (matchedProducts.length === 0 && /最新|最流行|热销|推荐/.test(userQueryLower)) {
        // 返回款式最丰富的系列
        const bigSeries = Object.entries(seriesStats)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 3);

        bigSeries.forEach(([seriesName]) => {
          matchedProducts.push(...(seriesByGroup[seriesName] || []));
        });
      }
    }

    // 如果本地关键词没匹配到，尝试用AI回复里提到的系列名来筛选
    // 这样展示的商品就和AI实际推荐的系列对齐
    if (matchedProducts.length === 0 && assistantMessage) {
      let workingMsg = assistantMessage.toLowerCase();
      const allSeries = [...new Set(productList.map(p => p.series).filter(Boolean))];
      // 按名字长度倒序：先匹配更长更具体的系列，并把它从文本中"消费"掉，
      // 这样像 "Rexy" 这种短名只有在 "Rexy Anniversary" 之外独立出现时才会被匹配
      const mentionedSeries = [];
      for (const s of allSeries.slice().sort((a, b) => b.length - a.length)) {
        const sLower = s.toLowerCase();
        if (workingMsg.includes(sLower)) {
          mentionedSeries.push(s);
          // 移除已匹配系列名的所有出现，避免其子串被短系列名误匹配
          workingMsg = workingMsg.split(sLower).join(' ');
        }
      }

      if (mentionedSeries.length > 0) {
        productList.forEach(p => {
          if (p.series && mentionedSeries.includes(p.series)) {
            matchedProducts.push(p);
          }
        });
      }
    }

    // 如果仍然没有结果，返回全部
    if (matchedProducts.length === 0) {
      matchedProducts.push(...products);
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
      userQuery: message
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    console.error('Error stack:', error.stack);

    // 检查是否是超时/中止错误
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return res.status(504).json({
        error: 'Request timeout',
        message: '请求超时，请重试。'
      });
    }

    // 检查是否是API key问题
    if (error.message && error.message.includes('401')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: USE_QWEN
          ? 'DASHSCOPE_API_KEY 无效或未授权'
          : 'CLAUDE_API_KEY 无效或未授权'
      });
    }

    // 返回真实的错误信息
    res.status(500).json({
      error: 'Failed to process request',
      message: error.message || 'Unknown error',
      details: error.toString(),
      usingQwen: USE_QWEN,
      usingClaude: USE_CLAUDE
    });
  }
}
