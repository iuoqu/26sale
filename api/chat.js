import Anthropic from '@anthropic-ai/sdk';

const USE_QWEN = !!process.env.DASHSCOPE_API_KEY;
const USE_CLAUDE = !!process.env.CLAUDE_API_KEY && !USE_QWEN;

let claudeClient = null;
if (USE_CLAUDE) {
  try {
    claudeClient = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  } catch (e) {
    console.error('Failed to initialize Claude:', e.message);
  }
}

const ALL_COLOR_LABELS = ['黑','白','米白','灰','深灰','棕','深棕','卡其','蓝','海军蓝','绿','橄榄绿','红','粉','紫','黄','奶油','米色','多色'];

// 颜色别名 → 标准colorLabel
const COLOR_ALIASES = {
  '卡其色':'卡其','黑色':'黑','白色':'白','灰色':'灰','深灰色':'深灰',
  '棕色':'棕','深棕色':'深棕','蓝色':'蓝','绿色':'绿','红色':'红',
  '粉色':'粉','紫色':'紫','黄色':'黄','奶油色':'奶油','米白色':'米白',
  '橄榄绿色':'橄榄绿','海军蓝色':'海军蓝','深蓝':'海军蓝',
};

// colorCode前缀 → colorLabel（兜底）
const colorCodeMap = {
  'BLK':'黑','WHT':'白','BLU':'蓝','RED':'红','GRN':'绿',
  'BRN':'棕','TNR':'棕','TN2':'棕','GRY':'灰','DGR':'深灰',
  'NAV':'海军蓝','BEI':'米色','CRM':'奶油','KHA':'卡其',
  'OLV':'橄榄绿','OY2':'橄榄绿','PRP':'紫','YEL':'黄','PNK':'粉',
  'AH':'棕','B4':'棕','XJ3':'灰',
};

function getWantedColors(userQuery) {
  const wanted = new Set();
  for (const [alias, label] of Object.entries(COLOR_ALIASES)) {
    if (userQuery.includes(alias)) wanted.add(label);
  }
  for (const label of ALL_COLOR_LABELS) {
    if (userQuery.includes(label)) wanted.add(label);
  }
  return wanted;
}

function matchesColor(p, wantedColors) {
  if (wantedColors.size === 0) return false;

  // Primary: enriched colorLabel
  if (p.colorLabel && wantedColors.has(p.colorLabel)) return true;

  // Fallback: colorCode prefix lookup
  if (p.colorCode) {
    const code = p.colorCode.toUpperCase();
    for (const [prefix, label] of Object.entries(colorCodeMap)) {
      if (code.includes(prefix) && wantedColors.has(label)) return true;
    }
  }

  return false;
}

function extractProductType(productName) {
  if (!productName) return null;
  const u = productName.toUpperCase();
  const types = [
    ['T-SHIRT','T恤'],['T SHIRT','T恤'],['T-SH','T恤'],['T SHI','T恤'],['T SH','T恤'],[' TEE','T恤'],['TANK','背心'],
    ['SWEATSHIRT','卫衣'],['HOODIE','连帽衫'],['CREWNECK SWEA','毛衣'],['SWEATER','毛衣'],['CREWNECK','圆领衫'],['CARDIGAN','开衫'],
    ['POLO','Polo衫'],['POL','Polo衫'],['BLOUSON','夹克'],['BLOUSE','衬衫'],['BOMBER','飞行夹克'],['BOM','飞行夹克'],
    ['WINDBREAKER','风衣'],['WINDREAKER','风衣'],['TRENCH','风衣'],['BALMACAAN','大衣'],['TRUCKER','夹克'],['BLAZER','西装外套'],
    ['PUFFER','羽绒服'],['DOWN VEST','马甲'],['VEST','马甲'],['RACER','机车夹克'],
    ['JACKET','夹克'],['JACKE','夹克'],['JACK','夹克'],['LEATHER J','夹克'],['JAC','夹克'],
    ['CARPENTER PANT','裤子'],['JEANS','牛仔裤'],['JEAN','牛仔裤'],['TROUSER','裤子'],['JOGGER','裤子'],['PANTS','裤子'],['PANT','裤子'],['SHORTS','短裤'],
    ['COAT','大衣'],['DRESS','连衣裙'],['SKIRT','半身裙'],['SHIRT','衬衫'],
  ];
  for (const [token, name] of types) {
    if (u.includes(token)) return name;
  }
  return null;
}

