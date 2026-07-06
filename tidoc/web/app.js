/* 理票 · Tidoc 前端主逻辑 — 整理 / 筛选 / 便捷操作。 */

const State = {
  profiles: [],
  profileById: {},
  currentProfileId: null,
  activeTitle: '',
  rail: 'all',
  entries: [],
  selected: new Set(),
  density: 'comfortable',
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
  bindEvents();
  await loadProfiles();
  await refreshEntries();
  showSearchHintIfEmpty();
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
  const f = { title: State.activeTitle || undefined };
  const status = $('#filterStatus').value;
  const check = $('#filterCheck').value;
  const profile = $('#filterProfile').value;
  const kw = $('#filterKeyword').value.trim();
  const amin = $('#filterAmountMin').value;
  const amax = $('#filterAmountMax').value;
  const dfrom = $('#filterDateFrom').value;
  const dto = $('#filterDateTo').value;
  const sort = $('#sortSelect').value;

  if (State.rail === 'draft') f.status = 'draft';
  else if (State.rail === 'warn') f.check_status = 'warning';
  else if (State.rail === 'modified') f.modified_only = true;

  if (status) f.status = status;
  if (check) f.check_status = check;
  if (profile) f.profile_id = profile;
  if (kw) f.keyword = kw;
  if (amin) f.amount_min = amin;
  if (amax) f.amount_max = amax;
  if (dfrom) f.date_from = dfrom;
  if (dto) f.date_to = dto;
  if (sort) f.sort = sort;
  return f;
}

async function refreshEntries() {
  try {
    State.entries = await Api.listEntries(currentFilters());
  } catch (e) {
    toast(e.message, 'err');
    State.entries = [];
  }
  renderEntries();
  renderActiveFilters();
}

// ------------------------------------------------------------------ 渲染列表
function renderEntries() {
  const list = $('#entryList');
  list.dataset.density = State.density;
  list.innerHTML = '';
  const empty = $('#emptyState');
  const emptyAll = State.entries.length === 0;

  let sum = 0, paidSum = 0, modifiedCount = 0;
  State.entries.forEach((e) => {
    sum += Number(e.total) || 0;
    const fp = e.fields && e.fields.paid_amount ? Number(e.fields.paid_amount.current) : 0;
    paidSum += isNaN(fp) ? 0 : fp;
    if (e.modified_fields && e.modified_fields.length) modifiedCount++;
    list.appendChild(entryCard(e));
  });

  $('#stats').innerHTML = emptyAll
    ? ''
    : `<span><b>${State.entries.length}</b> 条</span>
       <span class="sep">·</span>
       <span>合计 <b class="stats-sum">${fmtMoney(sum)}</b></span>
       ${paidSum ? `<span class="sep">·</span><span>实付 <b style="color:var(--pass)">${fmtMoney(paidSum)}</b></span>` : ''}
       ${modifiedCount ? `<span class="sep">·</span><span>已改 <b>${modifiedCount}</b></span>` : ''}`;

  empty.hidden = !emptyAll;
  if (emptyAll) renderEmptyState();
  $('#selectionBar').classList.toggle('hidden', State.selected.size === 0);
  $('#selCount').textContent = `已选 ${State.selected.size}`;
}

