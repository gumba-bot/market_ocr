import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const rawPath = path.join(root, 'test_artifacts', 'ocr_runs', 'paddleocr_raw.json');
const outDir = path.join(root, 'test_artifacts', 'ocr_runs');

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

async function loadParser() {
  const appSource = await fs.readFile(path.join(root, 'app.js'), 'utf8');
  const start = appSource.indexOf('  function cleanLine(line) {');
  const end = appSource.indexOf('  function addScannedItem(parsed) {');
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not extract OCR parser block from app.js');

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
  const raw = JSON.parse(await fs.readFile(rawPath, 'utf8'));
  const parsePriceTag = await loadParser();
  const startedAt = new Date();

  const results = raw.map((testCase) => {
    const parsed = parsePriceTag(testCase.ocrData);
    const productNameScore = nameScore(parsed.name, testCase.expectedName);
    const finalPriceScore = priceScore(parsed.price, testCase.expectedPrice);
    const combinedScore = (productNameScore * 0.5) + (finalPriceScore * 0.5);
    return {
      ...testCase,
      actualName: parsed.name || '',
      actualPrice: parsed.price || '',
      parserMethod: parsed.method || '',
      parserConfidence: parsed.confidence || 0,
      nameScore: Number(productNameScore.toFixed(3)),
      priceScore: Number(finalPriceScore.toFixed(3)),
      combinedScore: Number(combinedScore.toFixed(3)),
      rawText: testCase.ocrData.text || '',
      ocrData: undefined,
    };
  });

  const summary = {
    provider: 'paddleocr',
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
  const jsonPath = path.join(outDir, `paddleocr_eval_${stamp}.json`);
  const mdPath = path.join(outDir, `paddleocr_eval_${stamp}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(report), 'utf8');
  console.log(`[DONE] ${jsonPath}`);
  console.log(`[DONE] ${mdPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

function renderMarkdown(report) {
  const lines = [
    '# PaddleOCR Comparison Report',
    '',
    `- Started: ${report.summary.startedAt}`,
    `- Cases: ${report.summary.caseCount}`,
    `- Average name score: ${report.summary.averageNameScore}`,
    `- Average price score: ${report.summary.averagePriceScore}`,
    `- Average combined score: ${report.summary.averageCombinedScore}`,
    `- Price exact: ${report.summary.priceExact}`,
    '',
    '| Case | Expected | Actual | Method | Name | Price | Combined |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ];

  report.results.forEach((item) => {
    const expected = `${item.expectedName} / ${item.expectedPrice}`;
    const actual = `${item.actualName || '(blank)'} / ${item.actualPrice || '(blank)'}`;
    lines.push(`| ${item.id} | ${escapePipe(expected)} | ${escapePipe(actual)} | ${item.parserMethod} | ${item.nameScore} | ${item.priceScore} | ${item.combinedScore} |`);
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
