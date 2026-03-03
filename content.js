const DEFAULT_SETTINGS = {
  enabled: true,
  targetLanguage: "zh-CN",
  mode: "overlay",
};

const ROOT_ID = "ponytranslate-root";
const SELECTION_ID = "ponytranslate-selection";
const PARAGRAPH_ATTRIBUTE = "data-ponytranslate-paragraph-id";
const CONTENT_SELECTOR = "p, div, article, section, li, blockquote";
const EXCLUDED_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "iframe",
  "canvas",
  "svg",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  "[role='navigation']",
  "[aria-hidden='true']",
].join(", ");
const NOISE_NAME_PATTERN =
  /\b(nav|menu|banner|footer|sidebar|promo|advert|ads|dialog|modal|cookie|comment)\b/i;

const MAX_CONCURRENT_TRANSLATIONS = 2;
const REQUEST_INTERVAL_MS = 280;
const RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 280;
const MUTATION_DEBOUNCE_MS = 220;

let widget = null;
let pageTranslator = null;

function debounce(callback, delay) {
  let timer = null;

  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

function wait(delay, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay);
    if (!signal) {
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      },
      { once: true }
    );
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatParagraphText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/([。！？；])\s*/g, "$1\n")
    .replace(/([.!?;])\s+/g, "$1\n")
    .trim();
}

