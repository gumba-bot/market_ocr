import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recognize } = require('tesseract.js');
const sharp = require('sharp');

const root = process.cwd();
const casesPath = path.join(root, 'test_artifacts', 'selected_cases.json');
const outDir = path.join(root, 'test_artifacts', 'ocr_runs');
const cacheDir = path.join(outDir, 'ocr_cache');

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
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
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

function heuristicResultScore(parsed) {
  const name = String(parsed.name || '');
  const priceDigits = String(parsed.price || '').replace(/[^0-9]/g, '');
  const hangulCount = (name.match(/[가-힣]/g) || []).length;
  const latinCount = (name.match(/[A-Za-z]/g) || []).length;
  const digitCount = (name.match(/[0-9]/g) || []).length;
  const tokenCount = name.split(/\s+/).filter(Boolean).length;
  const symbolNoise = (name.match(/[^0-9A-Za-z가-힣\s]/g) || []).length;
  const price = Number(priceDigits || 0);
  let score = Number(parsed.confidence || 0);

  if (priceDigits.length >= 4 && priceDigits.length <= 5) score += 70;
  if (priceDigits.length === 3) score -= 70;
  if (priceDigits.length > 5) score -= 15;
  if (price >= 1000 && price <= 100000) score += 25;
  if (price > 0 && price < 1000) score -= 50;
  if (price >= 1000 && price % 10 !== 0) score -= 90;
  if (price >= 1000 && price % 100 === 0) score += 45;
  if (price >= 1000 && /[89]0$/.test(priceDigits)) score += 30;
  if (hangulCount >= 2) score += 35;
  if (hangulCount >= 5) score += 15;
  if (latinCount > hangulCount && hangulCount < 2) score -= 25;
  if (digitCount > hangulCount + latinCount) score -= 20;
  if (tokenCount >= 8 && hangulCount < 6) score -= 45;
  if (tokenCount >= 12) score -= 35;
  if (symbolNoise >= 2) score -= 15;
  if (name.length > 40) score -= 30;
  if (parsed.method === 'coordinates') score += 8;
  if (!name) score -= 30;
  if (!priceDigits) score -= 45;

  return score;
}

async function recognizeCached(imagePath) {
  await fs.mkdir(cacheDir, { recursive: true });
  const stat = await fs.stat(imagePath);
  const cacheKey = Buffer.from(`${imagePath}:${stat.size}:${stat.mtimeMs}`).toString('base64url');
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);

  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    const { data } = await recognize(imagePath, 'kor+eng');
    const compact = {
      text: data.text || '',
      width: data.width || 0,
      height: data.height || 0,
      words: (data.words || []).map(word => ({
        text: word.text || '',
        confidence: word.confidence,
        bbox: word.bbox,
      })),
    };
    await fs.writeFile(cachePath, `${JSON.stringify(compact)}\n`, 'utf8');
    return compact;
  }
}

async function createOcrVariants(testCase) {
  const imagePath = path.join(root, testCase.path);
  const source = sharp(imagePath, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const specs = [
    { id: 'full', x: 0, y: 0, w: 1, h: 1 },
    { id: 'center_tag', x: 0.12, y: 0.05, w: 0.76, h: 0.78 },
    { id: 'middle_tag', x: 0.05, y: 0.12, w: 0.9, h: 0.76 },
    { id: 'top_band', x: 0, y: 0, w: 1, h: 0.72 },
    { id: 'lower_label', x: 0, y: 0.25, w: 1, h: 0.7 },
    { id: 'left_center', x: 0, y: 0.08, w: 0.62, h: 0.82 },
    { id: 'right_center', x: 0.38, y: 0.08, w: 0.62, h: 0.82 },
    { id: 'center_narrow', x: 0.25, y: 0.05, w: 0.5, h: 0.9 },
    { id: 'price_lower_center', x: 0.12, y: 0.32, w: 0.76, h: 0.5 },
    { id: 'price_lower_right', x: 0.38, y: 0.32, w: 0.58, h: 0.5 },
  ];

  const variants = [];
  const caseDir = path.join(outDir, 'variants', testCase.id);
  await fs.mkdir(caseDir, { recursive: true });

  for (const spec of specs) {
    const left = Math.max(0, Math.round(width * spec.x));
    const top = Math.max(0, Math.round(height * spec.y));
    const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * spec.w)));
    const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * spec.h)));
    const outPath = path.join(caseDir, `${spec.id}.png`);

    try {
      await fs.access(outPath);
    } catch {
      await sharp(imagePath, { failOn: 'none' })
        .rotate()
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toFile(outPath);
    }

    variants.push({ id: spec.id, path: outPath });
  }

  return variants;
}

