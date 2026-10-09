'use strict';

class ComparisonViewer {
  constructor() {
    this.views = ['source-view', 'result-view'].map(id => document.getElementById(id));
    this.images = this.views.map(view => view.querySelector('img'));
    this.buttons = [...document.querySelectorAll('[data-compare-zoom]')];
    this.menu = document.getElementById('compare-menu');
    this.zoomHere = document.getElementById('compare-zoom-here');
    this.fit = document.getElementById('compare-fit');
    this.copyButtons = ['copy-result', 'compare-copy'].map(id => document.getElementById(id));
    this.copying = false;
    this.copyFrame = null;
    this.copySource = null;
    this.copyFrameReady = false;
    this.copyFrameFailed = false;
    this.status = document.getElementById('compare-status');
    this.zoom = 1;
    this.center = { x: .5, y: .5 };
    this.jobId = null;
    this.size = null;
    this.pan = null;
    this.menuTarget = null;
    this.hover = null;

    for (const button of this.buttons) button.addEventListener('click', () => this.setZoom(Number(button.dataset.compareZoom)));
    for (const image of this.images) {
      image.addEventListener('load', () => this.render());
      image.addEventListener('error', () => this.render());
    }
    for (const view of this.views) {
      view.addEventListener('contextmenu', event => {
        event.preventDefault();
        const point = this.pointAt(view, event.clientX, event.clientY);
        if (point) this.openMenu(view, point, event.clientX, event.clientY);
      });
      view.addEventListener('pointerdown', event => this.startPan(view, event));
      view.addEventListener('pointermove', event => this.movePointer(view, event));
      view.addEventListener('pointerleave', () => { this.hover = null; });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) view.addEventListener(event, () => this.stopPan());
      view.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const bounds = view.getBoundingClientRect();
          this.openMenu(view, this.hover?.view === view ? this.hover.point : this.center, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        } else if (event.key === 'Escape') {
          event.preventDefault(); this.setZoom(1);
        } else if (this.ready && this.zoom > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          const step = .1 / this.zoom;
          this.center.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          this.center.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          this.render();
        }
      });
    }
    this.zoomHere.addEventListener('click', () => {
      const target = this.menuTarget;
      if (!target) return;
      this.setZoom(Math.max(4, this.zoom), target.point);
      target.view.focus({ preventScroll: true });
    });
    this.fit.addEventListener('click', () => {
      const target = this.menuTarget;
      this.setZoom(1); target?.view.focus({ preventScroll: true });
    });
    this.copyButtons.forEach(button => button.addEventListener('click', () => this.copyResult()));
    this.menu.addEventListener('keydown', event => {
      const items = [...this.menu.querySelectorAll('button:not(:disabled)')];
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        let index = items.indexOf(document.activeElement);
        index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault(); this.hideMenu(true);
      } else if (event.key === 'Tab') this.hideMenu(true);
    });
    document.addEventListener('pointerdown', event => { if (!this.menu.contains(event.target)) this.hideMenu(); });
    document.addEventListener('scroll', () => {
      if (!this.menuTarget) return;
      const bounds = this.menuTarget.view.getBoundingClientRect();
      if (Math.abs(bounds.top - this.menuTarget.bounds.top) > .5 || Math.abs(bounds.left - this.menuTarget.bounds.left) > .5) this.hideMenu();
    }, true);
    window.addEventListener('blur', () => { this.hideMenu(); this.stopPan(); });
    this.observer = new ResizeObserver(() => {
      const sizes = this.views.map(view => `${view.clientWidth}:${view.clientHeight}`).join(',');
      if (this.lastViewSizes && sizes !== this.lastViewSizes) this.hideMenu();
      this.lastViewSizes = sizes; this.render();
    });
    this.views.forEach(view => this.observer.observe(view));
    this.render();
  }

  get ready() {
    return Boolean(this.size && this.images.every(image => image.complete && image.naturalWidth > 0));
  }

  setJob(id, size) {
    if (id !== this.jobId) {
      this.hideMenu(); this.stopPan(); this.hover = null;
      this.zoom = 1; this.center = { x: .5, y: .5 };
    }
    this.jobId = id; this.size = size; this.render();
  }

  clear() {
    this.hideMenu(); this.stopPan(); this.hover = null;
    this.jobId = null; this.size = null;
    this.zoom = 1; this.center = { x: .5, y: .5 }; this.render();
  }

  geometry() {
    if (!this.size || this.views.some(view => !view.clientWidth || !view.clientHeight)) return null;
    // Work in source-image coordinates. Both sides use identical displayed dimensions,
    // even though the upscaled image has twice as many pixels along each axis.
    const fit = Math.min(...this.views.flatMap(view => [view.clientWidth / this.size[0], view.clientHeight / this.size[1]]));
    return { width: this.size[0] * fit * this.zoom, height: this.size[1] * fit * this.zoom };
  }

  pointAt(view, clientX, clientY) {
    if (!this.ready) return null;
    const bounds = view.querySelector('img').getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
    // Ignore the checkerboard margins around a fitted image.
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  setZoom(zoom, point = this.center) {
    if (!this.ready) return;
    this.hideMenu(); this.stopPan(); this.hover = null;
    this.zoom = zoom; this.center = zoom === 1 ? { x: .5, y: .5 } : { ...point };
    this.render();
  }

  render() {
    const ready = this.ready;
    this.buttons.forEach(button => {
      button.disabled = !ready;
      button.setAttribute('aria-pressed', String(Number(button.dataset.compareZoom) === this.zoom));
    });
    const failed = this.size && this.images.some(image => image.complete && !image.naturalWidth);
    const status = !this.size ? '전체 보기' : failed ? '이미지를 불러오지 못했습니다. 새로고침해 주세요.' : !ready ? '이미지 불러오는 중…' : this.zoom === 1 ? '전체 보기' : `${this.zoom}× 확대 · 양쪽 이동 연동`;
    if (this.status.textContent !== status) this.status.textContent = status;
    const geometry = this.geometry();
    if (geometry) {
      for (const [axis, length, dimension] of [['x', 'width', 'clientWidth'], ['y', 'height', 'clientHeight']]) {
        const edge = Math.min(.5, Math.max(...this.views.map(view => view[dimension])) / (2 * geometry[length]));
        this.center[axis] = Math.min(1 - edge, Math.max(edge, this.center[axis]));
      }
    }
    this.views.forEach((view, index) => {
      view.classList.toggle('is-zoomed', ready && this.zoom > 1);
      view.setAttribute('aria-busy', String(Boolean(this.size && !this.images[index].complete)));
      if (!geometry) return;
      const image = this.images[index];
      image.style.width = `${geometry.width}px`; image.style.height = `${geometry.height}px`;
      image.style.left = `${view.clientWidth / 2 - this.center.x * geometry.width}px`;
      image.style.top = `${view.clientHeight / 2 - this.center.y * geometry.height}px`;
    });
    this.updateCopy();
  }

  get modernClipboard() {
    return window.isSecureContext && typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem === 'function';
  }

  resetCopyFrame() {
    clearTimeout(this.copyFrameTimer);
    this.copyFrame?.remove(); this.copyFrame = null;
    this.copyFrameReady = false; this.copyFrameFailed = false;
  }

  updateCopy() {
    const image = this.images[1], source = this.jobId ? image.getAttribute('src') : null;
    if (source !== this.copySource) { this.resetCopyFrame(); this.copySource = source; }
    const ready = Boolean(source && image.complete && image.naturalWidth > 0);
    if (ready && !this.modernClipboard && !this.copyFrame) this.prepareCopyFrame(source);
    const available = ready && (this.modernClipboard || this.copyFrameReady || this.copyFrameFailed);
    for (const button of this.copyButtons) {
      button.disabled = this.copying || !available;
      button.title = this.copyFrameFailed ? '복사 준비에 실패했습니다. 클릭하여 다시 시도하세요.' : '현재 모델의 결과 이미지 전체를 클립보드에 복사합니다.';
    }
    const label = this.copying ? '복사 중…' : this.copyFrameFailed ? '복사 다시 시도' : ready && !available ? '복사 준비 중…' : '클립보드 복사';
    if (this.copyButtons[0].textContent !== label) this.copyButtons[0].textContent = label;
  }

  prepareCopyFrame(source) {
    // HTTP has no Async Clipboard API. Copy from a same-origin PNG image document
    // so Chromium writes the bitmap, rather than just an HTML <img> selection.
    const frame = document.createElement('iframe');
    frame.className = 'copy-image-frame'; frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true'); frame.title = '클립보드 복사용 결과 이미지';
    this.copyFrame = frame;
    const finish = success => {
      if (this.copyFrame !== frame) return;
      clearTimeout(this.copyFrameTimer);
      this.copyFrameReady = success; this.copyFrameFailed = !success; this.updateCopy();
    };
    frame.addEventListener('load', () => {
      try {
        const image = frame.contentDocument?.querySelector('img');
        finish(Boolean(frame.contentDocument?.contentType === 'image/png' && image?.complete && image.naturalWidth > 0));
      } catch { finish(false); }
    });
    frame.addEventListener('error', () => finish(false));
    const url = new URL(source, location.href); url.searchParams.set('clipboard', '1');
    frame.src = url.href;
    this.copyFrameTimer = setTimeout(() => finish(false), 30000);
    document.body.append(frame);
  }

  async copyResult() {
    if (this.copying || this.copyButtons[0].disabled) return;
    if (this.copyFrameFailed) { this.resetCopyFrame(); this.updateCopy(); return; }
    const source = this.copySource;
    const returnFocus = this.menu.hidden ? this.copyButtons[0] : this.views[1];
    this.hideMenu(); this.copying = true; this.updateCopy();
    try {
      if (this.modernClipboard) {
        // Keep the write call in the click gesture; ClipboardItem accepts a blob promise.
        const png = fetch(source).then(async response => {
          if (!response.ok) throw new Error('이미지를 불러오지 못했습니다.');
          const blob = await response.blob();
          if (blob.type !== 'image/png') throw new Error('PNG 이미지를 복사할 수 없습니다.');
          return blob;
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } else {
        const frame = this.copyFrame;
        if (!this.copyFrameReady || !frame?.contentDocument) throw new Error('이미지가 준비되지 않았습니다.');
        frame.contentWindow.focus(); frame.contentWindow.getSelection().removeAllRanges();
        if (!frame.contentDocument.execCommand('copy')) throw new Error('브라우저에서 복사를 허용하지 않았습니다.');
      }
      toast('결과 이미지 전체를 클립보드에 복사했습니다.');
    } catch {
      toast('클립보드에 복사하지 못했습니다. 다시 시도하거나 PNG 다운로드를 이용해 주세요.');
    } finally {
      this.copying = false; this.updateCopy();
      if (returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true });
    }
  }

  openMenu(view, point, clientX, clientY) {
    if (!this.ready) return;
    this.hideMenu(); this.stopPan();
    this.menuTarget = { view, point: { ...point }, bounds: view.getBoundingClientRect() };
    this.zoomHere.querySelector('span').textContent = `${Math.max(4, this.zoom)}×`;
    this.fit.disabled = this.zoom === 1;
    this.menu.hidden = false;
    this.menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - this.menu.offsetHeight - 8))}px`;
    view.setAttribute('aria-expanded', 'true');
    this.zoomHere.focus({ preventScroll: true });
  }

  hideMenu(restoreFocus = false) {
    const target = this.menuTarget;
    this.menu.hidden = true; this.menuTarget = null;
    this.views.forEach(view => view.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) target?.view.focus({ preventScroll: true });
  }

  startPan(view, event) {
    if (!this.ready || this.zoom === 1 || event.button !== 0) return;
    event.preventDefault(); view.focus({ preventScroll: true });
    this.pan = { view, id: event.pointerId, x: event.clientX, y: event.clientY, center: { ...this.center }, geometry: this.geometry() };
    view.setPointerCapture(event.pointerId);
    this.views.forEach(item => item.classList.add('is-panning'));
  }

  movePointer(view, event) {
    const point = this.pointAt(view, event.clientX, event.clientY);
    this.hover = point ? { view, point } : null;
    if (!this.pan || this.pan.id !== event.pointerId) return;
    this.center = {
      x: this.pan.center.x - (event.clientX - this.pan.x) / this.pan.geometry.width,
      y: this.pan.center.y - (event.clientY - this.pan.y) / this.pan.geometry.height,
    };
    this.render();
  }

  stopPan() {
    const pan = this.pan; this.pan = null;
    if (pan?.view.hasPointerCapture(pan.id)) pan.view.releasePointerCapture(pan.id);
    this.views.forEach(view => view.classList.remove('is-panning'));
  }
}
