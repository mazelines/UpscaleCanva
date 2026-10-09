'use strict';
const $ = id => document.getElementById(id);
let selected = [], jobs = [], focusedJob = null, focusedResult = 0, submitting = false, poll = null;
let lastJobsSignature = '';
const deletingJobs = new Set();
const comparison = new ComparisonViewer();
const modelLabel = { RealESRGAN_x2plus: '기본 2배', RealESRGAN_x4plus_anime_6B: '애니메이션 선화', both: '두 모델 비교' };
const statusLabel = { queued: '대기 중', running: 'AI 처리 중', completed: '완료', failed: '실패', interrupted: '중단됨' };
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6500); }
async function api(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { 'X-Arion-Request': '1', ...init.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청을 완료하지 못했습니다.');
  return data;
}
async function showWorkspace() {
  await refreshJobs(); clearInterval(poll); poll = setInterval(() => refreshJobs().catch(err => toast(err.message)), 2500);
}
function renderSelected() {
  $('selected-files').replaceChildren();
  for (const item of selected) {
    const row = el('div', 'selected-file'); const img = el('img'); img.src = item.url; img.alt = '';
    const info = el('div'); info.append(el('strong', '', item.file.name), el('small', '', `${(item.file.size / 1024 / 1024).toFixed(2)} MB`));
    const remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${item.file.name} 선택 해제`); remove.disabled = submitting;
    remove.onclick = () => { selected = selected.filter(x => x !== item); URL.revokeObjectURL(item.url); renderSelected(); };
    row.append(img, info, remove); $('selected-files').append(row);
  }
  $('submit-job').disabled = !selected.length || submitting;
  $('paste-target').setAttribute('aria-disabled', String(submitting));
  $('upload-paste').disabled = submitting || readingClipboard;
  $('drop-zone').classList.toggle('is-uploading', submitting);
  $('submit-job').firstElementChild.textContent = submitting ? '이미지 등록 중…' : selected.length > 1 ? `${selected.length}장 AI 2배 확대하기` : 'AI 2배 확대하기';
}
function addFiles(files) {
  if (submitting) return 0;
  const before = selected.length;
  for (const file of files) {
    if (selected.length >= 8) { toast('한 번에 최대 8장까지 선택할 수 있습니다.'); break; }
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 32 * 1024 * 1024) { toast(`${file.name}: PNG/JPG/WebP, 32MB 이하 파일을 선택해 주세요.`); continue; }
    if (selected.some(x => x.file.name === file.name && x.file.size === file.size && x.file.lastModified === file.lastModified)) continue;
    selected.push({ file, url: URL.createObjectURL(file) });
  }
  $('file-input').value = ''; renderSelected();
  return selected.length - before;
}
$('file-input').addEventListener('change', event => addFiles(event.target.files));
function chooseFiles() { if (!submitting) $('file-input').click(); }
$('drop-zone').addEventListener('click', chooseFiles);
$('drop-zone').addEventListener('keydown', event => {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const bounds = $('drop-zone').getBoundingClientRect();
    openUploadMenu(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseFiles(); }
});
const pasteShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
$('paste-shortcut').textContent = pasteShortcut;
$('paste-hint').textContent = `클립보드 이미지: 우클릭 → 붙여넣기 · ${pasteShortcut}`;
let readingClipboard = false;
function closeUploadMenu(restoreFocus = false) {
  const wasOpen = !$('upload-menu').hidden;
  $('upload-menu').hidden = true;
  $('paste-target').setAttribute('aria-expanded', 'false');
  if (restoreFocus && wasOpen) $('paste-target').focus({ preventScroll: true });
}
function openUploadMenu(x, y) {
  comparison.hideMenu();
  const menu = $('upload-menu');
  $('upload-paste').disabled = submitting || readingClipboard;
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  $('paste-target').setAttribute('aria-expanded', 'true');
  ($('upload-paste').disabled ? $('paste-target') : $('upload-paste')).focus({ preventScroll: true });
}
$('drop-zone').addEventListener('contextmenu', event => {
  event.preventDefault(); event.stopPropagation();
  const bounds = $('drop-zone').getBoundingClientRect();
  openUploadMenu(event.clientX || bounds.left + bounds.width / 2, event.clientY || bounds.top + bounds.height / 2);
});
$('upload-menu').addEventListener('contextmenu', event => event.preventDefault());
$('upload-menu').addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); $('upload-paste').focus(); }
});
document.addEventListener('keydown', event => {
  if ($('upload-menu').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeUploadMenu(true); }
  else if (event.key === 'Tab') closeUploadMenu(true);
});
document.addEventListener('pointerdown', event => { if (!$('upload-menu').contains(event.target)) closeUploadMenu(); });
document.addEventListener('contextmenu', event => { if (!$('upload-menu').contains(event.target)) closeUploadMenu(); });
document.addEventListener('focusin', event => {
  if (!$('upload-menu').contains(event.target) && event.target !== $('paste-target')) closeUploadMenu();
});
document.addEventListener('scroll', () => closeUploadMenu(true), true);
window.addEventListener('resize', () => closeUploadMenu(true));
window.addEventListener('blur', () => closeUploadMenu());
$('upload-paste').addEventListener('click', async () => {
  if (submitting || readingClipboard) return;
  closeUploadMenu(true);
  if (typeof navigator.clipboard?.read !== 'function') {
    // Some embedded browsers permit paste commands; ordinary HTTP pages need a user paste gesture.
    try { if (document.execCommand('paste')) return; } catch { /* Show the keyboard fallback. */ }
    const message = `이 브라우저에서는 ${pasteShortcut}를 눌러 클립보드 이미지를 붙여넣어 주세요.`;
    $('upload-status').textContent = message; toast(message);
    return;
  }
  readingClipboard = true; $('upload-paste').disabled = true;
  try {
    const items = await navigator.clipboard.read();
    const images = [];
    for (const item of items) {
      const type = ['image/png', 'image/jpeg', 'image/webp'].find(format => item.types.includes(format));
      if (type) images.push(await item.getType(type));
    }
    addClipboardImages(images);
  } catch {
    const message = `클립보드를 읽지 못했습니다. ${pasteShortcut}로 붙여넣거나 브라우저의 클립보드 접근을 허용해 주세요.`;
    $('upload-status').textContent = message; toast(message);
  } finally { readingClipboard = false; $('upload-paste').disabled = submitting; }
});
// Consume image paste events instead of inserting clipboard HTML into the page.
$('paste-target').addEventListener('beforeinput', event => event.preventDefault());
$('paste-target').addEventListener('input', () => $('paste-target').replaceChildren());
let clipboardSequence = 0;
document.addEventListener('paste', event => {
  const editable = event.target instanceof Element ? event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') : null;
  if (editable && editable !== $('paste-target')) return;
  const clipboard = event.clipboardData; if (!clipboard) return;
  const items = [...clipboard.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  const files = items.length ? items : [...clipboard.files];
  if (!files.length) {
    if (editable === $('paste-target')) { event.preventDefault(); toast('클립보드에 이미지가 없습니다. 이미지를 복사한 뒤 붙여넣어 주세요.'); }
    return;
  }
  event.preventDefault();
  closeUploadMenu(true);
  addClipboardImages(files);
});
function addClipboardImages(files) {
  if (submitting) { toast('이미지 등록이 끝난 뒤 붙여넣어 주세요.'); return; }
  if (!files.length) { toast('클립보드에 이미지가 없습니다. 이미지를 복사한 뒤 붙여넣어 주세요.'); return; }
  const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const images = files.filter(file => formats[file.type] || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name)));
  if (!images.length) { toast('PNG, JPG, WebP 이미지를 복사한 뒤 붙여넣어 주세요.'); return; }
  const named = images.map(file => {
    if (file.name && !/^(image|blob)(\.(png|jpe?g|webp))?$/i.test(file.name) && /\.(png|jpe?g|webp)$/i.test(file.name)) return file;
    const extension = formats[file.type] || file.name.split('.').pop().toLowerCase();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    return new File([file], `클립보드-${stamp}-${++clipboardSequence}.${extension}`, { type: file.type, lastModified: file.lastModified });
  });
  const added = addFiles(named);
  if (added) $('upload-status').textContent = `클립보드 이미지 ${added}장을 추가했습니다. 모델을 선택하고 확대하기를 눌러 주세요.`;
  $('paste-target').replaceChildren();
}
for (const name of ['dragenter', 'dragover']) $('drop-zone').addEventListener(name, event => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('drop-zone').addEventListener(name, event => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); });
$('drop-zone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
function upload(item, model, tile, current, total) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ name: item.file.name, model, tile });
    const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/jobs?${query}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream'); xhr.setRequestHeader('X-Arion-Request', '1');
    xhr.timeout = 120000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) $('upload-status').textContent = `${current}/${total} · ${item.file.name} · 업로드 ${Math.round(event.loaded / event.total * 100)}%`; };
    xhr.onload = () => {
      let data; try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('서버 응답을 읽을 수 없습니다.')); return; }
      if (xhr.status === 202) resolve(data);
      else reject(new Error(data.error || '업로드에 실패했습니다.'));
    };
    xhr.onerror = () => reject(new Error('PC와 연결할 수 없습니다. Tailscale 연결과 서버 상태를 확인해 주세요.'));
    xhr.ontimeout = () => reject(new Error('업로드 시간이 초과됐습니다. 작업 내역을 확인한 뒤 다시 시도해 주세요.'));
    xhr.send(item.file);
  });
}
$('submit-job').addEventListener('click', async () => {
  if (submitting || !selected.length) return;
  const batch = [...selected], model = document.querySelector('input[name="model"]:checked').value, tile = $('tile').value;
  submitting = true; renderSelected(); let done = 0;
  try {
    for (const item of batch) {
      await upload(item, model, tile, done + 1, batch.length); done++;
      selected = selected.filter(x => x !== item); URL.revokeObjectURL(item.url); renderSelected(); await refreshJobs();
    }
    $('upload-status').textContent = `${done}장을 등록했습니다. 아래 작업 내역에서 결과를 확인하세요.`;
  } catch (err) { $('upload-status').textContent = `${done}장 등록 완료. ${err.message}`; }
  finally { submitting = false; renderSelected(); }
});
function duration(job) {
  if (!job.startedAt) return new Date(job.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const seconds = Math.max(0, Math.round(((job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()) - new Date(job.startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}
async function deleteJob(job, button) {
  if (deletingJobs.has(job.id)) return;
  deletingJobs.add(job.id); button.disabled = true; button.textContent = '삭제 중';
  const index = jobs.findIndex(item => item.id === job.id);
  try {
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    await refreshJobs();
    const nextCard = $('jobs-list').children[Math.min(index, $('jobs-list').children.length - 1)];
    const nextButton = nextCard?.querySelector('button:not(:disabled)');
    (nextButton || $('refresh')).focus({ preventScroll: true });
    toast('작업 내역을 삭제했습니다.');
  } catch (err) { toast(err.message); }
  finally {
    deletingJobs.delete(job.id); button.disabled = false; button.textContent = '삭제';
    const currentButton = [...$('jobs-list').children].find(card => card.dataset.jobId === job.id)?.querySelector('.job-delete');
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = '삭제'; }
  }
}
async function refreshJobs() {
  const response = await api('/api/jobs'); jobs = response.jobs;
  const signature = JSON.stringify(jobs);
  if (signature === lastJobsSignature) {
    for (const card of $('jobs-list').children) {
      const job = jobs.find(x => x.id === card.dataset.jobId);
      if (job?.status === 'running') card.querySelector('.job-time').textContent = duration(job);
    }
    return;
  }
  lastJobsSignature = signature;
  const busy = jobs.filter(x => x.status === 'running').length, waiting = jobs.filter(x => x.status === 'queued').length;
  $('queue-summary').textContent = busy || waiting ? `${busy}장 처리 중 · ${waiting}장 대기` : `총 ${jobs.length}개 작업 · ${jobs.filter(x => x.status === 'completed').length}개 완료`;
  $('empty-state').hidden = jobs.length > 0;
  const fragment = document.createDocumentFragment();
  for (const job of jobs) {
    const card = el('article', 'job-card'); card.dataset.jobId = job.id;
    const content = el(job.status === 'completed' ? 'button' : 'div', 'job-content');
    if (job.status === 'completed') {
      content.type = 'button'; content.classList.add('job-open');
      content.setAttribute('aria-label', `${job.originalName} 완료 · 비교 및 다운로드`);
      content.onclick = () => { focusedJob = job.id; focusedResult = 0; renderReview(); $('review').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); };
    }
    const top = el('span', 'job-top'), thumb = el('img', 'job-thumb'); thumb.src = `/api/jobs/${job.id}/source`; thumb.alt = ''; thumb.loading = 'lazy';
    const info = el('span', 'job-info'), name = el('strong', '', job.originalName); name.title = job.originalName;
    info.append(name, el('small', '', `${job.image.size.join(' × ')} → ${job.image.size.map(v => v * 2).join(' × ')} · ${modelLabel[job.model]}`));
    top.append(thumb, info); const meta = el('span', 'job-meta');
    meta.append(el('span', `status ${job.status}`, job.status === 'queued' ? `대기 ${job.queuePosition}번째` : statusLabel[job.status]), el('span', 'job-time', duration(job)));
    if (job.status === 'completed') meta.append(el('span', 'job-link', '비교 · 다운로드 ↗'));
    content.append(top, meta); card.append(content);
    if (job.error) card.append(el('p', 'job-error', job.error));
    const canDelete = ['completed', 'failed', 'interrupted'].includes(job.status);
    const remove = el('button', 'job-delete', deletingJobs.has(job.id) ? '삭제 중' : '삭제'); remove.type = 'button';
    remove.disabled = !canDelete || deletingJobs.has(job.id);
    remove.title = canDelete ? '작업 내역 삭제' : '작업이 완료된 뒤 삭제할 수 있습니다.';
    remove.setAttribute('aria-label', `${job.originalName} 작업 내역 삭제`);
    remove.onclick = event => { event.stopPropagation(); deleteJob(job, remove); };
    card.append(remove);
    fragment.append(card);
  }
  $('jobs-list').replaceChildren(fragment);
  if (focusedJob) renderReview();
}
function renderReview() {
  const job = jobs.find(x => x.id === focusedJob);
  if (!job || job.status !== 'completed') {
    focusedJob = null; focusedResult = 0; $('review').hidden = true;
    comparison.clear();
    $('source-image').removeAttribute('src'); $('result-image').removeAttribute('src'); $('download').href = '#';
    return;
  }
  const r = job.results[focusedResult]; if (!r) return;
  $('review').hidden = false; $('review-name').textContent = job.originalName;
  $('result-tabs').replaceChildren();
  job.results.forEach((result, i) => { const button = el('button', i === focusedResult ? 'active' : '', modelLabel[result.model]); button.setAttribute('aria-pressed', String(i === focusedResult)); button.onclick = () => { focusedResult = i; renderReview(); }; $('result-tabs').append(button); });
  const sourceURL = `/api/jobs/${job.id}/original`, resultURL = `/api/jobs/${job.id}/result/${focusedResult}`;
  if ($('source-image').getAttribute('src') !== sourceURL) $('source-image').src = sourceURL;
  if ($('result-image').getAttribute('src') !== resultURL) $('result-image').src = resultURL;
  comparison.setJob(job.id, r.inputSize);
  $('download').href = `${resultURL}?download=1`;
  $('source-size').textContent = r.inputSize.join(' × '); $('result-size').textContent = r.outputSize.join(' × ');
  $('result-facts').replaceChildren();
  for (const [label, value] of [['AI 처리', `${r.elapsedSeconds.toFixed(2)}초`], ['GPU', r.gpu.replace('NVIDIA GeForce ', '')], ['색 프로파일', r.iccPreserved ? 'ICC 보존' : '원본에 없음'], ['출력', '2배 PNG']]) {
    const fact = el('span', '', label); fact.append(el('b', '', value)); $('result-facts').append(fact);
  }
}
$('refresh').addEventListener('click', () => refreshJobs().catch(err => toast(err.message)));
showWorkspace().catch(err => toast(`서버 연결을 확인해 주세요. ${err.message}`));
