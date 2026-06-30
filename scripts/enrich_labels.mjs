/**
 * 用 Qwen 视觉模型给所有商品补全标签：
 *   - 衣类：识别具体品类（T恤/夹克/风衣…）
 *   - 颜色码无法解析的：识别中文颜色名
 * 输出：public/product_data_enriched.js（格式与 product_data.js 相同，增加 categoryLabel / colorLabel 字段）
 *
 * 用法：DASHSCOPE_API_KEY=xxx node scripts/enrich_labels.mjs
 *       DASHSCOPE_API_KEY=xxx VISION_MODEL=qwen3.6-flash node scripts/enrich_labels.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '../public');

const API_KEY = process.env.DASHSCOPE_API_KEY;
if (!API_KEY) { console.error('请设置 DASHSCOPE_API_KEY'); process.exit(1); }

const ENDPOINT = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
const PREFERRED_MODEL = process.env.VISION_MODEL || null;

// ── 现有颜色解析（与前端一致）──────────────────────────────────────────────
function decodeColorFromCode(rawCode) {
  if (!rawCode) return '';
  const code = rawCode.toUpperCase();
  const tokens = [
    ['BLK','黑'],['LHBLK','黑'],['1ZBLK','黑'],['V5BLK','黑'],['/BK','黑'],['BK/','黑'],
    ['OFW','米白'],['WHT','白'],['/WH','白'],['WT','白'],
    ['DBR','深棕'],['WBR','酒红棕'],['BRN','棕'],['TNR','棕褐'],['TN2','棕褐'],
    ['MPL','枫棕'],['KHA','卡其'],['SND','沙色'],['SAD','沙棕'],
    ['HGR','麻灰'],['GRY','灰'],['MBL','蓝'],['NAV','海军蓝'],['/NV','海军蓝'],
    ['BLU','蓝'],['/OL','橄榄绿'],['OYG','绿'],['GRN','绿'],
    ['PIN','粉'],['PNK','粉'],['YLW','黄'],['YEL','黄'],['Y05','黄'],
    ['RED','红'],['CRM','奶油'],['CRE','奶油'],['PRP','紫'],['BEI','米色'],
    ['BLC','米白'],['DKH','深卡其'],['DEN','牛仔蓝'],['LBL','浅蓝'],
    ['CHR','棕红'],['OY2','深绿'],['BK_CQ','黑红'],
  ];
  for (const [t,n] of tokens) if (code.includes(t)) return n;
  return '';
}

// ── 现有品类解析（与前端一致）──────────────────────────────────────────────
function decodeGarmentFromName(name) {
  if (!name) return '';
  const u = name.toUpperCase();
  const types = [
    ['T-SHIRT','T恤'],['T SHIRT','T恤'],['T-SH','T恤'],['T SHI','T恤'],['T SH','T恤'],[' TEE','T恤'],['TANK','背心'],
    ['SWEATSHIRT','卫衣'],['HOODIE','连帽衫'],['CREWNECK SWEA','毛衣'],['SWEATER','毛衣'],['CREWNECK','圆领衫'],['CARDIGAN','开衫'],
    ['POLO','Polo衫'],['POL','Polo衫'],['BLOUSON','夹克'],['BLOUSE','衬衫'],['BOMBER','飞行夹克'],['BOM','飞行夹克'],
    ['WINDBREAKER','风衣'],['WINDREAKER','风衣'],['TRENCH','风衣'],['BALMACAAN','大衣'],['TRUCKER','夹克'],['BLAZER','西装外套'],
    ['PUFFER','羽绒服'],['DOWN VEST','羽绒马甲'],['VEST','马甲'],['RACER','机车夹克'],
    ['JACKET','夹克'],['JACKE','夹克'],['JACK','夹克'],['LEATHER J','夹克'],['JAC','夹克'],
    ['CARPENTER PANT','工装裤'],['JEANS','牛仔裤'],['JEAN','牛仔裤'],['TROUSER','长裤'],['JOGGER','运动裤'],['PANTS','裤子'],['PANT','裤子'],['SHORTS','短裤'],
    ['COAT','大衣'],['DRESS','连衣裙'],['SKIRT','半身裙'],['SHIRT','衬衫'],['SINGLE BREASTED','西装外套'],
  ];
  for (const [t,n] of types) if (u.includes(t)) return n;
  // 结尾匹配（截断名字）
  const suffixes = [['CAR','开衫'],['T S','T恤'],['PLEATED S','半身裙'],['C J','夹克']];
  for (const [t,n] of suffixes) if (u.endsWith(t)) return n;
  return '';
}

// ── 加载 PRODUCTS ──────────────────────────────────────────────────────────
const rawJs = fs.readFileSync(path.join(PUBLIC, 'product_data.js'), 'utf8');
const match = rawJs.match(/const PRODUCTS\s*=\s*(\[[\s\S]*\]);/);
if (!match) { console.error('无法解析 product_data.js'); process.exit(1); }
const PRODUCTS = JSON.parse(match[1]);
console.log(`加载 ${PRODUCTS.length} 条商品`);

// ── 需要视觉识别的商品 ─────────────────────────────────────────────────────
const needsGarment = PRODUCTS.filter(p =>
  p.type === '衣' && p.image && !decodeGarmentFromName(p.productName)
);
const needsColor = PRODUCTS.filter(p =>
  p.image && !decodeColorFromCode(p.colorCode)
);
// 合并去重（用 image 做 key）
const needsVision = [...new Map(
  [...needsGarment, ...needsColor].map(p => [p.image, p])
).values()];

console.log(`需要视觉识别：${needsVision.length} 件`);
console.log(`  - 品类未知（衣类）：${needsGarment.length} 件`);
console.log(`  - 颜色码无法解析：${needsColor.length} 件`);

if (needsVision.length === 0) {
  console.log('所有标签已完整，无需识别。');
  process.exit(0);
}

// ── 视觉 API ───────────────────────────────────────────────────────────────
function toBase64(imgPath) {
  const full = path.join(PUBLIC, imgPath);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  const mime = imgPath.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function callVision(model, dataUrl, prompt) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: prompt }
      ]}],
      max_tokens: 30,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  const data = JSON.parse(text);
  return { ok: true, content: data.choices?.[0]?.message?.content?.trim() || '' };
}

// ── 探测可用视觉模型 ───────────────────────────────────────────────────────
const MODELS_TO_TRY = [
  'qwen3.6-flash', 'qwen3.5-flash', 'qwen3.6-plus', 'qwen3.5-plus',
  'qwen3.7-plus',  'qwen-vl-plus',  'qwen-vl-max',
];

async function findModel() {
  if (PREFERRED_MODEL) {
    console.log(`\n使用指定模型: ${PREFERRED_MODEL}`);
    return PREFERRED_MODEL;
  }
  console.log('\n🔍 探测可用视觉模型...');
  const testImg = needsVision[0];
  const dataUrl = toBase64(testImg.image);
  for (const m of MODELS_TO_TRY) {
    process.stdout.write(`  ${m.padEnd(20)} ... `);
    try {
      const r = await callVision(m, dataUrl, '这是什么颜色的衣服？只回答颜色。');
      if (r.ok) { console.log(`✅ "${r.content}"`); return m; }
      console.log(`❌ ${r.status}: ${r.body.slice(0, 100)}`);
    } catch(e) { console.log(`❌ ${e.message}`); }
  }
  return null;
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
const model = await findModel();
if (!model) {
  console.error('\n❌ 没有可用的视觉模型，请检查 endpoint 或使用 VISION_MODEL=xxx 指定');
  process.exit(1);
}
console.log(`\n✅ 使用模型: ${model}`);

// 缓存：image → { garment?, color? }
const cache = {};

// 读取已有缓存（断点续跑）
const CACHE_FILE = path.join(__dirname, 'enrich_cache.json');
if (fs.existsSync(CACHE_FILE)) {
  Object.assign(cache, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
  console.log(`已加载缓存 ${Object.keys(cache).length} 条`);
}

const GARMENT_PROMPT = (name) =>
  `这是一件服装产品图片，产品名（可能被截断）：${name}。
只输出一个品类词，从以下选项选：T恤/衬衫/Polo衫/卫衣/连帽衫/毛衣/开衫/圆领衫/背心/夹克/飞行夹克/机车夹克/西装外套/风衣/大衣/羽绒服/马甲/牛仔裤/裤子/短裤/连衣裙/半身裙。不要解释。`;

const COLOR_PROMPT =
  `这件商品的主色调是什么？只输出一个颜色词，如：黑/白/米白/灰/棕/深棕/卡其/蓝/海军蓝/绿/橄榄绿/红/粉/紫/黄/奶油/多色。不要解释。`;

let done = 0;
console.log(`\n开始识别 ${needsVision.length} 件商品...\n`);

for (const p of needsVision) {
  const key = p.image;
  const cached = cache[key] || {};
  const needG = p.type === '衣' && !decodeGarmentFromName(p.productName) && !cached.garment;
  const needC = !decodeColorFromCode(p.colorCode) && !cached.color;
  if (!needG && !needC) { done++; continue; }

  const dataUrl = toBase64(p.image);
  if (!dataUrl) { console.log(`  ⚠️  图片不存在: ${p.image}`); continue; }

  process.stdout.write(`  [${++done}/${needsVision.length}] ${p.styleCode} `);

  if (needG) {
    try {
      const r = await callVision(model, dataUrl, GARMENT_PROMPT(p.productName));
      cached.garment = r.ok ? r.content : '服装';
      process.stdout.write(`品类="${cached.garment}" `);
    } catch(e) { cached.garment = '服装'; }
    await new Promise(r => setTimeout(r, 200));
  }

  if (needC) {
    try {
      const r = await callVision(model, dataUrl, COLOR_PROMPT);
      cached.color = r.ok ? r.content : '';
      process.stdout.write(`颜色="${cached.color}" `);
    } catch(e) { cached.color = ''; }
    await new Promise(r => setTimeout(r, 200));
  }

  cache[key] = cached;
  // 每条都保存缓存，支持断点续跑
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log();
}

// ── 生成增强版 product_data.js ────────────────────────────────────────────
console.log('\n生成增强数据...');
const enriched = PRODUCTS.map(p => {
  const c = cache[p.image] || {};
  const garmentLabel = p.type === '包' ? '包' :
                       p.type === '鞋' ? '鞋' :
                       decodeGarmentFromName(p.productName) || c.garment || '服装';
  const colorLabel   = decodeColorFromCode(p.colorCode) || c.color || '';
  return { ...p, garmentLabel, colorLabel };
});

const outPath = path.join(PUBLIC, 'product_data.js');
const outContent = `const PRODUCTS = ${JSON.stringify(enriched, null, 0)};\n`;
fs.writeFileSync(outPath, outContent);
console.log(`\n✅ 已写入 ${outPath}`);

// 汇总
const withGarment = enriched.filter(p => p.type === '衣' && p.garmentLabel !== '服装').length;
const totalClothes = enriched.filter(p => p.type === '衣').length;
const withColor    = enriched.filter(p => p.colorLabel).length;
console.log(`品类识别：${withGarment}/${totalClothes} 件衣服有具体品类`);
console.log(`颜色识别：${withColor}/${enriched.length} 件有颜色标签`);