function ensureWidget() {
  if (widget) {
    return widget;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const panel = document.createElement("div");
  panel.className = "ponytranslate-widget";
  panel.innerHTML = `
    <div class="ponytranslate-badge">ZT</div>
    <div class="ponytranslate-copy">
      <strong>小马快译 已启用</strong>
      <span>正在渲染译文...</span>
    </div>
  `;

  root.appendChild(panel);
  document.documentElement.appendChild(root);
  widget = panel;
  return widget;
}

function removeWidget() {
  const root = document.getElementById(ROOT_ID);
  if (root) {
    root.remove();
  }
  widget = null;
}

function applyMode(mode) {
  document.documentElement.dataset.ponytranslateMode = mode;
  document.body?.setAttribute("data-ponytranslate-mode", mode);
}

function updateWidgetCopy(settings, stats = {}) {
  const panel = ensureWidget();
  const title = panel.querySelector("strong");
  const subtitle = panel.querySelector("span");
  const translatedCount = stats.translatedCount || 0;

  title.textContent =
    settings.mode === "dual"
      ? "小马快译 双语模式"
      : settings.mode === "highlight"
        ? "小马快译 高亮模式"
        : "小马快译 覆盖模式";
  subtitle.textContent = `目标语言：${settings.targetLanguage} | 已渲染：${translatedCount}`;
}

function buildMockTranslation(text, targetLanguage) {
  const dictionary = {
    "zh-CN": {
      the: "这",
      and: "并且",
      you: "你",
      your: "你的",
      browser: "浏览器",
      translation: "翻译",
      page: "页面",
      language: "语言",
      content: "内容",
      article: "文章",
      read: "阅读",
      click: "点击",
      select: "选择",
      hover: "悬停",
      mode: "模式",
      paragraph: "段落",
      overlay: "覆盖",
      highlight: "高亮",
      text: "文本",
      translate: "翻译",
      source: "原文",
      show: "显示",
      hide: "隐藏",
      fast: "快速",
      enable: "启用",
      disable: "关闭",
      settings: "设置",
      support: "支持",
      multiple: "多种",
    },
    en: {},
    ja: {},
    ko: {},
    fr: {},
  };

  const replacements = dictionary[targetLanguage] || {};
  const translated = text.replace(/\b([a-zA-Z]{2,})\b/g, (full, word) => {
    const matched = replacements[word.toLowerCase()];
    return matched || full;
  });

  const compact = translated.replace(/\s+/g, " ").trim();
  const prefixMap = {
    "zh-CN": "译",
    en: "EN",
    ja: "JP",
    ko: "KR",
    fr: "FR",
  };
  const prefix = prefixMap[targetLanguage] || targetLanguage;

  if (targetLanguage === "zh-CN") {
    return `【${prefix}】${compact}`;
  }

  return `[${prefix}] ${compact}`;
}

class TranslationService {
  constructor(settings) {
    this.settings = settings;
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.nextAllowedAt = 0;
    this.dispatchTimer = null;
  }

  updateSettings(settings) {
    const languageChanged = settings.targetLanguage !== this.settings.targetLanguage;
    this.settings = settings;

    if (languageChanged) {
      this.cache.clear();
    }
  }

  destroy() {
    if (this.dispatchTimer) {
      window.clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }

    for (const job of this.queue) {
      job.reject(new DOMException("The operation was aborted.", "AbortError"));
    }

    this.queue = [];
  }

  translate(text, options = {}) {
    const normalized = (text || "").trim();
    const cacheKey = `${this.settings.targetLanguage}::${normalized}`;

    if (!normalized) {
      return Promise.resolve({
        text: "",
        cached: true,
      });
    }

    if (this.cache.has(cacheKey)) {
      return Promise.resolve({
        text: this.cache.get(cacheKey),
        cached: true,
      });
    }

    return new Promise((resolve, reject) => {
      const job = {
        cacheKey,
        text: normalized,
        signal: options.signal || null,
        resolve,
        reject,
      };

      if (job.signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }

      if (job.signal) {
        job.abortHandler = () => {
          this.queue = this.queue.filter((item) => item !== job);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        job.signal.addEventListener("abort", job.abortHandler, { once: true });
      }

      this.queue.push(job);
      this.processQueue();
    });
  }

  processQueue() {
    if (this.active >= MAX_CONCURRENT_TRANSLATIONS || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const delay = Math.max(0, this.nextAllowedAt - now);
    if (delay > 0) {
      if (this.dispatchTimer !== null) {
        return;
      }

      this.dispatchTimer = window.setTimeout(() => {
        this.dispatchTimer = null;
        this.processQueue();
      }, delay);
      return;
    }

    const job = this.queue.shift();
    if (!job) {
      return;
    }

    this.active += 1;
    this.nextAllowedAt = Date.now() + REQUEST_INTERVAL_MS;

    this.performTranslation(job)
      .then((result) => {
        this.cache.set(job.cacheKey, result);
        job.resolve({
          text: result,
          cached: false,
        });
      })
      .catch((error) => {
        job.reject(error);
      })
      .finally(() => {
        if (job.signal && job.abortHandler) {
          job.signal.removeEventListener("abort", job.abortHandler);
        }

        this.active -= 1;
        this.processQueue();
      });
  }

  async performTranslation(job) {
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
      try {
        return await this.requestTranslation(job.text, job.signal);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw error;
        }

        lastError = error;
        if (attempt === RETRY_LIMIT) {
          break;
        }

        await wait(RETRY_BASE_DELAY_MS * (attempt + 1), job.signal);
      }
    }

    throw lastError || new Error("Translation failed");
  }

  async requestTranslation(text, signal) {
    await wait(160 + Math.min(420, Math.floor(text.length * 0.9)), signal);
    return buildMockTranslation(text, this.settings.targetLanguage);
  }
}

class SelectionToolbar {
  constructor(service, getTargetLanguage, shareCardGenerator) {
    this.service = service;
    this.getTargetLanguage = getTargetLanguage;
    this.shareCardGenerator = shareCardGenerator;
    this.root = null;
    this.translateButton = null;
    this.shareButton = null;
    this.card = null;
    this.activeText = "";
    this.activeSelection = null;
    this.currentAbortController = null;

    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleSelectionChange = debounce(
      () => this.refreshSelectionUi(false),
      80
    );
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleTranslateClick = this.handleTranslateClick.bind(this);
    this.handleShareClick = this.handleShareClick.bind(this);
  }

  mount() {
    if (this.root) {
      return;
    }

    const root = document.createElement("div");
    root.id = SELECTION_ID;
    root.innerHTML = `
      <div class="ponytranslate-selection-actions">
        <button type="button" class="ponytranslate-selection-action" data-action="translate">翻译选中</button>
        <button type="button" class="ponytranslate-selection-action ponytranslate-selection-action-secondary" data-action="share">生成卡片</button>
      </div>
      <div class="ponytranslate-selection-card" hidden>
        <div class="ponytranslate-selection-meta"></div>
        <div class="ponytranslate-selection-result">正在翻译...</div>
      </div>
    `;

    document.documentElement.appendChild(root);
    this.root = root;
    this.translateButton = root.querySelector('[data-action="translate"]');
    this.shareButton = root.querySelector('[data-action="share"]');
    this.card = root.querySelector(".ponytranslate-selection-card");
    if (!this.shareCardGenerator) {
      this.shareButton?.setAttribute("hidden", "hidden");
    }

    this.translateButton?.addEventListener("click", this.handleTranslateClick);
    this.shareButton?.addEventListener("click", this.handleShareClick);
    document.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("touchend", this.handleTouchEnd);
    document.addEventListener("selectionchange", this.handleSelectionChange);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  destroy() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    document.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("touchend", this.handleTouchEnd);
    document.removeEventListener("selectionchange", this.handleSelectionChange);
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.translateButton?.removeEventListener("click", this.handleTranslateClick);
    this.shareButton?.removeEventListener("click", this.handleShareClick);

    if (this.root) {
      this.root.remove();
    }

    this.root = null;
    this.translateButton = null;
    this.shareButton = null;
    this.card = null;
    this.activeText = "";
    this.activeSelection = null;
  }

  handleMouseUp() {
    this.refreshSelectionUi(true);
  }

  handleTouchEnd() {
    window.setTimeout(() => this.refreshSelectionUi(true), 0);
  }

  handleDocumentPointerDown(event) {
    if (this.root?.contains(event.target)) {
      return;
    }

    this.hide();
  }

  getSelectionPayload() {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim() || "";

    if (!text || text.length < 2 || text.length > 280 || selection?.isCollapsed) {
      return null;
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) {
      return null;
    }

    const startContainer =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer?.parentElement || null;
    if (
      startContainer?.closest(
        "input, textarea, select, button, [contenteditable='true'], [contenteditable='']"
      )
    ) {
      return null;
    }

    if (this.root && startContainer?.closest(`#${SELECTION_ID}`)) {
      return null;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      return null;
    }

    const context = this.extractSelectionContext(range, text);

    return {
      text,
      rect,
      context,
      title: document.title || "当前页面",
      url: window.location.href,
    };
  }

  extractSelectionContext(range, selectedText) {
    const container =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer?.parentElement || null;
    const host = container?.closest("p, li, blockquote, article, section, div") || container;
    const content = (host?.innerText || host?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!content) {
      return selectedText;
    }

    const index = content.indexOf(selectedText);
    if (index === -1) {
      return content.slice(0, 140);
    }

    const start = Math.max(0, index - 36);
    const end = Math.min(content.length, index + selectedText.length + 36);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < content.length ? "..." : "";
    return `${prefix}${content.slice(start, end)}${suffix}`;
  }

  refreshSelectionUi(showCardReset) {
    const payload = this.getSelectionPayload();
    if (
      !payload ||
      !this.root ||
      !this.translateButton ||
      !this.shareButton ||
      !this.card
    ) {
      this.hide();
      return;
    }

    this.activeText = payload.text;
    this.activeSelection = payload;
    const top = Math.max(12, window.scrollY + payload.rect.top - 44);
    const left = Math.max(
      12,
      Math.min(
        window.scrollX + payload.rect.left + payload.rect.width / 2,
        window.scrollX + window.innerWidth - 12
      )
    );

    this.root.style.top = `${top}px`;
    this.root.style.left = `${left}px`;
    this.root.dataset.visible = "true";
    this.translateButton.hidden = false;
    if (this.shareButton) {
      this.shareButton.hidden = !this.shareCardGenerator;
    }

    if (showCardReset) {
      this.card.hidden = true;
    }
  }

  async handleTranslateClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this.activeText || !this.card) {
      return;
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    this.currentAbortController = new AbortController();
    const meta = this.card.querySelector(".ponytranslate-selection-meta");
    const result = this.card.querySelector(".ponytranslate-selection-result");
    if (!meta || !result) {
      return;
    }

    meta.textContent = `快速翻译 -> ${this.getTargetLanguage()}`;
    result.textContent = "正在翻译...";
    this.card.hidden = false;

    try {
      const translated = await this.service.translate(this.activeText, {
        signal: this.currentAbortController.signal,
      });
      result.textContent = translated.text;
    } catch (error) {
      if (error?.name !== "AbortError") {
        result.textContent = "翻译失败，请重试";
      }
    } finally {
      this.currentAbortController = null;
    }
  }

  async handleShareClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this.activeSelection || !this.shareCardGenerator) {
      return;
    }

    await this.shareCardGenerator.open(this.activeSelection);
  }

  hide() {
    if (!this.root) {
      return;
    }

    this.root.dataset.visible = "false";
    this.activeText = "";
    this.activeSelection = null;
    if (this.card) {
      this.card.hidden = true;
    }
  }
}

