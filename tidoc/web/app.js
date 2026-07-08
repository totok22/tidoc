/* tidoc 前端主逻辑 — 整理 / 筛选 / 便捷操作。 */

const State = {
  profiles: [],
  profileById: {},
  currentProfileId: null,
  activeTitle: '',
  quickView: 'all',
  entries: [],
  selected: new Set(),
  lastSelectedId: null,
  suppressListAnimation: false,
  density: 'comfortable',
  groupBy: 'none',       // 'none' | 'profile' | 'title' —— 列表分组浏览
  tagFilter: '',         // 高级筛选：按标签
  notesFilter: '',       // 高级筛选：'' | 'yes' | 'no'（有 / 无记账备注）
  batchFilter: '',       // 当前聚焦的批次 id（在批次内浏览 / 管理）
  batches: [],           // 批次列表缓存
  allTags: [],           // 全库用过的标签
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, kind) {
  const t = el('div', 'toast' + (kind ? ' ' + kind : ''), esc(msg));
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 280); }, 2600);
}

const TITLE_CLASS = { '北京理工大学': 'univ', '北京理工大学教育基金会': 'found' };
const TITLE_SHORT = { '北京理工大学': '北京理工大学', '北京理工大学教育基金会': '教育基金会' };
const STATUS_LABEL = { draft: '草稿', partial: '部分材料', complete: '完整' };
const CHECK_LABEL = { pass: '校验通过', warning: '需确认', blocked: '问题严重' };
const FIRST_USE_GUIDE_KEY = 'tidoc.firstUseGuide.v1';
const FIELD_LABEL = {
  paid_amount: '实付金额', actual_item_name: '实际物资名称', notes: '备注',
  invoice_no: '发票号码', total: '价税合计', buyer_name: '购买方抬头',
  buyer_tax_id: '税号', title: '抬头',
};

function fmtMoney(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? v : '¥' + n.toFixed(2);
}
function initials(name) {
  if (!name) return '—';
  return Array.from(name).slice(0, 2).join('');
}
function baseName(p) { return String(p).split(/[/\\]/).pop(); }
function dateShort(s) {
  if (!s) return '无日期';
  return s.length > 10 ? s.slice(0, 10) : s;
}

// inline SVG icons (no emoji)
const I = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4z"/><path d="m14 5 3 3"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h6M8 17h4"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4M21 7v10l-9 4M12 11v10"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><text x="9" y="16" font-size="6" fill="currentColor" stroke="none" font-family="JetBrains Mono, monospace">PDF</text></svg>',
  xml: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m9 12-2 2 2 2M13 12l2 2-2 2" stroke-width="1.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="m4 17 5-4 4 3 3-2 4 4"/></svg>',
  inspect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5M8 11h6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};
function iconPencil(s) { return wrapSvg(I.pencil, s); }
function iconNote(s) { return wrapSvg(I.note, s); }
function iconBox(s) { return wrapSvg(I.box, s); }
function iconPdf() { return I.pdf; }
function iconXml() { return I.xml; }
function iconImage() { return I.image; }
function iconInspect() { return I.inspect; }
function wrapSvg(svg, s) {
  return svg.replace('<svg ', `<svg width="${s}" height="${s}" `);
}

// ------------------------------------------------------------------ 初始化
async function init() {
  applyPreferences();
  bindEvents();
  await loadProfiles();
  await loadBatches();
  await refreshEntries();
  await refreshTagOptions();
  showSearchHintIfEmpty();
  maybeShowFirstUseGuide();
}

// 启动时套用用户在设置里选的默认抬头 / 密度
function applyPreferences() {
  const dt = localStorage.getItem('tidoc.defaultTitle') || '';
  if (dt) {
    State.activeTitle = dt;
    const titleSel = $('#filterTitle');
    if (titleSel) titleSel.value = dt;
  }
  const dd = localStorage.getItem('tidoc.defaultDensity');
  if (dd) {
    State.density = dd;
    $$('.density-btn').forEach((b) => b.classList.toggle('active', b.dataset.density === dd));
  }
}

async function refreshTagOptions() {
  try { State.allTags = await Api.listTags(); } catch (e) { State.allTags = []; }
  const sel = $('#filterTag');
  if (!sel) return;
  const cur = State.tagFilter;
  sel.innerHTML = '<option value="">全部</option>' +
    State.allTags.map((t) => `<option value="${esc(t)}"${t === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

async function loadProfiles() {
  State.profiles = await Api.listProfiles();
  State.profileById = Object.fromEntries(State.profiles.map((p) => [p.id, p]));
  renderProfileSelects();
  if (!State.profiles.length) {
    openProfileManager(true);
    return;
  }
  const def = State.profiles.find((p) => p.is_default) || State.profiles[0];
  State.currentProfileId = def.id;
  renderProfilePill();
}

function renderProfilePill() {
  const p = State.profileById[State.currentProfileId];
  if (!p) {
    $('#profileName').textContent = '未选择';
    $('#profileReviewer').textContent = '';
    $('#profileAvatar').textContent = '—';
    return;
  }
  $('#profileName').textContent = p.name;
  $('#profileReviewer').textContent = '审核 · ' + p.reviewer + (p.is_default ? ' · 默认' : '');
  $('#profileAvatar').textContent = initials(p.name);
}

function renderProfileSelects() {
  const sel = $('#filterProfile');
  sel.innerHTML = '<option value="">全部</option>';
  State.profiles.forEach((p) => {
    const o = el('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
}

// ------------------------------------------------------------------ 筛选
function currentFilters() {
  const val = (id) => $('#' + id)?.value || '';
  State.activeTitle = val('filterTitle');
  const f = { title: State.activeTitle || undefined };
  const status = val('filterStatus');
  const check = val('filterCheck');
  const profile = val('filterProfile');
  const kw = val('filterKeyword').trim();
  const amin = val('filterAmountMin');
  const amax = val('filterAmountMax');
  const dfrom = val('filterDateFrom');
  const dto = val('filterDateTo');
  const sort = val('sortSelect');

  if (State.quickView === 'warning') f.check_status = 'warning';
  else if (State.quickView === 'modified') f.modified_only = true;
  else if (State.quickView === 'complete') f.status = 'complete';

  if (status) f.status = status;
  if (check) f.check_status = check;
  if (profile) f.profile_id = profile;
  if (kw) f.keyword = kw;
  if (amin) f.amount_min = amin;
  if (amax) f.amount_max = amax;
  if (dfrom) f.date_from = dfrom;
  if (dto) f.date_to = dto;
  if (sort) f.sort = sort;
  if (State.tagFilter) f.tags = [State.tagFilter];
  if (State.notesFilter) f.has_notes = State.notesFilter;
  if (State.batchFilter) f.batch_id = State.batchFilter;
  return f;
}

async function refreshEntries() {
  try {
    State.entries = await Api.listEntries(currentFilters());
    if (State.quickView === 'incomplete') {
      State.entries = State.entries.filter((e) => (e.completeness?.status || e.status) !== 'complete');
    }
  } catch (e) {
    toast(e.message, 'err');
    State.entries = [];
  }
  renderEntries();
  renderActiveFilters();
  renderBatchContext();
}

// ------------------------------------------------------------------ 渲染列表
function renderEntries() {
  const list = $('#entryList');
  list.dataset.density = State.density;
  list.classList.toggle('no-anim', State.suppressListAnimation);
  list.innerHTML = '';
  const empty = $('#emptyState');
  const emptyAll = State.entries.length === 0;

  let sum = 0, paidSum = 0, modifiedCount = 0;
  State.entries.forEach((e) => {
    sum += Number(e.total) || 0;
    const fp = e.fields && e.fields.paid_amount ? Number(e.fields.paid_amount.current) : 0;
    paidSum += isNaN(fp) ? 0 : fp;
    if (e.modified_fields && e.modified_fields.length) modifiedCount++;
  });

  if (State.groupBy !== 'none' && !emptyAll) {
    renderGroupedEntries(list);
  } else {
    State.entries.forEach((e) => list.appendChild(entryCard(e)));
  }

  $('#stats').innerHTML = emptyAll
    ? ''
    : `<span><b>${State.entries.length}</b> 条</span>
       <span class="sep">·</span>
       <span>合计 <b class="stats-sum">${fmtMoney(sum)}</b></span>
       ${paidSum ? `<span class="sep">·</span><span>实付 <b style="color:var(--pass)">${fmtMoney(paidSum)}</b></span>` : ''}
       ${modifiedCount ? `<span class="sep">·</span><span>已改 <b>${modifiedCount}</b></span>` : ''}`;

  empty.hidden = !emptyAll;
  if (emptyAll) renderEmptyState();
  const hasSelection = State.selected.size > 0;
  $('#selectionBar').classList.toggle('hidden', !hasSelection);
  $('#selCount').textContent = hasSelection ? `已选 ${State.selected.size}` : '未选择';
  ['clearSelBtn', 'addToBatchBtn', 'tagBtn', 'batchSummaryBtn', 'batchExportBtn', 'batchPrintBtn', 'batchDeleteBtn'].forEach((id) => {
    const btn = $('#' + id);
    if (btn) btn.disabled = !hasSelection;
  });
  State.suppressListAnimation = false;
}

function entryCard(e) {
  const tcls = TITLE_CLASS[e.title] || '';
  const card = el('div', 'entry-card' + (tcls ? ' title-' + tcls : '') +
    (State.selected.has(e.id) ? ' selected' : ''));

  const check = el('div', 'entry-check');
  check.title = '切换选中';
  check.onclick = (ev) => { ev.stopPropagation(); toggleSelect(e.id, ev.shiftKey); };
  check.ondblclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = State.selected.has(e.id);
  cb.onclick = (ev) => { ev.stopPropagation(); toggleSelect(e.id, ev.shiftKey); };
  cb.ondblclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  check.appendChild(cb);

  const stripe = el('div', 'entry-stripe');
  stripe.title = '切换选中';
  stripe.onclick = (ev) => { ev.stopPropagation(); toggleSelect(e.id, ev.shiftKey); };

  const modified = (e.modified_fields && e.modified_fields.length)
    ? `<span class="badge modified" title="有 ${e.modified_fields.length} 个字段被人工修改">${iconPencil(11)}已改 ${e.modified_fields.length}</span>` : '';
  // 校验状态：仅在 warning/blocked 时突出显示（pass 不占视觉）
  const checkBadge = (e.check_status && e.check_status !== 'pass')
    ? `<span class="badge ${e.check_status}" title="${esc(e.check_message || '')}">${CHECK_LABEL[e.check_status] || ''}</span>` : '';

  const fields = e.fields || {};
  const notesCur = fields.notes ? fields.notes.current : '';
  const actualCur = fields.actual_item_name ? fields.actual_item_name.current : '';
  const paidCur = fields.paid_amount ? fields.paid_amount.current : '';

  // 三个附件完整度状态点：发票 / 付款 / 查验
  const dot = (on, label) => `<span class="att-dot${on ? ' on' : ''}" title="${label}${on ? '：已上传' : '：缺'}">${label}</span>`;
  const attDots = `<span class="att-dots">${dot(e.has_invoice, '发票')}${dot(e.has_payment, '付款')}${dot(e.has_inspection, '查验')}</span>`;

  // 完整度：基于后端派生的 completeness（状态自动推导），缺项做 tooltip
  const comp = e.completeness || { ready: false, status: e.status, missing: [] };
  const dstatus = comp.status || e.status;
  const compBadge = comp.ready
    ? `<span class="badge complete-ready" title="材料齐全、实付已填、校验通过">齐备</span>`
    : `<span class="badge status-${dstatus}" title="${comp.missing.length ? '待补：' + comp.missing.join('、') : ''}">${STATUS_LABEL[dstatus] || dstatus}</span>`;

  const itemTitle = actualCur || (e.items && e.items[0] && (e.items[0].actual_name || e.items[0].name)) || '未填物资名称';
  const notesPreview = notesCur
    ? `<span class="notes-preview important" title="${esc(notesCur)}">${iconNote(12)}${esc(notesCur)}</span>`
    : '<span class="notes-preview muted">无备注</span>';

  const main = el('div', 'entry-main', `
    <div class="entry-line1">
      <span class="entry-item-title" title="${esc(itemTitle)}">${esc(itemTitle)}</span>
      ${compBadge}
      ${checkBadge}
      ${modified}
    </div>
    <div class="entry-line2">
      <span class="seller-muted" title="${esc(e.seller || '')}">${esc(e.seller || '未识别销售方')}</span>
      <span class="mono">${esc(e.invoice_no || '无发票号')}</span>
      <span>${esc(dateShort(e.invoice_date))}</span>
      ${attDots}
    </div>`);
  if (notesCur || actualCur) {
    main.insertAdjacentHTML('beforeend', `<div class="entry-note-line">${notesPreview}</div>`);
  }
  const tags = Array.isArray(e.tags) ? e.tags : [];
  if (tags.length) {
    main.insertAdjacentHTML('beforeend',
      `<div class="entry-tags">${tags.map((t) => `<span class="entry-tag">${esc(t)}</span>`).join('')}</div>`);
  }

  const right = el('div', 'entry-right');
  right.innerHTML = `
    <div class="entry-total">${fmtMoney(e.total)}</div>
    ${paidCur ? `<div class="entry-paid">实付 <b>${fmtMoney(paidCur)}</b></div>` : '<div class="entry-paid muted">实付未填</div>'}
    <div class="entry-inline-actions">
      <button data-card-action="paid" title="填写实付金额">实付</button>
      <button data-card-action="pay" title="添加付款截图">付款</button>
      <button data-card-action="inspect" title="添加查验单">查验</button>
    </div>
    <div class="entry-open-hint">点击打开</div>`;
  right.querySelectorAll('[data-card-action]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const action = b.dataset.cardAction;
      if (action === 'paid') await quickPaidFlow(e);
      else if (action === 'pay') await quickAddAttachment(e.id, 'payment_screenshot');
      else if (action === 'inspect') await quickAddAttachment(e.id, 'inspection_pdf');
    };
  });

  card.append(check, stripe, main, right);
  let openTimer = null;
  card.onclick = () => {
    openTimer = setTimeout(() => openEntryDetail(e.id), 260);
  };
  card.ondblclick = async (ev) => {
    ev.preventDefault();
    if (openTimer) clearTimeout(openTimer);
    await quickPaidFlow(e);
  };
  card.oncontextmenu = (ev) => {
    ev.preventDefault();
    openEntryMenu(ev.clientX, ev.clientY, e);
  };
  card.ondragover = (ev) => {
    ev.preventDefault();
    card.classList.add('card-dragging');
  };
  card.ondragleave = () => card.classList.remove('card-dragging');
  card.ondrop = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    card.classList.remove('card-dragging');
    try {
      const added = await addDroppedMaterialFiles(e.id, [...(ev.dataTransfer?.files || [])]);
      if (added) {
        await refreshEntries();
        toast('材料已添加', 'ok');
      }
    } catch (err) { toast(err.message, 'err'); }
  };
  return card;
}

// 按报账人 / 抬头分组渲染，每组头显示条数、合计、齐备率，可整组选中
function renderGroupedEntries(list) {
  const keyOf = (e) => State.groupBy === 'profile'
    ? (State.profileById[e.profile_id]?.name || '未知报账人')
    : (e.title || '未标注抬头');
  const groups = new Map();
  State.entries.forEach((e) => {
    const k = keyOf(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  });

  [...groups.entries()].forEach(([name, items]) => {
    const total = items.reduce((s, e) => s + (Number(e.total) || 0), 0);
    const ready = items.filter((e) => (e.completeness?.ready)).length;
    const allSel = items.every((e) => State.selected.has(e.id));
    const tcls = State.groupBy === 'title' ? (TITLE_CLASS[name] || '') : '';

    const head = el('div', 'group-head' + (tcls ? ' title-' + tcls : ''));
    head.innerHTML = `
      <button class="group-sel" title="选中/取消这组">${allSel ? '✓' : ''}</button>
      <span class="group-name">${esc(name)}</span>
      <span class="group-meta"><b>${items.length}</b> 条 · 合计 <b>${fmtMoney(total)}</b> · 齐备 ${ready}/${items.length}</span>`;
    head.querySelector('.group-sel').onclick = () => {
      if (allSel) items.forEach((e) => State.selected.delete(e.id));
      else items.forEach((e) => State.selected.add(e.id));
      renderEntries();
    };
    list.appendChild(head);
    items.forEach((e) => list.appendChild(entryCard(e)));
  });
}

function renderEmptyState() {
  const hasFilter = hasAnyFilter();
  const illus = $('#emptyIllus');
  if (hasFilter) {
    illus.innerHTML = `<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="21" cy="21" r="13"/><path d="m31 31 7 7M16 21h10M21 16v10"/></svg>`;
    $('#emptyTitle').textContent = '没有匹配的条目';
    $('#emptySub').textContent = '清掉一些筛选，或换个关键词、抬头。';
    $('#emptyNew').textContent = '清空筛选';
    $('#emptyNew').onclick = () => clearAllFilters();
  } else {
    illus.innerHTML = `<svg viewBox="0 0 48 48" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14h22l6 6v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z"/><path d="M31 14v6h6M14 26h16M14 32h12M14 38h8"/><path d="M9 14l3-5h18l3 5" opacity=".6"/></svg>`;
    $('#emptyTitle').textContent = '还没有报账条目';
    $('#emptySub').textContent = '上传一张发票，开始整理报账凭证。';
    $('#emptyNew').textContent = '新建第一条';
    $('#emptyNew').onclick = () => openNewEntry();
  }
}

