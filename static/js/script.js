/* ═══════════════════════════════════════════════
   TaskFlow Pro — Frontend Script
   All features: CRUD, D&D, Timers, Notifications,
   Filters, Dark mode, Export, Recycle Bin
═══════════════════════════════════════════════ */

'use strict';

// ── STATE ──────────────────────────────────────
let currentView    = 'all';
let currentPriority = '';
let currentSort    = 'created';
let editTags       = [];
let editSubtasks   = [];
let editLinks      = [];
let editRecur      = '';
let currentTaskId  = null;
let activeTimers   = {};
let sortableInst   = null;
let debounceTimer  = null;
let notifCheckInterval = null;
let toastContainer = null;

// SWATCH COLORS
const SWATCHES = ['#7c6af7','#f472b6','#60a5fa','#34d399','#fbbf24','#f87171','#22d3ee','#a78bfa','#fb923c'];

// ── INIT ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Create toast container
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container-custom';
  document.body.appendChild(toastContainer);

  // Apply dark mode icon
  updateDarkModeIcon();

  // Init category swatches
  initSwatches();

  // Load tasks
  loadTasks();

  // Load nav badges
  loadStats();

  // Start notification polling
  startNotificationCheck();

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);
});

// ── NAVIGATION ─────────────────────────────────
function setView(view, btn) {
  currentView = view;
  currentPriority = '';

  // Reset priority chips
  document.querySelectorAll('.f-chip').forEach(el => el.classList.remove('active'));
  const allChip = document.querySelector('.f-chip[data-priority=""]');
  if (allChip) allChip.classList.add('active');

  // Update nav active
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Topbar title
  const titles = {
    all: 'All Tasks', active: 'Active Tasks', done: 'Completed',
    overdue: '🔥 Overdue', today: '📅 Due Today', bin: '🗑️ Recycle Bin',
  };
  const title = titles[view] || getCategoryTitle(view);
  document.getElementById('topbar-title').textContent = title;

  // Show/hide add form and filter row for bin view
  const isSpecial = view === 'bin';
  const filterRow = document.getElementById('filter-row');
  const statsGrid = document.getElementById('stats-grid');
  const progressSection = document.getElementById('progress-section');
  if (filterRow) filterRow.style.display = isSpecial ? 'none' : '';
  if (statsGrid) statsGrid.style.display = isSpecial ? 'none' : '';
  if (progressSection) progressSection.style.display = isSpecial ? 'none' : '';

  // Close sidebar on mobile
  if (window.innerWidth < 992) closeSidebar();

  loadTasks();
}

function getCategoryTitle(view) {
  if (view.startsWith('cat_')) {
    const catId = view.replace('cat_', '');
    const btn = document.querySelector(`[data-view="cat_${catId}"]`);
    return btn ? btn.textContent.trim().replace(/\d+$/, '') : 'Category';
  }
  return view;
}

function setFilter(priority, btn) {
  currentPriority = priority;
  document.querySelectorAll('.f-chip').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadTasks();
}

function setSort(val) {
  currentSort = val;
  loadTasks();
}

// ── LOAD TASKS ─────────────────────────────────
async function loadTasks() {
  const container = document.getElementById('task-list');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const params = new URLSearchParams();
    const search = document.getElementById('search-input')?.value?.trim() || '';
    if (search) params.set('search', search);
    if (currentSort) params.set('sort', currentSort);
    if (currentPriority) params.set('priority', currentPriority);

    // Handle special views
    if (currentView === 'bin') {
      params.set('bin', '1');
    } else if (currentView === 'done') {
      params.set('status', 'done');
    } else if (currentView === 'active') {
      // filter client-side
    } else if (currentView === 'overdue') {
      // filter client-side
    } else if (currentView === 'today') {
      // filter client-side
    } else if (currentView.startsWith('cat_')) {
      params.set('category', currentView.replace('cat_', ''));
    }

    const resp = await fetch('/api/tasks?' + params.toString());
    if (!resp.ok) throw new Error('Failed to load');
    let tasks = await resp.json();

    // Client-side view filters
    const today = window.APP?.today || new Date().toISOString().slice(0, 10);
    if (currentView === 'active') tasks = tasks.filter(t => t.status !== 'done');
    if (currentView === 'overdue') tasks = tasks.filter(t => t.is_overdue);
    if (currentView === 'today') tasks = tasks.filter(t => t.deadline === today && t.status !== 'done');

    renderTasks(tasks);
    loadStats();
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading tasks</div><div class="empty-sub">Check your connection and refresh.</div></div>';
  }
}

function debounceLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadTasks, 300);
}

// ── RENDER TASKS ───────────────────────────────
function renderTasks(tasks) {
  const container = document.getElementById('task-list');

  if (currentView === 'bin') {
    renderBin(tasks, container);
    return;
  }

  if (!tasks.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">No tasks found</div>
      <div class="empty-sub">${currentView === 'all' ? 'Click "+ Add Task" to create your first task.' : 'No tasks match this view.'}</div>
    </div>`;
    return;
  }

  const active = tasks.filter(t => t.status !== 'done');
  const done   = tasks.filter(t => t.status === 'done');
  let html = '';

  if (active.length) {
    active.forEach(t => { html += taskCardHTML(t); });
  }

  if (done.length && currentView !== 'active') {
    if (active.length) html += `<div class="section-div">Completed (${done.length})</div>`;
    done.forEach(t => { html += taskCardHTML(t); });
  }

  container.innerHTML = html;

  // Init drag & drop
  initSortable();
}

function taskCardHTML(t) {
  const pLabel = { urgent: '🚨 Urgent', high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[t.priority] || t.priority;
  const statusMap = { todo: ['📝 To Do','badge-todo'], in_progress: ['⏳ In Progress','badge-in-progress'], done: ['✅ Done','badge-done'] };
  const [sLabel, sCls] = statusMap[t.status] || ['—','badge-todo'];

  const dlHTML = t.deadline ? dlBadge(t.deadline, t.is_overdue) : '';
  const catBadge = t.category_name
    ? `<span class="badge-cat" style="background:${hexWithAlpha(t.category_color,0.15)};color:${t.category_color}">${t.category_icon} ${esc(t.category_name)}</span>` : '';
  const tags = (t.tags || []).slice(0, 3).map(tg => `<span class="badge-tag">#${esc(tg)}</span>`).join('');
  const recurBadge = t.recur ? `<span class="badge-recur">🔄 ${t.recur}</span>` : '';

  const checkHtml = `<div class="task-check ${t.status==='done'?'checked':''}" onclick="toggleDone(${t.id})">${t.status==='done'?'✓':''}</div>`;

  let subtaskHTML = '';
  if (t.subtask_progress) {
    const sp = t.subtask_progress;
    subtaskHTML = `<div class="subtask-bar-wrap"><div class="subtask-bar-fill" style="width:${sp.pct}%"></div></div>
    <div class="subtask-bar-label">${sp.done}/${sp.total} sub-tasks</div>`;
  }

  const notePreview = t.description ? `<div style="font-size:11.5px;color:var(--text-dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px">📝 ${esc(t.description.split('\n')[0])}</div>` : '';

  const cards = `
  <div class="task-card p-${t.priority}${t.status==='done'?' done-task':''}${t.is_overdue?' overdue-task':''}" id="tc-${t.id}" data-id="${t.id}">
    ${checkHtml}
    <div class="task-body" onclick="openDrawer(${t.id})" style="cursor:pointer">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        <span class="badge-prio badge-${t.priority}">${pLabel}</span>
        <span class="badge-status ${sCls}">${sLabel}</span>
        ${catBadge}${dlHTML}${tags}${recurBadge}
      </div>
      ${notePreview}
      ${subtaskHTML}
    </div>
    <div class="task-actions">
      <button class="t-action-btn" onclick="openEditModal(${t.id})" title="Edit"><i class="fa fa-edit"></i></button>
      <button class="t-action-btn del" onclick="deleteTask(${t.id})" title="Delete"><i class="fa fa-trash"></i></button>
    </div>
  </div>`;
  return cards;
}

function dlBadge(dl, isOverdue) {
  const today = window.APP?.today || new Date().toISOString().slice(0,10);
  const tom = new Date(); tom.setDate(tom.getDate()+1);
  const tomStr = tom.toISOString().slice(0,10);
  const in3 = new Date(); in3.setDate(in3.getDate()+3);
  const in3Str = in3.toISOString().slice(0,10);
  const d = new Date(dl + 'T00:00:00');
  const lbl = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  if (isOverdue || dl < today) return `<span class="badge-deadline dl-overdue">⚠ ${lbl}</span>`;
  if (dl === today)            return `<span class="badge-deadline dl-today">🔴 Today</span>`;
  if (dl === tomStr)           return `<span class="badge-deadline dl-soon">🟡 Tomorrow</span>`;
  if (dl <= in3Str)            return `<span class="badge-deadline dl-soon">📅 ${lbl}</span>`;
  return `<span class="badge-deadline dl-normal">📅 ${lbl}</span>`;
}

// ── RECYCLE BIN RENDER ─────────────────────────
function renderBin(tasks, container) {
  if (!tasks.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗑️</div><div class="empty-title">Recycle bin is empty</div><div class="empty-sub">Deleted tasks appear here for 30 days before permanent removal.</div></div>`;
    return;
  }
  let html = `<div class="d-flex justify-content-between align-items-center mb-3">
    <span style="font-size:13px;color:var(--text-muted)">${tasks.length} item${tasks.length!==1?'s':''} · auto-deleted after 30 days</span>
    <button class="btn-danger-sm" onclick="emptyBin()"><i class="fa fa-trash me-1"></i>Empty Bin</button>
  </div>`;
  tasks.forEach(t => {
    html += `<div class="bin-card">
      <div class="flex-1 min-w-0">
        <div class="bin-title">${esc(t.title)}</div>
        <div class="bin-meta">${t.priority} · ${t.category_name || 'No category'}</div>
      </div>
      <div class="d-flex gap-2 align-items-center">
        <button class="btn-ghost-sm" onclick="restoreTask(${t.id})"><i class="fa fa-undo me-1"></i>Restore</button>
        <button class="btn-danger-sm" onclick="permDelete(${t.id})">✕ Delete</button>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

// ── CRUD ───────────────────────────────────────
async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) { toast('Please enter a task title', 'error'); document.getElementById('task-title').focus(); return; }

  const tid = document.getElementById('edit-task-id').value;
  const payload = {
    title,
    description: document.getElementById('task-desc').value.trim(),
    priority:    document.getElementById('task-priority').value,
    status:      document.getElementById('task-status').value,
    deadline:    document.getElementById('task-deadline').value || null,
    category_id: document.getElementById('task-category').value || null,
    notify_before: parseInt(document.getElementById('task-notify').value) || 0,
    tags:        editTags,
    subtasks:    editSubtasks,
    links:       editLinks,
    recur:       editRecur,
  };

  try {
    let resp, url = '/api/tasks', method = 'POST';
    if (tid) { url = `/api/tasks/${tid}`; method = 'PUT'; }
    resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!resp.ok) throw new Error('Save failed');
    closeTaskModal();
    loadTasks();
    toast(tid ? 'Task updated ✓' : 'Task created ✓', 'success');
  } catch (e) {
    toast('Failed to save task', 'error');
  }
}

