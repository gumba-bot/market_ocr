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
  const regionHelp = document.querySelector('.region-help');
  const regionCloseBtn = document.querySelector('.region-close-btn');
  const regionRunBtn = document.querySelector('.region-run-btn');
  const regionResetBtn = document.querySelector('.region-reset-btn');
  const tagRegionBox = document.querySelector('.tag-region-box');
  const draftRegionBox = document.querySelector('.draft-region-box');

  let items = [];
  let deferredPrompt;
  let currentPreviewUrl = '';
  let currentPhotoFile = null;
  let regionDraftStart = null;
  let regionSelection = null;
  const defaultRegionHelpText = regionHelp.textContent;
  const defaultRegionRunText = regionRunBtn.textContent;

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js')
      .then((registration) => registration.update())
      .catch((err) => {
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
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizePriceValue(raw) {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    if (digits.length < 3 || digits.length > 8) return 0;
    return parseInt(digits, 10) || 0;
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
    drawRegionBox(tagRegionBox, regionSelection);
  }

  function openRegionModal() {
    if (!currentPhotoFile || !currentPreviewUrl) {
      setScanMessage('먼저 가격표 사진을 촬영해 주세요.');
      return;
    }

    regionSelection = null;
    regionDraftStart = null;
    draftRegionBox.hidden = true;
    regionHelp.textContent = defaultRegionHelpText;
    regionRunBtn.textContent = defaultRegionRunText;
    regionImage.src = currentPreviewUrl;
    regionModal.hidden = false;
    requestAnimationFrame(updateRegionBoxes);
  }

  function closeRegionModal() {
    regionModal.hidden = true;
    regionDraftStart = null;
    draftRegionBox.hidden = true;

    if (currentPhotoFile && scanPanel.hidden) {
      setScanMessage('촬영한 사진이 있습니다. 영역 다시 지정을 눌러 OCR을 진행하세요.');
    }
  }

  function resetRegionSelection() {
    regionSelection = null;
    regionDraftStart = null;
    draftRegionBox.hidden = true;
    regionHelp.textContent = defaultRegionHelpText;
    regionRunBtn.textContent = defaultRegionRunText;
    updateRegionBoxes();
  }

  async function runSelectedRegionOcr() {
    if (!currentPhotoFile) return;
    if (!regionSelection) {
      regionHelp.textContent = '가격표 영역을 먼저 드래그해 주세요.';
      return;
    }
    if (!window.Tesseract) {
      setScanMessage('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
      return;
    }

    regionRunBtn.disabled = true;
    areaSelectBtn.disabled = true;
    regionHelp.textContent = 'OCR 준비 중입니다. 0%';
    regionRunBtn.textContent = 'OCR 0%';
    setScanMessage('OCR 준비 중입니다. 0%');

    try {
      const tagImage = await prepareRegionForOcr(currentPhotoFile, regionSelection);
      const progressLogger = (progress) => {
        if (progress.status !== 'recognizing text') return;
        const pct = Math.round((progress.progress || 0) * 100);
        const message = `OCR 진행 중입니다. ${pct}%`;
        regionHelp.textContent = message;
        regionRunBtn.textContent = `OCR ${pct}%`;
        setScanMessage(message);
      };
      const ocr = await window.Tesseract.recognize(tagImage, 'kor+eng', { logger: progressLogger });
      const parsed = {
        ...parseLinePriceTag(ocr.data.text || ''),
        method: 'manual',
        confidence: 45,
      };
      parsed.confidence = parsed.price ? 80 : 45;

      addScannedItem(parsed);
      closeRegionModal();
      setScanMessage('선택한 영역에서 읽은 내용을 입력했습니다. 필요하면 바로 수정하세요.', parsed);
    } catch (err) {
      console.error('Manual region OCR failed:', err);
      regionHelp.textContent = defaultRegionHelpText;
      regionRunBtn.textContent = defaultRegionRunText;
      setScanMessage('선택한 영역을 읽는 중 오류가 발생했습니다. 다시 지정해 주세요.');
    } finally {
      regionRunBtn.disabled = false;
      areaSelectBtn.disabled = false;
      regionRunBtn.textContent = defaultRegionRunText;
    }
  }

  function addScannedItem(parsed) {
    const target = items.find(item => !item.name && !item.price);
    const item = target || createItem();
    if (!target) {
      items.push(item);
    }

    item.name = parsed.name || '';
    item.price = parsed.price || '';
    item.count = 1;
    saveToLocalStorage();
    renderAll();

    const row = itemsList.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
    if (row) {
      const inputToFocus = item.name ? row.querySelector('.price-input') : row.querySelector('.item-input');
      inputToFocus.focus();
      inputToFocus.select();
    }
  }

  async function handlePhoto(file) {
    if (!file) return;

    cameraBtn.disabled = true;
    showPreview(file);
    scanPanel.hidden = true;
    openRegionModal();
    cameraBtn.disabled = false;
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

    regionSelection = region;
    updateRegionBoxes();
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
      areaSelectBtn.hidden = true;
    }
  });

  renderAll();
});