function renderActiveFilters() {
  const wrap = $('#activeFilters');
  const chips = [];
  const mkChip = (label, onClear) => {
    const c = el('span', 'filter-chip', `<span>${esc(label)}</span>`);
    const x = el('button', null, '×');
    x.onclick = () => { State.selected.clear(); onClear(); }; c.appendChild(x);
    chips.push(c);
  };
  // 工具条上已经可见的筛选条件不再生成 active chip，避免同一状态重复占位。
  if ($('#filterStatus')?.value) mkChip('状态：' + STATUS_LABEL[$('#filterStatus').value], () => { $('#filterStatus').value = ''; refreshEntries(); });
  if ($('#filterCheck').value) mkChip('校验：' + CHECK_LABEL[$('#filterCheck').value], () => { $('#filterCheck').value = ''; refreshEntries(); });
  // 批次聚焦已经由上方批次标签表达，避免同一状态在筛选 chip 里重复出现。
  if ($('#filterAmountMin').value || $('#filterAmountMax').value) mkChip(`金额 ${$('#filterAmountMin').value || '∞'}–${$('#filterAmountMax').value || '∞'}`, () => { $('#filterAmountMin').value = ''; $('#filterAmountMax').value = ''; refreshEntries(); });
  if ($('#filterDateFrom').value || $('#filterDateTo').value) mkChip(`日期 ${$('#filterDateFrom').value || '…'}–${$('#filterDateTo').value || '…'}`, () => { $('#filterDateFrom').value = ''; $('#filterDateTo').value = ''; refreshEntries(); });
  if (State.tagFilter) mkChip('标签：' + State.tagFilter, () => { State.tagFilter = ''; $('#filterTag').value = ''; refreshEntries(); });
  if (State.notesFilter) mkChip('备注：' + (State.notesFilter === 'yes' ? '有' : '无'), () => { State.notesFilter = ''; $('#filterNotes').value = ''; refreshEntries(); });

  wrap.innerHTML = '';
  if (!chips.length) {
    wrap.classList.add('hidden');
    $('#advancedDot').classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  chips.forEach((c) => wrap.appendChild(c));
  $('#advancedDot').classList.toggle('hidden', !chips.length);
}

function hasAnyFilter() {
  return !!(($('#filterStatus')?.value || '') || $('#filterCheck').value || $('#filterProfile').value || $('#filterTitle').value ||
    $('#filterKeyword').value || $('#filterAmountMin').value || $('#filterAmountMax').value ||
    $('#filterDateFrom').value || $('#filterDateTo').value ||
    State.tagFilter || State.notesFilter || State.batchFilter ||
    State.quickView !== 'all');
}

function updateQuickViewButtons() {
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === State.quickView));
}

function setQuickView(v) {
  State.quickView = v || 'all';
  updateQuickViewButtons();
  State.selected.clear();
  refreshEntries();
}

function showSearchHintIfEmpty() {
  const kb = $('#searchKbd');
  kb.hidden = !!$('#filterKeyword').value;
}

// ------------------------------------------------------------------ 选择 / 批量
function toggleSelect(id, range) {
  State.suppressListAnimation = true;
  if (range && State.lastSelectedId) {
    const ids = State.entries.map((e) => e.id);
    const a = ids.indexOf(State.lastSelectedId);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      ids.slice(from, to + 1).forEach((eid) => State.selected.add(eid));
      State.lastSelectedId = id;
      renderEntries();
      return;
    }
  }
  if (State.selected.has(id)) State.selected.delete(id);
  else State.selected.add(id);
  State.lastSelectedId = id;
  renderEntries();
}
async function selectAllVisible() {
  State.suppressListAnimation = true;
  State.selected.clear();
  State.entries.forEach((e) => State.selected.add(e.id));
  State.lastSelectedId = State.entries.length ? State.entries[State.entries.length - 1].id : null;
  renderEntries();
}
function selectVisibleWhere(predicate) {
  State.suppressListAnimation = true;
  State.selected.clear();
  State.entries.filter(predicate).forEach((e) => State.selected.add(e.id));
  const picked = [...State.selected];
  State.lastSelectedId = picked.length ? picked[picked.length - 1] : null;
  renderEntries();
}

// ------------------------------------------------------------------ 批次（运营组）
async function loadBatches() {
  try {
    State.batches = await Api.listBatches($('#showArchivedBatches')?.checked);
  } catch (e) { State.batches = []; }
  renderBatchList();
  renderBatchSelect();
  renderBatchFolders();
}

function renderBatchList() {
  const wrap = $('#batchList');
  if (!wrap) return;
  wrap.innerHTML = '';

  // “全部条目”入口（退出批次聚焦）
  const allItem = el('div', 'batch-item' + (State.batchFilter ? '' : ' active'));
  allItem.innerHTML = `<span class="batch-item-name">全部条目</span>`;
  allItem.onclick = () => focusBatch('');
  wrap.appendChild(allItem);

  if (!State.batches.length) {
    wrap.appendChild(el('div', 'batch-empty', '还没有批次。<br/>把要一起交的条目圈成一批，方便催办和导出。'));
    return;
  }

  State.batches.forEach((b) => {
    const item = el('div', 'batch-item' + (State.batchFilter === b.id ? ' active' : '') + (b.archived ? ' archived' : ''));
    const st = b.stats || { count: b.count || 0, incomplete: 0, total: '0' };
    item.innerHTML = `
      <span class="batch-item-name" title="${esc(b.name)}">${esc(b.name)}</span>
      <span class="batch-item-meta">
        <span>${st.count} 条</span>
        ${st.incomplete ? `<span class="batch-warn" title="${st.incomplete} 条尚未齐备">缺 ${st.incomplete}</span>` : '<span class="batch-ok">齐</span>'}
      </span>`;
    item.onclick = () => focusBatch(b.id);
    item.oncontextmenu = (ev) => { ev.preventDefault(); openBatchMenu(ev.clientX, ev.clientY, b); };
    wrap.appendChild(item);
  });
}

function renderBatchSelect() {
  const sel = $('#filterBatch');
  if (!sel) return;
  const cur = State.batchFilter;
  sel.innerHTML = '<option value="">全部</option>' + State.batches.map((b) =>
    `<option value="${esc(b.id)}"${b.id === cur ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
}

function renderBatchFolders() {
  const wrap = $('#batchFolders');
  if (!wrap) return;
  const folders = State.batches.filter((b) => !b.archived);
  if (!folders.length && !State.batchFilter) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  } else {
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <button class="batch-folder all${State.batchFilter ? '' : ' active'}" data-folder="">全部条目</button>
      ${folders.map((b) => {
        const st = b.stats || {};
        return `<span class="batch-folder${State.batchFilter === b.id ? ' active' : ''}" data-folder="${esc(b.id)}">
          <button class="folder-open" title="${esc(b.name)}"><span>${esc(b.name)}</span><small>${st.count || 0} 条${st.incomplete ? ` · <span class="miss">缺 ${st.incomplete}</span>` : ' · 齐'}</small></button>
          <button class="folder-menu" data-folder-menu="${esc(b.id)}" title="批次操作">⋯</button>
        </span>`;
      }).join('')}
      <button class="batch-folder new" id="folderNewBatch">新建批次</button>`;
  }
  wrap.querySelectorAll('[data-folder]').forEach((node) => {
    node.onclick = (ev) => {
      if (ev.target instanceof Element && ev.target.closest('[data-folder-menu]')) return;
      focusBatch(node.dataset.folder || '');
    };
  });
  wrap.querySelectorAll('[data-folder-menu]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const b = State.batches.find((x) => x.id === btn.dataset.folderMenu);
      if (b) openBatchMenu(ev.clientX, ev.clientY, b);
    };
  });
  const newBtn = $('#folderNewBatch');
  if (newBtn) newBtn.onclick = () => newBatchFlow();
}

function focusBatch(batchId) {
  State.batchFilter = batchId || '';
  const sel = $('#filterBatch');
  if (sel) sel.value = State.batchFilter;
  State.selected.clear();
  renderBatchList();
  renderBatchContext();
  renderBatchFolders();
  refreshEntries();
}