async function toggleDone(id) {
  try {
    const card = document.getElementById('tc-' + id);
    const isDone = card?.classList.contains('done-task');
    const newStatus = isDone ? 'todo' : 'done';
    await fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    loadTasks();
    toast(newStatus === 'done' ? 'Task completed ✓' : 'Task reopened', newStatus === 'done' ? 'success' : 'info');
  } catch (e) { toast('Update failed', 'error'); }
}

async function deleteTask(id) {
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    loadTasks();
    toast('Moved to Recycle Bin', 'warn');
  } catch (e) { toast('Delete failed', 'error'); }
}

async function restoreTask(id) {
  try {
    await fetch(`/api/tasks/${id}/restore`, { method: 'POST' });
    loadTasks();
    toast('Task restored ✓', 'success');
  } catch (e) { toast('Restore failed', 'error'); }
}

async function permDelete(id) {
  if (!confirm('Permanently delete this task? This cannot be undone.')) return;
  try {
    await fetch(`/api/tasks/${id}?force=1`, { method: 'DELETE' });
    loadTasks();
    toast('Permanently deleted', 'info');
  } catch (e) { toast('Delete failed', 'error'); }
}

async function emptyBin() {
  if (!confirm('Empty the entire recycle bin? This cannot be undone.')) return;
  try {
    const resp = await fetch('/api/tasks?bin=1');
    const tasks = await resp.json();
    await Promise.all(tasks.map(t => fetch(`/api/tasks/${t.id}?force=1`, { method: 'DELETE' })));
    loadTasks();
    toast('Recycle bin emptied', 'success');
  } catch (e) { toast('Failed to empty bin', 'error'); }
}

