/* 理票 · Tidoc 前端主逻辑。 */

const State = {
  profiles: [],
  currentProfileId: null,
  activeTitle: '',        // '' 全部 / 北京理工大学 / 北京理工大学教育基金会
  entries: [],
  selected: new Set(),
};

const $ = (sel) => document.querySelector(sel);
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
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}

const TITLE_CLASS = { '北京理工大学': 'univ', '北京理工大学教育基金会': 'found' };
const STATUS_LABEL = { draft: '草稿', partial: '部分材料', complete: '完整' };
const CHECK_LABEL = { pass: '校验通过', warning: '需确认', blocked: '严重差异' };
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

// ------------------------------------------------------------------ 初始化
async function init() {
  await Api.ready();
  bindEvents();
  await loadProfiles();
  await refreshEntries();
}

async function loadProfiles() {
  State.profiles = await Api.listProfiles();
  const sel = $('#profileSelect');
  sel.innerHTML = '';
  if (!State.profiles.length) {
    // 无身份：引导创建
    sel.innerHTML = '<option>（无身份）</option>';
    openProfileManager(true);
    return;
  }
  State.profiles.forEach((p) => {
    const o = el('option');
    o.value = p.id;
    o.textContent = `${p.name} → ${p.reviewer}` + (p.is_default ? ' ★' : '');
    sel.appendChild(o);
  });
  const def = State.profiles.find((p) => p.is_default) || State.profiles[0];
  State.currentProfileId = def.id;
  sel.value = def.id;
}

// ------------------------------------------------------------------ 列表
function currentFilters() {
  const f = { title: State.activeTitle || undefined };
  const status = $('#filterStatus').value;
  const check = $('#filterCheck').value;
  const kw = $('#filterKeyword').value.trim();
  const amin = $('#filterAmountMin').value;
  const amax = $('#filterAmountMax').value;
  if (status) f.status = status;
  if (check) f.check_status = check;
  if (kw) f.keyword = kw;
  if (amin) f.amount_min = amin;
  if (amax) f.amount_max = amax;
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
}

function renderEntries() {
  const list = $('#entryList');
  list.innerHTML = '';
  const empty = $('#emptyState');
  empty.hidden = State.entries.length > 0;

  let sum = 0;
  State.entries.forEach((e) => {
    sum += Number(e.total) || 0;
    list.appendChild(entryCard(e));
  });

  $('#stats').textContent =
    `共 ${State.entries.length} 条 · 合计 ${fmtMoney(sum)}`;
  updateBatchBar();
}

