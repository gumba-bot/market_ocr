import { useState, useEffect } from 'react'
import './index.css'

function App() {
  const [items, setItems] = useState(() => {
    const saved = localStorage.getItem('market_cal_items')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        // parsing error
      }
    }
    return [{ id: Date.now(), name: '', price: '', count: 1 }]
  })

  // Save to localStorage whenever items change
  useEffect(() => {
    localStorage.setItem('market_cal_items', JSON.stringify(items))
  }, [items])
  // Format number with commas
  const formatNumber = (numStr) => {
    if (!numStr) return ''
    const cleanNum = numStr.replace(/,/g, '').replace(/[^0-9]/g, '')
    if (!cleanNum) return ''
    return parseInt(cleanNum, 10).toLocaleString('ko-KR')
  }

  // Parse string back to number
  const parseNumber = (numStr) => {
    if (!numStr) return 0
    return parseInt(numStr.replace(/,/g, ''), 10) || 0
  }

  const handleNameChange = (index, value) => {
    const newItems = [...items]
    newItems[index].name = value
    setItems(newItems)
  }

  const handlePriceChange = (index, value) => {
    const newItems = [...items]
    newItems[index].price = formatNumber(value)
    setItems(newItems)
  }

  const handleCountChange = (index, value) => {
    const newItems = [...items]
    const num = parseInt(value, 10)
    newItems[index].count = isNaN(num) ? '' : num
    setItems(newItems)
  }

  const handleDeleteItem = (index) => {
    if (!window.confirm('이 품목을 삭제하시겠습니까?')) {
      return
    }

    if (items.length <= 1) {
      setItems([{ id: Date.now(), name: '', price: '', count: 1 }])
      return
    }
    const newItems = items.filter((_, i) => i !== index)
    setItems(newItems)
  }

  // Auto-add new row if the last row has some input
  useEffect(() => {
    const lastItem = items[items.length - 1]
    if (lastItem && (lastItem.name !== '' || lastItem.price !== '')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([...items, { id: Date.now(), name: '', price: '', count: 1 }])
    }
  }, [items])

  const getCount = (count) => {
    if (count === undefined) return 1
    const parsed = parseInt(count, 10)
    return isNaN(parsed) ? 0 : parsed
  }

  const validItems = items.filter(item => item.name.trim() !== '' || item.price !== '')
  const totalCount = validItems.length
  const totalPrice = validItems.reduce((sum, item) => sum + (parseNumber(item.price) * getCount(item.count)), 0)

  const handleClearAll = () => {
    if (window.confirm('모든 품목을 삭제하시겠습니까?')) {
      const resetItems = [{ id: Date.now(), name: '', price: '', count: 1 }]
      setItems(resetItems)
    }
  }

  return (
    <div className="app-container">
      <div className="sticky-top">
        <header className="header">
          <h1>굼바의 장바구니</h1>
          <button className="clear-btn" onClick={handleClearAll}>모두 삭제</button>
        </header>

        {/* Header Row (Totals) */}
        <div className="table-header total-row">
          <div className="col">
            <span className="label">총 품목 수</span>
            <span className="value count-value">{totalCount}개</span>
          </div>
          <div className="col">
            <span className="label">총 합계</span>
            <span className="value price-value">{totalPrice.toLocaleString('ko-KR')}원</span>
          </div>
        </div>
      </div>

      <div className="table-container">

        {/* Input Rows */}
        <div className="items-list">
          {items.map((item, index) => {
            const countVal = item.count !== undefined ? item.count : 1
            const countNum = parseInt(countVal, 10) || 0
            const itemTotal = (parseNumber(item.price) || 0) * countNum
            return (
              <div key={item.id} className="item-row">
                <div className="col name-col">
                  <input
                    type="text"
                    placeholder="품목명"
                    value={item.name}
                    onChange={(e) => handleNameChange(index, e.target.value)}
                    className="item-input"
                  />
                </div>
                <div className="col price-col">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="단가"
                    value={item.price}
                    onChange={(e) => handlePriceChange(index, e.target.value)}
                    className="price-input"
                  />
                </div>
                <div className="col count-col">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="수량"
                    value={countVal}
                    onChange={(e) => handleCountChange(index, e.target.value)}
                    className="count-input"
                  />
                </div>
                <div className="col total-col">
                  <span className="item-total">{itemTotal > 0 ? itemTotal.toLocaleString('ko-KR') : ''}</span>
                </div>
                <div className="col delete-col">
                  <button
                    className="delete-item-btn"
                    onClick={() => handleDeleteItem(index)}
                    tabIndex="-1"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