async function clearDone() {
  try {
    const resp = await fetch('/api/tasks?status=done');
    const tasks = await resp.json();
    if (!tasks.length) { toast('No completed tasks to clear', 'info'); return; }
    await Promise.all(tasks.map(t => fetch(`/api/tasks/${t.id}`, { method: 'DELETE' })));
    loadTasks();
    toast(`${tasks.length} task${tasks.length>1?'s':''} moved to bin`, 'warn');
  } catch(e) { toast('Failed', 'error'); }
}

// ── ADD / EDIT MODAL ───────────────────────────
function openAddModal() {
  currentTaskId = null;
  editTags = []; editSubtasks = []; editLinks = []; editRecur = '';
  document.getElementById('modal-title').innerHTML = '<i class="fa fa-plus-circle me-2"></i>New Task';
  document.getElementById('edit-task-id').value = '';
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-status').value = 'todo';
  document.getElementById('task-deadline').value = '';
  document.getElementById('task-category').value = '';
  document.getElementById('task-notify').value = '';
  document.querySelectorAll('.recur-btn').forEach(b => b.classList.toggle('active', b.dataset.r === ''));
  renderTagChips(); renderSubtaskList(); renderLinksList();
  document.getElementById('attachments-list').innerHTML = '';
  document.getElementById('attachment-section').style.display = 'none'; // hide until editing
  new bootstrap.Modal(document.getElementById('taskModal')).show();
  setTimeout(() => document.getElementById('task-title').focus(), 200);
}

async function openEditModal(id) {
  currentTaskId = id;
  try {
    const resp = await fetch(`/api/tasks?sort=created`);
    const all = await resp.json();
    const t = all.find(x => x.id === id);
    if (!t) { toast('Task not found', 'error'); return; }

    editTags = [...(t.tags || [])];
    editSubtasks = (t.subtasks || []).map(s => ({ ...s }));
    editLinks = [...(t.links || [])];
    editRecur = t.recur || '';

    document.getElementById('modal-title').innerHTML = '<i class="fa fa-edit me-2"></i>Edit Task';
    document.getElementById('edit-task-id').value = id;
    document.getElementById('task-title').value = t.title;
    document.getElementById('task-desc').value = t.description || '';
    document.getElementById('task-priority').value = t.priority;
    document.getElementById('task-status').value = t.status;
    document.getElementById('task-deadline').value = t.deadline || '';
    document.getElementById('task-category').value = t.category_id || '';
    document.getElementById('task-notify').value = t.notify_before || '';
    document.querySelectorAll('.recur-btn').forEach(b => b.classList.toggle('active', b.dataset.r === editRecur));
    renderTagChips(); renderSubtaskList(); renderLinksList();

    // Show attachment section and load attachments
    document.getElementById('attachment-section').style.display = '';
    renderAttachmentsList(t.attachments || []);

    new bootstrap.Modal(document.getElementById('taskModal')).show();
    setTimeout(() => document.getElementById('task-title').focus(), 200);
  } catch (e) { toast('Failed to load task', 'error'); }
}

function closeTaskModal() {
  const m = bootstrap.Modal.getInstance(document.getElementById('taskModal'));
  if (m) m.hide();
}