function entryCard(e) {
  const tcls = TITLE_CLASS[e.title] || '';
  const card = el('div', 'entry-card' + (tcls ? ' title-' + tcls : '') +
    (State.selected.has(e.id) ? ' selected' : ''));

  const check = el('div', 'entry-check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = State.selected.has(e.id);
  cb.onclick = (ev) => { ev.stopPropagation(); toggleSelect(e.id); };
  check.appendChild(cb);

  const chip = e.title
    ? `<span class="title-chip ${tcls}">${esc(e.title === '北京理工大学教育基金会' ? '教育基金会' : e.title)}</span>`
    : '';
  const modified = (e.modified_fields && e.modified_fields.length)
    ? `<span class="badge modified" title="有 ${e.modified_fields.length} 个字段被人工修改">✎ 已修改</span>` : '';

  const main = el('div', 'entry-main', `
    <div class="entry-line1">
      ${chip}
      <span class="entry-seller">${esc(e.seller || '（未识别销售方）')}</span>
      <span class="badge status-${e.status}">${STATUS_LABEL[e.status] || e.status}</span>
      <span class="badge ${e.check_status}">${CHECK_LABEL[e.check_status] || e.check_status}</span>
      ${modified}
    </div>
    <div class="entry-line2">
      <span>发票号 ${esc(e.invoice_no || '—')}</span>
      <span>${esc(e.invoice_date || '无日期')}</span>
      <span>附件 ${e.attachment_count || 0}</span>
    </div>`);

  const right = el('div', 'entry-right', `
    <div class="entry-total">${fmtMoney(e.total)}</div>`);

  card.append(check, main, right);
  card.onclick = () => openEntryDetail(e.id);
  return card;
}

// ------------------------------------------------------------------ 选择 / 批量
function toggleSelect(id) {
  if (State.selected.has(id)) State.selected.delete(id);
  else State.selected.add(id);
  renderEntries();
}
function updateBatchBar() {
  const bar = $('#batchBar');
  bar.hidden = State.selected.size === 0;
  $('#selCount').textContent = `已选 ${State.selected.size} 项`;
}

// ------------------------------------------------------------------ 事件
function bindEvents() {
  $('#profileSelect').onchange = (e) => { State.currentProfileId = e.target.value; };
  $('#manageProfilesBtn').onclick = () => openProfileManager(false);

  document.querySelectorAll('.title-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.title-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      State.activeTitle = tab.dataset.title;
      State.selected.clear();
      refreshEntries();
    };
  });

  let kwTimer;
  const relist = () => refreshEntries();
  $('#filterStatus').onchange = relist;
  $('#filterCheck').onchange = relist;
  $('#filterAmountMin').onchange = relist;
  $('#filterAmountMax').onchange = relist;
  $('#filterKeyword').oninput = () => { clearTimeout(kwTimer); kwTimer = setTimeout(relist, 250); };

  $('#newEntryBtn').onclick = openNewEntry;
  $('#summaryBtn').onclick = exportSummary;
  $('#exportBtn').onclick = () => doExport(State.selected.size ? [...State.selected] : State.entries.map((e) => e.id));
  $('#importBtn').onclick = doImport;

  $('#batchExportBtn').onclick = () => doExport([...State.selected]);
  $('#batchDeleteBtn').onclick = batchDelete;
  $('#clearSelBtn').onclick = () => { State.selected.clear(); renderEntries(); };
}

