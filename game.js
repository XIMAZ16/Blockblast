/**
 * BLOCK BLAST - Retro Arcade Edition
 * Game logic: 8x8 board, 3-piece tray, drag & drop, line clears, combos, high score.
 */
(() => {
  'use strict';

  const SIZE = 8;
  const BEST_KEY = 'retro_bb_best';
  const audio = window.retroAudio;

  /* ------------------------------------------------------------------
     Shapes (cells as [row, col]). Rotations are generated automatically;
     "w" is how often a shape family appears.
     ------------------------------------------------------------------ */
  const BASE_SHAPES = [
    { w: 3, cells: [[0, 0]] },
    { w: 4, cells: [[0, 0], [0, 1]] },
    { w: 4, cells: [[0, 0], [0, 1], [0, 2]] },
    { w: 2, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { w: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    { w: 4, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { w: 1, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
    { w: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] },
    { w: 3, cells: [[0, 0], [1, 0], [1, 1]] },
    { w: 2, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
    { w: 3, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { w: 2, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { w: 2, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { w: 2, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { w: 2, cells: [[0, 1], [1, 1], [2, 1], [2, 0]] }
  ];

  function normalize(cells) {
    const minR = Math.min(...cells.map((c) => c[0]));
    const minC = Math.min(...cells.map((c) => c[1]));
    return cells
      .map(([r, c]) => [r - minR, c - minC])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  const VARIANTS = [];
  BASE_SHAPES.forEach((base) => {
    const seen = new Set();
    let cur = normalize(base.cells);
    for (let k = 0; k < 4; k++) {
      const key = JSON.stringify(cur);
      if (!seen.has(key)) {
        seen.add(key);
        VARIANTS.push({ w: base.w, cells: cur });
      }
      cur = normalize(cur.map(([r, c]) => [c, -r]));
    }
  });
  const TOTAL_WEIGHT = VARIANTS.reduce((sum, v) => sum + v.w, 0);

  function pickShape() {
    let n = Math.random() * TOTAL_WEIGHT;
    for (const v of VARIANTS) {
      n -= v.w;
      if (n <= 0) return v.cells;
    }
    return VARIANTS[0].cells;
  }

  function dims(shape) {
    return {
      rows: Math.max(...shape.map((c) => c[0])) + 1,
      cols: Math.max(...shape.map((c) => c[1])) + 1
    };
  }

  /* ------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const trayEl = $('tray');
  const slots = Array.from(trayEl.querySelectorAll('.slot'));
  const popupLayer = $('popup-layer');
  const scoreEl = $('score-val');
  const comboEl = $('combo-val');
  const bestEl = $('best-val');
  const hintEl = $('board-hint');
  const muteBtn = $('mute-btn');
  const resultModal = $('result-modal');
  const rulesModal = $('rules-modal');

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */
  const cells = [];
  let grid = [];
  let pieces = [];
  let score = 0;
  let combo = 0;
  let sinceClear = 0;
  let best = loadBest();
  let startBest = best;
  let over = false;
  let busy = false;
  let drag = null;

  function loadBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch (e) { /* storage unavailable */ }
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------------
     Board rendering
     ------------------------------------------------------------------ */
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      cells[r] = [];
      for (let c = 0; c < SIZE; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.setAttribute('role', 'gridcell');
        boardEl.appendChild(el);
        cells[r][c] = el;
      }
    }
  }

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(-1));
  }

  function renderGrid() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = grid[r][c];
        cells[r][c].className = v >= 0 ? `cell filled c-${v}` : 'cell';
        cells[r][c].style.animationDelay = '';
      }
    }
  }

  function metrics() {
    const r0 = cells[0][0].getBoundingClientRect();
    const r1 = cells[0][1].getBoundingClientRect();
    const board = boardEl.getBoundingClientRect();
    return {
      cs: r0.width,
      pitch: r1.left - r0.left,
      gap: r1.left - r0.right,
      left: r0.left,
      top: r0.top,
      board
    };
  }

  /* ------------------------------------------------------------------
     Placement logic
     ------------------------------------------------------------------ */
  function canPlace(shape, row, col) {
    return shape.every(([dr, dc]) => {
      const r = row + dr;
      const c = col + dc;
      return r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r][c] === -1;
    });
  }

  function canFitAnywhere(shape) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (canPlace(shape, r, c)) return true;
      }
    }
    return false;
  }

  // Full rows / columns of a grid-like predicate filled(r, c)
  function findFullLines(filled) {
    const rows = [];
    const cols = [];
    for (let r = 0; r < SIZE; r++) {
      let full = true;
      for (let c = 0; c < SIZE; c++) if (!filled(r, c)) { full = false; break; }
      if (full) rows.push(r);
    }
    for (let c = 0; c < SIZE; c++) {
      let full = true;
      for (let r = 0; r < SIZE; r++) if (!filled(r, c)) { full = false; break; }
      if (full) cols.push(c);
    }
    return { rows, cols };
  }

  /* ------------------------------------------------------------------
     Tray
     ------------------------------------------------------------------ */
  function makePieceEl(piece, cs, gap) {
    const { rows, cols } = dims(piece.shape);
    const pitch = cs + gap;
    const el = document.createElement('div');
    el.className = 'piece';
    el.style.width = `${cols * pitch - gap}px`;
    el.style.height = `${rows * pitch - gap}px`;
    piece.shape.forEach(([r, c]) => {
      const b = document.createElement('div');
      b.className = `block c-${piece.color}`;
      b.style.width = `${cs}px`;
      b.style.height = `${cs}px`;
      b.style.left = `${c * pitch}px`;
      b.style.top = `${r * pitch}px`;
      el.appendChild(b);
    });
    return el;
  }

  function generatePieces() {
    let set = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      set = [0, 1, 2].map(() => ({
        shape: pickShape(),
        color: Math.floor(Math.random() * 5),
        used: false
      }));
      if (set.some((p) => canFitAnywhere(p.shape))) break;
    }
    return set;
  }

  function renderTray() {
    const m = metrics();
    const trayCell = Math.max(14, Math.floor(m.cs * 0.6));
    slots.forEach((slot, i) => {
      slot.innerHTML = '';
      slot.classList.remove('dragging', 'unplayable', 'empty');
      const piece = pieces[i];
      if (!piece || piece.used) {
        slot.classList.add('empty');
        return;
      }
      slot.appendChild(makePieceEl(piece, trayCell, 2));
      if (!canFitAnywhere(piece.shape)) slot.classList.add('unplayable');
    });
  }

  /* ------------------------------------------------------------------
     HUD
     ------------------------------------------------------------------ */
  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function updateHud(bumpScore) {
    scoreEl.textContent = score;
    comboEl.textContent = `x${combo}`;
    bestEl.textContent = best;
    if (bumpScore) bump(scoreEl);
  }

  function setHint(html) {
    hintEl.innerHTML = html;
  }

  function popup(main, sub) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.innerHTML = `<span class="popup-main">${main}</span>${sub ? `<span class="popup-sub">${sub}</span>` : ''}`;
    popupLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  /* ------------------------------------------------------------------
     Drag & drop
     ------------------------------------------------------------------ */
  function showPreview(shape, color, row, col) {
    renderGrid();
    const pieceCells = new Set(shape.map(([dr, dc]) => (row + dr) * SIZE + (col + dc)));
    const { rows, cols } = findFullLines(
      (r, c) => grid[r][c] >= 0 || pieceCells.has(r * SIZE + c)
    );
    const rowSet = new Set(rows);
    const colSet = new Set(cols);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = cells[r][c];
        if (pieceCells.has(r * SIZE + c)) {
          el.classList.add('ghost', `c-${color}`);
        }
        if ((rowSet.has(r) || colSet.has(c)) && (grid[r][c] >= 0 || pieceCells.has(r * SIZE + c))) {
          el.classList.add('will-clear');
        }
      }
    }
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (over || busy || drag) return;
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const idx = Number(slot.dataset.idx);
    const piece = pieces[idx];
    if (!piece || piece.used) return;
    e.preventDefault();

    audio.init();
    const m = metrics();
    const floatEl = makePieceEl(piece, m.cs, m.gap);
    floatEl.classList.add('floating');
    document.body.appendChild(floatEl);

    const { rows, cols } = dims(piece.shape);
    drag = {
      idx,
      piece,
      slot,
      floatEl,
      m,
      pointerId: e.pointerId,
      touch: e.pointerType !== 'mouse',
      w: cols * m.pitch - m.gap,
      h: rows * m.pitch - m.gap,
      row: null,
      col: null,
      near: false,
      lastKey: ''
    };
    slot.classList.add('dragging');
    try { slot.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    audio.playPick();
    onMove(e);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { m, floatEl, piece } = drag;
    // On touch, lift the piece above the finger so it stays visible
    const lift = drag.touch ? drag.h / 2 + m.cs * 0.9 : 0;
    const left = e.clientX - drag.w / 2;
    const top = e.clientY - drag.h / 2 - lift;
    floatEl.style.transform = `translate3d(${left}px, ${top}px, 0)`;

    const col = Math.round((left - m.left) / m.pitch);
    const row = Math.round((top - m.top) / m.pitch);
    const b = m.board;
    drag.near = left + drag.w > b.left && left < b.right && top + drag.h > b.top && top < b.bottom;

    const valid = canPlace(piece.shape, row, col);
    const key = valid ? `${row},${col}` : 'x';
    if (key === drag.lastKey) return;
    drag.lastKey = key;

    if (valid) {
      drag.row = row;
      drag.col = col;
      showPreview(piece.shape, piece.color, row, col);
    } else {
      drag.row = null;
      drag.col = null;
      renderGrid();
    }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    d.floatEl.remove();
    d.slot.classList.remove('dragging');
    renderGrid();

    if (e.type !== 'pointercancel' && d.row !== null) {
      place(d.piece, d.row, d.col);
    } else if (e.type !== 'pointercancel' && d.near) {
      audio.playInvalid();
      boardEl.classList.remove('shake-anim');
      void boardEl.offsetWidth;
      boardEl.classList.add('shake-anim');
    }
  }

  /* ------------------------------------------------------------------
     Place a piece, clear lines, score
     ------------------------------------------------------------------ */
  async function place(piece, row, col) {
    busy = true;
    piece.shape.forEach(([dr, dc]) => { grid[row + dr][col + dc] = piece.color; });
    piece.used = true;
    renderGrid();
    audio.playPlace();

    let gained = piece.shape.length;
    const { rows, cols } = findFullLines((r, c) => grid[r][c] >= 0);
    const lines = rows.length + cols.length;

    if (lines > 0) {
      combo += 1;
      sinceClear = 0;
      gained += 20 * lines * lines * combo;

      const toClear = new Set();
      rows.forEach((r) => { for (let c = 0; c < SIZE; c++) toClear.add(r * SIZE + c); });
      cols.forEach((c) => { for (let r = 0; r < SIZE; r++) toClear.add(r * SIZE + c); });
      toClear.forEach((k) => {
        const r = Math.floor(k / SIZE);
        const c = k % SIZE;
        cells[r][c].classList.add('clearing');
        cells[r][c].style.animationDelay = `${(r + c) * 14}ms`;
      });
      audio.playClear(lines, combo);
      await wait(580);
      toClear.forEach((k) => { grid[Math.floor(k / SIZE)][k % SIZE] = -1; });
      renderGrid();

      const labels = [lines === 1 ? 'CLEAR!' : `${lines} LINES!`];
      if (combo >= 2) labels.push(`COMBO x${combo}`);
      const perfect = grid.every((line) => line.every((v) => v === -1));
      if (perfect) {
        gained += 300;
        labels.push('PERFECT!');
        audio.playRecord();
      }
      popup(`+${gained}`, labels.join('<br>'));
      setHint(`<span class="badge-free">★ ${combo >= 2 ? `COMBO x${combo}` : 'เคลียร์!'}</span> เคลียร์ ${lines} แถว +${gained}`);
    } else {
      sinceClear += 1;
      if (sinceClear >= 3 && combo > 0) {
        combo = 0;
        setHint('คอมโบหลุด! ลองเคลียร์แถวให้ต่อเนื่อง');
      } else if (combo === 0) {
        setHint('<span class="badge-free">★ ลุยต่อ</span> เติมแถวหรือคอลัมน์ให้เต็มเพื่อเคลียร์');
      }
    }

    score += gained;
    if (score > best) {
      best = score;
      saveBest();
    }
    updateHud(true);

    if (pieces.every((p) => p.used)) pieces = generatePieces();
    renderTray();
    busy = false;
    checkGameOver();
  }

  function checkGameOver() {
    const remaining = pieces.filter((p) => !p.used);
    if (remaining.some((p) => canFitAnywhere(p.shape))) return;

    over = true;
    const record = score > 0 && score > startBest;
    setTimeout(() => {
      $('modal-score').textContent = score;
      $('modal-icon').textContent = record ? '🏆' : '💥';
      $('modal-icon').classList.toggle('record', record);
      $('modal-title').textContent = record ? 'NEW RECORD!' : 'GAME OVER';
      $('modal-subtitle').textContent = record
        ? 'ทำลายสถิติสูงสุดของตัวเองสำเร็จ!'
        : 'ไม่มีที่วางบล็อกแล้ว ลองอีกครั้งนะ';
      resultModal.classList.remove('hidden');
      if (record) audio.playRecord(); else audio.playGameOver();
    }, 450);
  }

  /* ------------------------------------------------------------------
     Game flow
     ------------------------------------------------------------------ */
  function newGame() {
    grid = emptyGrid();
    score = 0;
    combo = 0;
    sinceClear = 0;
    startBest = best;
    over = false;
    busy = false;
    drag = null;
    popupLayer.innerHTML = '';
    resultModal.classList.add('hidden');
    pieces = generatePieces();
    renderGrid();
    renderTray();
    updateHud(false);
    setHint('<span class="badge-free">★ เริ่มเลย</span> ลากบล็อกด้านล่างไปวางบนกระดาน');
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */
  trayEl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  trayEl.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => { if (!drag) renderTray(); });

  function syncMuteIcon() {
    muteBtn.textContent = audio.isMuted ? '🔇' : '🔊';
  }

  muteBtn.addEventListener('click', () => {
    audio.toggleMute();
    syncMuteIcon();
    audio.playClick();
  });

  $('open-rules-btn').addEventListener('click', () => {
    audio.playClick();
    rulesModal.classList.remove('hidden');
  });

  const closeRules = () => {
    audio.playClick();
    rulesModal.classList.add('hidden');
  };
  $('close-rules-btn').addEventListener('click', closeRules);
  $('rules-ok-btn').addEventListener('click', closeRules);

  $('restart-btn').addEventListener('click', () => {
    audio.playClick();
    newGame();
  });

  $('play-again-btn').addEventListener('click', () => {
    audio.playClick();
    newGame();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') rulesModal.classList.add('hidden');
  });

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */
  buildBoard();
  syncMuteIcon();
  newGame();
})();