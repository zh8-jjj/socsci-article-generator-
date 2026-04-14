# 🧠 认知升级引擎 (Cognitive Upgrade Engine)

[中文版](#-中文版) | [English](#-english)

---

## 🇨🇳 中文版

一个专为构建“第二大脑”和个人知识库（PKM）打造的自动化写作与提炼引擎。基于 Google Gemini API，采用极简、高级的文艺风 UI 设计，帮助你将深奥的理论转化为通俗易懂的认知脚手架。

### ✨ 核心特性

- **📚 批量文章生成**：输入多个标题，一键批量生成高质量的社科/哲学文章。
- **🎯 价值观对齐 (Global Context)**：注入你的核心价值观和背景知识，确保 AI 生成的所有内容调性统一，拒绝千篇一律的“AI 味”。
- **✂️ 长文/书籍提炼**：将冗长的读书笔记、网页摘录或原文片段，一键转化为结构化的认知卡片。
- **📦 纯净 Markdown 导出**：支持一键打包导出 ZIP，完美适配 Obsidian, Notion, Logseq, IMA 等主流双链笔记软件。
- **☁️ 多端云同步**：支持 Google 账号登录，基于 Firebase 实现数据云端实时同步；未登录状态下自动使用本地存储 (Local Storage) 防丢失。
- **🎨 极致 UI 体验**：石楠色调、衬线字体，专为文字工作者、学者和创作者打造的沉浸式无干扰环境。

### 🛠 技术栈

- **前端框架**: React 18 + Vite
- **UI 样式**: Tailwind CSS + Lucide Icons
- **AI 引擎**: Google Gemini API (`@google/genai`)
- **BaaS 服务**: Firebase (Authentication & Firestore)
- **文件处理**: JSZip + FileSaver.js

### 🚀 快速开始

#### 1. 克隆项目
```bash
git clone https://github.com/yourusername/socsci-article-generator.git
cd socsci-article-generator
```

#### 2. 安装依赖
```bash
npm install
```

#### 3. 配置环境变量
在根目录创建 `.env` 文件，并填入你的 Gemini API Key：
```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```
*(注：本项目在 AI Studio 环境中默认使用 `process.env.GEMINI_API_KEY`，本地部署时请根据你的构建工具调整为 `import.meta.env.VITE_GEMINI_API_KEY` 或相应配置)*

#### 4. 配置 Firebase (可选)
如果需要开启云端同步功能，请在 Firebase 控制台创建项目，启用 Firestore 和 Google Auth，并将配置填入 `src/firebase.ts` 或 `firebase-applet-config.json` 中。

#### 5. 运行项目
```bash
npm run dev
```

### 🤝 参与贡献
欢迎提交 Pull Request 或 Issue！如果你有更好的 Prompt 模板或 UI 改进建议，非常期待你的分享。

### 📄 开源协议
本项目采用 [MIT License](LICENSE) 开源协议。

---

## 🇬🇧 English

An automated writing and extraction engine designed for building a "Second Brain" and Personal Knowledge Management (PKM) systems. Powered by the Google Gemini API, it features a minimalist, high-end literary UI design to help you transform profound theories into accessible cognitive scaffolds.

### ✨ Key Features

- **📚 Batch Article Generation**: Input multiple titles and generate high-quality social science/philosophy articles in batches.
- **🎯 Values Alignment (Global Context)**: Inject your core values and background knowledge to ensure all AI-generated content maintains a consistent tone, avoiding the generic "AI flavor".
- **✂️ Book/Material Extraction**: Instantly transform lengthy reading notes, web excerpts, or original text snippets into structured cognitive cards.
- **📦 Pure Markdown Export**: One-click ZIP export, perfectly compatible with mainstream bi-directional linking note apps like Obsidian, Notion, Logseq, and IMA.
- **☁️ Cloud Sync**: Supports Google account login with real-time cloud data synchronization via Firebase. Automatically falls back to Local Storage when logged out to prevent data loss.
- **🎨 Premium UI Experience**: Heather tones and serif fonts create an immersive, distraction-free environment tailored for writers, scholars, and creators.

### 🛠 Tech Stack

- **Frontend**: React 18 + Vite
- **Styling**: Tailwind CSS + Lucide Icons
- **AI Engine**: Google Gemini API (`@google/genai`)
- **BaaS**: Firebase (Authentication & Firestore)
- **File Processing**: JSZip + FileSaver.js

### 🚀 Getting Started

#### 1. Clone the repository
```bash
git clone https://github.com/yourusername/socsci-article-generator.git
cd socsci-article-generator
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Configure Environment Variables
Create a `.env` file in the root directory and add your Gemini API Key:
```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

#### 4. Configure Firebase (Optional)
To enable cloud synchronization, create a project in the Firebase Console, enable Firestore and Google Auth, and add your configuration to `src/firebase.ts` or `firebase-applet-config.json`.

#### 5. Run the development server
```bash
npm run dev
```

### 📄 License
This project is licensed under the [MIT License](LICENSE).