function entryCard(e) {
  const tcls = TITLE_CLASS[e.title] || '';
  const card = el('div', 'entry-card' + (tcls ? ' title-' + tcls : '') +
    (State.selected.has(e.id) ? ' selected' : ''));

  const check = el('div', 'entry-check');
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = State.selected.has(e.id);
  cb.onclick = (ev) => { ev.stopPropagation(); toggleSelect(e.id); };
  check.appendChild(cb);

  const stripe = el('div', 'entry-stripe');

  const chip = e.title ? `<span class="title-chip ${tcls}">${esc(TITLE_SHORT[e.title] || e.title)}</span>` : '';
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

  const notesPreview = notesCur
    ? `<span class="notes-preview" title="${esc(notesCur)}">${iconNote(12)}${esc(notesCur)}</span>`
    : (actualCur ? `<span class="notes-preview">${iconBox(12)}${esc(actualCur)}</span>` : '');

  const main = el('div', 'entry-main', `
    <div class="entry-line1">
      ${chip}
      <span class="entry-seller">${esc(e.seller || '（未识别销售方）')}</span>
      ${compBadge}
      ${checkBadge}
      ${modified}
    </div>
    <div class="entry-line2">
      <span class="mono">${esc(e.invoice_no || '无发票号')}</span>
      <span>${esc(dateShort(e.invoice_date))}</span>
      ${attDots}
      ${notesPreview}
    </div>`);

  const right = el('div', 'entry-right');
  right.innerHTML = `
    <div class="entry-total">${fmtMoney(e.total)}</div>
    ${paidCur ? `<div class="entry-paid">实付 <b>${fmtMoney(paidCur)}</b></div>` : '<div class="entry-paid muted">实付未填</div>'}
    <div class="entry-quick">
      <button data-quick="open" title="查看详情">详情</button>
      <button data-quick="note" title="追加备注">备注</button>
      <button data-quick="del" class="danger" title="删除">删</button>
    </div>`;
  right.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const a = b.dataset.quick;
      if (a === 'open') openEntryDetail(e.id);
      else if (a === 'note') quickNoteFlow(e);
      else if (a === 'del') quickDelete(e);
    };
  });

  card.append(check, stripe, main, right);
  card.onclick = () => openEntryDetail(e.id);
  return card;
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
    x.onclick = onClear; c.appendChild(x);
    chips.push(c);
  };
  if ($('#filterStatus').value) mkChip('状态：' + STATUS_LABEL[$('#filterStatus').value], () => { $('#filterStatus').value = ''; refreshEntries(); });
  if ($('#filterCheck').value) mkChip('校验：' + CHECK_LABEL[$('#filterCheck').value], () => { $('#filterCheck').value = ''; refreshEntries(); });
  if ($('#filterProfile').value) mkChip('报账人：' + (State.profileById[$('#filterProfile').value]?.name || ''), () => { $('#filterProfile').value = ''; refreshEntries(); });
  if ($('#filterKeyword').value) mkChip('搜索：' + $('#filterKeyword').value, () => { $('#filterKeyword').value = ''; refreshEntries(); });
  if ($('#filterAmountMin').value || $('#filterAmountMax').value) mkChip(`金额 ${$('#filterAmountMin').value || '∞'}–${$('#filterAmountMax').value || '∞'}`, () => { $('#filterAmountMin').value = ''; $('#filterAmountMax').value = ''; refreshEntries(); });
  if ($('#filterDateFrom').value || $('#filterDateTo').value) mkChip(`日期 ${$('#filterDateFrom').value || '…'}–${$('#filterDateTo').value || '…'}`, () => { $('#filterDateFrom').value = ''; $('#filterDateTo').value = ''; refreshEntries(); });

  wrap.innerHTML = '';
  if (!chips.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  chips.forEach((c) => wrap.appendChild(c));
  $('#advancedDot').classList.toggle('hidden', !chips.length);
}

function hasAnyFilter() {
  return !!($('#filterStatus').value || $('#filterCheck').value || $('#filterProfile').value ||
    $('#filterKeyword').value || $('#filterAmountMin').value || $('#filterAmountMax').value ||
    $('#filterDateFrom').value || $('#filterDateTo').value ||
    State.activeTitle || State.rail !== 'all');
}

function showSearchHintIfEmpty() {
  const kb = $('#searchKbd');
  kb.hidden = !!$('#filterKeyword').value;
}

// ------------------------------------------------------------------ 选择 / 批量
function toggleSelect(id) {
  if (State.selected.has(id)) State.selected.delete(id);
  else State.selected.add(id);
  renderEntries();
}
async function selectAllVisible() {
  State.entries.forEach((e) => State.selected.add(e.id));
  renderEntries();
}

// ------------------------------------------------------------------ 卡片快捷
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

  $$('.title-tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.title-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      State.activeTitle = tab.dataset.title;
      State.selected.clear();
      refreshEntries();
    };
  });

  $$('[data-rail]').forEach((btn) => {
    btn.onclick = () => {
      $$('[data-rail]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const prev = State.rail;
      State.rail = btn.dataset.rail;
      if (prev !== State.rail) {
        if (State.rail === 'draft') $('#filterStatus').value = '';
        if (State.rail === 'warn') $('#filterCheck').value = '';
      }
      refreshEntries();
    };
  });

  let kwTimer;
  const relist = () => refreshEntries();
  $('#filterStatus').onchange = relist;
  $('#filterCheck').onchange = relist;
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
  $('#emptyNew').onclick = () => openNewEntry();
  $('#railExport').onclick = () => doExport(State.selected.size ? [...State.selected] : State.entries.map((e) => e.id));
  $('#railImport').onclick = doImport;
  $('#railPrint').onclick = () => openPrintDialog(State.selected.size ? [...State.selected] : State.entries.map((e) => e.id));

  $('#selectAllBtn').onclick = selectAllVisible;
  $('#clearSelBtn').onclick = () => { State.selected.clear(); renderEntries(); };
  $('#batchSummaryBtn').onclick = exportSummary;
  $('#batchDeleteBtn').onclick = batchDelete;

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
  ['filterStatus', 'filterCheck', 'filterProfile', 'filterKeyword', 'filterAmountMin', 'filterAmountMax', 'filterDateFrom', 'filterDateTo'].forEach((id) => { const n = $('#' + id); if (n) n.value = ''; });
  $$('.title-tab').forEach((t) => t.classList.remove('active'));
  $$('.title-tab')[0].classList.add('active');
  $$('[data-rail]').forEach((b) => b.classList.remove('active'));
  $$('[data-rail]')[0].classList.add('active');
  State.rail = 'all';
  State.activeTitle = '';
  showSearchHintIfEmpty();
  refreshEntries();
}