// ------------------------------------------------------------------ 通用弹层
function modal({ title, body, footer, wide }) {
  const mask = el('div', 'modal-mask');
  const box = el('div', 'modal' + (wide ? ' wide' : ''));
  const head = el('div', 'modal-head', `<h2>${esc(title)}</h2>`);
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
  return { mask, body: bodyEl, close };
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
      list.innerHTML = '<p class="hint">还没有身份。请先创建一个：填本人姓名与对应审核人。</p>';
    }
    State.profiles.forEach((p) => {
      const row = el('div', 'attach-item');
      row.innerHTML = `<div style="flex:1">
        <b>${esc(p.name)}</b> → ${esc(p.reviewer)} ${p.is_default ? '<span class="badge pass">默认</span>' : ''}
      </div>`;
      const setDef = mkBtn('设为默认', 'small ghost', async () => {
        await Api.setDefaultProfile(p.id); await loadProfiles(); refresh();
      });
      const del = mkBtn('删除', 'small danger', async () => {
        try { await Api.deleteProfile(p.id); await loadProfiles(); refresh(); toast('已删除', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      });
      if (!p.is_default) row.appendChild(setDef);
      row.appendChild(del);
      list.appendChild(row);
    });
    return list;
  }

  const form = el('div');
  form.innerHTML = `
    <h3 style="margin:16px 0 10px;font-size:13px;color:var(--ink-soft)">新增身份</h3>
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
      refresh();
      toast('身份已添加', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  const m = modal({
    title: '身份管理',
    body: wrap,
    footer: [addBtn, mkBtn('关闭', 'ghost', () => m.close())],
  });

  function refresh() {
    wrap.replaceChild(renderList(), wrap.firstChild);
  }
}

// ------------------------------------------------------------------ 新建条目
function openNewEntry() {
  if (!State.currentProfileId) { toast('请先创建身份', 'err'); openProfileManager(true); return; }

  const picked = { xml: null, pdf: null, payments: [], inspection: null };
  const body = el('div');
  body.innerHTML = `
    <div class="hint">推荐同时提供发票 PDF + XML，识别更准；付款截图建议浅色背景。可只传一部分，先存草稿。</div>
    <div class="form-row" style="margin-top:14px">
      <label>抬头（强隔离，两个抬头全程分开）</label>
      <select id="neTitle">
        <option value="">（按识别结果自动判断）</option>
        <option value="北京理工大学">北京理工大学</option>
        <option value="北京理工大学教育基金会">北京理工大学教育基金会</option>
      </select>
    </div>
    <div class="upload-grid">
      ${uploadRow('xml', '发票 XML', '选择 .xml')}
      ${uploadRow('pdf', '发票 PDF', '选择 .pdf')}
      ${uploadRow('payment', '付款截图', '可多选')}
      ${uploadRow('inspection', '发票查验单 PDF', '选择 .pdf')}
    </div>
    <div id="nePreview"></div>`;

  function uploadRow(key, label, ph) {
    return `<div class="form-row">
      <label>${label}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" data-pick="${key}">${ph}</button>
        <span id="ne-${key}-name" style="font-size:12px;color:var(--ink-soft)">未选择</span>
      </div>
    </div>`;
  }

  body.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.pick;
      try {
        const multiple = key === 'payment';
        const res = await Api.pickFiles(multiple);
        const paths = res.paths || [];
        if (!paths.length) return;
        const nameSpan = body.querySelector(`#ne-${key}-name`);
        if (key === 'payment') { picked.payments = paths; nameSpan.textContent = `${paths.length} 张`; }
        else if (key === 'inspection') { picked.inspection = paths[0]; nameSpan.textContent = baseName(paths[0]); }
        else { picked[key] = paths[0]; nameSpan.textContent = baseName(paths[0]); await preview(); }
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
        <div class="detail-section" style="margin-top:16px">
          <h3>识别结果 <span class="badge ${c.status}">${CHECK_LABEL[c.status]}</span></h3>
          <div class="kv">
            <span class="k">发票号码</span><span>${esc(p.invoice_no || '—')}</span>
            <span class="k">发票日期</span><span>${esc(p.invoice_date || '—')}</span>
            <span class="k">销售方</span><span>${esc(p.seller || '—')}</span>
            <span class="k">购买方抬头</span><span>${esc(p.buyer_name || '—')}</span>
            <span class="k">价税合计</span><span>${fmtMoney(p.total)}</span>
            <span class="k">明细条数</span><span>${p.items.length}</span>
          </div>
          ${c.message ? `<p class="hint" style="margin-top:10px;background:var(--warn-soft);color:var(--warn)">${esc(c.message)}</p>` : ''}
        </div>`;
      // 自动带出抬头
      const titleSel = body.querySelector('#neTitle');
      if (!titleSel.value && p.buyer_name) titleSel.value = p.buyer_name;
    } catch (e) { toast('识别失败：' + e.message, 'err'); }
  }

  const create = async (status) => {
    try {
      await Api.createEntry({
        profileId: State.currentProfileId,
        title: body.querySelector('#neTitle').value,
        xmlPath: picked.xml, pdfPath: picked.pdf,
        paymentPaths: picked.payments, inspectionPath: picked.inspection,
        status,
      });
      m.close();
      await refreshEntries();
      toast('已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const m = modal({
    title: '新建报账条目',
    wide: true,
    body,
    footer: [
      mkBtn('存为草稿', 'ghost', () => create('draft')),
      mkBtn('保存', 'primary', () => create('complete')),
    ],
  });
}

function baseName(p) { return String(p).split(/[/\\]/).pop(); }

// ------------------------------------------------------------------ 条目详情
async function openEntryDetail(entryId) {
  let e;
  try { e = await Api.getEntry(entryId); } catch (err) { toast(err.message, 'err'); return; }
  if (!e) { toast('条目不存在', 'err'); return; }

  const body = el('div');
  const tcls = TITLE_CLASS[e.title] || '';
  const f = e.fields || {};

  const itemsRows = (e.items || []).map((it) => `<tr>
    <td>${esc(it.actual_name || it.name)}</td><td>${esc(it.unit)}</td>
    <td>${esc(it.quantity)}</td><td>${fmtMoney(it.unit_price)}</td><td>${fmtMoney(it.total)}</td>
  </tr>`).join('') || '<tr><td colspan="5" style="color:var(--ink-soft)">无明细</td></tr>';

  const attachRows = (e.attachments || []).map((a) => `
    <div class="attach-item">
      <span class="attach-type">${attachTypeLabel(a.type)}</span>
      <span style="flex:1">${esc(a.original_name)}</span>
      <button class="btn small danger" data-del-att="${a.id}">删除</button>
    </div>`).join('') || '<span style="color:var(--ink-soft);font-size:13px">暂无附件</span>';

  const history = (e.history || []).map((h) => `
    <div class="hitem">${esc(h.changed_at)} · ${esc(FIELD_LABEL[h.field] || h.field)}：
      「${esc(h.old_value || '空')}」→「${esc(h.new_value || '空')}」</div>`).join('')
    || '<span>暂无修改记录</span>';

  body.innerHTML = `
    <div class="detail-section">
      <h3>识别信息（默认只读）</h3>
      <div class="kv">
        ${lockedKV('发票号码', 'invoice_no', e.invoice_no)}
        <span class="k">发票日期</span><span>${esc(e.invoice_date || '—')}</span>
        <span class="k">销售方</span><span>${esc(e.seller || '—')}</span>
        ${lockedKV('购买方抬头', 'buyer_name', e.buyer_name)}
        ${lockedKV('价税合计', 'total', e.total, true)}
        <span class="k">税号</span><span>${esc(e.buyer_tax_id || '—')}</span>
      </div>
    </div>

    <div class="detail-section">
      <h3>可修改信息</h3>
      <div class="form-grid">
        ${editRow('实付金额', 'paid_amount', f.paid_amount)}
        ${editRow('实际物资名称', 'actual_item_name', f.actual_item_name)}
      </div>
      ${editRow('备注', 'notes', f.notes, true)}
    </div>

    <div class="detail-section">
      <h3>状态</h3>
      <select id="deStatus">
        <option value="draft"${e.status==='draft'?' selected':''}>草稿</option>
        <option value="partial"${e.status==='partial'?' selected':''}>部分材料</option>
        <option value="complete"${e.status==='complete'?' selected':''}>完整</option>
      </select>
      <span class="badge ${e.check_status}" style="margin-left:10px">${CHECK_LABEL[e.check_status]}</span>
      ${e.check_message ? `<p class="hint" style="margin-top:8px;background:var(--warn-soft);color:var(--warn)">${esc(e.check_message)}</p>` : ''}
    </div>

    <div class="detail-section">
      <h3>物品明细</h3>
      <table class="items-table">
        <thead><tr><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
    </div>

    <div class="detail-section">
      <h3>附件 <button class="btn small" id="deAddAtt">＋ 添加</button></h3>
      <div class="attach-list" id="deAttachList">${attachRows}</div>
    </div>

    <div class="detail-section">
      <h3>修改记录（不可擦除）</h3>
      <div class="history-list">${history}</div>
    </div>`;

  function lockedKV(label, field, val, money) {
    const mark = ''; // 关键信息修正记录在 history，这里只标锁
    return `<span class="k field-locked-label">${label}<span class="lock-icon">🔒</span></span>
      <span data-locked="${field}" title="关键信息，双击走人工修正留痕">${money ? fmtMoney(val) : esc(val || '—')}${mark}</span>`;
  }

  function editRow(label, field, fv, full) {
    const modified = fv && fv.modified;
    const val = fv ? fv.current : '';
    return `<div class="form-row"${full ? ' style="grid-column:1/-1"' : ''}>
      <label>${label}${modified ? '<span class="field-modified-mark">✎ 已人工修改</span>' : ''}</label>
      <input data-edit="${field}" value="${esc(val)}"/>
    </div>`;
  }

  // 可改字段：失焦保存
  body.querySelectorAll('[data-edit]').forEach((inp) => {
    inp.onchange = async () => {
      try {
        await Api.updateField(entryId, inp.dataset.edit, inp.value, State.currentProfileId);
        toast('已保存', 'ok');
        await refreshEntries();
      } catch (err) { toast(err.message, 'err'); }
    };
  });

  // 关键信息：双击走人工修正
  body.querySelectorAll('[data-locked]').forEach((span) => {
    span.ondblclick = () => correctLockedFlow(entryId, span.dataset.locked, e[span.dataset.locked], m);
  });

  $('#modalRoot');
  body.querySelector('#deStatus').onchange = async (ev) => {
    try { await Api.setStatus(entryId, ev.target.value); await refreshEntries(); toast('状态已更新', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };

  body.querySelector('#deAddAtt').onclick = () => addAttachmentFlow(entryId, m);
  body.querySelectorAll('[data-del-att]').forEach((b) => {
    b.onclick = async () => {
      try { await Api.deleteAttachment(b.dataset.delAtt); toast('已删除', 'ok'); m.close(); openEntryDetail(entryId); await refreshEntries(); }
      catch (err) { toast(err.message, 'err'); }
    };
  });

  const m = modal({
    title: (tcls ? (e.title === '北京理工大学教育基金会' ? '教育基金会 · ' : '北京理工大学 · ') : '') + '报账条目',
    wide: true,
    body,
    footer: [
      mkBtn('删除条目', 'danger', async () => {
        if (!confirm('确认删除该条目及其附件？此操作不可撤销。')) return;
        try { await Api.deleteEntry(entryId); m.close(); await refreshEntries(); toast('已删除', 'ok'); }
        catch (err) { toast(err.message, 'err'); }
      }),
      mkBtn('关闭', 'ghost', () => m.close()),
    ],
  });
}

function attachTypeLabel(t) {
  return { invoice_pdf: '发票PDF', invoice_xml: '发票XML', payment_screenshot: '付款截图',
    inspection_pdf: '查验单', other: '其他' }[t] || t;
}

async function correctLockedFlow(entryId, field, current, parentModal) {
  const body = el('div');
  body.innerHTML = `
    <div class="hint" style="background:var(--warn-soft);color:var(--warn)">
      这是关键信息。修正会永久留痕（记录旧值、新值、时间、身份），随条目一起导出。
    </div>
    <div class="form-row" style="margin-top:14px">
      <label>${FIELD_LABEL[field] || field}</label>
      <input id="clVal" value="${esc(current || '')}"/>
    </div>`;
  const m = modal({
    title: '人工修正关键信息',
    body,
    footer: [
      mkBtn('取消', 'ghost', () => m.close()),
      mkBtn('确认修正并留痕', 'primary', async () => {
        try {
          await Api.correctLocked(entryId, field, body.querySelector('#clVal').value, State.currentProfileId);
          m.close(); parentModal.close(); openEntryDetail(entryId); await refreshEntries();
          toast('已修正并留痕', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }),
    ],
  });
}

async function addAttachmentFlow(entryId, parentModal) {
  const body = el('div');
  body.innerHTML = `
    <div class="form-row"><label>附件类型</label>
      <select id="atType">
        <option value="payment_screenshot">付款截图</option>
        <option value="invoice_pdf">发票 PDF</option>
        <option value="invoice_xml">发票 XML</option>
        <option value="inspection_pdf">查验单 PDF</option>
        <option value="other">其他</option>
      </select>
    </div>`;
  const m = modal({
    title: '添加附件',
    body,
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
async function exportSummary() {
  const ids = State.selected.size ? [...State.selected] : State.entries.map((e) => e.id);
  if (!ids.length) { toast('没有可导出的条目', 'err'); return; }
  try {
    const s = await Api.buildSummary(ids);
    const byTitle = Object.entries(s.by_title || {}).map(([t, n]) => `${t}：${n} 条`).join('　');
    modal({
      title: '汇总信息',
      wide: true,
      body: `<div class="hint">共 ${s.count} 条，合计 ${fmtMoney(s.total)}。${byTitle}</div>
        <pre style="margin-top:12px;background:var(--bg);padding:14px;border-radius:8px;overflow:auto;max-height:52vh;font-size:12px">${esc(JSON.stringify(s, null, 2))}</pre>`,
      footer: [mkBtn('关闭', 'ghost', function () { this.closest('.modal-mask').remove(); })],
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
      if (!confirm(`⚠ 该绑定包已被外部修改（${insp.tampered.join(', ')}）。\n仍要导入吗？导入后这些条目将标记为可疑。`)) return;
      allow = true;
    }
    const r = await Api.importBindle(path, State.currentProfileId, allow);
    await refreshEntries();
    toast(r.message + `（${r.imported} 条）`, r.tampered && r.tampered.length ? 'err' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
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

// ------------------------------------------------------------------ 启动
window.addEventListener('DOMContentLoaded', init);