const TYPE_CLOTHING_TERMS = ['卫衣','夹克','t恤','外套','大衣','连衣裙','裙子','裤子','短裤','衬衣','衬衫',
  '上衣','衣服','背心','毛衣','开衫','马甲','风衣','羽绒服','polo','polo衫','圆领衫','连帽衫'];

function matchesType(p, userQuery) {
  // Use enriched garmentLabel
  if (p.garmentLabel && userQuery.includes(p.garmentLabel)) return true;

  // General type keywords
  if (p.type === '衣' && (userQuery.includes('衣服') || userQuery.includes('上衣') || userQuery.includes('服装'))) return true;
  if (p.type === '衣' && TYPE_CLOTHING_TERMS.some(t => userQuery.includes(t))) return true;
  if (p.type === '包' && userQuery.includes('包')) return true;
  if (p.type === '鞋' && userQuery.includes('鞋')) return true;

  // Category match
  if (p.category && userQuery.includes(p.category)) return true;

  // English product name matching
  const productType = extractProductType(p.productName);
  if (productType && userQuery.includes(productType)) return true;

  return false;
}

// Build compact catalog for AI system prompt so it uses real SKUs
function buildProductCatalog(products) {
  return products.map(p => {
    const label = p.garmentLabel || (p.type === '包' ? (p.category || '包') : p.type === '鞋' ? (p.category || '鞋') : '');
    const color = p.colorLabel || '';
    return `${p.styleCode}|${p.series || ''}|${color}|${label}`;
  }).join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, products } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const productList = products || [];
    const catalog = buildProductCatalog(productList);

    const systemPrompt = productList.length > 0
      ? `你是一个专业的时尚购物顾问。用户会描述他们想要的产品，你的任务是理解需求并精准推荐。

以下是本次特卖的全部商品目录，格式为「款号|系列|颜色|品类」：
${catalog}

推荐规则：
1. 只推荐目录中真实存在的款号，不要编造
2. 根据用户的颜色/品类/系列需求，从目录中找出匹配款号
3. 列出匹配的款号（如 CCD01-B4）并说明为何推荐
4. 回复简洁，用中文`
      : `你是一个专业的时尚购物顾问。这是一个设计师品牌特卖活动。用中文友好地回答用户问题。`;

    let assistantMessage = '';

    if (USE_QWEN) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const qwenUrl = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

      const qwenResponse = await fetch(qwenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          max_tokens: 800,
          temperature: 0.3,
          enable_thinking: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!qwenResponse.ok) {
        const errorText = await qwenResponse.text();
        throw new Error(`Qwen API error ${qwenResponse.status}: ${errorText}`);
      }
      const qwenData = await qwenResponse.json();
      assistantMessage = qwenData.choices?.[0]?.message?.content
        || qwenData.output?.text
        || '';
      if (!assistantMessage) throw new Error(`Qwen 格式未知: ${JSON.stringify(qwenData)}`);

    } else if (USE_CLAUDE && claudeClient) {
      const response = await claudeClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      });
      assistantMessage = response.content[0]?.type === 'text' ? response.content[0].text : '';
    } else {
      throw new Error('No LLM API configured. Please set DASHSCOPE_API_KEY or CLAUDE_API_KEY');
    }

    // Client-side matching using enriched colorLabel / garmentLabel / type
    const userQueryLower = message.toLowerCase();

    const COLOR_DETECT = ['黑','白','蓝','红','绿','灰','棕','米','粉','紫','黄','卡其','奶油','米白','深灰','橄榄','海军','深棕','多色'];
    const TYPE_DETECT = ['卫衣','夹克','t恤','外套','大衣','连衣裙','裙子','裤子','短裤','衬衣','衬衫',
      '包','鞋','上衣','衣服','背心','毛衣','开衫','马甲','风衣','羽绒服','polo','圆领衫','连帽衫'];

    const hasColorQuery = COLOR_DETECT.some(c => userQueryLower.includes(c));
    const hasTypeQuery = TYPE_DETECT.some(t => userQueryLower.includes(t));

    const wantedColors = getWantedColors(userQueryLower);
    const matchedProducts = [];

    if (hasColorQuery || hasTypeQuery) {
      productList.forEach(p => {
        const colorOk = !hasColorQuery || matchesColor(p, wantedColors);
        const typeOk = !hasTypeQuery || matchesType(p, userQueryLower);
        if (colorOk && typeOk) matchedProducts.push(p);
      });
    } else {
      // Series matching: check user query first, then AI response
      const allSeries = [...new Set(productList.map(p => p.series).filter(Boolean))];
      const sortedSeries = allSeries.slice().sort((a, b) => b.length - a.length);

      const findMentionedSeries = (text) => {
        let working = text.toLowerCase();
        const found = [];
        for (const s of sortedSeries) {
          const sL = s.toLowerCase();
          if (working.includes(sL)) {
            found.push(s);
            working = working.split(sL).join(' ');
          }
        }
        return found;
      };

      let mentionedSeries = findMentionedSeries(userQueryLower);
      if (mentionedSeries.length === 0 && assistantMessage) {
        mentionedSeries = findMentionedSeries(assistantMessage);
      }

      if (mentionedSeries.length > 0) {
        const seriesSet = new Set(mentionedSeries);
        productList.forEach(p => {
          if (p.series && seriesSet.has(p.series)) matchedProducts.push(p);
        });
      }

      // Also extract any SKUs the AI mentioned that exist in the catalog
      if (matchedProducts.length === 0 && assistantMessage) {
        const skuSet = new Set(productList.map(p => p.styleCode));
        // Match patterns like CCD01-B4, HC01-KHA, BK02-WHT
        const skuPattern = /\b([A-Z]{2,5}\d{2,3}(?:-[A-Z0-9]{2,5})?)\b/g;
        const aiSkus = new Set();
        let m;
        while ((m = skuPattern.exec(assistantMessage)) !== null) {
          if (skuSet.has(m[1])) aiSkus.add(m[1]);
        }
        if (aiSkus.size > 0) {
          productList.forEach(p => { if (aiSkus.has(p.styleCode)) matchedProducts.push(p); });
        }
      }

      // General trending fallback: top 3 series by count, capped at 20 products
      if (matchedProducts.length === 0 && /最新|最流行|热销|推荐|好看/.test(userQueryLower)) {
        const seriesCounts = {};
        productList.forEach(p => { seriesCounts[p.series||'其他'] = (seriesCounts[p.series||'其他']||0) + 1; });
        const topSeries = Object.entries(seriesCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([s]) => s);
        const topSet = new Set(topSeries);
        productList.forEach(p => { if (p.series && topSet.has(p.series)) matchedProducts.push(p); });
      }
    }

    const uniqueSkus = [...new Set(matchedProducts.map(p => p.styleCode))];

    res.status(200).json({
      message: assistantMessage,
      matchedProducts,
      matchCount: matchedProducts.length,
      uniqueSkus,
      userQuery: message,
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return res.status(504).json({ error: 'Request timeout', message: '请求超时，请重试。' });
    }
    if (error.message?.includes('401')) {
      return res.status(401).json({ error: 'Authentication failed', message: 'API Key 无效或未授权' });
    }
    res.status(500).json({
      error: 'Failed to process request',
      message: error.message || 'Unknown error',
    });
  }
}