// ------------------------------------------------------------------ 通用弹层
function modal({ title, subhead, titleChip, body, footer, wide }) {
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

  const close = () => mask.remove();
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
    const list = el('div');
    if (!State.profiles.length) {
      list.innerHTML = '<div class="hint">还没有身份。在下方面板创建第一个：填本人姓名与对应审核人。</div>';
      return list;
    }
    State.profiles.forEach((p) => {
      const row = el('div', 'attach-item');
      row.innerHTML = `<div style="flex:1">
        <b>${esc(p.name)}</b> → ${esc(p.reviewer)}
        ${p.is_default ? ' <span class="badge pass">默认</span>' : ''}
        <div style="font-size:11px;color:var(--ink-faint);margin-top:2px">
          ${p.student_id ? '学号 ' + esc(p.student_id) + '　' : ''}
          ${p.bank_name ? esc(p.bank_name) : ''}
        </div>
      </div>`;
      if (!p.is_default) row.appendChild(mkBtn('设为默认', 'small ghost', async () => {
        await Api.setDefaultProfile(p.id); await loadProfiles(); refreshProfileList();
      }));
      row.appendChild(mkBtn('删除', 'small danger', async () => {
        try { await Api.deleteProfile(p.id); await loadProfiles(); refreshProfileList(); toast('已删除', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      }));
      list.appendChild(row);
    });
    return list;
  }
  function refreshProfileList() { wrap.replaceChild(renderList(), wrap.firstChild); }

  const form = el('div');
  form.innerHTML = `
    <h3 style="margin:18px 0 10px;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em">新增身份</h3>
    <div class="form-grid">
      <div class="form-row"><label>本人姓名 *</label><input id="pfName" placeholder="必填"/></div>
      <div class="form-row"><label>对应审核人 *</label><input id="pfReviewer" placeholder="必填"/></div>
      <div class="form-row"><label>学号</label><input id="pfStudent"/></div>
      <div class="form-row"><label>电话</label><input id="pfContact"/></div>
      <div class="form-row"><label>开户行</label><input id="pfBank"/></div>
      <div class="form-row"><label>卡号</label><input id="pfCard"/></div>
    </div>`;

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
      toast('身份已添加', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  const m = modal({
    title: '身份管理',
    body: wrap,
    footer: [addBtn, mkBtn('关闭', 'ghost', () => m.close())],
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

// ------------------------------------------------------------------ 文件夹批量导入
async function openBatchImport() {
  if (!State.currentProfileId) { toast('请先选择报账人', 'err'); return; }
  let picked;
  try { picked = await Api.pickFolder(); } catch (e) { toast(e.message, 'err'); return; }
  const folder = picked && picked.path;
  if (!folder) return;

  let scan;
  try { scan = await Api.scanFolder(folder); } catch (e) { toast('扫描失败：' + e.message, 'err'); return; }

  // 可编辑的分组模型：ungrouped 里的文件可指派到某组或忽略
  const TYPE_OPTS = [
    ['invoice_pdf', '发票 PDF'], ['invoice_xml', '发票 XML'],
    ['payment_screenshot', '付款截图'], ['inspection_pdf', '查验单'], ['other', '其他'],
  ];
  const groups = scan.groups.map((g) => ({ label: g.label, files: g.files.map((f) => ({ ...f })) }));
  const ungrouped = scan.ungrouped.map((f) => ({ ...f, ignore: true }));

  const body = el('div');
  const render = () => {
    const typeSel = (f, idx, gi) => `<select data-type data-gi="${gi}" data-fi="${idx}" class="bi-type">
      ${TYPE_OPTS.map(([v, l]) => `<option value="${v}"${v === f.type ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`;
    const groupRows = groups.map((g, gi) => `
      <div class="bi-group">
        <div class="bi-group-head">
          <b>组 ${esc(g.label)}</b>
          <span class="bi-count">${g.files.length} 个文件</span>
        </div>
        ${g.files.map((f, fi) => `
          <div class="bi-file">
            <span class="bi-name" title="${esc(f.name)}">${esc(f.name)}</span>
            ${typeSel(f, fi, gi)}
          </div>`).join('')}
      </div>`).join('') || '<div class="hint">没有可分组的文件。</div>';

    const ungroupedRows = ungrouped.length ? `
      <div class="detail-section" style="margin-top:16px">
        <h3>未能自动分组<span class="h3-line"></span></h3>
        <div class="hint" style="margin-bottom:10px">这些文件名里没有识别到组号，可勾选并入新的一条，或忽略。</div>
        ${ungrouped.map((f, ui) => `
          <div class="bi-file">
            <label class="bi-ignore"><input type="checkbox" data-ung="${ui}" ${f.ignore ? '' : 'checked'}/> 导入</label>
            <span class="bi-name" title="${esc(f.name)}">${esc(f.name)}</span>
          </div>`).join('')}
      </div>` : '';

    body.innerHTML = `
      <div class="hint">在 <b>${esc(folder)}</b> 找到 <b>${scan.total_files}</b> 个文件，建议分为 <b>${groups.length}</b> 组。每组将创建一条报账条目，可调整每个文件的类型。</div>
      <div class="bi-groups" style="margin-top:14px">${groupRows}</div>
      ${ungroupedRows}`;

    body.querySelectorAll('[data-type]').forEach((sel) => {
      sel.onchange = () => {
        const gi = +sel.dataset.gi, fi = +sel.dataset.fi;
        groups[gi].files[fi].type = sel.value;
      };
    });
    body.querySelectorAll('[data-ung]').forEach((cb) => {
      cb.onchange = () => { ungrouped[+cb.dataset.ung].ignore = !cb.checked; };
    });
  };
  render();

  const m = modal({
    title: '文件夹批量导入',
    wide: true, body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn(`创建 ${groups.length} 条`, 'primary', async () => {
        // 未分组里勾选导入的，合成额外一组
        const extra = ungrouped.filter((f) => !f.ignore);
        const payload = groups.map((g) => ({ label: g.label, files: g.files.map((f) => ({ path: f.path, type: f.type })) }));
        if (extra.length) payload.push({ label: '未分组', files: extra.map((f) => ({ path: f.path, type: f.type })) });
        if (!payload.length) { toast('没有可创建的分组', 'err'); return; }
        try {
          const r = await Api.batchCreateEntries(State.currentProfileId, payload);
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

// ------------------------------------------------------------------ 条目详情
async function openEntryDetail(entryId) {
  let e;
  try { e = await Api.getEntry(entryId); } catch (err) { toast(err.message, 'err'); return; }
  if (!e) { toast('条目不存在', 'err'); return; }

  const body = el('div');
  const tcls = TITLE_CLASS[e.title] || '';
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
        <span style="flex:1" title="${esc(a.stored_path)}">${esc(a.original_name)}</span>
        ${a.note ? `<span style="font-size:11px;color:var(--ink-soft)">· ${esc(a.note)}</span>` : ''}
        <button class="btn small danger" data-del-att="${a.id}">删除</button>
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
  const compLine = comp.ready
    ? `<p class="hint ok-hint" style="margin-top:10px">材料齐全、实付已填、校验通过。</p>`
    : (comp.missing.length ? `<p class="hint" style="margin-top:10px">待补：${comp.missing.map(esc).join('、')}。</p>` : '');

  body.innerHTML = `
    <div class="detail-section">
      <h3>发票信息 ${e.check_status && e.check_status !== 'pass' ? `<span class="badge ${e.check_status}">${CHECK_LABEL[e.check_status]}</span>` : ''}<span class="h3-line"></span></h3>
      <div class="kv">
        ${lockedKV('发票号码', 'invoice_no', e.invoice_no, true)}
        ${lockedKV('发票日期', 'invoice_date', e.invoice_date)}
        ${lockedKV('销售方', 'seller', e.seller)}
        ${lockedKV('购买方抬头', 'buyer_name', e.buyer_name)}
        ${lockedKV('价税合计', 'total', e.total, true, true)}
        ${lockedKV('税号', 'buyer_tax_id', e.buyer_tax_id, true)}
        <span class="k">报账人</span><span>${esc(owner ? owner.name : '—')} → ${esc(owner ? owner.reviewer : '—')}</span>
      </div>
      ${e.check_message ? `<p class="hint warn" style="margin-top:12px">${esc(e.check_message)}</p>` : ''}
    </div>

    <div class="detail-section">
      <h3>填写信息<span class="h3-line"></span></h3>
      <div class="form-grid">
        ${editRow('实付金额', 'paid_amount', f.paid_amount)}
        ${editRow('实际物资名称', 'actual_item_name', f.actual_item_name)}
      </div>
      ${editRow('备注', 'notes', f.notes, true)}
    </div>

    <div class="detail-section">
      <h3>物品明细<span class="h3-line"></span></h3>
      <table class="items-table">
        <thead><tr><th>名称</th><th>单位</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">金额</th><th style="width:32px"></th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div class="items-add-row"><button class="btn small" id="deAddItem">＋ 添加明细行</button></div>
    </div>

    <div class="detail-section">
      <h3>报账材料<span class="h3-line"></span></h3>
      <div class="att-groups">${attachSection}</div>
      ${compLine}
    </div>

    <div class="detail-section">
      <h3>修改记录<span class="h3-line"></span></h3>
      <div class="history-list">${history}</div>
    </div>`;

  function lockedKV(label, field, val, mono, money) {
    const display = money ? fmtMoney(val) : esc(val || '\u2014');
    return `<span class="k field-locked-label">${label}<span class="lock-icon">${wrapSvg(I.lock, 11)}</span></span>
      <span data-locked="${field}" class="${mono ? 'v-mono' : ''}">
        <span class="locked-val" title="点击修改">${display}</span>
        <input class="locked-input${mono ? ' v-mono' : ''}" value="${esc(val || '')}"/>
      </span>`;
  }

  function editRow(label, field, fv, full) {
    const modified = fv && fv.modified;
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
  body.querySelectorAll('[data-del-att]').forEach((b) => {
    b.onclick = async () => {
      try { await Api.deleteAttachment(b.dataset.delAtt); toast('已删除', 'ok'); mm.close(); openEntryDetail(entryId); await refreshEntries(); }
      catch (err) { toast(err.message, 'err'); }
    };
  });

  const mm = modal({
    title: e.seller || (e.invoice_no ? '发票 ' + e.invoice_no : '报账条目'),
    titleChip: tcls ? { cls: tcls, text: TITLE_SHORT[e.title] || e.title } : null,
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

function attachTypeLabel(t) {
  return { invoice_pdf: '发票PDF', invoice_xml: '发票XML', payment_screenshot: '付款截图',
    inspection_pdf: '查验单', other: '其他' }[t] || t;
}
async function addAttachmentFlow(entryId, parentModal, presetType) {
  const body = el('div');
  const opts = [
    ['payment_screenshot', '付款截图'],
    ['invoice_pdf', '发票 PDF'],
    ['invoice_xml', '发票 XML'],
    ['inspection_pdf', '查验单 PDF'],
    ['other', '其他'],
  ];
  body.innerHTML = `
    <div class="form-row"><label>附件类型</label>
      <select id="atType">
        ${opts.map(([v, l]) => `<option value="${v}"${v === presetType ? ' selected' : ''}>${l}</option>`).join('')}
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
    const m = modal({
      title: '汇总信息',
      wide: true,
      body: `<div class="hint">共 <b>${s.count}</b> 条，合计 <b style="font-family:var(--font-serif)">${fmtMoney(s.total)}</b>。${byTitle || ''}</div>
        <pre style="margin-top:12px;background:var(--paper-2);padding:14px;border-radius:9px;overflow:auto;max-height:48vh;font-size:12px;border:1px solid var(--line-soft)">${esc(JSON.stringify(s, null, 2))}</pre>`,
      footer: [mkBtn('关闭', 'ghost', () => m.close())],
    });
  } catch (e) { toast(e.message, 'err'); }
}

async function doExport(ids) {
  if (!ids || !ids.length) { toast('请先选择要导出的条目', 'err'); return; }
  const name = prompt('绑定包名称：', '报账绑定包-' + new Date().toISOString().slice(0, 10));
  if (name == null) return;
  try {
    const r = await Api.exportBindle(ids, name);
    toast(`已导出 ${r.count} 条到 ${baseName(r.path)}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
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