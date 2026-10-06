try { const t = localStorage.getItem('lr-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* default to system */ }