function renderBatchContext() {
  const bar = $('#batchContext');
  if (!bar) return;
  if (!State.batchFilter) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const b = State.batches.find((x) => x.id === State.batchFilter);
  if (!b) { bar.classList.add('hidden'); return; }
  const st = b.stats || {};
  // 批次名、条数、缺料数和总额已由批次标签与列表统计表达，这里只保留按人拆分和整批动作。
  const persons = (st.by_person || []).map((p) =>
    `<span class="ctx-person">${esc(p.name)} <b>${p.count}</b>${p.incomplete ? ` <i title="${p.incomplete} 条未齐">缺${p.incomplete}</i>` : ''}</span>`).join('');
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="ctx-left">
      ${persons ? `<span class="ctx-persons">${persons}</span>` : '<span class="ctx-persons muted">暂无人员拆分</span>'}
    </div>
    <div class="ctx-actions">
      <button class="btn small primary" id="ctxExport">导出</button>
      <button class="btn small ghost" id="ctxPrint">打印</button>
    </div>`;
  const ids = () => State.entries.map((e) => e.id);
  $('#ctxExport').onclick = () => doExport(ids());
  $('#ctxPrint').onclick = () => openPrintDialog(ids());
  // 重命名 / 归档 / 删除统一走 tab 的「⋯」菜单，此处不重复。
}

function openBatchMenu(x, y, b) {
  closeEntryMenu();
  const menu = el('div', 'entry-context-menu');
  const item = (label, fn, danger) => {
    const btn = el('button', danger ? 'danger' : '', esc(label));
    btn.onclick = async () => { closeEntryMenu(); await fn(); };
    menu.appendChild(btn);
  };
  item('打开这批', () => focusBatch(b.id));
  item('重命名', () => renameBatchFlow(b));
  item(b.archived ? '取消归档' : '归档', async () => {
    await Api.archiveBatch(b.id, !b.archived); await loadBatches();
    toast(b.archived ? '已取消归档' : '已归档', 'ok');
  });
  item('删除批次', async () => {
    if (!confirm(`删除批次「${b.name}」？条目本身不会被删除。`)) return;
    await Api.deleteBatch(b.id);
    if (State.batchFilter === b.id) focusBatch('');
    await loadBatches(); toast('批次已删除', 'ok');
  }, true);
  menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeEntryMenu, { once: true }), 0);
}

async function renameBatchFlow(b) {
  const body = el('div');
  body.innerHTML = `
    <div class="form-row"><label>批次名称</label><input id="bName" value="${esc(b.name)}"/></div>
    <div class="form-row"><label>说明（可选）</label><textarea id="bNote" rows="3" style="width:100%;font-family:inherit;font-size:13px;padding:10px;border-radius:9px;border:1px solid var(--line);resize:vertical">${esc(b.note || '')}</textarea></div>`;
  const m = modal({
    title: '编辑批次', body,
    footer: [mkBtn('取消', 'ghost', () => m.close()), mkBtn('保存', 'primary', async () => {
      const name = body.querySelector('#bName').value.trim();
      if (!name) { toast('名称不能为空', 'err'); return; }
      try {
        await Api.updateBatch(b.id, { name, note: body.querySelector('#bNote').value });
        m.close(); await loadBatches(); renderBatchContext(); toast('已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    })],
  });
  setTimeout(() => body.querySelector('#bName')?.focus(), 20);
}

async function newBatchFlow(presetIds) {
  const ids = presetIds || [...State.selected];
  const body = el('div');
  body.innerHTML = `
    <div class="form-row"><label>批次名称</label><input id="bName" placeholder="如：7月第一批 / 张三这次的"/></div>
    <div class="form-row"><label>说明（可选）</label><input id="bNote" placeholder="备注这批的用途"/></div>
    <div class="hint">${ids.length ? `将把当前选中的 <b>${ids.length}</b> 条装入新批次。` : '创建空批次，之后再从列表选条目加入。'}</div>`;
  const m = modal({
    title: '新建批次', body,
    footer: [mkBtn('取消', 'ghost', () => m.close()), mkBtn('创建', 'primary', async () => {
      const name = body.querySelector('#bName').value.trim();
      if (!name) { toast('请填批次名称', 'err'); return; }
      try {
        const b = await Api.createBatch(name, body.querySelector('#bNote').value, ids);
        m.close(); await loadBatches(); focusBatch(b.id);
        toast(`批次「${name}」已创建`, 'ok');
      } catch (e) { toast(e.message, 'err'); }
    })],
  });
  setTimeout(() => body.querySelector('#bName')?.focus(), 20);
}

// 把选中条目加入批次（可选已有批次或新建）
async function addSelectionToBatch() {
  const ids = [...State.selected];
  if (!ids.length) { toast('请先选择条目', 'err'); return; }
  await loadBatches();
  const body = el('div');
  const options = State.batches.filter((b) => !b.archived).map((b) =>
    `<button class="batch-pick" data-batch="${b.id}"><b>${esc(b.name)}</b><span>${b.stats?.count || 0} 条</span></button>`).join('');
  body.innerHTML = `
    <div class="hint">把选中的 <b>${ids.length}</b> 条加入哪个批次？</div>
    <div class="batch-pick-list">${options || '<div class="hint">还没有批次。</div>'}</div>`;
  const m = modal({
    title: '加入批次', body,
    footer: [mkBtn('取消', 'ghost', () => m.close()), mkBtn('＋ 新建批次装入', 'primary', () => { m.close(); newBatchFlow(ids); })],
  });
  body.querySelectorAll('[data-batch]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const r = await Api.addEntriesToBatch(btn.dataset.batch, ids);
        m.close(); await loadBatches(); renderBatchContext();
        toast(`已加入 ${r.added} 条`, 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

// 批量打标签
async function tagSelectionFlow() {
  const ids = [...State.selected];
  if (!ids.length) { toast('请先选择条目', 'err'); return; }
  try { State.allTags = await Api.listTags(); } catch (e) { State.allTags = []; }
  const body = el('div');
  const existing = State.allTags.map((t) => `<button class="tag-pick" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  body.innerHTML = `
    <div class="segmented compact" style="margin-bottom:12px">
      <button class="seg active" data-mode="add">添加</button>
      <button class="seg" data-mode="remove">移除</button>
    </div>
    <div class="form-row"><label>标签</label><input id="tagInput" placeholder="输入标签后回车"/></div>
    ${existing ? `<div class="tag-cloud-label">已用过的标签</div><div class="tag-cloud">${existing}</div>` : ''}`;
  let mode = 'add';
  const apply = async (tag) => {
    tag = (tag || '').trim();
    if (!tag) return;
    try {
      const r = mode === 'remove' ? await Api.removeTag(ids, tag) : await Api.addTag(ids, tag);
      await refreshTagOptions(); await refreshEntries(); await loadBatches();
      toast(mode === 'remove' ? `已从 ${r.changed} 条移除「${tag}」` : `已给 ${r.changed} 条打上「${tag}」`, 'ok');
      m.close();
    } catch (e) { toast(e.message, 'err'); }
  };
  const m = modal({
    title: '打标签', body,
    footer: [mkBtn('完成', 'ghost', () => m.close())],
  });
  const input = body.querySelector('#tagInput');
  body.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      body.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
    };
  });
  input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); apply(input.value); } };
  body.querySelectorAll('[data-tag]').forEach((btn) => { btn.onclick = () => apply(btn.dataset.tag); });
  setTimeout(() => input.focus(), 20);
}

// ------------------------------------------------------------------ 卡片快捷
async function quickPaidFlow(e) {
  const cur = (await Api.getEntry(e.id)).fields?.paid_amount?.current || '';
  const body = el('div');
  body.innerHTML = `
    <div class="form-row">
      <label>实付金额</label>
      <input id="qpInput" type="number" step="0.01" value="${esc(cur)}" placeholder="例如 128.50"/>
    </div>`;
  const m = modal({
    title: '填写实付金额',
    body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('保存', 'primary', async () => {
        try {
          await Api.updateField(e.id, 'paid_amount', body.querySelector('#qpInput').value, State.currentProfileId);
          m.close(); await refreshEntries(); toast('实付金额已保存', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }),
    ],
  });
  setTimeout(() => body.querySelector('#qpInput')?.focus(), 20);
}

async function quickAddAttachment(entryId, type) {
  try {
    const res = await Api.pickFiles(type === 'payment_screenshot');
    const paths = res.paths || [];
    if (!paths.length) return;
    for (const p of paths) await Api.addAttachment(entryId, p, type);
    await refreshEntries();
    toast('材料已添加', 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

function openEntryMenu(x, y, e) {
  closeEntryMenu();
  const menu = el('div', 'entry-context-menu');
  const item = (label, fn, danger) => {
    const b = el('button', danger ? 'danger' : '', esc(label));
    b.onclick = async () => { closeEntryMenu(); await fn(); };
    menu.appendChild(b);
  };
  item('打开条目', () => openEntryDetail(e.id));
  item('填写实付金额', () => quickPaidFlow(e));
  item('添加付款截图', () => quickAddAttachment(e.id, 'payment_screenshot'));
  item('添加查验单', () => quickAddAttachment(e.id, 'inspection_pdf'));
  item('添加发票 PDF', () => quickAddAttachment(e.id, 'invoice_pdf'));
  item('编辑备注', () => quickNoteFlow(e));
  item('删除条目', () => quickDelete(e), true);
  menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 260) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeEntryMenu, { once: true }), 0);
}

function closeEntryMenu() {
  const old = $('.entry-context-menu');
  if (old) old.remove();
}

async function quickNoteFlow(e) {
  const cur = (await Api.getEntry(e.id)).fields?.notes?.current || '';
  const body = el('div');
  body.innerHTML = `
    <div class="hint">作为这条的记账备注。修改会留记录。</div>
    <div class="form-row" style="margin-top:14px">
      <label>备注</label>
      <textarea id="qnInput" rows="5" style="width:100%;font-family:inherit;font-size:13px;padding:10px;border-radius:9px;border:1px solid var(--line);resize:vertical">${esc(cur)}</textarea>
    </div>`;
  const m = modal({
    title: '编辑备注', body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('保存', 'primary', async () => {
        try { await Api.updateField(e.id, 'notes', body.querySelector('#qnInput').value, State.currentProfileId); m.close(); await refreshEntries(); toast('备注已保存', 'ok'); }
        catch (err) { toast(err.message, 'err'); }
      }),
    ],
  });
}
async function quickDelete(e) {
  if (!confirm(`确认删除「${e.seller || '该条目'}」？此操作不可撤销。`)) return;
  try { await Api.deleteEntry(e.id); await refreshEntries(); toast('已删除', 'ok'); }
  catch (err) { toast(err.message, 'err'); }
}

// ------------------------------------------------------------------ 事件
function bindEvents() {
  $('#profilePill').onclick = () => openProfileManager(false);

  $$('[data-view]').forEach((btn) => {
    btn.onclick = () => setQuickView(btn.dataset.view);
  });

  let kwTimer;
  const relist = () => { State.selected.clear(); refreshEntries(); };
  const relistFromAdvanced = () => { State.selected.clear(); State.quickView = 'all'; updateQuickViewButtons(); refreshEntries(); };
  if ($('#filterStatus')) $('#filterStatus').onchange = relistFromAdvanced;
  $('#filterTitle').onchange = () => { State.activeTitle = $('#filterTitle').value; relist(); };
  $('#filterCheck').onchange = relistFromAdvanced;
  $('#filterProfile').onchange = relist;
  $('#sortSelect').onchange = relist;
  $('#filterKeyword').oninput = () => { showSearchHintIfEmpty(); clearTimeout(kwTimer); kwTimer = setTimeout(relist, 220); };
  $('#filterAmountMin').oninput = () => { clearTimeout(kwTimer); kwTimer = setTimeout(relist, 220); };
  $('#filterAmountMax').oninput = () => { clearTimeout(kwTimer); kwTimer = setTimeout(relist, 220); };
  $('#filterDateFrom').onchange = relist;
  $('#filterDateTo').onchange = relist;

  $('#advancedToggle').onclick = () => {
    const p = $('#advancedPanel');
    p.classList.toggle('hidden');
    $('#advancedToggle').classList.toggle('active', !p.classList.contains('hidden'));
  };
  $('#clearFilters').onclick = () => clearAllFilters();

  $$('.density-btn').forEach((b) => {
    b.onclick = () => {
      $$('.density-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      State.density = b.dataset.density;
      $('#entryList').dataset.density = State.density;
    };
  });

  $('#newEntryBtn').onclick = openNewEntry;
  $('#batchImportBtn').onclick = openBatchImport;
  $('#settingsBtn').onclick = openSettings;
  $('#emptyNew').onclick = () => openNewEntry();
  $('#actionImport').onclick = doImport;

  $('#selectAllBtn').onclick = selectAllVisible;
  $('#selectIncompleteBtn').onclick = () => selectVisibleWhere((e) => (e.completeness?.status || e.status) !== 'complete');
  $('#selectWarningBtn').onclick = () => selectVisibleWhere((e) => e.check_status === 'warning' || e.check_status === 'blocked');
  $('#clearSelBtn').onclick = () => { State.suppressListAnimation = true; State.selected.clear(); State.lastSelectedId = null; renderEntries(); };
  $('#addToBatchBtn').onclick = addSelectionToBatch;
  $('#tagBtn').onclick = tagSelectionFlow;
  $('#batchSummaryBtn').onclick = () => exportSummary([...State.selected]);
  $('#batchExportBtn').onclick = () => doExport([...State.selected]);
  $('#batchPrintBtn').onclick = () => openPrintDialog([...State.selected]);
  $('#batchDeleteBtn').onclick = batchDelete;

  // 批次侧栏
  $('#newBatchBtn').onclick = () => newBatchFlow();
  $('#showArchivedBatches').onchange = loadBatches;

  // 分组浏览
  $$('[data-group]').forEach((b) => {
    b.onclick = () => {
      $$('[data-group]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      State.groupBy = b.dataset.group;
      renderEntries();
    };
  });

  // 新增筛选维度
  $('#filterTag').onchange = () => { State.tagFilter = $('#filterTag').value; relistFromAdvanced(); };
  $('#filterNotes').onchange = () => { State.notesFilter = $('#filterNotes').value; relistFromAdvanced(); };

  setupGlobalDrop();

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#filterKeyword').focus(); }
    else if (e.key.toLowerCase() === 'n') openNewEntry();
    else if (e.key === 'Escape') { const m = $('#modalRoot'); if (m.lastChild) m.lastChild.remove(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllVisible(); }
  });
}

function clearAllFilters() {
  ['filterStatus', 'filterCheck', 'filterProfile', 'filterTitle', 'filterBatch', 'filterKeyword', 'filterAmountMin', 'filterAmountMax', 'filterDateFrom', 'filterDateTo', 'filterTag', 'filterNotes'].forEach((id) => { const n = $('#' + id); if (n) n.value = ''; });
  State.quickView = 'all';
  updateQuickViewButtons();
  State.activeTitle = '';
  State.batchFilter = '';
  State.tagFilter = '';
  State.notesFilter = '';
  showSearchHintIfEmpty();
  refreshEntries();
}

// ------------------------------------------------------------------ 通用弹层
function modal({ title, subhead, titleChip, body, footer, wide, onClose }) {
  const mask = el('div', 'modal-mask');
  const box = el('div', 'modal' + (wide ? ' wide' : ''));
  const head = el('div', 'modal-head');
  const titleRow = el('div', 'modal-title-row');
  if (titleChip) titleRow.appendChild(el('span', 'title-chip lg ' + titleChip.cls, esc(titleChip.text)));
  titleRow.appendChild(el('h2', null, esc(title)));
  if (subhead) titleRow.appendChild(el('div', 'modal-subhead', esc(subhead)));
  head.appendChild(titleRow);
  const closeBtn = el('button', 'modal-close', '×');
  head.appendChild(closeBtn);
  const bodyEl = el('div', 'modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = el('div', 'modal-foot');
  (footer || []).forEach((b) => foot.appendChild(b));

  box.append(head, bodyEl, foot);
  mask.appendChild(box);
  $('#modalRoot').appendChild(mask);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (onClose) onClose();
    mask.remove();
  };
  closeBtn.onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  return { mask, body: bodyEl, close, foot };
}

function mkBtn(text, cls, onClick) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''), esc(text));
  b.onclick = onClick;
  return b;
}

