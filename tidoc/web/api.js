/* 与 Python 后端的通信封装。所有后端方法通过 window.pywebview.api 暴露，
   统一返回 {ok, data|error}。这里做等待桥就绪 + 解包 + 报错。 */

const Api = (() => {
  let ready = null;

  function waitReady() {
    if (ready) return ready;
    ready = new Promise((resolve) => {
      if (window.pywebview && window.pywebview.api) return resolve();
      window.addEventListener('pywebviewready', () => resolve(), { once: true });
      // 兜底轮询（某些平台事件时机不稳）
      const t = setInterval(() => {
        if (window.pywebview && window.pywebview.api) {
          clearInterval(t);
          resolve();
        }
      }, 50);
    });
    return ready;
  }

  async function call(method, ...args) {
    await waitReady();
    const fn = window.pywebview.api[method];
    if (!fn) throw new Error(`后端方法不存在：${method}`);
    const res = await fn(...args);
    if (res && res.ok === false) throw new Error(res.error || '未知错误');
    return res && 'data' in res ? res.data : res;
  }

  return {
    ready: waitReady,
    listProfiles: () => call('list_profiles'),
    createProfile: (name, reviewer, isDefault, opt) => call('create_profile', name, reviewer, isDefault, opt || {}),
    updateProfile: (id, fields) => call('update_profile', id, fields),
    setDefaultProfile: (id) => call('set_default_profile', id),
    deleteProfile: (id) => call('delete_profile', id),

    parseFiles: (xml, pdf) => call('parse_files', xml, pdf),
    createEntry: (args) => call('create_entry',
      args.profileId, args.title || '', args.xmlPath || null, args.pdfPath || null,
      args.paymentPaths || [], args.inspectionPath || null, args.status || 'draft'),

    listEntries: (filters) => call('list_entries', filters || {}),
    getEntry: (id) => call('get_entry', id),
    updateField: (id, field, value, pid) => call('update_field', id, field, value, pid || ''),
    correctLocked: (id, field, value, pid) => call('correct_locked_field', id, field, value, pid || ''),
    setStatus: (id, status) => call('set_status', id, status),
    setMeta: (id, category, tags) => call('set_meta', id, category, tags),
    deleteEntry: (id) => call('delete_entry', id),
    deleteEntries: (ids) => call('delete_entries', ids),

    addItem: (entryId, fields) => call('add_item', entryId, fields || {}),
    updateItem: (itemId, fields) => call('update_item', itemId, fields || {}),
    deleteItem: (itemId) => call('delete_item', itemId),

    addAttachment: (id, path, type, note) => call('add_attachment', id, path, type, note || ''),
    deleteAttachment: (id) => call('delete_attachment', id),
    setAttachmentNote: (id, note) => call('set_attachment_note', id, note),

    printComponentStatus: () => call('print_component_status'),
    buildPrints: (ids, options, name) => call('build_prints', ids, options || null, name || null),

    buildSummary: (ids) => call('build_summary', ids),
    exportBindle: (ids, name) => call('export_bindle', ids, name),
    inspectBindle: (path) => call('inspect_bindle', path),
    importBindle: (path, pid, allowTampered) => call('import_bindle', path, pid, !!allowTampered),

    pickFiles: (multiple, fileTypes) => call('pick_files', multiple !== false, fileTypes || null),
    pickFolder: () => call('pick_folder'),
    scanFolder: (folder) => call('scan_folder', folder),
    batchCreateEntries: (profileId, groups, title) => call('batch_create_entries', profileId, groups, title || ''),
    dataRoot: () => call('data_root_path'),
  };
})();
