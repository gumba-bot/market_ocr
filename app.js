document.addEventListener('DOMContentLoaded', () => {
  const itemsList = document.querySelector('.items-list');
  const totalCountEl = document.querySelector('.count-value');
  const totalPriceEl = document.querySelector('.price-value');
  const clearBtn = document.querySelector('.clear-btn');
  const installBtn = document.querySelector('.install-btn');
  const cameraBtn = document.querySelector('.camera-btn');
  const photoInput = document.querySelector('.photo-input');
  const scanPanel = document.querySelector('.scan-panel');
  const scanPreview = document.querySelector('.scan-preview');
  const scanStatus = document.querySelector('.scan-status');
  const scanResult = document.querySelector('.scan-result');
  const areaSelectBtn = document.querySelector('.area-select-btn');
  const regionModal = document.querySelector('.region-modal');
  const regionImage = document.querySelector('.region-image');
  const regionImageWrap = document.querySelector('.region-image-wrap');
  const regionModeBtns = document.querySelectorAll('.region-mode-btn');
  const regionCloseBtn = document.querySelector('.region-close-btn');
  const regionRunBtn = document.querySelector('.region-run-btn');
  const regionResetBtn = document.querySelector('.region-reset-btn');
  const nameRegionBox = document.querySelector('.name-region-box');
  const priceRegionBox = document.querySelector('.price-region-box');
  const draftRegionBox = document.querySelector('.draft-region-box');

  const TEMPLATE_STORAGE_KEY = 'market_cal_price_tag_templates';
  const MAX_TEMPLATES = 12;
  const pendingScanContexts = new Map();

  let items = [];
  let deferredPrompt;
  let currentPreviewUrl = '';
  let currentPhotoFile = null;
  let lastScannedItemId = '';
  let priceTagTemplates = loadPriceTagTemplates();
  let regionMode = 'name';
  let regionDraftStart = null;
  let regionSelection = { name: null, price: null };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Service Worker registration failed:', err);
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block';
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  const saved = localStorage.getItem('market_cal_items');
  if (saved) {
    try {
      items = JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse localStorage data:', e);
    }
  }

  if (!items || items.length === 0) {
    items = [createItem()];
  }

  function createItem(data = {}) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: '',
      price: '',
      count: 1,
      ...data,
    };
  }

  function saveToLocalStorage() {
    localStorage.setItem('market_cal_items', JSON.stringify(items));
  }

  function loadPriceTagTemplates() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(template => template.nameRegion && template.priceRegion) : [];
    } catch {
      return [];
    }
  }

  function savePriceTagTemplates() {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(priceTagTemplates.slice(0, MAX_TEMPLATES)));
  }

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatNumber(numStr) {
    if (!numStr) return '';
    const cleanNum = String(numStr).replace(/,/g, '').replace(/[^0-9]/g, '');
    if (!cleanNum) return '';
    return parseInt(cleanNum, 10).toLocaleString('ko-KR');
  }

  function parseNumber(numStr) {
    if (!numStr) return 0;
    return parseInt(String(numStr).replace(/,/g, ''), 10) || 0;
  }

  function updateTotals() {
    const validItems = items.filter(item => (item.name && item.name.trim() !== '') || item.price !== '');
    const totalCount = validItems.length;
    const totalPrice = validItems.reduce((sum, item) => {
      const countVal = item.count !== undefined && item.count !== '' ? item.count : 1;
      const countNum = parseInt(countVal, 10) || 0;
      return sum + (parseNumber(item.price) * countNum);
    }, 0);

    totalCountEl.textContent = `${totalCount}개`;
    totalPriceEl.textContent = `${totalPrice.toLocaleString('ko-KR')}원`;
  }

  function updateRowTotal(row, item) {
    const countVal = item.count !== undefined && item.count !== '' ? item.count : 1;
    const countNum = parseInt(countVal, 10) || 0;
    const itemTotal = (parseNumber(item.price) || 0) * countNum;
    row.querySelector('.item-total').textContent = itemTotal > 0 ? itemTotal.toLocaleString('ko-KR') : '';
  }

  function maybeLearnFromCorrection(item) {
    const context = pendingScanContexts.get(item.id);
    if (!context || context.learned) return;

    const learned = learnTemplateFromCorrection(context, item);
    if (!learned) return;

    context.learned = true;
    priceTagTemplates = [
      learned,
      ...priceTagTemplates.filter(template => template.signature !== learned.signature),
    ].slice(0, MAX_TEMPLATES);
    savePriceTagTemplates();
    setScanMessage('수정한 위치를 기억했습니다. 다음 가격표부터 같은 구조를 먼저 적용합니다.', {
      name: item.name,
      price: item.price,
    });
  }

  function checkAutoAdd() {
    if (items.length === 0) return;
    const lastItem = items[items.length - 1];
    if (lastItem && ((lastItem.name && lastItem.name !== '') || (lastItem.price && lastItem.price !== ''))) {
      const newItem = createItem();
      items.push(newItem);
      appendRow(newItem);
    }
  }

  function appendRow(item) {
    const countVal = item.count !== undefined && item.count !== '' ? item.count : 1;
    const countNum = parseInt(countVal, 10) || 0;
    const itemTotal = (parseNumber(item.price) || 0) * countNum;

    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.itemId = item.id;
    row.innerHTML = `
      <div class="col name-col">
        <input type="text" placeholder="상품명" value="${escapeAttr(item.name)}" class="item-input">
      </div>
      <div class="col price-col">
        <input type="text" inputmode="numeric" placeholder="단가" value="${escapeAttr(item.price)}" class="price-input">
      </div>
      <div class="col count-col">
        <input type="number" inputmode="numeric" min="1" placeholder="수량" value="${escapeAttr(countVal)}" class="count-input">
      </div>
      <div class="col total-col">
        <span class="item-total">${itemTotal > 0 ? itemTotal.toLocaleString('ko-KR') : ''}</span>
      </div>
      <div class="col delete-col">
        <button class="delete-item-btn" type="button" tabindex="-1" aria-label="상품 삭제">삭제</button>
      </div>
    `;

    const nameInput = row.querySelector('.item-input');
    const priceInput = row.querySelector('.price-input');
    const countInput = row.querySelector('.count-input');
    const deleteBtn = row.querySelector('.delete-item-btn');

    nameInput.addEventListener('input', (e) => {
      item.name = e.target.value;
      maybeLearnFromCorrection(item);
      saveToLocalStorage();
      updateTotals();
      checkAutoAdd();
    });

    priceInput.addEventListener('input', (e) => {
      const cursorPosition = e.target.selectionStart;
      const oldLength = e.target.value.length;
      const formatted = formatNumber(e.target.value);
      item.price = formatted;
      e.target.value = formatted;
      maybeLearnFromCorrection(item);

      const diff = formatted.length - oldLength;
      const newPos = Math.max(0, cursorPosition + diff);
      try {
        e.target.setSelectionRange(newPos, newPos);
      } catch {
        // Some mobile numeric keyboards do not support selection ranges.
      }

      updateRowTotal(row, item);
      saveToLocalStorage();
      updateTotals();
      checkAutoAdd();
    });

    countInput.addEventListener('input', (e) => {
      const num = parseInt(e.target.value, 10);
      item.count = isNaN(num) ? '' : num;

      updateRowTotal(row, item);
      saveToLocalStorage();
      updateTotals();
    });

    deleteBtn.addEventListener('click', () => {
      if (!window.confirm('이 상품을 삭제하시겠습니까?')) {
        return;
      }

      const idx = items.indexOf(item);
      if (idx === -1) return;

      if (items.length <= 1) {
        item.name = '';
        item.price = '';
        item.count = 1;
        nameInput.value = '';
        priceInput.value = '';
        countInput.value = 1;
        updateRowTotal(row, item);
      } else {
        items.splice(idx, 1);
        row.remove();
      }

      saveToLocalStorage();
      updateTotals();
      checkAutoAdd();
    });

    itemsList.appendChild(row);
  }

  function renderAll() {
    itemsList.innerHTML = '';
    items.forEach(item => appendRow(item));
    updateTotals();
    checkAutoAdd();
  }

  function setScanMessage(message, result = null) {
    scanPanel.hidden = false;
    scanStatus.textContent = message;
    areaSelectBtn.hidden = !currentPhotoFile;

    if (result) {
      const methodLabel = result.method === 'template'
        ? '저장된 구조'
        : result.method === 'coordinates'
          ? '좌표 분석'
          : result.method === 'manual'
            ? '지정 영역'
            : '텍스트 분석';
      const confidence = Number.isFinite(result.confidence) ? ` · ${result.confidence}%` : '';
      scanResult.hidden = false;
      scanResult.innerHTML = `
        <span>${escapeAttr(result.name || '상품명 확인 필요')}</span>
        <strong>${escapeAttr(result.price || '단가 확인 필요')}</strong>
        <em>${escapeAttr(methodLabel + confidence)}</em>
      `;
    } else {
      scanResult.hidden = true;
      scanResult.innerHTML = '';
    }
  }

  function showPreview(file) {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
    }

    currentPhotoFile = file;
    currentPreviewUrl = URL.createObjectURL(file);
    scanPreview.src = currentPreviewUrl;
    scanPreview.hidden = false;
    areaSelectBtn.hidden = false;
  }

  async function loadImageSource(file) {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          close: () => {},
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      image.src = url;
    });
  }

  function paintOcrVariant(source, crop) {
    const maxSide = 1800;
    const cropX = Math.max(0, Math.round(source.width * crop.x));
    const cropY = Math.max(0, Math.round(source.height * crop.y));
    const cropWidth = Math.max(1, Math.min(source.width - cropX, Math.round(source.width * crop.w)));
    const cropHeight = Math.max(1, Math.min(source.height - cropY, Math.round(source.height * crop.h)));
    const scale = Math.min(maxSide / Math.max(cropWidth, cropHeight), 1.8);
    const width = Math.max(1, Math.round(cropWidth * scale));
    const height = Math.max(1, Math.round(cropHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source.image, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      const contrasted = Math.max(0, Math.min(255, ((gray - 128) * 1.45) + 128));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.92);
  }

  async function prepareImageVariantsForOcr(file) {
    const source = await loadImageSource(file);
    const crops = [
      { id: 'full', x: 0, y: 0, w: 1, h: 1 },
      { id: 'center', x: 0.12, y: 0.05, w: 0.76, h: 0.78 },
      { id: 'top', x: 0, y: 0, w: 1, h: 0.72 },
      { id: 'right', x: 0.38, y: 0.08, w: 0.62, h: 0.82 },
      { id: 'lower', x: 0.12, y: 0.32, w: 0.76, h: 0.5 },
    ];

    try {
      return crops.map(crop => ({
        id: crop.id,
        image: paintOcrVariant(source, crop),
      }));
    } finally {
      source.close();
    }
  }

  async function prepareRegionForOcr(file, region) {
    const source = await loadImageSource(file);
    try {
      const crop = {
        x: clamp(region.x0, 0, 1),
        y: clamp(region.y0, 0, 1),
        w: clamp(region.x1 - region.x0, 0.02, 1),
        h: clamp(region.y1 - region.y0, 0.02, 1),
      };
      return paintOcrVariant(source, crop);
    } finally {
      source.close();
    }
  }

  function cleanLine(line) {
    return line
      .replace(/[|()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const PRICE_PATTERN = /(?:[₩￦]\s*)?([0-9]{1,3}(?:(?:\s*[,.\s]\s*)[0-9]{3})+|[0-9]{3,8})\s*(?:원|won)?/gi;
  const PRICE_TEXT_PATTERN = /(?:[₩￦]\s*)?[0-9]{1,3}(?:(?:\s*[,.\s]\s*)[0-9]{3})+\s*(?:원|won)?|(?:[₩￦]\s*)?[0-9]{3,8}\s*(?:원|won)|(?:[₩￦]\s*)[0-9]{3,8}|[0-9]{4,8}(?!\s*(?:g|kg|ml|l|개입|입|봉|팩|매|%))/gi;
  const FINAL_PRICE_WORDS = /(최종|할인|행사|판매|특가|세일|쿠폰|회원|카드|가격|단가|매가)/;
  const ORIGINAL_PRICE_WORDS = /(정상|기존|소비자|권장|원가|before)/i;
  const UNIT_WORDS = /(g|kg|ml|l|개입|입|봉|매|팩|100g|용량)/i;
  const NAME_NOISE_WORDS = /(마트|매장|영수증|합계|결제|바코드|barcode|행사기간|유통기한|제조일|쿠폰|포인트|적립|총액|소계)/i;
  const PRICE_LABEL_WORDS = /(최종|할인|행사|판매가|판매|특가|세일|쿠폰|회원|카드|가격|단가|정상가|소비자가|원가|매가)/g;
  const HANGUL_PATTERN = /[가-힣]/;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeText(text) {
    return cleanLine(String(text || '').replace(/[^\w가-힣₩￦원%,.+/\-\s]/g, ' '));
  }

  function getBbox(source) {
    const bbox = source && (source.bbox || source.boundingBox || source);
    if (!bbox) return null;

    const firstFinite = (...values) => values.find(value => Number.isFinite(Number(value)));
    const x0 = Number(firstFinite(bbox.x0, bbox.left, bbox.x, bbox[0]));
    const y0 = Number(firstFinite(bbox.y0, bbox.top, bbox.y, bbox[1]));
    const x1 = Number(firstFinite(
      bbox.x1,
      bbox.right,
      Number.isFinite(Number(bbox.x)) && Number.isFinite(Number(bbox.w)) ? Number(bbox.x) + Number(bbox.w) : undefined,
      Number.isFinite(Number(bbox.x)) && Number.isFinite(Number(bbox.width)) ? Number(bbox.x) + Number(bbox.width) : undefined,
      bbox[2],
    ));
    const y1 = Number(firstFinite(
      bbox.y1,
      bbox.bottom,
      Number.isFinite(Number(bbox.y)) && Number.isFinite(Number(bbox.h)) ? Number(bbox.y) + Number(bbox.h) : undefined,
      Number.isFinite(Number(bbox.y)) && Number.isFinite(Number(bbox.height)) ? Number(bbox.y) + Number(bbox.height) : undefined,
      bbox[3],
    ));

    if ([x0, y0, x1, y1].some(value => !Number.isFinite(value))) return null;
    if (x1 <= x0 || y1 <= y0) return null;
    return { x0, y0, x1, y1 };
  }

  function unionBbox(items) {
    const boxes = items.map(item => item.bbox).filter(Boolean);
    if (boxes.length === 0) return null;

    return {
      x0: Math.min(...boxes.map(box => box.x0)),
      y0: Math.min(...boxes.map(box => box.y0)),
      x1: Math.max(...boxes.map(box => box.x1)),
      y1: Math.max(...boxes.map(box => box.y1)),
    };
  }

  function bboxCenter(box) {
    return {
      x: (box.x0 + box.x1) / 2,
      y: (box.y0 + box.y1) / 2,
    };
  }

  function bboxHeight(box) {
    return box.y1 - box.y0;
  }

  function bboxToRegion(box, width, height, padding = 0.025) {
    return {
      x0: clamp((box.x0 / width) - padding, 0, 1),
      y0: clamp((box.y0 / height) - padding, 0, 1),
      x1: clamp((box.x1 / width) + padding, 0, 1),
      y1: clamp((box.y1 / height) + padding, 0, 1),
    };
  }

  function regionToBbox(region, width, height, padding = 0) {
    return {
      x0: clamp(region.x0 - padding, 0, 1) * width,
      y0: clamp(region.y0 - padding, 0, 1) * height,
      x1: clamp(region.x1 + padding, 0, 1) * width,
      y1: clamp(region.y1 + padding, 0, 1) * height,
    };
  }

  function isCenterInside(box, regionBox) {
    const center = bboxCenter(box);
    return center.x >= regionBox.x0 && center.x <= regionBox.x1 && center.y >= regionBox.y0 && center.y <= regionBox.y1;
  }

  function groupWordsIntoLines(words) {
    if (words.length === 0) return [];

    const sortedWords = [...words].sort((a, b) => ((a.bbox.y0 + a.bbox.y1) / 2) - ((b.bbox.y0 + b.bbox.y1) / 2));
    const medianHeight = [...sortedWords]
      .map(word => bboxHeight(word.bbox))
      .sort((a, b) => a - b)[Math.floor(sortedWords.length / 2)] || 20;
    const lineThreshold = Math.max(10, medianHeight * 0.7);
    const buckets = [];

    sortedWords.forEach((word) => {
      const cy = bboxCenter(word.bbox).y;
      const bucket = buckets.find(line => Math.abs(line.cy - cy) <= lineThreshold);
      if (bucket) {
        bucket.words.push(word);
        bucket.cy = ((bucket.cy * (bucket.words.length - 1)) + cy) / bucket.words.length;
      } else {
        buckets.push({ cy, words: [word] });
      }
    });

    return buckets
      .map((line, index) => {
        const lineWords = line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const bbox = unionBbox(lineWords);
        return {
          index,
          words: lineWords,
          text: normalizeText(lineWords.map(word => word.text).join(' ')),
          bbox,
          confidence: average(lineWords.map(word => word.confidence).filter(Number.isFinite)),
        };
      })
      .filter(line => line.text && line.bbox)
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)
      .map((line, index) => ({ ...line, index }));
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function buildOcrLayout(ocrData) {
    const text = String(ocrData?.text || '');
    const rawWords = Array.isArray(ocrData?.words) ? ocrData.words : [];
    const words = rawWords
      .map((word) => {
        const bbox = getBbox(word);
        const wordText = normalizeText(word.text || word.symbol || '');
        if (!bbox || !wordText) return null;
        return {
          text: wordText,
          bbox,
          confidence: Number(word.confidence),
        };
      })
      .filter(Boolean);

    const maxX = Math.max(1, Number(ocrData?.width) || 0, ...words.map(word => word.bbox.x1));
    const maxY = Math.max(1, Number(ocrData?.height) || 0, ...words.map(word => word.bbox.y1));
    const lines = groupWordsIntoLines(words);

    return {
      text,
      words,
      lines,
      width: maxX,
      height: maxY,
    };
  }

  function normalizePriceValue(raw) {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.length < 3 || digits.length > 8) return 0;
    return parseInt(digits, 10) || 0;
  }

  function compactDigits(text) {
    return String(text || '').replace(/[^0-9]/g, '');
  }

  function addPriceCandidate(candidates, candidate) {
    const duplicate = candidates.find(existing => (
      existing.value === candidate.value
      && Math.abs(existing.bbox.y0 - candidate.bbox.y0) < 8
      && Math.abs(existing.bbox.x0 - candidate.bbox.x0) < 20
    ));

    if (!duplicate) {
      candidates.push(candidate);
    } else if (candidate.score > duplicate.score) {
      Object.assign(duplicate, candidate);
    }
  }

  function scoreCoordinatePriceCandidate({ value, raw, text, bbox, lineIndex, layout, inTemplate = false }) {
    const hasCurrency = /[₩￦원]/.test(text);
    const hasThousandsMark = /[,.]/.test(raw) || /[0-9]\s+[0-9]{3}/.test(raw);
    const center = bboxCenter(bbox);
    const heightRatio = bboxHeight(bbox) / layout.height;
    const yRatio = center.y / layout.height;
    let score = 0;

    score += heightRatio * 180;
    score += yRatio * 35;
    score += lineIndex * 2;
    if (FINAL_PRICE_WORDS.test(text)) score += 110;
    if (hasCurrency) score += 45;
    if (hasThousandsMark) score += 25;
    if (inTemplate) score += 130;
    if (/%/.test(text)) score -= 35;
    if (value >= 1900 && value <= 2099 && !hasCurrency && !hasThousandsMark && !FINAL_PRICE_WORDS.test(text)) score -= 130;
    if (value >= 1000 && value % 10 !== 0 && !hasCurrency && !hasThousandsMark) score -= 85;
    if (value >= 1000 && value % 100 === 0) score += 25;
    if (value >= 1000 && /[89]0$/.test(String(value))) score += 18;
    if (ORIGINAL_PRICE_WORDS.test(text) && !/(최종|할인|행사|특가|세일|판매)/.test(text)) score -= 90;
    if (/(100\s*g|100g|g당|당\s*[0-9,.]+원|100G)/i.test(text)) score -= 130;
    if (UNIT_WORDS.test(text) && !hasCurrency && !hasThousandsMark && !FINAL_PRICE_WORDS.test(text)) score -= 55;
    if (!hasCurrency && !hasThousandsMark && !FINAL_PRICE_WORDS.test(text) && value < 1000) score -= 25;
    if (value > 1000000 && !hasCurrency && !FINAL_PRICE_WORDS.test(text)) score -= 25;

    return score;
  }

  function extractCoordinatePriceCandidates(layout, regionBox = null, inTemplate = false) {
    const candidates = [];
    const sourceLines = regionBox
      ? layout.lines.filter(line => isCenterInside(line.bbox, regionBox) || line.words.some(word => isCenterInside(word.bbox, regionBox)))
      : layout.lines;

    sourceLines.forEach((line) => {
      const scopedWords = regionBox ? line.words.filter(word => isCenterInside(word.bbox, regionBox)) : line.words;
      const lineText = normalizeText((scopedWords.length ? scopedWords : line.words).map(word => word.text).join(' '));
      if (!lineText) return;

      let match;
      PRICE_PATTERN.lastIndex = 0;
      while ((match = PRICE_PATTERN.exec(lineText)) !== null) {
        const raw = match[1];
        const value = normalizePriceValue(raw);
        if (!value || value < 100 || value > 10000000) continue;

        const matchText = match[0];
        const nextChar = lineText.slice(match.index + matchText.length, match.index + matchText.length + 1);
        if (nextChar === '%') continue;

        const matchDigits = compactDigits(matchText);
        const matchedWords = (scopedWords.length ? scopedWords : line.words).filter(word => {
          const digits = compactDigits(word.text);
          return digits && (matchDigits.includes(digits) || digits.includes(matchDigits));
        });
        const bbox = unionBbox(matchedWords.length ? matchedWords : [{ bbox: line.bbox }]) || line.bbox;
        const score = scoreCoordinatePriceCandidate({
          value,
          raw,
          text: lineText,
          bbox,
          lineIndex: line.index,
          layout,
          inTemplate,
        });

        addPriceCandidate(candidates, {
          value,
          raw,
          text: lineText,
          lineIndex: line.index,
          bbox,
          score,
        });
      }
    });

    return candidates.sort((a, b) => b.score - a.score || bboxHeight(b.bbox) - bboxHeight(a.bbox));
  }

  function extractNameFromRegion(layout, regionBox) {
    const lineCandidates = layout.lines
      .map((line) => {
        const words = line.words.filter(word => isCenterInside(word.bbox, regionBox));
        if (words.length === 0) return null;
        const original = words.map(word => word.text).join(' ');
        const text = stripPriceText(normalizeText(original));
        if (!isUsableName(text)) return null;

        const letters = (text.match(/[가-힣A-Za-z]/g) || []).length;
        const hangul = (text.match(/[가-힣]/g) || []).length;
        const digits = (text.match(/[0-9]/g) || []).length;
        let score = letters * 3 + hangul * 4 + bboxHeight(line.bbox) / layout.height * 80;
        if (digits > letters) score -= 40;
        if (text.length >= 4 && text.length <= 32) score += 20;

        return {
          text,
          bbox: unionBbox(words) || line.bbox,
          score,
          original,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return lineCandidates[0] || null;
  }

  function guessProductNameFromCoordinates(layout, selectedPrice) {
    if (!selectedPrice) return null;

    const priceCenter = bboxCenter(selectedPrice.bbox);
    const candidates = layout.lines
      .map((line) => {
        const text = stripPriceText(line.text);
        if (!isUsableName(text)) return null;

        const lineCenter = bboxCenter(line.bbox);
        const verticalDistance = Math.abs(lineCenter.y - priceCenter.y) / layout.height;
        const isAbove = lineCenter.y < priceCenter.y;
        const isSameLine = Math.abs(lineCenter.y - priceCenter.y) < Math.max(12, bboxHeight(selectedPrice.bbox) * 0.6);
        const xOverlap = Math.max(0, Math.min(line.bbox.x1, selectedPrice.bbox.x1) - Math.max(line.bbox.x0, selectedPrice.bbox.x0));
        const overlapRatio = xOverlap / Math.max(1, Math.min(line.bbox.x1 - line.bbox.x0, selectedPrice.bbox.x1 - selectedPrice.bbox.x0));
        const digits = (text.match(/[0-9]/g) || []).length;
        const letters = (text.match(/[가-힣A-Za-z]/g) || []).length;
        let score = 80 - (verticalDistance * 260);

        if (isAbove) score += 45;
        if (isSameLine) score += 25;
        if (overlapRatio > 0.2) score += 15;
        if (HANGUL_PATTERN.test(text)) score += 30;
        if (text.length >= 4 && text.length <= 30) score += 18;
        if (digits > letters) score -= 35;
        if (lineCenter.y > priceCenter.y + bboxHeight(selectedPrice.bbox)) score -= 30;

        return {
          text,
          bbox: line.bbox,
          lineIndex: line.index,
          score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || null;
  }

  function getLayoutSignature(layout) {
    const tokens = layout.words
      .map(word => word.text)
      .filter(text => (
        FINAL_PRICE_WORDS.test(text)
        || ORIGINAL_PRICE_WORDS.test(text)
        || UNIT_WORDS.test(text)
        || /[₩￦원%]/.test(text)
      ))
      .slice(0, 8)
      .join('|');

    return tokens || `${Math.round(layout.width)}x${Math.round(layout.height)}`;
  }

  function trySavedTemplates(layout) {
    for (const template of priceTagTemplates) {
      const nameRegion = regionToBbox(template.nameRegion, layout.width, layout.height, 0.04);
      const priceRegion = regionToBbox(template.priceRegion, layout.width, layout.height, 0.04);
      const price = extractCoordinatePriceCandidates(layout, priceRegion, true)[0];
      const name = extractNameFromRegion(layout, nameRegion);

      if (price && (name || price.score > 150)) {
        template.hits = (template.hits || 0) + 1;
        template.updatedAt = Date.now();
        savePriceTagTemplates();
        return {
          name: name ? name.text : '',
          price: formatNumber(String(price.value)),
          rawText: layout.text,
          method: 'template',
          confidence: Math.round(Math.min(99, 55 + (price.score / 8) + (name ? 15 : 0))),
          selectedPrice: price,
          selectedName: name,
          layout,
        };
      }
    }

    return null;
  }

  function parseCoordinatePriceTag(layout) {
    if (layout.words.length === 0 || layout.lines.length === 0) return null;

    const selectedPrice = extractCoordinatePriceCandidates(layout)[0];
    if (!selectedPrice) return null;

    const selectedName = guessProductNameFromCoordinates(layout, selectedPrice);
    return {
      name: selectedName ? selectedName.text : '',
      price: formatNumber(String(selectedPrice.value)),
      rawText: layout.text,
      method: 'coordinates',
      confidence: Math.round(Math.min(95, 45 + (selectedPrice.score / 10) + (selectedName ? 20 : 0))),
      selectedPrice,
      selectedName,
      layout,
    };
  }

  function extractPriceCandidates(lines) {
    const candidates = [];

    lines.forEach((line, lineIndex) => {
      let match;
      PRICE_PATTERN.lastIndex = 0;
      while ((match = PRICE_PATTERN.exec(line)) !== null) {
        const raw = match[1];
        const value = normalizePriceValue(raw);
        if (!value || value < 100 || value > 10000000) continue;

        const nextChar = line.slice(match.index + match[0].length, match.index + match[0].length + 1);
        if (nextChar === '%') continue;

        const hasCurrency = /[₩￦원]/.test(match[0]);
        const hasThousandsMark = /[,.]/.test(raw) || /[0-9]\s+[0-9]{3}/.test(raw);
        let score = lineIndex * 3;
        if (FINAL_PRICE_WORDS.test(line)) score += 100;
        if (hasCurrency) score += 35;
        if (hasThousandsMark) score += 25;
        if (/%/.test(line)) score += 15;
        if (ORIGINAL_PRICE_WORDS.test(line) && !/(최종|할인|행사|특가|세일)/.test(line)) score -= 80;
        if (UNIT_WORDS.test(line) && !hasCurrency && !hasThousandsMark && !FINAL_PRICE_WORDS.test(line)) score -= 45;
        if (!hasCurrency && !hasThousandsMark && !FINAL_PRICE_WORDS.test(line) && value < 1000) score -= 20;

        candidates.push({
          value,
          raw,
          line,
          lineIndex,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
          score,
        });
      }
    });

    return candidates.sort((a, b) => b.score - a.score || b.lineIndex - a.lineIndex);
  }

  function stripPriceText(line) {
    return line
      .replace(PRICE_TEXT_PATTERN, ' ')
      .replace(/[0-9]+(?:\.[0-9]+)?\s*%/g, ' ')
      .replace(PRICE_LABEL_WORDS, ' ')
      .replace(/[^\w가-힣\s+./-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isUsableName(text) {
    if (text.length < 2 || text.length > 55) return false;
    if (!/[가-힣A-Za-z]/.test(text)) return false;
    if (/^[0-9\s.,/+%-]+$/.test(text)) return false;
    if (/^[0-9\s.]+(?:g|kg|ml|l|개입|입|봉|팩|매)$/i.test(text)) return false;
    if (NAME_NOISE_WORDS.test(text)) return false;
    return true;
  }

  function scoreNameCandidate(candidate, priceLineIndex) {
    const { index, text, original } = candidate;
    if (!isUsableName(text)) return null;

    const distance = Math.abs(index - priceLineIndex);
    const digits = (text.match(/[0-9]/g) || []).length;
    const letters = (text.match(/[가-힣A-Za-z]/g) || []).length;
    let score = Math.max(0, 70 - (distance * 18));

    if (index === priceLineIndex) score += 35;
    if (index < priceLineIndex) score += 25;
    if (/[가-힣]/.test(text)) score += 25;
    if (/[A-Za-z]/.test(text)) score += 8;
    if (/[0-9]+(?:g|kg|ml|l|개입|입|봉|팩)/i.test(text)) score += 8;
    if (text.length >= 4 && text.length <= 28) score += 12;
    if (digits > letters) score -= 25;
    if (PRICE_LABEL_WORDS.test(original)) score -= 15;
    PRICE_LABEL_WORDS.lastIndex = 0;

    return { ...candidate, score };
  }

  function guessProductName(lines, selectedPrice) {
    const priceLineIndex = selectedPrice ? selectedPrice.lineIndex : 0;
    const minIndex = Math.max(0, priceLineIndex - 4);
    const maxIndex = Math.min(lines.length - 1, priceLineIndex + 1);
    const candidates = [];

    for (let index = minIndex; index <= maxIndex; index += 1) {
      const original = lines[index];
      candidates.push({ index, original, text: stripPriceText(original) });

      if (selectedPrice && index === priceLineIndex) {
        const sameLineWithoutPrice = `${original.slice(0, selectedPrice.matchStart)} ${original.slice(selectedPrice.matchEnd)}`;
        candidates.push({ index, original, text: stripPriceText(sameLineWithoutPrice) });
      }
    }

    const scored = candidates
      .map(candidate => scoreNameCandidate(candidate, priceLineIndex))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.index - a.index);

    return (scored[0] || { text: '' }).text;
  }

  function parseLinePriceTag(text) {
    const lines = text
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean);
    const candidates = extractPriceCandidates(lines);

    if (candidates.length === 0) {
      return {
        name: guessProductName(lines, null),
        price: '',
        rawText: text,
        method: 'text',
        confidence: 20,
      };
    }

    const selected = candidates[0];
    return {
      name: guessProductName(lines, selected),
      price: formatNumber(String(selected.value)),
      rawText: text,
      method: 'text',
      confidence: selected.score > 100 ? 50 : 35,
    };
  }

  function parsePriceTag(ocrData) {
    const layout = buildOcrLayout(ocrData || {});
    const templateResult = trySavedTemplates(layout);
    if (templateResult) return templateResult;

    const coordinateResult = parseCoordinatePriceTag(layout);
    if (coordinateResult && (coordinateResult.name || coordinateResult.price)) {
      return coordinateResult;
    }

    return parseLinePriceTag(layout.text || String(ocrData || ''));
  }

  function scoreExtractionResult(parsed) {
    const name = String(parsed.name || '');
    const priceDigits = compactDigits(parsed.price);
    const price = Number(priceDigits || 0);
    const hangulCount = (name.match(/[가-힣]/g) || []).length;
    const latinCount = (name.match(/[A-Za-z]/g) || []).length;
    const digitCount = (name.match(/[0-9]/g) || []).length;
    const tokenCount = name.split(/\s+/).filter(Boolean).length;
    const symbolNoise = (name.match(/[^0-9A-Za-z가-힣\s]/g) || []).length;
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

  function getImageContentRect() {
    const wrapRect = regionImageWrap.getBoundingClientRect();
    const naturalWidth = regionImage.naturalWidth || 1;
    const naturalHeight = regionImage.naturalHeight || 1;
    const wrapRatio = wrapRect.width / wrapRect.height;
    const imageRatio = naturalWidth / naturalHeight;
    let width = wrapRect.width;
    let height = wrapRect.height;
    let left = 0;
    let top = 0;

    if (wrapRatio > imageRatio) {
      width = wrapRect.height * imageRatio;
      left = (wrapRect.width - width) / 2;
    } else {
      height = wrapRect.width / imageRatio;
      top = (wrapRect.height - height) / 2;
    }

    return {
      left,
      top,
      width,
      height,
      wrapLeft: wrapRect.left,
      wrapTop: wrapRect.top,
    };
  }

  function pointerToImagePoint(event) {
    const rect = getImageContentRect();
    const x = clamp((event.clientX - rect.wrapLeft - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.wrapTop - rect.top) / rect.height, 0, 1);
    return { x, y };
  }

  function normalizeRegion(start, end) {
    return {
      x0: Math.min(start.x, end.x),
      y0: Math.min(start.y, end.y),
      x1: Math.max(start.x, end.x),
      y1: Math.max(start.y, end.y),
    };
  }

  function drawRegionBox(box, region) {
    if (!region) {
      box.hidden = true;
      return;
    }

    const rect = getImageContentRect();
    box.hidden = false;
    box.style.left = `${rect.left + (region.x0 * rect.width)}px`;
    box.style.top = `${rect.top + (region.y0 * rect.height)}px`;
    box.style.width = `${Math.max(28, (region.x1 - region.x0) * rect.width)}px`;
    box.style.height = `${Math.max(24, (region.y1 - region.y0) * rect.height)}px`;
  }

  function updateRegionBoxes() {
    drawRegionBox(nameRegionBox, regionSelection.name);
    drawRegionBox(priceRegionBox, regionSelection.price);
  }

  function setRegionMode(mode) {
    regionMode = mode;
    regionModeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function openRegionModal() {
    if (!currentPhotoFile || !currentPreviewUrl) {
      setScanMessage('먼저 가격표 사진을 촬영해 주세요.');
      return;
    }

    regionSelection = { name: null, price: null };
    regionDraftStart = null;
    draftRegionBox.hidden = true;
    setRegionMode('name');
    regionImage.src = currentPreviewUrl;
    regionModal.hidden = false;
    requestAnimationFrame(updateRegionBoxes);
  }

  function closeRegionModal() {
    regionModal.hidden = true;
    regionDraftStart = null;
    draftRegionBox.hidden = true;
  }

  function resetRegionSelection() {
    regionSelection = { name: null, price: null };
    regionDraftStart = null;
    draftRegionBox.hidden = true;
    updateRegionBoxes();
    setRegionMode('name');
  }

  function extractManualName(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(cleanLine)
      .map(stripPriceText)
      .filter(isUsableName)
      .sort((a, b) => b.length - a.length);
    return lines[0] || cleanLine(String(text || '').split(/\r?\n/).find(Boolean) || '');
  }

  function saveManualRegionTemplate() {
    if (!regionSelection.name || !regionSelection.price) return;

    const signature = 'manual-region';
    const existing = priceTagTemplates.find(template => template.signature === signature);
    const template = {
      id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      signature,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      hits: existing?.hits || 0,
      samples: Math.min((existing?.samples || 0) + 1, 999),
      nameRegion: regionSelection.name,
      priceRegion: regionSelection.price,
    };

    priceTagTemplates = [
      template,
      ...priceTagTemplates.filter(item => item.id !== template.id && item.signature !== signature),
    ].slice(0, MAX_TEMPLATES);
    savePriceTagTemplates();
  }

  async function runSelectedRegionOcr() {
    if (!currentPhotoFile) return;
    if (!regionSelection.name || !regionSelection.price) {
      setScanMessage('상품명 영역과 가격 영역을 모두 지정해 주세요.');
      return;
    }
    if (!window.Tesseract) {
      setScanMessage('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
      return;
    }

    regionRunBtn.disabled = true;
    areaSelectBtn.disabled = true;
    setScanMessage('선택한 영역만 다시 읽는 중입니다.');

    try {
      const nameImage = await prepareRegionForOcr(currentPhotoFile, regionSelection.name);
      const priceImage = await prepareRegionForOcr(currentPhotoFile, regionSelection.price);
      const [nameOcr, priceOcr] = await Promise.all([
        window.Tesseract.recognize(nameImage, 'kor+eng'),
        window.Tesseract.recognize(priceImage, 'kor+eng'),
      ]);
      const priceParsed = parseLinePriceTag(priceOcr.data.text || '');
      const parsed = {
        name: extractManualName(nameOcr.data.text || ''),
        price: priceParsed.price || '',
        rawText: `${nameOcr.data.text || ''}\n${priceOcr.data.text || ''}`,
        method: 'manual',
        confidence: priceParsed.price ? 85 : 55,
      };

      saveManualRegionTemplate();
      addScannedItem(parsed);
      closeRegionModal();
      setScanMessage('선택한 영역에서 읽은 내용을 입력했습니다.', parsed);
    } catch (err) {
      console.error('Manual region OCR failed:', err);
      setScanMessage('선택한 영역을 읽는 중 오류가 발생했습니다. 다시 지정해 주세요.');
    } finally {
      regionRunBtn.disabled = false;
      areaSelectBtn.disabled = false;
    }
  }

  function findNameBoxForCorrection(context, correctedName) {
    const layout = context.layout;
    const normalizedCorrection = normalizeText(correctedName).replace(/\s+/g, '');
    if (!layout || !normalizedCorrection) return null;

    const exactLine = layout.lines
      .map(line => ({
        line,
        compact: stripPriceText(line.text).replace(/\s+/g, ''),
      }))
      .filter(({ compact }) => compact && (compact.includes(normalizedCorrection) || normalizedCorrection.includes(compact)))
      .sort((a, b) => b.compact.length - a.compact.length)[0];

    if (exactLine) return exactLine.line.bbox;
    return context.selectedName ? context.selectedName.bbox : null;
  }

  function findPriceBoxForCorrection(context, correctedPrice) {
    const layout = context.layout;
    const correctedDigits = compactDigits(correctedPrice);
    if (!layout || !correctedDigits) return null;

    const exactCandidate = extractCoordinatePriceCandidates(layout)
      .find(candidate => String(candidate.value) === correctedDigits);

    if (exactCandidate) return exactCandidate.bbox;
    return context.selectedPrice ? context.selectedPrice.bbox : null;
  }

  function learnTemplateFromCorrection(context, item) {
    const name = normalizeText(item.name);
    const price = formatNumber(item.price);
    if (!context.layout || !isUsableName(name) || !price) return null;

    const nameBox = findNameBoxForCorrection(context, name);
    const priceBox = findPriceBoxForCorrection(context, price);
    if (!nameBox || !priceBox) return null;

    const layout = context.layout;
    const signature = getLayoutSignature(layout);
    const existing = priceTagTemplates.find(template => template.signature === signature);

    return {
      id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      signature,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      hits: existing?.hits || 0,
      samples: Math.min((existing?.samples || 0) + 1, 999),
      nameRegion: bboxToRegion(nameBox, layout.width, layout.height, 0.035),
      priceRegion: bboxToRegion(priceBox, layout.width, layout.height, 0.035),
    };
  }

  function addScannedItem(parsed) {
    const manualTarget = parsed.method === 'manual' && lastScannedItemId
      ? items.find(item => item.id === lastScannedItemId)
      : null;
    const target = manualTarget || items.find(item => !item.name && !item.price);
    const item = target || createItem();
    if (!target) {
      items.push(item);
    }

    item.name = parsed.name || '';
    item.price = parsed.price || '';
    item.count = 1;
    saveToLocalStorage();
    renderAll();
    if (parsed.layout) {
      pendingScanContexts.set(item.id, parsed);
    }
    lastScannedItemId = item.id;

    const row = itemsList.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
    if (row) {
      const inputToFocus = item.name ? row.querySelector('.price-input') : row.querySelector('.item-input');
      inputToFocus.focus();
      inputToFocus.select();
    }
  }

  async function handlePhoto(file) {
    if (!file) return;
    if (!window.Tesseract) {
      setScanMessage('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
      return;
    }

    cameraBtn.disabled = true;
    showPreview(file);
    setScanMessage('가격표 이미지를 준비하는 중입니다.');

    try {
      const variants = await prepareImageVariantsForOcr(file);
      const parsedCandidates = [];

      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index];
        const { data } = await window.Tesseract.recognize(variant.image, 'kor+eng', {
          logger: (progress) => {
            if (progress.status === 'recognizing text') {
              const pct = Math.round((progress.progress || 0) * 100);
              setScanMessage(`가격표 글자를 읽는 중입니다. ${index + 1}/${variants.length} · ${pct}%`);
            }
          },
        });
        const parsedVariant = parsePriceTag(data);
        parsedCandidates.push({
          ...parsedVariant,
          variant: variant.id,
          selectionScore: scoreExtractionResult(parsedVariant),
        });
      }

      const parsed = parsedCandidates.sort((a, b) => b.selectionScore - a.selectionScore)[0] || {
        name: '',
        price: '',
        method: 'text',
        confidence: 0,
      };
      addScannedItem(parsed);

      if (parsed.name || parsed.price) {
        setScanMessage('사진에서 읽은 내용을 입력했습니다. 필요하면 바로 수정하세요.', parsed);
      } else {
        setScanMessage('상품명과 단가를 찾지 못했습니다. 가격표가 화면에 크게 보이도록 다시 찍어 주세요.');
      }
    } catch (err) {
      console.error('OCR failed:', err);
      setScanMessage('사진을 읽는 중 오류가 발생했습니다. 다시 촬영해 주세요.');
    } finally {
      cameraBtn.disabled = false;
    }
  }

  cameraBtn.addEventListener('click', () => {
    photoInput.value = '';
    photoInput.click();
  });

  photoInput.addEventListener('change', (e) => {
    handlePhoto(e.target.files && e.target.files[0]);
  });

  areaSelectBtn.addEventListener('click', openRegionModal);

  regionCloseBtn.addEventListener('click', closeRegionModal);
  regionResetBtn.addEventListener('click', resetRegionSelection);
  regionRunBtn.addEventListener('click', runSelectedRegionOcr);
  regionImage.addEventListener('load', updateRegionBoxes);
  window.addEventListener('resize', () => {
    if (!regionModal.hidden) updateRegionBoxes();
  });

  regionModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => setRegionMode(btn.dataset.mode));
  });

  regionImageWrap.addEventListener('pointerdown', (event) => {
    if (regionModal.hidden) return;
    event.preventDefault();
    regionImageWrap.setPointerCapture(event.pointerId);
    regionDraftStart = pointerToImagePoint(event);
    drawRegionBox(draftRegionBox, normalizeRegion(regionDraftStart, regionDraftStart));
  });

  regionImageWrap.addEventListener('pointermove', (event) => {
    if (!regionDraftStart) return;
    event.preventDefault();
    drawRegionBox(draftRegionBox, normalizeRegion(regionDraftStart, pointerToImagePoint(event)));
  });

  regionImageWrap.addEventListener('pointerup', (event) => {
    if (!regionDraftStart) return;
    event.preventDefault();
    const region = normalizeRegion(regionDraftStart, pointerToImagePoint(event));
    regionDraftStart = null;
    draftRegionBox.hidden = true;

    if ((region.x1 - region.x0) < 0.03 || (region.y1 - region.y0) < 0.03) {
      return;
    }

    regionSelection[regionMode] = region;
    updateRegionBoxes();
    if (regionMode === 'name' && !regionSelection.price) {
      setRegionMode('price');
    }
  });

  regionImageWrap.addEventListener('pointercancel', () => {
    regionDraftStart = null;
    draftRegionBox.hidden = true;
  });

  clearBtn.addEventListener('click', () => {
    if (window.confirm('모든 상품을 삭제하시겠습니까?')) {
      items = [createItem()];
      saveToLocalStorage();
      renderAll();
      scanPanel.hidden = true;
      currentPhotoFile = null;
      lastScannedItemId = '';
      areaSelectBtn.hidden = true;
    }
  });

  renderAll();
});
