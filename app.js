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

  let items = [];
  let deferredPrompt;
  let currentPreviewUrl = '';

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

    if (result) {
      scanResult.hidden = false;
      scanResult.innerHTML = `
        <span>${escapeAttr(result.name || '상품명 확인 필요')}</span>
        <strong>${escapeAttr(result.price || '단가 확인 필요')}</strong>
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

    currentPreviewUrl = URL.createObjectURL(file);
    scanPreview.src = currentPreviewUrl;
    scanPreview.hidden = false;
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

  async function prepareImageForOcr(file) {
    const source = await loadImageSource(file);
    const maxSide = 1800;
    const scale = Math.min(maxSide / Math.max(source.width, source.height), 1);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source.image, 0, 0, width, height);
    source.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      const contrasted = Math.max(0, Math.min(255, ((gray - 128) * 1.35) + 128));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.92);
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

  function parsePriceTag(text) {
    const lines = text
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean);
    const candidates = extractPriceCandidates(lines);

    if (candidates.length === 0) {
      return { name: guessProductName(lines, null), price: '', rawText: text };
    }

    const selected = candidates[0];
    return {
      name: guessProductName(lines, selected),
      price: formatNumber(String(selected.value)),
      rawText: text,
    };
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
    if (!window.Tesseract) {
      setScanMessage('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.');
      return;
    }

    cameraBtn.disabled = true;
    showPreview(file);
    setScanMessage('가격표 이미지를 준비하는 중입니다.');

    try {
      const imageForOcr = await prepareImageForOcr(file);
      const { data } = await window.Tesseract.recognize(imageForOcr, 'kor+eng', {
        logger: (progress) => {
          if (progress.status === 'recognizing text') {
            const pct = Math.round((progress.progress || 0) * 100);
            setScanMessage(`가격표 글자를 읽는 중입니다. ${pct}%`);
          }
        },
      });
      const parsed = parsePriceTag(data.text || '');
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

  clearBtn.addEventListener('click', () => {
    if (window.confirm('모든 상품을 삭제하시겠습니까?')) {
      items = [createItem()];
      saveToLocalStorage();
      renderAll();
      scanPanel.hidden = true;
    }
  });

  renderAll();
});
