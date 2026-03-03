(function attachShareCardModule(globalScope) {
  const CARD_ROOT_ID = "ponytranslate-share-card-root";
  const PRESETS = [
    {
      id: "sunrise",
      label: "晨光",
      accent: "#f37b32",
      gradient:
        "linear-gradient(135deg, rgba(253, 242, 210, 0.96), rgba(243, 123, 50, 0.88))",
      texture:
        "radial-gradient(circle at top right, rgba(255,255,255,0.28), transparent 42%)",
    },
    {
      id: "ocean",
      label: "海岸",
      accent: "#2e76b7",
      gradient:
        "linear-gradient(135deg, rgba(213, 239, 255, 0.96), rgba(46, 118, 183, 0.92))",
      texture:
        "radial-gradient(circle at top left, rgba(255,255,255,0.22), transparent 46%)",
    },
    {
      id: "forest",
      label: "松林",
      accent: "#2f7a57",
      gradient:
        "linear-gradient(135deg, rgba(224, 245, 228, 0.96), rgba(47, 122, 87, 0.92))",
      texture:
        "radial-gradient(circle at 70% 15%, rgba(255,255,255,0.22), transparent 44%)",
    },
  ];

  class ZdfShareCardGenerator {
    constructor() {
      this.root = null;
      this.preview = null;
      this.offscreen = null;
      this.status = null;
      this.copyButton = null;
      this.selection = null;
      this.previewTimer = null;
      this.state = {
        presetId: PRESETS[0].id,
        backgroundColor: "#fff7e8",
        backgroundImage: "",
        fontScale: 1,
        exportType: "png",
        busy: false,
      };

      this.handleBackdropClick = this.handleBackdropClick.bind(this);
      this.handleClose = this.handleClose.bind(this);
      this.handleControls = this.handleControls.bind(this);
      this.handleDownload = this.handleDownload.bind(this);
      this.handleCopy = this.handleCopy.bind(this);
    }

    ensureMounted() {
      if (this.root) {
        return;
      }

      const root = document.createElement("div");
      root.id = CARD_ROOT_ID;
      root.innerHTML = `
        <div class="ponytranslate-share-backdrop" data-action="close"></div>
        <section class="ponytranslate-share-dialog" role="dialog" aria-modal="true" aria-label="分享卡片预览">
          <header class="ponytranslate-share-header">
            <div>
              <strong>分享卡片</strong>
              <span>选中文字后生成可下载图片</span>
            </div>
            <button type="button" class="ponytranslate-share-close" data-action="close" aria-label="关闭">×</button>
          </header>
          <div class="ponytranslate-share-body">
            <div class="ponytranslate-share-preview-shell">
              <div class="ponytranslate-share-preview"></div>
            </div>
            <aside class="ponytranslate-share-controls">
              <label>
                <span>卡片风格</span>
                <div class="ponytranslate-share-chip-group">
                  ${PRESETS.map(
                    (preset) => `
                      <button type="button" class="ponytranslate-share-chip" data-preset="${preset.id}">
                        ${preset.label}
                      </button>
                    `
                  ).join("")}
                </div>
              </label>
              <label>
                <span>背景底色</span>
                <input type="color" value="${this.state.backgroundColor}" data-field="backgroundColor" />
              </label>
              <label>
                <span>背景图片</span>
                <input type="url" placeholder="https://example.com/cover.jpg" data-field="backgroundImage" />
              </label>
              <label>
                <span>字号比例</span>
                <input type="range" min="0.9" max="1.3" step="0.05" value="${this.state.fontScale}" data-field="fontScale" />
              </label>
              <label>
                <span>导出格式</span>
                <select data-field="exportType">
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG</option>
                </select>
              </label>
              <div class="ponytranslate-share-status" aria-live="polite"></div>
            </aside>
          </div>
          <footer class="ponytranslate-share-footer">
            <button type="button" class="ponytranslate-share-action ponytranslate-share-action-muted" data-action="copy">复制图片</button>
            <button type="button" class="ponytranslate-share-action" data-action="download">下载图片</button>
          </footer>
        </section>
      `;

      document.documentElement.appendChild(root);
      this.root = root;
      this.preview = root.querySelector(".ponytranslate-share-preview");
      this.status = root.querySelector(".ponytranslate-share-status");
      this.copyButton = root.querySelector('[data-action="copy"]');

      const offscreen = document.createElement("div");
      offscreen.className = "ponytranslate-share-offscreen";
      document.documentElement.appendChild(offscreen);
      this.offscreen = offscreen;

      root.addEventListener("click", this.handleBackdropClick);
      root.querySelector(".ponytranslate-share-controls")?.addEventListener(
        "input",
        this.handleControls
      );
      root.querySelector(".ponytranslate-share-controls")?.addEventListener(
        "click",
        this.handleControls
      );
      root
        .querySelector('[data-action="download"]')
        ?.addEventListener("click", this.handleDownload);
      root
        .querySelector('[data-action="copy"]')
        ?.addEventListener("click", this.handleCopy);
    }

    destroy() {
      this.root?.removeEventListener("click", this.handleBackdropClick);
      if (this.previewTimer) {
        window.clearTimeout(this.previewTimer);
        this.previewTimer = null;
      }
      this.root?.remove();
      this.offscreen?.remove();
      this.root = null;
      this.preview = null;
      this.offscreen = null;
      this.status = null;
      this.copyButton = null;
    }

    async open(selection) {
      this.ensureMounted();
      this.selection = selection;
      if (!this.root) {
        return;
      }

      this.root.dataset.open = "true";
      this.updateStatus("");
      this.renderPreview();
      this.schedulePreviewGeneration(true);
    }

    close() {
      if (!this.root) {
        return;
      }

      this.root.dataset.open = "false";
      this.updateStatus("");
    }

    handleBackdropClick(event) {
      const actionTarget =
        event.target instanceof Element ? event.target.closest("[data-action]") : null;
      const presetTarget =
        event.target instanceof Element ? event.target.closest("[data-preset]") : null;

      if (presetTarget instanceof HTMLElement) {
        this.state.presetId = presetTarget.dataset.preset || this.state.presetId;
        this.renderPreview();
        this.schedulePreviewGeneration();
        return;
      }

      if (!actionTarget) {
        return;
      }

      const action = actionTarget.getAttribute("data-action");
      if (action === "close") {
        this.handleClose();
      }
    }

    handleClose() {
      this.close();
    }

    handleControls(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      const field = target.dataset.field;
      if (!field) {
        return;
      }

      if (field === "fontScale") {
        this.state.fontScale = Number(target.value) || 1;
      } else {
        this.state[field] = target.value.trim();
      }

      this.renderPreview();
      this.schedulePreviewGeneration();
    }

    schedulePreviewGeneration(immediate) {
      if (this.previewTimer) {
        window.clearTimeout(this.previewTimer);
      }

      const delay = immediate ? 0 : 120;
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = null;
        void this.generatePreviewAsset();
      }, delay);
    }

    renderPreview() {
      if (!this.preview || !this.selection) {
        return;
      }

      const preset = this.getPreset();
      const title = this.escapeHtml(this.selection.title || "当前页面");
      const quote = this.escapeHtml(this.selection.text || "");
      const context = this.escapeHtml(this.selection.context || "");
      const source = this.escapeHtml(this.getDisplaySource(this.selection.url));
      const fontSize = `${Math.round(28 * this.state.fontScale)}px`;
      const backgroundImage = this.state.backgroundImage
        ? `linear-gradient(135deg, rgba(15,23,42,0.18), rgba(15,23,42,0.06)), url("${this.escapeAttribute(
            this.state.backgroundImage
          )}")`
        : `${preset.texture}, ${preset.gradient}`;

      this.preview.innerHTML = `
        <article
          class="ponytranslate-share-card"
          style="
            --zdf-share-accent: ${preset.accent};
            --zdf-share-base: ${this.state.backgroundColor};
            --zdf-share-font-size: ${fontSize};
            --zdf-share-background: ${backgroundImage};
          "
        >
          <div class="ponytranslate-share-card-inner">
            <div class="ponytranslate-share-card-topline">
              <span class="ponytranslate-share-brand">🐴</span>
              <span class="ponytranslate-share-tag">小马快译</span>
            </div>
            <blockquote class="ponytranslate-share-quote">“${quote}”</blockquote>
            <p class="ponytranslate-share-context">${context}</p>
            <footer class="ponytranslate-share-meta">
              <div>
                <strong>${title}</strong>
                <span>${source}</span>
              </div>
              <span class="ponytranslate-share-watermark">小马快译 · 轻快阅读</span>
            </footer>
          </div>
        </article>
      `;

      this.root
        ?.querySelectorAll(".ponytranslate-share-chip")
        .forEach((button) => {
          button.setAttribute(
            "data-active",
            button.getAttribute("data-preset") === this.state.presetId ? "true" : "false"
          );
        });
    }

    async generatePreviewAsset() {
      if (!this.selection || !this.preview) {
        return null;
      }

      try {
        await this.renderToCanvas();
        this.updateStatus("卡片已就绪，可下载或复制。");
      } catch (error) {
        this.updateStatus("预览生成失败，已保留可编辑卡片。");
      }
      return null;
    }

    async handleDownload() {
      const blob = await this.exportBlob(this.state.exportType);
      if (!blob) {
        return;
      }

      const extension = this.state.exportType === "jpeg" ? "jpg" : "png";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ponytranslate-share-card.${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.updateStatus(`已开始下载 ${extension.toUpperCase()} 图片。`);
    }

    async handleCopy() {
      if (
        typeof ClipboardItem === "undefined" ||
        !navigator.clipboard ||
        typeof navigator.clipboard.write !== "function"
      ) {
        this.updateStatus("当前页面不支持复制图片，请直接下载。");
        return;
      }

      const blob = await this.exportBlob("png");
      if (!blob) {
        return;
      }

      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob,
          }),
        ]);
        this.updateStatus("图片已复制到剪贴板。");
      } catch (error) {
        this.updateStatus("复制失败，请改用下载。");
      }
    }

    async exportBlob(type) {
      if (this.state.busy) {
        return null;
      }

      this.state.busy = true;
      this.updateStatus("正在生成图片...");

      try {
        const canvas = await this.renderToCanvas();
        if (!canvas) {
          this.updateStatus("当前页面缺少 html2canvas，无法导出。");
          return null;
        }

        const mimeType = type === "jpeg" ? "image/jpeg" : "image/png";
        const quality = type === "jpeg" ? 0.92 : 1;

        const blob = await new Promise((resolve) => {
          canvas.toBlob(resolve, mimeType, quality);
        });

        if (!blob) {
          this.updateStatus("导出失败，请重试。");
          return null;
        }

        return blob;
      } catch (error) {
        this.updateStatus("生成失败，已降级为当前预览。");
        return null;
      } finally {
        this.state.busy = false;
      }
    }

    async renderToCanvas() {
      if (
        !this.preview ||
        !this.offscreen ||
        typeof globalScope.html2canvas !== "function"
      ) {
        return null;
      }

      await this.waitForFonts();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const sourceNode = this.preview.firstElementChild;
      if (!(sourceNode instanceof HTMLElement)) {
        return null;
      }

      this.offscreen.innerHTML = "";
      const clone = sourceNode.cloneNode(true);
      this.offscreen.appendChild(clone);

      try {
        return await globalScope.html2canvas(clone, {
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor: null,
          scale: Math.min(2, globalScope.devicePixelRatio || 1.6),
          imageTimeout: 2200,
          width: clone.offsetWidth,
          height: clone.offsetHeight,
        });
      } catch (error) {
        if (clone instanceof HTMLElement && this.state.backgroundImage) {
          clone.style.setProperty("--zdf-share-background", `${this.getPreset().texture}, ${this.getPreset().gradient}`);
          return globalScope.html2canvas(clone, {
            useCORS: true,
            allowTaint: false,
            logging: false,
            backgroundColor: null,
            scale: Math.min(2, globalScope.devicePixelRatio || 1.6),
            imageTimeout: 2200,
            width: clone.offsetWidth,
            height: clone.offsetHeight,
          });
        }
        throw error;
      } finally {
        this.offscreen.innerHTML = "";
      }
    }

    async waitForFonts() {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch (error) {
          return;
        }
      }
    }

    getPreset() {
      return PRESETS.find((item) => item.id === this.state.presetId) || PRESETS[0];
    }

    getDisplaySource(url) {
      try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      } catch (error) {
        return url || "";
      }
    }

    updateStatus(message) {
      if (this.status) {
        this.status.textContent = message;
      }
    }

    escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    escapeAttribute(value) {
      return String(value || "").replaceAll('"', "&quot;");
    }
  }

  globalScope.ZdfShareCardGenerator = ZdfShareCardGenerator;
})(window);