// ------------------------------------------------------------------ 身份管理
function openProfileManager(forceCreate) {
  const wrap = el('div');

  function renderList() {
    const list = el('div', 'profile-list');
    if (!State.profiles.length) {
      list.innerHTML = '<div class="hint">还没有身份。在下方创建第一个：填本人姓名与对应审核人。</div>';
      return list;
    }
    State.profiles.forEach((p) => {
      const row = el('div', 'profile-row');
      const extra = [
        p.student_id ? '学号 ' + esc(p.student_id) : '',
        p.contact ? esc(p.contact) : '',
        p.bank_name ? esc(p.bank_name) : '',
        p.bank_card ? '尾号 ' + esc(String(p.bank_card).slice(-4)) : '',
      ].filter(Boolean).join(' · ');
      row.innerHTML = `<div class="profile-row-main">
        <div class="profile-row-title"><b>${esc(p.name)}</b><span class="arrow">→</span>${esc(p.reviewer)}
          ${p.is_default ? ' <span class="badge pass">默认</span>' : ''}</div>
        ${extra ? `<div class="profile-row-extra">${extra}</div>` : ''}
      </div>`;
      const actions = el('div', 'profile-row-actions');
      actions.appendChild(mkBtn('编辑', 'small ghost', () => editProfileFlow(p, refreshProfileList)));
      if (!p.is_default) actions.appendChild(mkBtn('设为默认', 'small ghost', async () => {
        await Api.setDefaultProfile(p.id); await loadProfiles(); refreshProfileList();
      }));
      actions.appendChild(mkBtn('删除', 'small danger', async () => {
        try { await Api.deleteProfile(p.id); await loadProfiles(); refreshProfileList(); toast('已删除', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      }));
      row.appendChild(actions);
      list.appendChild(row);
    });
    return list;
  }
  function refreshProfileList() { wrap.replaceChild(renderList(), wrap.firstChild); }

  const form = el('div');
  form.innerHTML = `
    <h3 class="detail-section" style="margin:18px 0 10px"><span>新增身份</span><span class="h3-line"></span></h3>
    <div class="form-grid">
      <div class="form-row"><label>本人姓名 *</label><input id="pfName" placeholder="必填"/></div>
      <div class="form-row"><label>对应审核人 *</label><input id="pfReviewer" placeholder="必填"/></div>
      <div class="form-row"><label>学号</label><input id="pfStudent"/></div>
      <div class="form-row"><label>电话</label><input id="pfContact"/></div>
      <div class="form-row"><label>开户行</label><input id="pfBank"/></div>
      <div class="form-row"><label>卡号</label><input id="pfCard"/></div>
    </div>
    <div class="hint" style="margin-top:4px">学号 / 电话 / 银行信息供打印导出组件使用，可留空。</div>`;

  wrap.appendChild(renderList());
  wrap.appendChild(form);

  const addBtn = mkBtn('添加身份', 'primary', async () => {
    const name = form.querySelector('#pfName').value.trim();
    const reviewer = form.querySelector('#pfReviewer').value.trim();
    if (!name || !reviewer) { toast('姓名与审核人必填', 'err'); return; }
    try {
      await Api.createProfile(name, reviewer, State.profiles.length === 0, {
        student_id: form.querySelector('#pfStudent').value.trim(),
        contact: form.querySelector('#pfContact').value.trim(),
        bank_name: form.querySelector('#pfBank').value.trim(),
        bank_card: form.querySelector('#pfCard').value.trim(),
      });
      await loadProfiles();
      refreshProfileList();
      ['pfName', 'pfReviewer', 'pfStudent', 'pfContact', 'pfBank', 'pfCard'].forEach((id) => { form.querySelector('#' + id).value = ''; });
      toast('身份已添加', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  const m = modal({
    title: '身份管理',
    subhead: '本人姓名 + 审核人写入导出；一个人可存多个身份，主界面一键切换',
    wide: true,
    body: wrap,
    footer: [addBtn, mkBtn('关闭', 'ghost', () => m.close())],
  });
}

// 编辑已有身份（后端 update_profile 支持全部字段）
function editProfileFlow(p, onDone) {
  const body = el('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-row"><label>本人姓名 *</label><input id="epName" value="${esc(p.name)}"/></div>
      <div class="form-row"><label>对应审核人 *</label><input id="epReviewer" value="${esc(p.reviewer)}"/></div>
      <div class="form-row"><label>学号</label><input id="epStudent" value="${esc(p.student_id || '')}"/></div>
      <div class="form-row"><label>电话</label><input id="epContact" value="${esc(p.contact || '')}"/></div>
      <div class="form-row"><label>开户行</label><input id="epBank" value="${esc(p.bank_name || '')}"/></div>
      <div class="form-row"><label>卡号</label><input id="epCard" value="${esc(p.bank_card || '')}"/></div>
    </div>`;
  const m = modal({
    title: '编辑身份', body,
    footer: [mkBtn('取消', 'ghost', () => m.close()), mkBtn('保存', 'primary', async () => {
      const name = body.querySelector('#epName').value.trim();
      const reviewer = body.querySelector('#epReviewer').value.trim();
      if (!name || !reviewer) { toast('姓名与审核人必填', 'err'); return; }
      try {
        await Api.updateProfile(p.id, {
          name, reviewer,
          student_id: body.querySelector('#epStudent').value.trim(),
          contact: body.querySelector('#epContact').value.trim(),
          bank_name: body.querySelector('#epBank').value.trim(),
          bank_card: body.querySelector('#epCard').value.trim(),
        });
        await loadProfiles();
        m.close(); if (onDone) onDone();
        toast('已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    })],
  });
}

async function openSettings() {
  let paths, printStatus;
  try {
    paths = await Api.dataRoot();
    printStatus = await Api.printComponentStatus();
  } catch (e) { toast(e.message, 'err'); return; }
  const body = el('div');

  const profileCount = State.profiles.length;
  const defaultProfile = State.profiles.find((p) => p.is_default);
  const printBadge = printStatus.available
    ? '<span class="settings-ok">已安装</span>'
    : '<span class="settings-warn">未安装</span>';
  const printDetail = printStatus.available
    ? '可生成发票拼接、报账说明、验收单等打印材料。'
    : (printStatus.missing?.length ? '缺少：' + esc(printStatus.missing.join('、')) : '可选组件，用于运营组打印。');

  body.innerHTML = `
    <div class="settings-shell">
      <!-- 身份 -->
      <div class="settings-block">
        <div class="settings-row" id="setProfiles">
          <div class="settings-row-copy">
            <b>身份信息</b>
            <span>${profileCount ? `${profileCount} 个身份${defaultProfile ? ' · 默认 ' + esc(defaultProfile.name) + ' → ' + esc(defaultProfile.reviewer) : ''}` : '尚未创建身份'}</span>
          </div>
          <button class="btn small">管理</button>
        </div>
      </div>

      <!-- 偏好 -->
      <div class="settings-block">
        <div class="settings-block-title">偏好</div>
        <div class="settings-row">
          <div class="settings-row-copy">
            <b>启动默认抬头</b>
            <span>打开软件时默认聚焦哪个抬头分区</span>
          </div>
          <select id="setDefaultTitle" class="settings-select">
            <option value="">全部</option>
            <option value="北京理工大学">北京理工大学</option>
            <option value="北京理工大学教育基金会">教育基金会</option>
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-row-copy">
            <b>默认列表密度</b>
            <span>条目列表的默认松紧</span>
          </div>
          <select id="setDefaultDensity" class="settings-select">
            <option value="comfortable">标准</option>
            <option value="compact">精简</option>
          </select>
        </div>
      </div>

      <!-- 数据位置 -->
      <div class="settings-block">
        <div class="settings-block-title">数据位置</div>
        <div class="settings-datapath">
          <code title="${esc(paths.root)}">${esc(paths.root)}</code>
          <span class="settings-datapath-tag">${paths.is_default ? '系统默认位置' : '自定义位置'}</span>
        </div>
        <div class="settings-row-actions">
          <button class="btn small ghost" id="setOpenData">打开文件夹</button>
          <button class="btn small ghost" id="setOpenExports">打开导出目录</button>
        </div>
        <details class="settings-advanced">
          <summary>高级数据维护</summary>
          <div class="settings-row-actions">
            <button class="btn small" id="setMigrate">迁移到新位置…</button>
            ${paths.is_default ? '' : '<button class="btn small ghost" id="setResetData">恢复默认位置</button>'}
          </div>
          <div class="hint" style="margin-top:10px">迁移会整体移动数据库与附件，请选择空文件夹。</div>
        </details>
      </div>

      <!-- 可选组件与更新 -->
      <div class="settings-block">
        <div class="settings-block-title">组件与更新</div>
        <div class="settings-row">
          <div class="settings-row-copy">
            <b>打印导出组件 ${printBadge}</b>
            <span>${printDetail}</span>
          </div>
        </div>
        <div class="settings-row" id="setUpdate">
          <div class="settings-row-copy">
            <b>检查更新</b>
            <span>核心程序与可选组件</span>
          </div>
          <button class="btn small">检查</button>
        </div>
      </div>

      <!-- 关于 -->
      <div class="settings-block about">
        <img src="assets/tidoc-logo-128.png" alt="" />
        <div>
          <b>tidoc</b>
          <span>报账凭证管理与整理工具</span>
          <button class="link-btn" id="setGuide">查看使用提示</button>
        </div>
      </div>
    </div>`;

  // 偏好回填
  body.querySelector('#setDefaultTitle').value = localStorage.getItem('tidoc.defaultTitle') || '';
  body.querySelector('#setDefaultDensity').value = localStorage.getItem('tidoc.defaultDensity') || 'comfortable';
  body.querySelector('#setDefaultTitle').onchange = (ev) => {
    localStorage.setItem('tidoc.defaultTitle', ev.target.value);
    State.activeTitle = ev.target.value;
    const titleSel = $('#filterTitle');
    if (titleSel) titleSel.value = State.activeTitle;
    State.selected.clear();
    refreshEntries();
    toast('已保存', 'ok');
  };
  body.querySelector('#setDefaultDensity').onchange = (ev) => {
    localStorage.setItem('tidoc.defaultDensity', ev.target.value);
    State.density = ev.target.value;
    $('#entryList').dataset.density = State.density;
    toast('已保存', 'ok');
  };

  body.querySelector('#setProfiles').onclick = () => { m.close(); openProfileManager(false); };
  body.querySelector('#setUpdate').onclick = () => { m.close(); openUpdateDialog(); };
  body.querySelector('#setGuide').onclick = () => { m.close(); openUsageGuide(false); };
  body.querySelector('#setOpenData').onclick = () => Api.openPath(paths.root).catch((e) => toast(e.message, 'err'));
  body.querySelector('#setOpenExports').onclick = () => Api.openPath(paths.exports).catch((e) => toast(e.message, 'err'));
  body.querySelector('#setMigrate').onclick = async () => {
    if (!confirm('迁移数据到新位置？请选择一个空文件夹。迁移过程中请勿关闭软件。')) return;
    try {
      const r = await Api.chooseAndMigrateDataRoot();
      if (r && r.changed) { m.close(); toast('数据已迁移到新位置', 'ok'); openSettings(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  const resetBtn = body.querySelector('#setResetData');
  if (resetBtn) resetBtn.onclick = async () => {
    if (!confirm('把数据迁回系统默认位置？')) return;
    try {
      const r = await Api.resetDataRootToDefault();
      if (r && r.changed) { m.close(); toast('已恢复默认位置', 'ok'); openSettings(); }
    } catch (e) { toast(e.message, 'err'); }
  };

  const m = modal({
    title: '设置',
    body,
    wide: true,
    footer: [mkBtn('关闭', 'ghost', () => m.close())],
  });
}

async function openUpdateDialog() {
  const body = el('div', '', '<div class="hint">正在读取更新清单...</div>');
  const m = modal({
    title: '软件更新',
    body,
    footer: [mkBtn('关闭', 'ghost', () => m.close())],
  });
  try {
    const status = await Api.checkUpdates();
    const rows = (status.updates || []).map((u) => {
      const available = u.available;
      const action = u.component === 'print'
        ? `<button class="btn small${available ? '' : ' ghost'}" data-install-print ${available ? '' : 'disabled'}>安装</button>`
        : `<button class="btn small${available ? '' : ' ghost'}" data-download-core ${available ? '' : 'disabled'}>下载</button>`;
      return `<div class="settings-status-row">
        <b>${esc(u.name || u.component)}</b>
        <span>${esc(u.current_version || '未安装')} → ${esc(u.latest_version || '未知')} ${available ? '<span class="settings-warn">有更新</span>' : '<span class="settings-ok">已是最新</span>'} ${action}</span>
      </div>`;
    }).join('');
    body.innerHTML = `
      <div class="detail-section">
        <h3>更新源<span class="h3-line"></span></h3>
        <div class="hint"><code>${esc(status.manifest_url)}</code></div>
      </div>
      <div class="detail-section">
        <h3>当前平台<span class="h3-line"></span></h3>
        <div class="hint">${esc(status.platform)}</div>
      </div>
      <div class="detail-section">
        <h3>可用版本<span class="h3-line"></span></h3>
        ${rows || '<div class="hint warn">清单里没有当前平台的更新包。</div>'}
      </div>`;
    const coreBtn = body.querySelector('[data-download-core]');
    if (coreBtn) coreBtn.onclick = async () => {
      coreBtn.disabled = true;
      coreBtn.textContent = '下载中';
      try {
        const r = await Api.downloadCoreUpdate();
        toast('核心更新包已下载：' + baseName(r.file_path), 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { coreBtn.textContent = '下载'; coreBtn.disabled = false; }
    };
    const printBtn = body.querySelector('[data-install-print]');
    if (printBtn) printBtn.onclick = async () => {
      printBtn.disabled = true;
      printBtn.textContent = '安装中';
      try {
        const r = await Api.installPrintComponent();
        toast('打印组件已安装：' + r.version, 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { printBtn.textContent = '安装'; printBtn.disabled = false; }
    };
  } catch (e) {
    body.innerHTML = `<div class="hint warn">${esc(e.message)}</div>`;
  }
}

function maybeShowFirstUseGuide() {
  if (!State.profiles.length) return;
  if (localStorage.getItem(FIRST_USE_GUIDE_KEY)) return;
  if ($('#modalRoot').lastChild) return;
  setTimeout(() => {
    if (!$('#modalRoot').lastChild && !localStorage.getItem(FIRST_USE_GUIDE_KEY)) {
      openUsageGuide(true);
    }
  }, 450);
}

function openUsageGuide(firstRun) {
  const body = el('div');
  body.innerHTML = `
    <div class="guide-steps">
      <div>
        <b>1. 导入发票</b>
        <span>拖入 PDF，或用批量导入处理一组发票。XML 可辅助识别。</span>
      </div>
      <div>
        <b>2. 补齐材料</b>
        <span>把付款截图、查验单拖到条目卡片，或在条目里添加。</span>
      </div>
      <div>
        <b>3. 筛选检查</b>
        <span>用待补材料、需确认、抬头、报账人缩小范围。</span>
      </div>
      <div>
        <b>4. 批量处理</b>
        <span>先选当前列表或异常条目，再汇总、导出、打印或装入批次。</span>
      </div>
    </div>`;
  const m = modal({
    title: firstRun ? '快速开始' : '使用提示',
    body,
    footer: [
      mkBtn('知道了', 'primary', () => {
        localStorage.setItem(FIRST_USE_GUIDE_KEY, '1');
        m.close();
      }),
    ],
  });
}

// ------------------------------------------------------------------ 新建条目
function openNewEntry() {
  if (!State.currentProfileId) { toast('请先创建身份', 'err'); openProfileManager(true); return; }

  const picked = { xml: null, pdf: null, payments: [], inspection: null };
  const body = el('div');

  function uploadTile(key, label, hint, ph, ico) {
    return `<div class="upload-tile" data-tile="${key}">
      <div class="ut-title">${ico} ${label}</div>
      <div class="ut-hint">${hint}</div>
      <button class="btn small" data-pick="${key}">${ph}</button>
      <div class="ut-name" id="ne-${key}-name" hidden></div>
    </div>`;
  }
  const utIco = (svg) => svg.replace('<svg ', '<svg width="18" height="18" ');

  body.innerHTML = `
    <div class="hint">推荐同时上传发票 PDF 和 XML，识别更准。材料不齐可先存草稿，之后补齐。</div>
    <div class="form-row" style="margin-top:14px">
      <label>抬头</label>
      <select id="neTitle">
        <option value="">自动识别</option>
        <option value="北京理工大学">北京理工大学</option>
        <option value="北京理工大学教育基金会">北京理工大学教育基金会</option>
      </select>
    </div>
    <div class="upload-grid">
      ${uploadTile('pdf', '发票 PDF', '推荐上传', '选择文件', utIco(iconPdf()))}
      ${uploadTile('xml', '发票 XML', '让识别更准', '选择文件', utIco(iconXml()))}
      ${uploadTile('payment', '付款截图', '可多张 · 浅色背景', '选择图片', utIco(iconImage()))}
      ${uploadTile('inspection', '查验单 PDF', '可选', '选择文件', utIco(iconInspect()))}
    </div>
    <div id="nePreview"></div>`;

  body.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.pick;
      try {
        const multiple = key === 'payment';
        const res = await Api.pickFiles(multiple);
        const paths = res.paths || [];
        if (!paths.length) return;
        const nameEl = body.querySelector(`#ne-${key}-name`);
        const tile = body.querySelector(`[data-tile="${key}"]`);
        if (key === 'payment') {
          picked.payments = paths;
          nameEl.textContent = `${paths.length} 张付款截图`;
        } else if (key === 'inspection') {
          picked.inspection = paths[0];
          nameEl.textContent = baseName(paths[0]);
        } else {
          picked[key] = paths[0];
          nameEl.textContent = baseName(paths[0]);
        }
        nameEl.hidden = false;
        tile.classList.add('has-file');
        if (key === 'xml' || key === 'pdf') await preview();
      } catch (e) { toast(e.message, 'err'); }
    };
  });

  async function preview() {
    if (!picked.xml && !picked.pdf) return;
    try {
      const r = await Api.parseFiles(picked.xml, picked.pdf);
      const p = r.parsed, c = r.check;
      const prev = body.querySelector('#nePreview');
      prev.innerHTML = `
        <div class="detail-section" style="margin-top:18px">
          <h3>识别结果 <span class="badge ${c.status}">${CHECK_LABEL[c.status]}</span></h3>
          <div class="kv">
            <span class="k">发票号码</span><span class="v-mono">${esc(p.invoice_no || '—')}</span>
            <span class="k">发票日期</span><span>${esc(p.invoice_date || '—')}</span>
            <span class="k">销售方</span><span>${esc(p.seller || '—')}</span>
            <span class="k">购买方抬头</span><span>${esc(p.buyer_name || '—')}</span>
            <span class="k">价税合计</span><span><b style="font-family:var(--font-serif);font-size:15px">${fmtMoney(p.total)}</b></span>
            <span class="k">明细条数</span><span>${p.items.length}</span>
          </div>
          ${c.message ? `<p class="hint warn" style="margin-top:12px">${esc(c.message)}</p>` : ''}
        </div>`;
      const titleSel = body.querySelector('#neTitle');
      if (!titleSel.value && p.buyer_name) titleSel.value = p.buyer_name;
    } catch (e) { toast('识别失败：' + e.message, 'err'); }
  }

  const create = async () => {
    try {
      await Api.createEntry({
        profileId: State.currentProfileId,
        title: body.querySelector('#neTitle').value,
        xmlPath: picked.xml, pdfPath: picked.pdf,
        paymentPaths: picked.payments, inspectionPath: picked.inspection,
        status: 'draft',
      });
      m.close();
      await refreshEntries();
      toast('已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const m = modal({
    title: '新建报账条目',
    subhead: '上传后自动识别，发票号、金额等无需手输；状态按材料齐全度自动判定',
    wide: true, body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('保存', 'primary', () => create()),
    ],
  });
}

// ------------------------------------------------------------------ 批量导入
async function openBatchImport() {
  if (!State.currentProfileId) { toast('请先选择报账人', 'err'); return; }
  const body = el('div');
  body.innerHTML = `
    <div class="import-choice-grid">
      <button class="import-choice" id="biFolder">
        <b>选择文件夹</b>
        <span>扫描其中的发票 PDF 和 XML</span>
      </button>
      <button class="import-choice" id="biFiles">
        <b>多选发票文件</b>
        <span>选择几张 PDF，可同时选 XML</span>
      </button>
    </div>`;
  const m = modal({
    title: '批量导入',
    body,
    footer: [mkBtn('取消', 'ghost', () => m.close())],
  });
  body.querySelector('#biFolder').onclick = () => { m.close(); openBatchImportFromFolder(); };
  body.querySelector('#biFiles').onclick = () => { m.close(); openBatchImportFromFiles(); };
}

async function openBatchImportFromFolder() {
  let picked;
  try { picked = await Api.pickFolder(); } catch (e) { toast(e.message, 'err'); return; }
  const folder = picked && picked.path;
  if (!folder) return;
  try {
    const scan = await Api.scanFolder(folder);
    openBatchImportPreview(scan, folder);
  } catch (e) { toast('扫描失败：' + e.message, 'err'); }
}

async function openBatchImportFromFiles() {
  let picked;
  try { picked = await Api.pickFiles(true); } catch (e) { toast(e.message, 'err'); return; }
  const paths = (picked && picked.paths) || [];
  if (!paths.length) return;
  try {
    const scan = await Api.scanFiles(paths);
    openBatchImportPreview(scan, `${paths.length} 个文件`);
  } catch (e) { toast('扫描失败：' + e.message, 'err'); }
}

function openBatchImportPreview(scan, sourceLabel) {
  const groups = scan.groups.map((g) => ({
    label: g.label,
    selected: g.selected !== false,
    warnings: g.warnings || [],
    files: g.files.map((f) => ({ ...f })),
  }));
  const ungrouped = scan.ungrouped || [];
  const ignored = scan.ignored || [];

  const body = el('div');
  const render = () => {
    const groupRows = groups.map((g, gi) => `
      <div class="bi-group${g.selected ? '' : ' off'}">
        <div class="bi-group-head">
          <label class="bi-ignore"><input type="checkbox" data-bi-group="${gi}" ${g.selected ? 'checked' : ''}/> 导入</label>
          <b>组 ${esc(g.label)}</b>
          <span class="bi-count">${batchGroupSummary(g)}</span>
        </div>
        ${g.files.map((f) => `
          <div class="bi-file">
            <span class="attach-type">${esc(f.type_label || attachTypeLabel(f.type))}</span>
            <span class="bi-name" title="${esc(f.name)}">${esc(f.name)}</span>
            ${f.warning ? `<span class="bi-warning">${esc(f.warning)}</span>` : ''}
          </div>`).join('')}
        ${(g.warnings || []).length ? `<div class="bi-warning">${g.warnings.map(esc).join('；')}</div>` : ''}
      </div>`).join('') || '<div class="hint">没有找到可导入的发票 PDF。批量导入要求每条至少有一个发票 PDF，XML 可以没有。</div>';

    const ungroupedRows = ungrouped.length ? `
      <div class="detail-section" style="margin-top:16px">
        <h3>未匹配 XML<span class="h3-line"></span></h3>
        <div class="hint" style="margin-bottom:10px">这些 XML 没有对应发票 PDF，不会单独创建条目。</div>
        <div class="bi-muted-list">${ungrouped.map((f) => `
          <div class="bi-file">
            <span class="attach-type">${esc(f.type_label || 'XML')}</span>
            <span class="bi-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="bi-warning">${esc(f.warning || '')}</span>
          </div>`).join('')}</div>
      </div>` : '';

    const ignoredRows = ignored.length ? `
      <div class="detail-section" style="margin-top:16px">
        <h3>未参与批量<span class="h3-line"></span></h3>
        <div class="hint" style="margin-bottom:10px">付款截图、查验单需要绑定到具体条目，请在条目详情里添加，或拖到主界面后选择条目。</div>
        <div class="bi-muted-list">${ignored.map((f) => `
          <div class="bi-file">
            <span class="attach-type">${esc(f.type_label || '跳过')}</span>
            <span class="bi-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="bi-warning">${esc(f.warning || '')}</span>
          </div>`).join('')}</div>
      </div>` : '';

    body.innerHTML = `
      <div class="batch-import-summary">
        <div><span>条目</span><b>${scan.invoice_pdf_count || groups.length}</b></div>
        <div><span>XML</span><b>${scan.matched_xml_count || 0}</b></div>
        <div><span>跳过</span><b>${ignored.length + ungrouped.length}</b></div>
      </div>
      <div class="hint" style="margin-top:12px">从 <b>${esc(sourceLabel)}</b> 扫描到 <b>${scan.total_files}</b> 个候选文件。每个发票 PDF 创建一条；XML 只在能匹配到 PDF 时一起带入。</div>
      <div class="bi-groups" style="margin-top:14px">${groupRows}</div>
      ${ungroupedRows}
      ${ignoredRows}`;

    body.querySelectorAll('[data-bi-group]').forEach((cb) => {
      cb.onchange = () => { groups[+cb.dataset.biGroup].selected = cb.checked; render(); };
    });
  };
  render();

  const selectedImportPaths = () => groups
    .filter((g) => g.selected)
    .flatMap((g) => g.files.map((f) => f.path));
  const m = modal({
    title: '确认导入',
    wide: true, body,
    onClose: () => cleanupDroppedPaths(selectedImportPaths()),
    footer: [
      mkBtn('取消', 'ghost', async () => {
        await cleanupDroppedPaths(selectedImportPaths());
        m.close();
      }),
      mkBtn('创建选中条目', 'primary', async () => {
        const payload = groups
          .filter((g) => g.selected)
          .map((g) => ({ label: g.label, files: g.files.map((f) => ({ path: f.path, type: f.type })) }));
        if (!payload.length) { toast('没有可创建的分组', 'err'); return; }
        try {
          const r = await Api.batchCreateEntries(State.currentProfileId, payload);
          await cleanupDroppedPaths(selectedImportPaths());
          m.close();
          await refreshEntries();
          if (r.failed && r.failed.length) {
            toast(`创建 ${r.created} 条，${r.failed.length} 组失败`, 'err');
          } else {
            toast(`已创建 ${r.created} 条`, 'ok');
          }
        } catch (e) { toast(e.message, 'err'); }
      }),
    ],
  });
}

function batchGroupSummary(g) {
  const count = (type) => g.files.filter((f) => f.type === type).length;
  const parts = [`${g.files.length} 个文件`, 'PDF'];
  if (count('invoice_xml')) parts.push('XML');
  return parts.join(' · ');
}

// ------------------------------------------------------------------ 条目详情
async function openEntryDetail(entryId) {
  let e;
  try { e = await Api.getEntry(entryId); } catch (err) { toast(err.message, 'err'); return; }
  if (!e) { toast('条目不存在', 'err'); return; }

  const body = el('div');
  const f = e.fields || {};
  const owner = State.profileById[e.profile_id];

  const itemsRows = (e.items || []).map((it) => {
    const cols = [
      { f: 'actual_name', v: it.actual_name || it.name, cls: '' },
      { f: 'unit', v: it.unit, cls: '' },
      { f: 'quantity', v: it.quantity, cls: 'num' },
      { f: 'unit_price', v: it.unit_price, cls: 'num' },
      { f: 'total', v: it.total, cls: 'num' },
    ];
    return `<tr data-item-id="${it.id}">${cols.map((c) =>
      `<td class="${c.cls}"><span class="cell-val">${c.cls === 'num' ? fmtMoney(c.v) : esc(c.v || '\u2014')}</span><input class="cell-input${c.cls === 'num' ? ' num' : ''}" data-item-field="${c.f}" value="${esc(c.v || '')}"/></td>`
    ).join('')}<td class="act"><button class="del-row" data-del-item="${it.id}" title="删除此行">\u00d7</button></td></tr>`;
  }).join('') || `<tr><td colspan="6" style="color:var(--ink-soft)">无明细</td></tr>`;

  // 附件按报账所需的三类分组展示：发票 / 付款截图 / 查验单；缺的类别显式提示
  const atts = e.attachments || [];
  const attGroup = (label, types, hint) => {
    const list = atts.filter((a) => types.includes(a.type));
    const has = list.length > 0;
    const rows = list.map((a) => `
      <div class="attach-item">
        <span class="attach-name" title="${esc(a.abs_path || a.stored_path)}">${esc(a.original_name)}</span>
        <div class="attach-actions">
          <select class="attach-type-select" data-att-type="${a.id}">
            ${ATTACHMENT_TYPE_OPTS.map(([v, l]) => `<option value="${v}"${v === a.type ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <input class="attach-note" data-att-note="${a.id}" value="${esc(a.note || '')}" placeholder="备注"/>
          <button class="btn small ghost" data-open-att="${a.id}">打开</button>
          <button class="btn small ghost" data-reveal-att="${a.id}">位置</button>
          <button class="btn small ghost" data-replace-att="${a.id}">替换</button>
          <button class="btn small danger" data-del-att="${a.id}">删除</button>
        </div>
      </div>`).join('');
    return `
      <div class="att-group${has ? ' has' : ' missing'}">
        <div class="att-group-head">
          <span class="att-group-dot"></span>
          <span class="att-group-title">${label}</span>
          <span class="att-group-status">${has ? `已上传 ${list.length}` : '未上传'}</span>
          <button class="btn small att-group-add" data-add-att-type="${types[0]}" data-add-att-label="${label}">＋ 添加</button>
        </div>
        ${has ? `<div class="attach-list">${rows}</div>` : `<div class="att-group-hint">${hint}</div>`}
      </div>`;
  };
  const attachSection = [
    attGroup('发票', ['invoice_pdf', 'invoice_xml'], '上传发票 PDF 或 XML，用于识别发票信息。'),
    attGroup('付款截图', ['payment_screenshot'], '上传付款截图，作为实付凭证。'),
    attGroup('查验单', ['inspection_pdf'], '上传发票查验单 PDF。'),
    (atts.some((a) => a.type === 'other')
      ? attGroup('其他', ['other'], '') : ''),
  ].join('');

  const history = (e.history || []).map((h) => `
    <div class="hitem">
      <span class="h-time">${esc(h.changed_at)}</span>
      <span class="h-field">${esc(FIELD_LABEL[h.field] || h.field)}</span>
      <span class="h-val">「${esc(h.old_value || '空')}」→「${esc(h.new_value || '空')}」</span>
    </div>`).join('')
    || '<div class="attach-item" style="color:var(--ink-soft)">暂无修改记录</div>';

  const comp = e.completeness || { ready: false, missing: [] };
  const flowStep = (on, label, sub) => `
    <div class="flow-step${on ? ' on' : ''}">
      <span class="flow-dot"></span>
      <b>${label}</b>
      <small>${sub}</small>
    </div>`;
  const materialFlow = `
    <div class="flow-strip">
      ${flowStep(e.has_invoice, '发票', e.has_invoice ? '已导入' : '需要 PDF')}
      ${flowStep(e.has_payment, '付款', e.has_payment ? '已上传' : '后续补截图')}
      ${flowStep(e.has_inspection, '查验', e.has_inspection ? '已上传' : '后续补查验单')}
      ${flowStep(!!((f.paid_amount || {}).current), '实付', (f.paid_amount || {}).current ? fmtMoney((f.paid_amount || {}).current) : '手动填写')}
    </div>`;
  const compLine = comp.ready
    ? `<p class="hint ok-hint" style="margin-top:10px">材料齐全、实付已填、校验通过。</p>`
    : (comp.missing.length ? `<p class="hint" style="margin-top:10px">待补：${comp.missing.map(esc).join('、')}。</p>` : '');

  body.innerHTML = `
    ${materialFlow}
    <div class="detail-top-grid">
      <div class="detail-section">
        <h3>关键信息 ${e.check_status && e.check_status !== 'pass' ? `<span class="badge ${e.check_status}">${CHECK_LABEL[e.check_status]}</span>` : ''}<span class="h3-line"></span></h3>
        <div class="kv compact">
          ${lockedKV('发票号码', 'invoice_no', e.invoice_no, true)}
          ${lockedKV('发票日期', 'invoice_date', e.invoice_date)}
          ${lockedKV('销售方', 'seller', e.seller)}
          ${lockedKV('价税合计', 'total', e.total, true, true)}
          ${lockedKV('购买方', 'buyer_name', e.buyer_name)}
          <span class="k">报账人</span><span>${esc(owner ? owner.name : '—')} → ${esc(owner ? owner.reviewer : '—')}</span>
        </div>
        ${e.check_message ? `<p class="hint warn compact-hint">${esc(e.check_message)}</p>` : ''}
      </div>

      <div class="detail-section">
        <h3>需要手动确认<span class="h3-line"></span></h3>
        <div class="form-grid compact">
          ${editRow('实付金额', 'paid_amount', f.paid_amount)}
          ${editRow('实际物资名称', 'actual_item_name', f.actual_item_name)}
        </div>
        ${editRow('备注', 'notes', f.notes, true)}
        ${compLine}
      </div>
    </div>

    <div class="detail-section">
      <h3>报账材料<span class="h3-line"></span></h3>
      <div class="material-drop" id="materialDrop">
        <b>拖拽材料到这里</b>
        <span>PDF 自动识别为发票或查验单，图片自动作为付款截图；也可用下方添加按钮。</span>
      </div>
      <div class="att-groups">${attachSection}</div>
    </div>

    <details class="detail-section minor-section">
      <summary>物品明细</summary>
      <table class="items-table">
        <thead><tr><th>名称</th><th>单位</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">金额</th><th style="width:32px"></th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div class="items-add-row"><button class="btn small" id="deAddItem">＋ 添加明细行</button></div>
    </details>

    <details class="detail-section minor-section">
      <summary>修改记录</summary>
      <div class="history-list">${history}</div>
    </details>`;

  function lockedKV(label, field, val, mono, money) {
    const display = money ? fmtMoney(val) : esc(val || '\u2014');
    return `<span class="k field-locked-label">${label}<span class="lock-icon">${wrapSvg(I.lock, 11)}</span></span>
      <span data-locked="${field}" class="${mono ? 'v-mono' : ''}">
        <span class="locked-val" title="点击修改">${display}</span>
        <input class="locked-input${mono ? ' v-mono' : ''}" value="${esc(val || '')}"/>
      </span>`;
  }

  function editRow(label, field, fv, full) {
    const modified = field !== 'notes' && fv && fv.modified;
    const val = fv ? fv.current : '';
    if (field === 'notes') {
      return `<div class="form-row"${full ? ' style="grid-column:1/-1"' : ''}>
        <label>${label}${modified ? '<span class="field-modified-mark">' + iconPencil(11) + '已人工修改</span>' : ''}</label>
        <textarea data-edit="${field}" rows="3" style="width:100%;font-family:inherit;font-size:13px;padding:10px;border-radius:9px;border:1px solid var(--line);resize:vertical">${esc(val)}</textarea>
      </div>`;
    }
    return `<div class="form-row"${full ? ' style="grid-column:1/-1"' : ''}>
      <label>${label}${modified ? '<span class="field-modified-mark">' + iconPencil(11) + '已人工修改</span>' : ''}</label>
      <input data-edit="${field}" value="${esc(val)}"/>
    </div>`;
  }

  setupMaterialDrop(body.querySelector('#materialDrop'), entryId, async () => {
    toast('材料已添加', 'ok');
    mm.close(); openEntryDetail(entryId); await refreshEntries();
  });

  // ---- editable fields (paid_amount, actual_item_name, notes)
  body.querySelectorAll('[data-edit]').forEach((inp) => {
    inp.onchange = async () => {
      try {
        await Api.updateField(entryId, inp.dataset.edit, inp.value, State.currentProfileId);
        toast('已保存', 'ok');
        await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
  });

  // ---- locked fields: click-to-edit inline
  body.querySelectorAll('[data-locked]').forEach((wrap) => {
    const field = wrap.dataset.locked;
    const valSpan = wrap.querySelector('.locked-val');
    const inp = wrap.querySelector('.locked-input');
    valSpan.onclick = () => {
      wrap.classList.add('locked-editing');
      inp.focus();
      inp.select();
    };
    const commit = async () => {
      wrap.classList.remove('locked-editing');
      const nv = inp.value.trim();
      const ov = e[field] || '';
      if (nv === ov) return;
      try {
        await Api.correctLocked(entryId, field, nv, State.currentProfileId);
        toast('已修改并记下', 'ok');
        mm.close(); openEntryDetail(entryId); await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
    inp.onblur = commit;
    inp.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { inp.value = e[field] || ''; wrap.classList.remove('locked-editing'); }
    };
  });

  // ---- items: click-to-edit inline cells
  body.querySelectorAll('.items-table td .cell-val').forEach((valSpan) => {
    valSpan.onclick = () => {
      const td = valSpan.parentElement;
      td.classList.add('editing');
      const inp = td.querySelector('.cell-input');
      inp.focus();
      inp.select();
    };
  });
  body.querySelectorAll('.items-table .cell-input').forEach((inp) => {
    const td = inp.parentElement;
    const tr = td.closest('tr');
    const itemId = parseInt(tr.dataset.itemId, 10);
    const field = inp.dataset.itemField;
    let origVal = inp.value;
    const commit = async () => {
      td.classList.remove('editing');
      const nv = inp.value.trim();
      if (nv === origVal) return;
      try {
        await Api.updateItem(itemId, { [field]: nv });
        origVal = nv;
        td.querySelector('.cell-val').textContent = nv || '\u2014';
        toast('已保存', 'ok');
        await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
    inp.onblur = commit;
    inp.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { inp.value = origVal; td.classList.remove('editing'); }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        inp.blur();
        // move to next/prev editable cell
        const allInputs = [...body.querySelectorAll('.items-table .cell-input')];
        const idx = allInputs.indexOf(inp);
        const next = allInputs[ev.shiftKey ? idx - 1 : idx + 1];
        if (next) {
          const nextTd = next.parentElement;
          nextTd.classList.add('editing');
          next.focus();
          next.select();
        }
      }
    };
  });

  // ---- items: delete row
  body.querySelectorAll('[data-del-item]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await Api.deleteItem(parseInt(btn.dataset.delItem, 10));
        toast('已删除', 'ok');
        mm.close(); openEntryDetail(entryId); await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
  });

  // ---- items: add row
  body.querySelector('#deAddItem').onclick = async () => {
    try {
      await Api.addItem(entryId, { name: '', actual_name: '', unit: '', quantity: '', unit_price: '', total: '' });
      toast('已添加', 'ok');
      mm.close(); openEntryDetail(entryId); await refreshEntries();
    } catch (err) { toast(err.message, 'err'); }
  };

  // ---- 报账材料：按类别添加（预选类型）
  body.querySelectorAll('[data-add-att-type]').forEach((btn) => {
    btn.onclick = () => addAttachmentFlow(entryId, mm, btn.dataset.addAttType);
  });
  body.querySelectorAll('[data-open-att]').forEach((b) => {
    b.onclick = async () => {
      try { await Api.openAttachment(b.dataset.openAtt); }
      catch (err) { toast(err.message, 'err'); }
    };
  });
  body.querySelectorAll('[data-reveal-att]').forEach((b) => {
    b.onclick = async () => {
      try { await Api.revealAttachment(b.dataset.revealAtt); }
      catch (err) { toast(err.message, 'err'); }
    };
  });
  body.querySelectorAll('[data-replace-att]').forEach((b) => {
    b.onclick = async () => {
      const att = atts.find((a) => a.id === b.dataset.replaceAtt);
      if (!att) return;
      try {
        const type = att.type;
        const res = await Api.pickFiles(false);
        const path = (res.paths || [])[0];
        if (!path) return;
        await Api.updateAttachment(att.id, { src_path: path, type });
        toast('附件已替换', 'ok');
        mm.close(); openEntryDetail(entryId); await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
  body.querySelectorAll('[data-att-type]').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await Api.updateAttachment(sel.dataset.attType, { type: sel.value });
        toast('附件类型已更新', 'ok');
        mm.close(); openEntryDetail(entryId); await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
  body.querySelectorAll('[data-att-note]').forEach((inp) => {
    inp.onchange = async () => {
      try { await Api.updateAttachment(inp.dataset.attNote, { note: inp.value }); toast('附件备注已保存', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    };
  });
  body.querySelectorAll('[data-del-att]').forEach((b) => {
    b.onclick = async () => {
      try { await Api.deleteAttachment(b.dataset.delAtt); toast('已删除', 'ok'); mm.close(); openEntryDetail(entryId); await refreshEntries(); }
      catch (err) { toast(err.message, 'err'); }
    };
  });

  const mm = modal({
    title: e.seller || (e.invoice_no ? '发票 ' + e.invoice_no : '报账条目'),
    wide: true, body,
    footer: [
      mkBtn('删除条目', 'danger', async () => {
        if (!confirm('确认删除该条目及其附件？此操作不可撤销。')) return;
        try { await Api.deleteEntry(entryId); mm.close(); await refreshEntries(); toast('已删除', 'ok'); }
        catch (err) { toast(err.message, 'err'); }
      }),
      mkBtn('关闭', 'ghost', () => mm.close()),
    ],
  });
}

const ATTACHMENT_TYPE_OPTS = [
  ['payment_screenshot', '付款截图'],
  ['invoice_pdf', '发票 PDF'],
  ['invoice_xml', '发票 XML'],
  ['inspection_pdf', '查验单 PDF'],
  ['other', '其他'],
];

function classifyAttachmentByName(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.xml')) return 'invoice_xml';
  if (/\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(n)) return 'payment_screenshot';
  if (n.endsWith('.pdf') && (name.includes('查验') || name.includes('验真'))) return 'inspection_pdf';
  if (n.endsWith('.pdf')) return 'invoice_pdf';
  return 'other';
}

function dragFilePath(file) {
  return file.path || file.webkitRelativePath || '';
}

async function addDroppedMaterialFiles(entryId, files) {
  if (!files.length) return false;
  const paths = await droppedFilesToPaths(files);
  try {
    await validateDroppedMaterialsForEntry(entryId, paths);
    for (const path of paths) {
      await Api.addAttachment(entryId, path, classifyAttachmentByName(path));
    }
  } finally {
    await cleanupDroppedPaths(paths);
  }
  return true;
}

async function validateDroppedMaterialsForEntry(entryId, paths) {
  const entry = await Api.getEntry(entryId);
  const wrongInvoices = [];
  const unconfirmedInvoices = [];
  for (const path of paths) {
    const type = classifyAttachmentByName(path);
    if (type !== 'invoice_pdf' && type !== 'invoice_xml') continue;
    try {
      const result = type === 'invoice_xml'
        ? await Api.parseFiles(path, null)
        : await Api.parseFiles(null, path);
      const invoiceNo = result.parsed?.invoice_no || '';
      if (entry.invoice_no && invoiceNo && invoiceNo !== entry.invoice_no) {
        wrongInvoices.push(baseName(path));
      } else if (entry.invoice_no && !invoiceNo) {
        unconfirmedInvoices.push(baseName(path));
      }
    } catch (_) {
      if (entry.invoice_no || entry.has_invoice) unconfirmedInvoices.push(baseName(path));
    }
  }
  if (wrongInvoices.length) {
    throw new Error(`这张发票不属于当前条目：${wrongInvoices.join('、')}。发票 PDF/XML 请拖到主界面批量导入。`);
  }
  if (unconfirmedInvoices.length) {
    throw new Error(`无法确认发票是否属于当前条目：${unconfirmedInvoices.join('、')}。请用“替换”或从主界面导入。`);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

async function droppedFilesToPaths(files) {
  const list = [...(files || [])];
  if (!list.length) return [];
  const directPaths = list.map(dragFilePath).filter(Boolean);
  if (directPaths.length === list.length) return directPaths;
  const payload = [];
  for (const file of list) {
    payload.push({ name: file.name || 'dropped-file', data_url: await readFileAsDataURL(file) });
  }
  const saved = await Api.saveDroppedFiles(payload);
  return saved.paths || [];
}

async function cleanupDroppedPaths(paths) {
  if (!paths || !paths.length) return;
  try { await Api.cleanupDroppedFiles(paths); }
  catch (_) { /* 清理失败不影响用户当前操作 */ }
}

function setupMaterialDrop(zone, entryId, onDone) {
  if (!zone) return;
  zone.ondragover = (ev) => {
    ev.preventDefault();
    zone.classList.add('dragging');
  };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    zone.classList.remove('dragging');
    const files = [...(ev.dataTransfer?.files || [])];
    try {
      const added = await addDroppedMaterialFiles(entryId, files);
      if (added) await onDone();
    } catch (err) { toast(err.message, 'err'); }
  };
}

function isInvoiceImportFile(path) {
  const n = String(path || '').toLowerCase();
  if (n.endsWith('.xml')) return true;
  if (!n.endsWith('.pdf')) return false;
  return !(path.includes('查验') || path.includes('验真'));
}

function isAttachableMaterialFile(path) {
  const n = String(path || '').toLowerCase();
  if (/\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(n)) return true;
  return n.endsWith('.pdf') && (path.includes('查验') || path.includes('验真'));
}

function setupGlobalDrop() {
  let hideTimer = null;
  const hasFiles = (dt) => dt && Array.from(dt.types || []).includes('Files');
  const keepOverlayVisible = () => {
    showDragOverlay();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideDragOverlay, 220);
  };
  document.addEventListener('dragenter', (ev) => {
    if (!hasFiles(ev.dataTransfer)) return;
    keepOverlayVisible();
  });
  document.addEventListener('dragleave', (ev) => {
    if (ev.clientX <= 0 || ev.clientY <= 0 ||
        ev.clientX >= window.innerWidth || ev.clientY >= window.innerHeight) {
      clearTimeout(hideTimer);
      hideDragOverlay();
    }
  });
  document.addEventListener('dragover', (ev) => {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    keepOverlayVisible();
  });
  document.addEventListener('drop', async (ev) => {
    if (!ev.dataTransfer?.files?.length) return;
    ev.preventDefault();
    clearTimeout(hideTimer);
    hideDragOverlay();
    if (ev.target instanceof Element && ev.target.closest('.entry-card, .material-drop, .modal-mask')) return;
    let paths = [];
    try { paths = await droppedFilesToPaths([...ev.dataTransfer.files]); }
    catch (e) { toast(e.message || '读取拖入文件失败', 'err'); return; }
    const invoicePaths = paths.filter(isInvoiceImportFile);
    const materialPaths = paths.filter(isAttachableMaterialFile);
    if (invoicePaths.length) {
      try {
        const scan = await Api.scanFiles(invoicePaths);
        openBatchImportPreview(scan, `${invoicePaths.length} 个拖入文件`);
        if (materialPaths.length) toast('付款截图和查验单请绑定到条目', 'err');
      } catch (e) {
        await cleanupDroppedPaths(paths);
        toast('扫描失败：' + e.message, 'err');
      }
      return;
    }
    if (materialPaths.length) {
      openAttachDroppedFiles(materialPaths);
      return;
    }
    await cleanupDroppedPaths(paths);
    toast('请拖入发票 PDF、XML、付款截图或查验单', 'err');
  });
  document.addEventListener('dragend', () => {
    clearTimeout(hideTimer);
    hideDragOverlay();
  });
  window.addEventListener('blur', () => {
    clearTimeout(hideTimer);
    hideDragOverlay();
  });
}

function showDragOverlay() {
  document.body.classList.add('dragging-files');
  if ($('.drag-overlay')) return;
  const ov = el('div', 'drag-overlay', `
    <div class="drag-guide">
      <b>空白列表区：导入发票 PDF/XML</b>
      <span>拖到条目卡片：绑定付款截图或查验单</span>
    </div>`);
  document.body.appendChild(ov);
}

function hideDragOverlay() {
  document.body.classList.remove('dragging-files');
  const ov = $('.drag-overlay');
  if (ov) ov.remove();
}

async function openAttachDroppedFiles(paths) {
  if (!State.currentProfileId) {
    await cleanupDroppedPaths(paths);
    toast('请先选择报账人', 'err');
    return;
  }
  let entries = [];
  try { entries = await Api.listEntries({}); }
  catch (e) {
    await cleanupDroppedPaths(paths);
    toast(e.message, 'err');
    return;
  }
  if (!entries.length) {
    await cleanupDroppedPaths(paths);
    toast('还没有可绑定的条目', 'err');
    return;
  }

  const body = el('div');
  const rows = paths.map((p, idx) => `
    <div class="drop-bind-row">
      <span class="attach-name" title="${esc(p)}">${esc(baseName(p))}</span>
      <select data-drop-type="${idx}">
        ${ATTACHMENT_TYPE_OPTS.filter(([v]) => ['payment_screenshot', 'inspection_pdf', 'other'].includes(v))
          .map(([v, l]) => `<option value="${v}"${v === classifyAttachmentByName(p) ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>`).join('');
  body.innerHTML = `
    <div class="form-row">
      <label>绑定到条目</label>
      <select id="dropEntry">
        ${entries.map((e) => `<option value="${e.id}">${esc(dropEntryLabel(e))}</option>`).join('')}
      </select>
    </div>
    <div class="drop-bind-list">${rows}</div>`;
  const m = modal({
    title: '绑定材料',
    body,
    onClose: () => cleanupDroppedPaths(paths),
    footer: [
      mkBtn('取消', 'ghost', async () => {
        await cleanupDroppedPaths(paths);
        m.close();
      }),
      mkBtn('添加到条目', 'primary', async () => {
        const entryId = body.querySelector('#dropEntry').value;
        try {
          for (const [idx, path] of paths.entries()) {
            const type = body.querySelector(`[data-drop-type="${idx}"]`).value;
            await Api.addAttachment(entryId, path, type);
          }
          await cleanupDroppedPaths(paths);
          m.close();
          await refreshEntries();
          toast('材料已添加', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      }),
    ],
  });
}

function dropEntryLabel(e) {
  const item = (e.fields?.actual_item_name?.current) || (e.items?.[0]?.actual_name) || e.seller || '未命名条目';
  return `${item} · ${e.invoice_no || '无发票号'} · ${fmtMoney(e.total)}`;
}

function attachTypeLabel(t) {
  return { invoice_pdf: '发票PDF', invoice_xml: '发票XML', payment_screenshot: '付款截图',
    inspection_pdf: '查验单', other: '其他' }[t] || t;
}
async function addAttachmentFlow(entryId, parentModal, presetType) {
  const body = el('div');
  body.innerHTML = `
    <div class="form-row"><label>附件类型</label>
      <select id="atType">
        ${ATTACHMENT_TYPE_OPTS.map(([v, l]) => `<option value="${v}"${v === presetType ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>`;
  const m = modal({
    title: '添加附件', body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('选择文件并添加', 'primary', async () => {
        try {
          const type = body.querySelector('#atType').value;
          const res = await Api.pickFiles(type === 'payment_screenshot');
          const paths = res.paths || [];
          if (!paths.length) return;
          for (const p of paths) await Api.addAttachment(entryId, p, type);
          m.close(); parentModal.close(); openEntryDetail(entryId); await refreshEntries();
          toast('附件已添加', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }),
    ],
  });
}

// ------------------------------------------------------------------ 汇总 / 绑定包 / 批量
async function exportSummary(ids) {
  const list = ids || (State.selected.size ? [...State.selected] : State.entries.map((e) => e.id));
  if (!list.length) { toast('没有可汇总的条目', 'err'); return; }
  try {
    const s = await Api.buildSummary(list);
    const byTitle = Object.entries(s.by_title || {}).map(([t, n]) => `${TITLE_SHORT[t] || t}：${n} 条`).join('　·　');
    const rows = (s.entries || []).slice(0, 12).map((e, i) => `
      <tr>
        <td>${i + 1}</td><td>${esc(e.invoice_no || '未识别')}</td><td>${esc(e.seller || '未识别')}</td>
        <td class="num">${fmtMoney(e.total)}</td><td>${esc(e.status || '')}</td>
      </tr>`).join('');
    const m = modal({
      title: '汇总信息',
      wide: true,
      body: `<div class="summary-strip">
          <div><span>条目</span><b>${s.count}</b></div>
          <div><span>合计</span><b>${fmtMoney(s.total)}</b></div>
          <div><span>抬头</span><b>${esc(byTitle || '未分组')}</b></div>
        </div>
        <table class="items-table summary-table" style="margin-top:14px">
          <thead><tr><th>#</th><th>发票号</th><th>销售方</th><th style="text-align:right">金额</th><th>状态</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="color:var(--ink-soft)">没有可显示的条目</td></tr>'}</tbody>
        </table>
        ${(s.entries || []).length > 12 ? '<div class="hint" style="margin-top:10px">这里只预览前 12 条；需要完整表格请使用导出里的“总览 Excel”。</div>' : ''}`,
      footer: [mkBtn('关闭', 'ghost', () => m.close())],
    });
  } catch (e) { toast(e.message, 'err'); }
}

async function doExport(ids) {
  if (!ids || !ids.length) { toast('请先选择要导出的条目', 'err'); return; }
  const body = el('div');
  const defaultName = '报账导出-' + new Date().toISOString().slice(0, 10);
  body.innerHTML = `
    <div class="form-row">
      <label>导出名称</label>
      <input id="exName" value="${esc(defaultName)}"/>
    </div>
    <div class="export-options">
      <label class="export-option">
        <input type="checkbox" data-export="bindle" checked/>
        <span><b>绑定包</b><small>给别人导入 tidoc 继续整理，包含条目、附件与签名清单。</small></span>
      </label>
      <label class="export-option">
        <input type="checkbox" data-export="excel" checked/>
        <span><b>总览 Excel</b><small>给负责人核对条数、金额、材料状态和备注。</small></span>
      </label>
      <label class="export-option">
        <input type="checkbox" data-export="archive" checked/>
        <span><b>规范命名附件包</b><small>按“序号_发票号_销售方_金额”分文件夹整理附件并压缩。</small></span>
      </label>
    </div>
    <div class="hint" style="margin-top:12px">当前选择 <b>${ids.length}</b> 条。导出的文件会放在设置里的“导出目录”。</div>`;
  const m = modal({
    title: '导出',
    wide: true,
    body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('开始导出', 'primary', async () => {
        const name = body.querySelector('#exName').value.trim() || defaultName;
        const chosen = [...body.querySelectorAll('[data-export]:checked')].map((x) => x.dataset.export);
        if (!chosen.length) { toast('请选择至少一种导出内容', 'err'); return; }
        try {
          const outputs = [];
          if (chosen.includes('bindle')) outputs.push(await Api.exportBindle(ids, name + '-绑定包'));
          if (chosen.includes('excel')) outputs.push(await Api.exportOverviewExcel(ids, name + '-总览'));
          if (chosen.includes('archive')) outputs.push(await Api.exportAttachmentArchive(ids, name + '-附件'));
          m.close();
          showExportResult(outputs);
          toast(`已导出 ${outputs.length} 个文件`, 'ok');
        } catch (e) { toast(e.message, 'err'); }
      }),
    ],
  });
}

function showExportResult(outputs) {
  const body = el('div');
  const rows = outputs.map((o) => `
    <div class="attach-item">
      <span class="attach-name" title="${esc(o.path)}">${esc(baseName(o.path))}</span>
      <button class="btn small ghost" data-open-export="${esc(o.path)}">打开</button>
    </div>`).join('');
  body.innerHTML = `<div class="hint">已生成以下文件。</div><div class="attach-list" style="margin-top:12px">${rows}</div>`;
  body.querySelectorAll('[data-open-export]').forEach((btn) => {
    btn.onclick = async () => {
      try { await Api.openPath(btn.dataset.openExport); }
      catch (e) { toast(e.message, 'err'); }
    };
  });
  const m = modal({
    title: '导出完成',
    body,
    footer: [mkBtn('关闭', 'ghost', () => m.close())],
  });
}

async function doImport() {
  if (!State.currentProfileId) { toast('请先创建身份', 'err'); return; }
  try {
    const res = await Api.pickFiles(false, ['绑定包 (*.tidoc)']);
    const paths = res.paths || [];
    if (!paths.length) return;
    const path = paths[0];
    const insp = await Api.inspectBindle(path);
    let allow = false;
    if (!insp.verified) {
      if (!confirm(`这份文件被改过（${insp.tampered.join(', ')}）。\n仍要导入吗？导入后这些条目会标记为可疑。`)) return;
      allow = true;
    }
    const r = await Api.importBindle(path, State.currentProfileId, allow);
    await refreshEntries();
    toast(r.message + `（${r.imported} 条）`, r.tampered && r.tampered.length ? 'err' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ------------------------------------------------------------------ 打印导出组件
async function openPrintDialog(ids) {
  if (!ids || !ids.length) { toast('请先选择要打印的条目', 'err'); return; }
  let status;
  try { status = await Api.printComponentStatus(); } catch (e) { toast(e.message, 'err'); return; }

  if (!status.available) {
    const m = modal({
      title: '打印导出组件未安装',
      body: `<div class="hint warn">打印功能需要安装可选组件，当前缺少：<b>${esc((status.missing || []).join(', '))}</b>。<br/>开发阶段可运行 <code>pip install -r requirements-print.txt</code> 安装。</div>`,
      footer: [mkBtn('知道了', 'ghost', () => m.close())],
    });
    return;
  }

  const byTitle = {};
  State.entries.filter((e) => ids.includes(e.id)).forEach((e) => {
    const t = e.title || '未标注抬头';
    byTitle[t] = (byTitle[t] || 0) + 1;
  });
  const titleSummary = Object.entries(byTitle).map(([t, n]) => `${TITLE_SHORT[t] || t}：${n} 条`).join('　·　');

  const ANNO = [
    ['invoice_no', '发票号'], ['person_name', '报账人'], ['paid_amount', '实付金额'],
    ['invoice_date', '日期'], ['seller', '销售方'], ['total', '价税合计'],
  ];
  const OUTPUTS = [
    ['make_invoice_pdf', '发票拼接 PDF'], ['make_payment_pdf', '付款截图拼接 PDF'],
    ['make_inspection_pdf', '查验单拼接 PDF'], ['make_reimburse_doc', '报账说明 Word'],
    ['make_acceptance_doc', '验收单 Word'],
  ];
  const defaultAnno = ['invoice_no', 'person_name', 'paid_amount'];

  const body = el('div');
  body.innerHTML = `
    <div class="hint">共 ${ids.length} 条。两个抬头会分开输出到各自文件夹，不混合。${esc(titleSummary)}</div>
    <div class="detail-section" style="margin-top:16px">
      <h3>生成内容<span class="h3-line"></span></h3>
      <div class="check-grid">
        ${OUTPUTS.map(([k, label]) => `<label class="chk"><input type="checkbox" data-out="${k}" checked/> ${label}</label>`).join('')}
      </div>
    </div>
    <div class="detail-section">
      <h3>拼接页叠加信息（勾选要标注的字段）<span class="h3-line"></span></h3>
      <div class="check-grid">
        ${ANNO.map(([k, label]) => `<label class="chk"><input type="checkbox" data-anno="${k}"${defaultAnno.includes(k) ? ' checked' : ''}/> ${label}</label>`).join('')}
      </div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label>文档日期</label><input id="pDate" placeholder="如 2026年7月5日"/></div>
      <div class="form-row"><label>存放地点</label><input id="pLoc" value="工训楼"/></div>
    </div>`;

  const genBtn = mkBtn('生成打印件', 'primary', async () => {
    const options = {};
    body.querySelectorAll('[data-out]').forEach((c) => { options[c.dataset.out] = c.checked; });
    const annoFields = [...body.querySelectorAll('[data-anno]:checked')].map((c) => c.dataset.anno);
    options.annotate = annoFields.length > 0;
    options.annotation_fields = annoFields;
    const date = body.querySelector('#pDate').value.trim();
    if (date) options.document_date = date;
    options.storage_location = body.querySelector('#pLoc').value.trim() || '工训楼';

    genBtn.disabled = true; genBtn.textContent = '生成中…';
    try {
      const name = '打印件-' + new Date().toISOString().slice(0, 10);
      const r = await Api.buildPrints(ids, options, name);
      m.close();
      showPrintResult(r.results);
    } catch (e) {
      toast(e.message, 'err');
      genBtn.disabled = false; genBtn.textContent = '生成打印件';
    }
  });

  const m = modal({
    title: '打印导出',
    subhead: '两个抬头分开输出 · 可勾选要标注的字段',
    wide: true, body,
    footer: [mkBtn('取消', 'ghost', () => m.close()), genBtn],
  });
}

function showPrintResult(results) {
  const OUT_LABEL = {
    invoice_pdf: '发票拼接 PDF', payment_pdf: '付款截图拼接 PDF', inspection_pdf: '查验单拼接 PDF',
    reimburse_doc: '报账说明 Word', acceptance_doc: '验收单 Word',
  };
  const html = (results || []).map((g) => {
    const tcls = TITLE_CLASS[g.title] || '';
    const files = Object.entries(g.files).map(([k, v]) =>
      `<div class="attach-item"><span class="attach-type">${OUT_LABEL[k] || k}</span><span style="flex:1" title="${esc(v)}">${esc(baseName(v))}</span></div>`).join('');
    return `<div class="detail-section">
      <h3>${tcls ? `<span class="title-chip ${tcls}">${esc(TITLE_SHORT[g.title] || g.title)}</span>` : esc(g.title || '未标注抬头')}<span class="h3-line"></span></h3>
      <div class="attach-list">${files || '<span style="color:var(--ink-soft)">无文件</span>'}</div>
    </div>`;
  }).join('');
  const m = modal({
    title: '打印件已生成',
    subhead: '已按抬头分文件夹保存到导出目录',
    wide: true,
    body: html || '<div class="hint">无生成结果。</div>',
    footer: [mkBtn('完成', 'primary', () => m.close())],
  });
}

async function batchDelete() {
  const ids = [...State.selected];
  if (!ids.length) return;
  if (!confirm(`确认删除所选 ${ids.length} 条？此操作不可撤销。`)) return;
  try {
    await Api.deleteEntries(ids);
    State.selected.clear();
    await refreshEntries();
    toast('已删除', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

window.addEventListener('error', (e) => {
  const msg = e.error ? e.error.message : e.message;
  if (msg && !/TSMMenuKey|NSSoftLinking/i.test(msg)) toast('JS 错误：' + msg, 'err');
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason && (e.reason.message || String(e.reason));
  if (msg) toast(msg, 'err');
});

// ------------------------------------------------------------------ 启动
window.addEventListener('DOMContentLoaded', init);
