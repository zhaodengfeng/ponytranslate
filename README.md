# 🐴 小马快译 · PonyTranslate

> 轻快双语阅读，马到成功

一个简洁优雅的浏览器扩展，让外文网页阅读变得轻松自然。支持双语对照、沉浸式翻译、选中文本分享卡片生成。

![Version](https://img.shields.io/badge/version-2.0.0-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ 功能特性

### 🔄 三种显示模式
- **覆盖模式** - 译文半透明覆盖在原文上方
- **双语对照** - 原文与译文并排显示
- **高亮提示** - 高亮原文，悬浮查看译文

### ⚡ 智能预加载
- Intersection Observer 监听可见段落
- 翻译队列管理（最多3个并发）
- 智能缓存，避免重复翻译
- 离开视口自动暂停

### 🎨 分享卡片
- 选中任意文字生成精美卡片
- 3种风格模板可选
- 自定义背景色/图片
- 一键下载或复制到剪贴板

### 🌍 多语言支持
- 简体中文
- English
- 日本语
- 한국어
- Français

---

## 📦 安装方法

### 开发者模式加载

1. 下载本仓库并解压
2. 打开 Chrome/Edge → `chrome://extensions`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择项目文件夹

### Chrome Web Store

（即将上架）

---

## 🚀 使用指南

### 基础翻译
1. 点击扩展图标，选择目标语言
2. 选择显示模式
3. 打开任意外文网页，自动翻译

### 划词翻译
1. 选中网页上的文字
2. 点击「翻译选中」按钮
3. 查看翻译结果

### 生成分享卡片
1. 选中喜欢的句子
2. 点击「生成卡片」按钮
3. 选择风格、调整样式
4. 下载或复制图片

---

## 🛠️ 技术栈

- **Manifest V3** - Chrome 扩展最新标准
- **原生 JavaScript (ES6+)** - 无框架依赖
- **Intersection Observer API** - 性能优化的可见性检测
- **Shadow DOM** - 样式隔离，避免页面冲突
- **html2canvas** - 客户端图片生成

---

## 📁 项目结构

```
ponytranslate/
├── manifest.json          # 扩展配置
├── popup.html/css/js      # 控制台界面
├── content.js/css         # 内容脚本
├── share-card.js/css      # 分享卡片功能
├── background.js          # 后台服务
├── lib/
│   └── html2canvas.min.js # 图片生成库
└── icons/                 # 扩展图标
```

---

## 📝 更新日志

### v2.0.0 (2026-03-03)
- 🎉 全新版本发布，代号「马年特别版」
- ✨ 新增分享卡片功能
- ⚡ 重构翻译引擎，支持 Shadow DOM 隔离
- 🎨 全新视觉设计
- 🔧 优化预加载性能

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License © 2026 Zhao Dengfeng

---

## 🐴 关于名字

**小马快译** — 马年吉祥，轻快灵动。愿你在阅读外文时如千里马般日行千里，语言障碍马到成功！