// ── TASK DETAIL DRAWER ─────────────────────────
async function openDrawer(id) {
  try {
    const resp = await fetch('/api/tasks?sort=created');
    const all = await resp.json();
    const t = all.find(x => x.id === id);
    if (!t) return;

    document.getElementById('drawer-title').textContent = t.title;
    const pLabel = { urgent: '🚨 Urgent', high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[t.priority] || t.priority;

    let html = `
      <div class="mb-3 d-flex gap-2 flex-wrap">
        <span class="badge-prio badge-${t.priority}">${pLabel}</span>
        ${t.status === 'done' ? '<span class="badge-status badge-done">✅ Done</span>' : ''}
        ${t.category_name ? `<span class="badge-cat" style="background:${hexWithAlpha(t.category_color,0.15)};color:${t.category_color}">${t.category_icon} ${esc(t.category_name)}</span>` : ''}
        ${t.deadline ? dlBadge(t.deadline, t.is_overdue) : ''}
        ${t.recur ? `<span class="badge-recur">🔄 ${t.recur}</span>` : ''}
      </div>`;

    if (t.description) {
      html += `<div class="mb-3">
        <div class="app-label mb-1">📝 Notes</div>
        <div style="font-size:13px;color:var(--text-muted);white-space:pre-wrap;background:var(--surface-2);border-radius:8px;padding:10px 12px">${esc(t.description)}</div>
      </div>`;
    }

    if (t.subtasks?.length) {
      const sp = t.subtask_progress;
      html += `<div class="mb-3">
        <div class="app-label mb-1">✅ Sub-tasks ${sp ? `(${sp.done}/${sp.total})` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${t.subtasks.map(s => `<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:${s.done?'var(--text-dim)':'var(--text-muted)'}">
            <div onclick="toggleSubtask(${s.id})" style="width:15px;height:15px;border-radius:3px;border:1.5px solid var(--border-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;${s.done?'background:var(--green);border-color:var(--green);color:#0c0c10':''}">${s.done?'✓':''}</div>
            <span style="${s.done?'text-decoration:line-through;opacity:.5':''}">${esc(s.text)}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }

    if (t.tags?.length) {
      html += `<div class="mb-3"><div class="app-label mb-1">🏷 Tags</div><div class="d-flex flex-wrap gap-1">${t.tags.map(tg=>`<span class="badge-tag">#${esc(tg)}</span>`).join('')}</div></div>`;
    }

    if (t.links?.length) {
      html += `<div class="mb-3"><div class="app-label mb-1">🔗 Links</div>
        ${t.links.map(l=>`<div class="links-list-item"><i class="fa fa-external-link-alt" style="color:var(--text-dim);font-size:11px"></i><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a></div>`).join('')}
      </div>`;
    }

    if (t.attachments?.length) {
      html += `<div class="mb-3"><div class="app-label mb-1">📎 Attachments</div>
        ${t.attachments.map(a=>`<div class="attachment-item"><i class="fa fa-file" style="color:var(--text-dim)"></i><span class="attachment-name">${esc(a.filename)}</span><span class="attachment-size">${formatSize(a.size)}</span></div>`).join('')}
      </div>`;
    }

    html += `<div class="mb-3">
      <div class="app-label mb-1">📋 Info</div>
      <div style="font-size:12px;color:var(--text-dim);display:flex;flex-direction:column;gap:3px">
        <div>Created: ${new Date(t.created_at).toLocaleDateString()}</div>
        ${t.time_spent > 0 ? `<div>Time tracked: ${formatTime(t.time_spent)}</div>` : ''}
      </div>
    </div>`;

    html += `<div class="d-flex gap-2 mt-4">
      <button class="btn-primary-sm flex-1" onclick="openEditModal(${id});closeDrawer()"><i class="fa fa-edit me-1"></i>Edit</button>
      <button class="btn-danger-sm" onclick="deleteTask(${id});closeDrawer()"><i class="fa fa-trash"></i></button>
    </div>`;

    document.getElementById('drawer-body').innerHTML = html;
    document.getElementById('task-drawer').classList.add('open');
    document.getElementById('drawer-backdrop').classList.remove('d-none');
  } catch (e) { toast('Failed to load details', 'error'); }
}

function closeDrawer() {
  document.getElementById('task-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.add('d-none');
}

async function toggleSubtask(sid) {
  try {
    await fetch(`/api/subtasks/${sid}/toggle`, { method: 'POST' });
    loadTasks();
  } catch(e) { toast('Update failed', 'error'); }
}

// ── TAGS ───────────────────────────────────────
function addTag(e) {
  if (e.key !== 'Enter') return;
  const inp = document.getElementById('tag-input');
  const val = inp.value.trim().replace(/\s+/g, '-').toLowerCase();
  if (!val || editTags.includes(val)) { inp.value = ''; return; }
  editTags.push(val);
  inp.value = '';
  renderTagChips();
}

function removeTag(t) {
  editTags = editTags.filter(x => x !== t);
  renderTagChips();
}

function renderTagChips() {
  document.getElementById('tag-chips').innerHTML = editTags.map(t =>
    `<div class="tag-chip">#${esc(t)} <span class="tag-chip-del" onclick="removeTag('${esc(t)}')">✕</span></div>`
  ).join('');
}

// ── SUBTASKS ───────────────────────────────────
function addSubtask(e) {
  if (e.key !== 'Enter') return;
  const inp = document.getElementById('subtask-input');
  const val = inp.value.trim();
  if (!val) return;
  editSubtasks.push({ text: val, done: false });
  inp.value = '';
  renderSubtaskList();
}

function toggleEditSubtask(i) {
  editSubtasks[i].done = !editSubtasks[i].done;
  renderSubtaskList();
}

function removeEditSubtask(i) {
  editSubtasks.splice(i, 1);
  renderSubtaskList();
}

function renderSubtaskList() {
  document.getElementById('subtask-list').innerHTML = editSubtasks.map((s, i) => `
    <div class="subtask-modal-row">
      <div class="subtask-check-mini ${s.done?'done':''}" onclick="toggleEditSubtask(${i})">${s.done?'✓':''}</div>
      <span class="${s.done?'subtask-text-done':''}" style="flex:1">${esc(s.text)}</span>
      <span style="cursor:pointer;color:var(--text-dim);font-size:12px" onclick="removeEditSubtask(${i})">✕</span>
    </div>`).join('');
}

// ── LINKS ──────────────────────────────────────
function addLink() {
  const url = document.getElementById('link-url').value.trim();
  const label = document.getElementById('link-label').value.trim();
  if (!url) return;
  editLinks.push({ url, label: label || url });
  document.getElementById('link-url').value = '';
  document.getElementById('link-label').value = '';
  renderLinksList();
}

function removeLink(i) {
  editLinks.splice(i, 1);
  renderLinksList();
}

function renderLinksList() {
  document.getElementById('links-list').innerHTML = editLinks.map((l, i) => `
    <div class="links-list-item">
      <i class="fa fa-external-link-alt" style="color:var(--text-dim);font-size:11px"></i>
      <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>
      <span style="cursor:pointer;color:var(--text-dim);font-size:12px;margin-left:auto" onclick="removeLink(${i})">✕</span>
    </div>`).join('');
}

// ── RECURRING ──────────────────────────────────
function setRecur(r, btn) {
  editRecur = r;
  document.querySelectorAll('.recur-btn').forEach(b => b.classList.toggle('active', b.dataset.r === r));
}

// ── ATTACHMENTS ────────────────────────────────
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length) uploadFiles(files);
}

