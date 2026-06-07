import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const casesPath = path.join(root, 'test_artifacts', 'selected_cases.json');
const outDir = path.join(root, 'test_artifacts', 'ocr_runs');
const cacheDir = path.join(outDir, 'openai_vision_cache');
const model = process.env.OPENAI_VISION_MODEL || 'gpt-5.5';

function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[()\[\]{}]/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
}

function levenshtein(a, b) {
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function nameScore(actual, expected) {
  const a = normalizeComparable(actual);
  const e = normalizeComparable(expected);
  if (!a && !e) return 1;
  if (!a || !e) return 0;
  if (a.includes(e) || e.includes(a)) return Math.min(a.length, e.length) / Math.max(a.length, e.length);
  return Math.max(0, 1 - (levenshtein(a, e) / Math.max(a.length, e.length)));
}

function priceScore(actual, expected) {
  const a = String(actual || '').replace(/[^0-9]/g, '');
  const e = String(expected || '').replace(/[^0-9]/g, '');
  if (!a || !e) return 0;
  return a === e ? 1 : 0;
}

async function imageToDataUrl(imagePath) {
  const buffer = await sharp(imagePath, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function getResponseText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

async function extractWithOpenAI(testCase) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  await fs.mkdir(cacheDir, { recursive: true });
  const imagePath = path.join(root, testCase.path);
  const stat = await fs.stat(imagePath);
  const cachePath = path.join(cacheDir, `${testCase.id}_${model}_${stat.size}_${Math.round(stat.mtimeMs)}.json`.replace(/[^0-9A-Za-z_.-]/g, '_'));

  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    const imageUrl = await imageToDataUrl(imagePath);
    const body = {
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You extract Korean retail price-tag data.',
                'Return only the target product name and final selling unit price.',
                'Ignore barcode numbers, dates, weight, quantity, unit price such as 100g당, normal/original prices, and nearby unrelated price tags.',
                'If the image contains multiple price tags, follow the user target rule.',
                'If the target cannot be read confidently, set needsReview=true and still return the best visible guess.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Target rule: ${testCase.targetRule}. Extract JSON fields for this price-tag image.`,
            },
            {
              type: 'input_image',
              image_url: imageUrl,
              detail: 'high',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'price_tag_extraction',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              productName: { type: 'string' },
              finalUnitPrice: { type: 'string' },
              priceDigits: { type: 'string' },
              confidence: { type: 'number' },
              needsReview: { type: 'boolean' },
              targetTagDescription: { type: 'string' },
              rationale: { type: 'string' },
            },
            required: [
              'productName',
              'finalUnitPrice',
              'priceDigits',
              'confidence',
              'needsReview',
              'targetTagDescription',
              'rationale',
            ],
          },
        },
      },
      max_output_tokens: 800,
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${JSON.stringify(payload)}`);
    }

    const text = getResponseText(payload);
    const parsed = JSON.parse(text);
    const result = {
      provider: 'openai_vision',
      model,
      rawResponseText: text,
      ...parsed,
    };
    await fs.writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    return result;
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const cases = JSON.parse(await fs.readFile(casesPath, 'utf8'));
  const startedAt = new Date();
  const results = [];

  for (const testCase of cases) {
    console.log(`[OpenAI Vision] ${testCase.id}`);
    const extraction = await extractWithOpenAI(testCase);
    const actualPrice = extraction.priceDigits || extraction.finalUnitPrice || '';
    const productNameScore = nameScore(extraction.productName, testCase.expectedName);
    const finalPriceScore = priceScore(actualPrice, testCase.expectedPrice);
    const combinedScore = (productNameScore * 0.5) + (finalPriceScore * 0.5);

    results.push({
      ...testCase,
      actualName: extraction.productName || '',
      actualPrice,
      finalUnitPrice: extraction.finalUnitPrice || '',
      confidence: extraction.confidence,
      needsReview: extraction.needsReview,
      targetTagDescription: extraction.targetTagDescription,
      rationale: extraction.rationale,
      nameScore: Number(productNameScore.toFixed(3)),
      priceScore: Number(finalPriceScore.toFixed(3)),
      combinedScore: Number(combinedScore.toFixed(3)),
    });
  }

  const summary = {
    provider: 'openai_vision',
    model,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    caseCount: results.length,
    averageNameScore: Number((results.reduce((sum, item) => sum + item.nameScore, 0) / results.length).toFixed(3)),
    averagePriceScore: Number((results.reduce((sum, item) => sum + item.priceScore, 0) / results.length).toFixed(3)),
    averageCombinedScore: Number((results.reduce((sum, item) => sum + item.combinedScore, 0) / results.length).toFixed(3)),
    priceExact: `${results.filter(item => item.priceScore === 1).length}/${results.length}`,
  };

  const report = { summary, results };
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const jsonPath = path.join(outDir, `openai_vision_${stamp}.json`);
  const mdPath = path.join(outDir, `openai_vision_${stamp}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');
  console.log(`[DONE] ${jsonPath}`);
  console.log(`[DONE] ${mdPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

function renderMarkdown(report) {
  const lines = [
    '# OpenAI Vision OCR Comparison Report',
    '',
    `- Model: ${report.summary.model}`,
    `- Started: ${report.summary.startedAt}`,
    `- Cases: ${report.summary.caseCount}`,
    `- Average name score: ${report.summary.averageNameScore}`,
    `- Average price score: ${report.summary.averagePriceScore}`,
    `- Average combined score: ${report.summary.averageCombinedScore}`,
    `- Price exact: ${report.summary.priceExact}`,
    '',
    '| Case | Expected | Actual | Review | Name | Price | Combined |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ];

  report.results.forEach((item) => {
    const expected = `${item.expectedName} / ${item.expectedPrice}`;
    const actual = `${item.actualName || '(blank)'} / ${item.actualPrice || '(blank)'}`;
    lines.push(`| ${item.id} | ${escapePipe(expected)} | ${escapePipe(actual)} | ${item.needsReview ? 'yes' : 'no'} | ${item.nameScore} | ${item.priceScore} | ${item.combinedScore} |`);
  });

  lines.push('', '## Details');
  report.results.forEach((item) => {
    lines.push('', `### ${item.id}`, '', `- Target: ${item.targetRule}`, `- Description: ${item.targetTagDescription || ''}`, `- Rationale: ${item.rationale || ''}`);
  });

  return `${lines.join('\n')}\n`;
}

function escapePipe(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