class PageTranslator {
  constructor(settings) {
    this.settings = settings;
    this.service = new TranslationService(settings);
    this.shareCardGenerator =
      typeof window.ZdfShareCardGenerator === "function"
        ? new window.ZdfShareCardGenerator()
        : null;
    this.selectionToolbar = new SelectionToolbar(
      this.service,
      () => this.settings.targetLanguage,
      this.shareCardGenerator
    );

    this.paragraphCounter = 0;
    this.records = new Map();
    this.observer = null;
    this.mutationObserver = null;
    this.refreshParagraphs = debounce(
      () => this.collectParagraphs(),
      MUTATION_DEBOUNCE_MS
    );
  }

  init() {
    this.selectionToolbar.mount();
    this.collectParagraphs();

    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      {
        root: null,
        rootMargin: "240px 0px 240px 0px",
        threshold: 0.1,
      }
    );

    for (const record of this.records.values()) {
      this.observer.observe(record.element);
    }

    this.mutationObserver = new MutationObserver(() => this.refreshParagraphs());
    if (document.body) {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  destroy() {
    this.selectionToolbar.destroy();
    this.shareCardGenerator?.destroy?.();
    this.service.destroy();
    this.observer?.disconnect();
    this.mutationObserver?.disconnect();

    for (const record of this.records.values()) {
      if (record.abortController) {
        record.abortController.abort();
      }

      this.teardownRecord(record);
    }

    this.records.clear();
  }

  updateSettings(settings) {
    const languageChanged = this.settings.targetLanguage !== settings.targetLanguage;
    const modeChanged = this.settings.mode !== settings.mode;
    this.settings = settings;
    this.service.updateSettings(settings);

    if (languageChanged) {
      for (const record of this.records.values()) {
        if (record.abortController) {
          record.abortController.abort();
          record.abortController = null;
        }

        record.translation = "";
        record.error = "";
        record.renderSide = "translation";
        record.rendered = false;
        this.requestTranslation(record);
      }
    } else if (modeChanged) {
      for (const record of this.records.values()) {
        if (record.translation || record.error) {
          this.renderRecord(record);
        }
      }
    }

    updateWidgetCopy(this.settings, {
      translatedCount: this.getTranslatedCount(),
    });
  }

  getTranslatedCount() {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.rendered && record.translation) {
        count += 1;
      }
    }
    return count;
  }

  collectParagraphs() {
    const candidates = Array.from(document.body?.querySelectorAll(CONTENT_SELECTOR) || []);

    for (const [id, record] of this.records.entries()) {
      if (record.element.isConnected) {
        continue;
      }

      if (record.abortController) {
        record.abortController.abort();
      }

      this.teardownRecord(record);
      this.records.delete(id);
    }

    for (const element of candidates) {
      if (!this.isParagraphCandidate(element)) {
        continue;
      }

      if (!element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
        this.paragraphCounter += 1;
        element.setAttribute(PARAGRAPH_ATTRIBUTE, `zt-p-${this.paragraphCounter}`);
      }

      const id = element.getAttribute(PARAGRAPH_ATTRIBUTE);
      if (!id) {
        continue;
      }

      const text = this.extractParagraphText(element);
      const existing = this.records.get(id);

      if (existing) {
        if (existing.text !== text) {
          existing.text = text;
          existing.translation = "";
          existing.error = "";
          existing.rendered = false;
          this.requestTranslation(existing);
        }
        continue;
      }

      const record = {
        id,
        element,
        text,
        translation: "",
        error: "",
        rendered: false,
        visible: false,
        hover: false,
        pinned: false,
        renderSide: "translation",
        host: null,
        abortController: null,
      };

      this.attachRecordListeners(record);
      this.records.set(id, record);
      this.observer?.observe(element);
    }
  }

  isParagraphCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.closest(EXCLUDED_SELECTOR)) {
      return false;
    }

    if (element.closest(`#${ROOT_ID}`) || element.closest(`#${SELECTION_ID}`)) {
      return false;
    }

    if (element.classList.contains("ponytranslate-inline-host")) {
      return false;
    }

    const className = typeof element.className === "string" ? element.className : "";
    const id = element.id || "";
    if (NOISE_NAME_PATTERN.test(className) || NOISE_NAME_PATTERN.test(id)) {
      return false;
    }

    if (element.children.length > 6 && /^(div|section|article)$/i.test(element.tagName)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity || "1") === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 18) {
      return false;
    }

    const text = this.extractParagraphText(element);
    if (text.length < 25) {
      return false;
    }

    if (/[{};<>]/.test(text) && text.length < 80) {
      return false;
    }

    const interactiveChildren = element.querySelectorAll(
      "button, input, textarea, select, nav, form"
    ).length;
    if (interactiveChildren > 0) {
      return false;
    }

    return true;
  }

  extractParagraphText(element) {
    return (element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  attachRecordListeners(record) {
    record.handleEnter = () => {
      record.hover = true;
      if (record.translation || record.error) {
        this.renderRecord(record);
      }
    };

    record.handleLeave = () => {
      record.hover = false;
      if (!record.pinned && (record.translation || record.error)) {
        this.renderRecord(record);
      }
    };

    record.handleClick = (event) => {
      if (event.target instanceof Element && event.target.closest(".ponytranslate-inline-host")) {
        return;
      }

      if (record.error && !record.abortController) {
        record.error = "";
        record.rendered = false;
        this.requestTranslation(record);
        return;
      }

      record.pinned = !record.pinned;
      this.renderRecord(record);
    };

    record.element.addEventListener("mouseenter", record.handleEnter);
    record.element.addEventListener("mouseleave", record.handleLeave);
    record.element.addEventListener("click", record.handleClick);
  }

  teardownRecord(record) {
    record.element.removeEventListener("mouseenter", record.handleEnter);
    record.element.removeEventListener("mouseleave", record.handleLeave);
    record.element.removeEventListener("click", record.handleClick);
    record.element.removeAttribute("data-ponytranslate-anchor");
    record.element.removeAttribute("data-ponytranslate-highlighted");
    record.element.removeAttribute("data-ponytranslate-rendered");

    if (record.host) {
      record.host.remove();
      record.host = null;
    }
  }

  handleIntersections(entries) {
    for (const entry of entries) {
      const id = entry.target.getAttribute(PARAGRAPH_ATTRIBUTE);
      if (!id) {
        continue;
      }

      const record = this.records.get(id);
      if (!record) {
        continue;
      }

      record.visible = entry.isIntersecting && entry.intersectionRatio >= 0.1;
      if (record.visible) {
        this.requestTranslation(record);
      }
    }
  }

  requestTranslation(record) {
    if (!record.visible && this.records.size > 10) {
      return;
    }

    if (!record.text || record.abortController || record.translation) {
      if (record.translation || record.error) {
        this.renderRecord(record);
      }
      return;
    }

    record.abortController = new AbortController();
    record.error = "";
    record.element.dataset.ponytranslateRendered = "loading";

    this.service
      .translate(record.text, {
        signal: record.abortController.signal,
      })
      .then((translated) => {
        record.translation = translated.text;
        record.rendered = true;
        record.element.dataset.ponytranslateRendered = "ready";
        this.renderRecord(record);
        updateWidgetCopy(this.settings, {
          translatedCount: this.getTranslatedCount(),
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") {
          return;
        }

        record.error = "翻译失败，点击段落重试";
        record.translation = "";
        record.rendered = true;
        record.element.dataset.ponytranslateRendered = "error";
        this.renderRecord(record);
      })
      .finally(() => {
        record.abortController = null;
      });
  }

  ensureRenderHost(record) {
    if (record.host?.isConnected) {
      return record.host;
    }

    const host = document.createElement("span");
    host.className = "ponytranslate-inline-host";
    host.attachShadow({ mode: "open" });
    record.host = host;
    record.element.appendChild(host);
    return host;
  }

  renderRecord(record) {
    if (!record.translation && !record.error) {
      return;
    }

    const host = this.ensureRenderHost(record);
    const shadow = host.shadowRoot;
    if (!shadow) {
      return;
    }

    const mode = this.settings.mode;
    const showOriginal = record.renderSide === "source";
    const displayText = showOriginal ? record.text : record.translation || record.error;
    const showPanel = mode !== "highlight" || record.hover || record.pinned;
    const showControls = mode === "highlight" || record.hover || record.pinned;
    const isError = Boolean(record.error && !record.translation);

    host.dataset.mode = mode;
    host.dataset.visible = showPanel ? "true" : "false";
    record.element.setAttribute(
      "data-ponytranslate-anchor",
      mode === "overlay" || mode === "highlight" ? "active" : "passive"
    );
    record.element.setAttribute(
      "data-ponytranslate-highlighted",
      mode === "highlight" ? "true" : "false"
    );

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          display: block;
          font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          color: #142030;
          pointer-events: auto;
        }

        .shell {
          box-sizing: border-box;
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(53, 87, 127, 0.18);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.94));
          box-shadow: 0 10px 26px rgba(18, 33, 56, 0.14);
          overflow: hidden;
          opacity: ${showPanel ? "1" : "0"};
          transform: translateY(${showPanel ? "0" : "6px"});
          transition: opacity 0.18s ease, transform 0.18s ease;
        }

        .shell.highlight {
          min-width: min(420px, 70vw);
          max-width: min(520px, 78vw);
        }

        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 7px 10px;
          background: rgba(33, 72, 118, 0.06);
          border-bottom: 1px solid rgba(53, 87, 127, 0.08);
          font-size: 11px;
          color: #44617f;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${isError ? "#d94841" : "#d36b1f"};
        }

        .actions {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          opacity: ${showControls ? "1" : "0"};
          pointer-events: ${showControls ? "auto" : "none"};
          transition: opacity 0.18s ease;
        }

        button {
          all: unset;
          box-sizing: border-box;
          cursor: pointer;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(211, 107, 31, 0.1);
          color: #b85618;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.4;
        }

        button:hover {
          background: rgba(211, 107, 31, 0.16);
        }

        .body {
          padding: 10px 12px 12px;
          font-size: 14px;
          line-height: 1.8;
          color: ${showOriginal ? "#516173" : isError ? "#c03b32" : "#1e2d3f"};
          white-space: pre-line;
          letter-spacing: 0.01em;
          word-break: break-word;
          text-wrap: pretty;
        }

        .body.translation {
          font-size: 15px;
          line-height: 1.9;
        }
      </style>
      <div class="shell ${mode}">
        <div class="toolbar">
          <span class="badge">
            <span class="dot"></span>
            ${isError ? "渲染失败" : showOriginal ? "原文" : "译文"}
          </span>
          <span class="actions">
            <button type="button" data-action="switch">
              ${showOriginal ? "看译文" : "看原文"}
            </button>
            <button type="button" data-action="pin">
              ${record.pinned ? "取消固定" : "固定显示"}
            </button>
          </span>
        </div>
        <div class="body ${showOriginal ? "source" : "translation"}">${escapeHtml(
          formatParagraphText(displayText)
        )}</div>
      </div>
    `;

    const switchButton = shadow.querySelector('[data-action="switch"]');
    const pinButton = shadow.querySelector('[data-action="pin"]');

    switchButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      record.renderSide = showOriginal ? "translation" : "source";
      this.renderRecord(record);
    });

    pinButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      record.pinned = !record.pinned;
      this.renderRecord(record);
    });
  }
}

function ensurePageTranslator(settings) {
  if (pageTranslator) {
    pageTranslator.updateSettings(settings);
    return pageTranslator;
  }

  pageTranslator = new PageTranslator(settings);
  pageTranslator.init();
  return pageTranslator;
}

function destroyPageTranslator() {
  if (!pageTranslator) {
    return;
  }

  pageTranslator.destroy();
  pageTranslator = null;
}

function applySettings(settings) {
  if (!settings.enabled) {
    destroyPageTranslator();
    removeWidget();
    delete document.documentElement.dataset.ponytranslateMode;
    document.body?.removeAttribute("data-ponytranslate-mode");
    return;
  }

  applyMode(settings.mode);
  ensurePageTranslator(settings);
  updateWidgetCopy(settings, {
    translatedCount: pageTranslator?.getTranslatedCount?.() || 0,
  });
  requestAnimationFrame(() => ensureWidget().classList.add("visible"));
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  applySettings({ ...DEFAULT_SETTINGS, ...stored });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "APPLY_SETTINGS") {
    applySettings({ ...DEFAULT_SETTINGS, ...message.payload });
  }
});

loadSettings().catch((error) => {
  console.error("Failed to initialize content script:", error);
});