async function uploadFiles(files) {
  const tid = document.getElementById('edit-task-id').value;
  if (!tid) { toast('Save the task first before adding attachments', 'info'); return; }
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const resp = await fetch(`/api/tasks/${tid}/attachments`, { method: 'POST', body: fd });
      if (!resp.ok) { toast(`Failed to upload ${file.name}`, 'error'); continue; }
      const att = await resp.json();
      toast(`Uploaded ${att.filename} ✓`, 'success');
      // Refresh attachments list
      const r2 = await fetch('/api/tasks?sort=created');
      const all = await r2.json();
      const t = all.find(x => x.id == tid);
      if (t) renderAttachmentsList(t.attachments || []);
    } catch (e) { toast(`Upload error: ${file.name}`, 'error'); }
  }
  loadTasks();
}

function renderAttachmentsList(attachments) {
  document.getElementById('attachments-list').innerHTML = attachments.map(a => `
    <div class="attachment-item">
      <i class="fa fa-file" style="color:var(--text-dim)"></i>
      <span class="attachment-name">${esc(a.filename)}</span>
      <span class="attachment-size">${formatSize(a.size)}</span>
      <span style="cursor:pointer;color:var(--red);font-size:12px;margin-left:4px" onclick="deleteAttachment(${a.id})">✕</span>
    </div>`).join('');
}

