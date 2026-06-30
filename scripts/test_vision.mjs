// 测试私有 endpoint 视觉识别，并列出未分类服装的识别结果
// 用法: DASHSCOPE_API_KEY=xxx node scripts/test_vision.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.DASHSCOPE_API_KEY;
if (!API_KEY) {
  console.error('请设置 DASHSCOPE_API_KEY 环境变量');
  process.exit(1);
}

const ENDPOINT = 'https://ws-nw9gantac6nmtvhr.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

// 按优先级尝试的视觉模型（flash 最快最便宜，plus 效果更好）
const MODELS_TO_TRY = [
  'qwen3.6-flash',
  'qwen3.5-flash',
  'qwen3.6-plus',
  'qwen3.5-plus',
  'qwen-vl-plus',
  'qwen-vl-max',
];

// 未分类的 12 件服装
const UNCLASSIFIED = [
  { name: 'COACH X CLOT RELAXED HORSE AND', image: 'product_images/女衣_CDD84_GRY.png',  styleCode: 'CDD84' },
  { name: 'CROPPED HORSE AND CARRIAGE HEA',  image: 'product_images/女衣_CDI34_BRN.png',  styleCode: 'CDI34' },
  { name: 'HORSE AND CARRIAGE STRIPED RUG',  image: 'product_images/女衣_CDI35_PIN.png',  styleCode: 'CDI35' },
  { name: 'DISTRESSED LONG SLEEVE V NECK',   image: 'product_images/女衣_CDI62_TN2.png',  styleCode: 'CDI62' },
  { name: 'COACH X CLOT SIGNATURE DENIM S',  image: 'product_images/女衣_CDK73_OYG.png',  styleCode: 'CDK73' },
  { name: 'COACH X CLOT HORSE AND CARRIAG',  image: 'product_images/女衣_CDR01_WHT.png',  styleCode: 'CDR01' },
  { name: 'HORSE AND CARRIAGE LONG SLEEVE',  image: 'product_images/男衣_CCQ18_BLK.png',  styleCode: 'CCQ18' },
  { name: 'COACH X CLOT KNOT FRONT LEATHE', image: 'product_images/男衣_CDD30_BLK.png',  styleCode: 'CDD30' },
  { name: 'COACH X CLOT RELAXED SIGNATURE', image: 'product_images/男衣_CDD51_OY2.png',  styleCode: 'CDD51' },
  { name: 'REXY ANNIVERSARY RELAXED JUNGL', image: 'product_images/男衣_CEI18_TNR.png',  styleCode: 'CEI18' },
  { name: 'HERITAGE C LIGHTWEIGHT LEATHER', image: 'product_images/男衣_CU447_BLK.png',  styleCode: 'CU447' },
  { name: 'REVERSIBLE LEATHER TRAINER',     image: 'product_images/男衣_CV534_BK_CQ.png', styleCode: 'CV534' },
];

function toBase64(imgPath) {
  const fullPath = path.join(__dirname, '../public', imgPath);
  const buf = fs.readFileSync(fullPath);
  const ext = path.extname(imgPath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
  return { b64: buf.toString('base64'), mime };
}

async function callVision(model, imgPath, productName) {
  const { b64, mime } = toBase64(imgPath);
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${b64}` }
        },
        {
          type: 'text',
          text: `这是一件服装产品图片，产品名称（可能被截断）：${productName}。
请从以下选项中选择最准确的品类（只输出一个词，不要解释）：
T恤 / 衬衫 / Polo衫 / 卫衣 / 连帽衫 / 毛衣 / 开衫 / 圆领衫 / 背心 /
夹克 / 飞行夹克 / 机车夹克 / 西装外套 / 风衣 / 大衣 / 羽绒服 / 马甲 /
牛仔裤 / 裤子 / 短裤 / 连衣裙 / 半身裙`
        }
      ]
    }],
    max_tokens: 20,
    temperature: 0
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };

  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content?.trim();
  return { ok: true, content };
}

// 第一步：用一张图探测哪个模型可用
async function findWorkingModel() {
  const testImg = UNCLASSIFIED[0];
  console.log(`\n🔍 探测可用视觉模型（测试图: ${testImg.image}）...\n`);

  for (const model of MODELS_TO_TRY) {
    process.stdout.write(`  ${model} ... `);
    try {
      const r = await callVision(model, testImg.image, testImg.name);
      if (r.ok) {
        console.log(`✅  识别结果: "${r.content}"`);
        return model;
      } else {
        console.log(`❌  ${r.status}: ${r.body.slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`❌  ${e.message}`);
    }
  }
  return null;
}

// 第二步：用找到的模型识别全部 12 件
async function classifyAll(model) {
  console.log(`\n📋 使用模型 ${model} 识别全部 ${UNCLASSIFIED.length} 件...\n`);
  const results = [];

  for (const p of UNCLASSIFIED) {
    process.stdout.write(`  [${p.styleCode}] ${p.name.padEnd(32)} → `);
    try {
      const r = await callVision(model, p.image, p.name);
      if (r.ok) {
        console.log(`"${r.content}"`);
        results.push({ styleCode: p.styleCode, category: r.content });
      } else {
        console.log(`ERROR ${r.status}`);
        results.push({ styleCode: p.styleCode, category: '服装', error: r.body.slice(0, 80) });
      }
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ styleCode: p.styleCode, category: '服装', error: e.message });
    }
    // 避免频率限制
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n\n// ===== 把这段粘贴进 category_overview.html 和 product_list.html 的识别函数前 =====');
  console.log('const VISION_CATEGORY_MAP = {');
  results.forEach(r => console.log(`  '${r.styleCode}': '${r.category}',`));
  console.log('};');

  return results;
}

const model = await findWorkingModel();
if (model) {
  await classifyAll(model);
} else {
  console.log('\n❌ 该 endpoint 上没有可用的视觉模型。');
  console.log('   可选方案：改用公共 DashScope API (dashscope.aliyuncs.com)');
}