async function loadParser() {
  const appSource = await fs.readFile(path.join(root, 'app.js'), 'utf8');
  const start = appSource.indexOf('  function cleanLine(line) {');
  const end = appSource.indexOf('  function addScannedItem(parsed) {');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not extract OCR parser block from app.js');
  }

  const parserBlock = appSource.slice(start, end);
  const source = `
    function formatNumber(numStr) {
      if (!numStr) return '';
      const cleanNum = String(numStr).replace(/,/g, '').replace(/[^0-9]/g, '');
      if (!cleanNum) return '';
      return parseInt(cleanNum, 10).toLocaleString('ko-KR');
    }
    let priceTagTemplates = [];
    function savePriceTagTemplates() {}
${parserBlock}
    globalThis.parsePriceTag = parsePriceTag;
  `;
  const context = { console, globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app_parser_extract.js' });
  return context.globalThis.parsePriceTag;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const cases = JSON.parse(await fs.readFile(casesPath, 'utf8'));
  const parsePriceTag = await loadParser();
  const startedAt = new Date();
  const results = [];

  for (const testCase of cases) {
    console.log(`[OCR] ${testCase.id}`);
    const variants = await createOcrVariants(testCase);
    const variantResults = [];

    for (const variant of variants) {
      const data = await recognizeCached(variant.path);
      const parsed = parsePriceTag(data);
      variantResults.push({
        variant: variant.id,
        parsed,
        rawText: data.text || '',
        heuristicScore: heuristicResultScore(parsed),
      });
    }

    const selected = variantResults.sort((a, b) => b.heuristicScore - a.heuristicScore)[0];
    const parsed = selected.parsed;
    const productNameScore = nameScore(parsed.name, testCase.expectedName);
    const finalPriceScore = priceScore(parsed.price, testCase.expectedPrice);
    const combinedScore = (productNameScore * 0.5) + (finalPriceScore * 0.5);

    results.push({
      ...testCase,
      actualName: parsed.name || '',
      actualPrice: parsed.price || '',
      selectedVariant: selected.variant,
      selectionHeuristicScore: Number(selected.heuristicScore.toFixed(3)),
      parserMethod: parsed.method || '',
      parserConfidence: parsed.confidence || 0,
      nameScore: Number(productNameScore.toFixed(3)),
      priceScore: Number(finalPriceScore.toFixed(3)),
      combinedScore: Number(combinedScore.toFixed(3)),
      rawText: selected.rawText,
      variants: variantResults.map(item => ({
        variant: item.variant,
        actualName: item.parsed.name || '',
        actualPrice: item.parsed.price || '',
        method: item.parsed.method || '',
        confidence: item.parsed.confidence || 0,
        heuristicScore: Number(item.heuristicScore.toFixed(3)),
      })),
    });
  }

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    caseCount: results.length,
    averageNameScore: Number((results.reduce((sum, item) => sum + item.nameScore, 0) / results.length).toFixed(3)),
    averagePriceScore: Number((results.reduce((sum, item) => sum + item.priceScore, 0) / results.length).toFixed(3)),
    averageCombinedScore: Number((results.reduce((sum, item) => sum + item.combinedScore, 0) / results.length).toFixed(3)),
  };

  const report = { summary, results };
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const jsonPath = path.join(outDir, `ocr_regression_${stamp}.json`);
  const mdPath = path.join(outDir, `ocr_regression_${stamp}.md`);

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');
  console.log(`[DONE] ${jsonPath}`);
  console.log(`[DONE] ${mdPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

function renderMarkdown(report) {
  const lines = [
    '# OCR Regression Report',
    '',
    `- Started: ${report.summary.startedAt}`,
    `- Cases: ${report.summary.caseCount}`,
    `- Average name score: ${report.summary.averageNameScore}`,
    `- Average price score: ${report.summary.averagePriceScore}`,
    `- Average combined score: ${report.summary.averageCombinedScore}`,
    '',
    '| Case | Expected | Actual | Variant | Method | Name | Price | Combined |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  ];

  report.results.forEach((item) => {
    const expected = `${item.expectedName} / ${item.expectedPrice}`;
    const actual = `${item.actualName || '(blank)'} / ${item.actualPrice || '(blank)'}`;
    lines.push(`| ${item.id} | ${escapePipe(expected)} | ${escapePipe(actual)} | ${item.selectedVariant} | ${item.parserMethod} | ${item.nameScore} | ${item.priceScore} | ${item.combinedScore} |`);
  });

  lines.push('', '## Variant Selection');
  report.results.forEach((item) => {
    lines.push('', `### ${item.id}`, '', '| Variant | Actual | Method | Confidence | Heuristic |', '| --- | --- | --- | ---: | ---: |');
    item.variants.forEach((variant) => {
      lines.push(`| ${variant.variant} | ${escapePipe(`${variant.actualName || '(blank)'} / ${variant.actualPrice || '(blank)'}`)} | ${variant.method} | ${variant.confidence} | ${variant.heuristicScore} |`);
    });
  });

  lines.push('', '## Raw OCR Text');
  report.results.forEach((item) => {
    lines.push('', `### ${item.id}`, '', '```text', item.rawText.trim(), '```');
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