async function deleteAttachment(aid) {
  try {
    await fetch(`/api/attachments/${aid}`, { method: 'DELETE' });
    const tid = document.getElementById('edit-task-id').value;
    if (tid) {
      const r = await fetch('/api/tasks?sort=created');
      const all = await r.json();
      const t = all.find(x => x.id == tid);
      if (t) renderAttachmentsList(t.attachments || []);
    }
    toast('Attachment deleted', 'info');
    loadTasks();
  } catch(e) { toast('Delete failed', 'error'); }
}

// ── CATEGORIES ─────────────────────────────────
let selectedCatIcon = '📁';
let selectedCatColor = '#7c6af7';

function openCategoryModal() {
  selectedCatIcon = '📁';
  selectedCatColor = '#7c6af7';
  document.getElementById('cat-name').value = '';
  document.querySelectorAll('.icon-opt').forEach(el => el.classList.remove('selected'));
  const first = document.querySelector('.icon-opt');
  if (first) first.classList.add('selected');
  initSwatches();
  new bootstrap.Modal(document.getElementById('categoryModal')).show();
}

function selectIcon(el) {
  document.querySelectorAll('.icon-opt').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  selectedCatIcon = el.textContent;
}

function initSwatches() {
  const cont = document.getElementById('cat-swatches');
  if (!cont) return;
  cont.innerHTML = SWATCHES.map(c =>
    `<div class="color-swatch${c===selectedCatColor?' selected':''}" style="background:${c}" onclick="selectSwatch('${c}',this)"></div>`
  ).join('');
}

function selectSwatch(c, el) {
  selectedCatColor = c;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

async function saveCategory() {
  const name = document.getElementById('cat-name').value.trim();
  if (!name) { toast('Enter a category name', 'error'); return; }
  try {
    const resp = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: selectedCatIcon, color: selectedCatColor }),
    });
    if (!resp.ok) throw new Error();
    const cat = await resp.json();
    bootstrap.Modal.getInstance(document.getElementById('categoryModal')).hide();
    toast(`Category "${name}" created ✓`, 'success');
    // Add to sidebar
    const cont = document.getElementById('sidebar-categories');
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = `cat_${cat.id}`;
    btn.onclick = function() { setView(`cat_${cat.id}`, this); };
    btn.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${cat.icon} ${esc(cat.name)}<span class="nav-badge" id="nb-cat-${cat.id}">0</span>`;
    cont.appendChild(btn);
    // Add to selects
    const opt = `<option value="${cat.id}">${cat.icon} ${esc(cat.name)}</option>`;
    document.getElementById('task-category').insertAdjacentHTML('beforeend', opt);
  } catch(e) { toast('Failed to create category', 'error'); }
}

// ── STATS & BADGES ─────────────────────────────
async function loadStats() {
  try {
    const resp = await fetch('/api/stats');
    const stats = await resp.json();
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('st-total', stats.total);
    set('st-done', stats.done);
    set('st-pct', stats.pct + '%');
    set('st-overdue', stats.overdue);
    const fill = document.getElementById('mini-fill');
    if (fill) fill.style.width = stats.pct + '%';
    const pfill = document.getElementById('progress-fill');
    if (pfill) pfill.style.width = stats.pct + '%';
    const plbl = document.getElementById('progress-label');
    if (plbl) plbl.textContent = stats.pct + '%';

    // Nav badges
    set('nb-all', stats.total);
    set('nb-active', stats.total - stats.done);
    set('nb-done', stats.done);
    set('nb-overdue', stats.overdue);
    set('nb-bin', stats.bin_count);

    // Category badges
    (stats.categories || []).forEach(c => {
      // find nav badge by category name
      const btns = document.querySelectorAll('.nav-item[data-view^="cat_"]');
      btns.forEach(btn => {
        if (btn.textContent.includes(c.name)) {
          const badge = btn.querySelector('.nav-badge');
          if (badge) badge.textContent = c.total - c.done;
        }
      });
    });

    // Today count
    const today = window.APP?.today || new Date().toISOString().slice(0,10);
    const tasksResp = await fetch('/api/tasks?sort=created');
    const tasks = await tasksResp.json();
    const todayCount = tasks.filter(t => t.deadline === today && t.status !== 'done').length;
    set('nb-today', todayCount);
  } catch(e) { /* silent */ }
}

// ── NOTIFICATIONS ──────────────────────────────
function startNotificationCheck() {
  checkNotifications();
  notifCheckInterval = setInterval(checkNotifications, 60000);
  // Also request browser notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

async function checkNotifications() {
  try {
    const resp = await fetch('/api/tasks?sort=deadline');
    const tasks = await resp.json();
    const now = new Date();
    const today = window.APP?.today || now.toISOString().slice(0,10);

    tasks.forEach(t => {
      if (t.status === 'done' || !t.deadline) return;
      if (t.is_overdue) {
        showNotificationBar(`⚠️ Overdue: "${t.title}" was due ${t.deadline}`);
      } else if (t.deadline === today) {
        showNotificationBar(`📅 Due Today: "${t.title}"`);
      }
      // Browser notification for tasks with notify_before set
      if (t.notify_before && t.deadline) {
        const dl = new Date(t.deadline + 'T23:59:00');
        const minsLeft = (dl - now) / 60000;
        if (minsLeft > 0 && minsLeft <= t.notify_before) {
          sendBrowserNotif(t.title, `Due in ${Math.round(minsLeft)} minutes`);
        }
      }
    });
  } catch(e) { /* silent */ }
}

let lastNotifMsg = '';
function showNotificationBar(msg) {
  if (msg === lastNotifMsg) return;
  lastNotifMsg = msg;
  const bar = document.getElementById('notification-bar');
  document.getElementById('notif-text').textContent = msg;
  bar.classList.remove('d-none');
}

function sendBrowserNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('TaskFlow: ' + title, { body, icon: '/static/images/icon.png' }); } catch(e) {}
  }
}

// ── EXPORT ─────────────────────────────────────
function exportTasks(fmt) {
  window.location.href = `/api/tasks/export?fmt=${fmt}`;
  toast(`Exporting as ${fmt.toUpperCase()}…`, 'info');
}

// ── DRAG & DROP ────────────────────────────────
function initSortable() {
  const list = document.getElementById('task-list');
  if (!list || currentSort !== 'position') return;
  if (sortableInst) sortableInst.destroy();
  sortableInst = Sortable.create(list, {
    animation: 150,
    handle: '.task-card',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    filter: '.section-div,.empty-state',
    onEnd: async (evt) => {
      const cards = list.querySelectorAll('.task-card[data-id]');
      const reorder = Array.from(cards).map((el, i) => ({ id: parseInt(el.dataset.id), position: i }));
      try {
        await fetch('/api/tasks/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reorder),
        });
        toast('Order saved', 'info');
      } catch(e) { toast('Reorder failed', 'error'); }
    },
  });
}

// ── DARK MODE ──────────────────────────────────
function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  updateDarkModeIcon();
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dark_mode: !isDark }),
  });
  toast((isDark ? '☀️ Light' : '🌙 Dark') + ' mode on', 'info');
}

function updateDarkModeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = document.getElementById('dm-icon');
  if (icon) icon.className = `fa ${isDark ? 'fa-sun' : 'fa-moon'} me-1`;
}

// ── SIDEBAR MOBILE ─────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.remove('d-none');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.add('d-none');
}

// ── TOAST ──────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  el.innerHTML = `<span class="toast-dot"></span>${esc(msg)}`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'all .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

// ── KEYBOARD SHORTCUTS ─────────────────────────
function onKeyDown(e) {
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'Escape') {
    closeDrawer();
    const m = bootstrap.Modal.getInstance(document.getElementById('taskModal'));
    if (m) m.hide();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openAddModal();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  }
}

// ── HELPERS ────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function formatTime(secs) {
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function hexWithAlpha(hex, alpha) {
  if (!hex) return `rgba(124,106,247,${alpha})`;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}