import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { 
  BookOpen, 
  FileText, 
  Download, 
  Play, 
  CheckCircle2, 
  Loader2, 
  Settings,
  Trash2,
  AlertCircle,
  Database,
  BrainCircuit,
  Zap,
  Brain,
  RotateCcw,
  Cloud,
  CloudOff,
  LogOut,
  LogIn
} from 'lucide-react';
import Markdown from 'react-markdown';
import { auth, db, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId || undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helper for timeout to prevent infinite hanging
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`请求超时（超过 ${ms / 1000} 秒未响应）。大模型可能处于拥堵状态，请稍后再试。`)), ms);
    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

type Tab = 'batch-article' | 'book-extract';
type ModelType = 'flash' | 'pro';

interface GeneratedContent {
  id: string;
  title: string;
  content: string;
  status: 'pending' | 'generating' | 'completed' | 'error' | 'cancelled';
  detail?: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是一个精通社会科学与哲学的资深学者，擅长将深奥的理论转化为普通人能听懂的“认知升级”脚手架。
请严格按照以下标准撰写文章，确保排版完美，可直接导入知识库：

1. 【通俗易懂】：目标读者是想要提高认知的普通人。禁止堆砌学术黑话，必须用生活中的常见现象、历史故事或通俗比喻来解释抽象的哲学/社科概念。
2. 【结构严谨（严格的 Markdown 排版）】：
   - 必须包含引言（痛点或现象引入）
   - 核心概念解析（使用 H2 ## 标题）
   - 经典思想家/理论溯源（使用引用块 > ）
   - 现实生活中的投射与应用（使用 H3 ### 标题和无序列表 - ）
   - 认知升级总结（加粗重点 ** **）
3. 【拒绝AI味与乱码】：语言要像智者交谈般自然、有温度。绝对不要输出任何 HTML 标签、特殊乱码字符或无关的过渡废话（如“好的，这是您的文章”）。只输出纯净的 Markdown 正文。
4. 【客观严密】：保持社科与哲学的严谨性，不传播伪科学或毒鸡汤，启发读者独立思考。`;

const DEFAULT_EXTRACT_PROMPT = '请提炼以下社会科学/哲学书籍资料的核心精华，输出为适合普通人阅读的认知卡片：\n1. 核心思想（一句话总结）\n2. 3-5个关键知识点（用通俗语言解释）\n3. 现实生活中的启示\n请严格使用纯净的 Markdown 格式，不要有乱码。';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('batch-article');
  const [modelType, setModelType] = useState<ModelType>('flash');
  const cancelRef = useRef(false);
  
  // Batch Article State
  const [topicsInput, setTopicsInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem('kb_systemPrompt') || DEFAULT_SYSTEM_PROMPT);
  const [globalContext, setGlobalContext] = useState(() => localStorage.getItem('kb_globalContext') || '');
  const [articles, setArticles] = useState<GeneratedContent[]>(() => {
    try { return JSON.parse(localStorage.getItem('kb_articles') || '[]'); } catch { return []; }
  });
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Book Extract State
  const [bookMaterial, setBookMaterial] = useState('');
  const [extractPrompt, setExtractPrompt] = useState(() => localStorage.getItem('kb_extractPrompt') || DEFAULT_EXTRACT_PROMPT);
  const [extractedContent, setExtractedContent] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  // Auth & Cloud State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Auto-save prompts and articles to localStorage (fallback)
  useEffect(() => { localStorage.setItem('kb_systemPrompt', systemPrompt); }, [systemPrompt]);
  useEffect(() => { localStorage.setItem('kb_globalContext', globalContext); }, [globalContext]);
  useEffect(() => { localStorage.setItem('kb_extractPrompt', extractPrompt); }, [extractPrompt]);
  useEffect(() => { 
    if (!user) { // Only save to local storage if not logged in
      localStorage.setItem('kb_articles', JSON.stringify(articles)); 
    }
  }, [articles, user]);

  // Handle Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        // Ensure user document exists
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            createdAt: new Date().toISOString()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle Cloud Sync (Load Articles)
  useEffect(() => {
    if (!isAuthReady) return;

    if (user) {
      setIsSyncing(true);
      const articlesRef = collection(db, 'users', user.uid, 'articles');
      const unsubscribe = onSnapshot(articlesRef, (snapshot) => {
        const cloudArticles: GeneratedContent[] = [];
        snapshot.forEach((doc) => {
          cloudArticles.push(doc.data() as GeneratedContent);
        });
        // Sort by createdAt descending
        cloudArticles.sort((a, b) => ((b as any).createdAt || 0) - ((a as any).createdAt || 0));
        setArticles(cloudArticles);
        setIsSyncing(false);
      }, (error) => {
        setIsSyncing(false);
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/articles`);
      });
      return () => unsubscribe();
    } else {
      // Load from local storage if logged out
      try { 
        const local = JSON.parse(localStorage.getItem('kb_articles') || '[]'); 
        setArticles(local);
      } catch { 
        setArticles([]); 
      }
    }
  }, [user, isAuthReady]);

  // Sync individual article changes to cloud
  const syncArticleToCloud = async (article: GeneratedContent) => {
    if (!user) return;
    try {
      const articleRef = doc(db, 'users', user.uid, 'articles', article.id);
      await setDoc(articleRef, {
        ...article,
        createdAt: (article as any).createdAt || Date.now()
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/articles/${article.id}`);
    }
  };

  const deleteArticleFromCloud = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'articles', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/articles/${id}`);
    }
  };

  const resetSystemPrompt = () => setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
  const resetExtractPrompt = () => setExtractPrompt(DEFAULT_EXTRACT_PROMPT);

  // Handle Batch Generation
  const handleGenerateBatch = async () => {
    const topics = topicsInput.split('\n').map(t => t.trim()).filter(t => t.length > 0);
    if (topics.length === 0) return;

    const newArticles: GeneratedContent[] = topics.map(topic => ({
      id: Math.random().toString(36).substring(7),
      title: topic,
      content: '',
      status: 'pending'
    }));

    // Append to existing articles instead of replacing
    setArticles(prev => [...newArticles, ...prev]);
    setIsGeneratingBatch(true);
    setProgress({ current: 0, total: newArticles.length });
    setTopicsInput(''); // Clear input after starting
    cancelRef.current = false;

    const modelName = modelType === 'flash' ? 'gemini-3-flash-preview' : 'gemini-3.1-pro-preview';

    for (let i = 0; i < newArticles.length; i++) {
      if (cancelRef.current) {
        setArticles(prev => prev.map(a => (a.status === 'pending' || a.status === 'generating') ? { ...a, status: 'cancelled', content: '已手动取消生成。' } : a));
        break;
      }

      const article = newArticles[i];
      
      setArticles(prev => prev.map(a => a.id === article.id ? { ...a, status: 'generating', detail: '准备中...' } : a));

      // Delay between requests (longer for Pro to respect 2 RPM limit)
      if (i > 0) {
        const delaySeconds = modelType === 'pro' ? 32 : 2;
        for(let w = 0; w < delaySeconds; w++) {
           if (cancelRef.current) break;
           setArticles(prev => prev.map(a => a.id === article.id ? { ...a, detail: `等待 API 冷却 (${delaySeconds - w}s)...` } : a));
           await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (cancelRef.current) {
        setArticles(prev => prev.map(a => (a.status === 'pending' || a.status === 'generating') ? { ...a, status: 'cancelled', content: '已手动取消生成。' } : a));
        break;
      }

      try {
        let promptContent = `请撰写文章，标题为：《${article.title}》`;
        if (globalContext.trim()) {
          promptContent += `\n\n【全局背景知识/核心价值观】（请在写作中贯彻以下理念并参考这些信息）：\n${globalContext}`;
        }

        const timeoutMs = modelType === 'flash' ? 60000 : 150000; // 60s for flash, 150s for pro
        
        let response;
        let lastError;
        // Retry logic up to 2 times to prevent infinite hanging
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (cancelRef.current) break;
          setArticles(prev => prev.map(a => a.id === article.id ? { ...a, detail: attempt > 1 ? `第 ${attempt}/2 次尝试重试中...` : '深度思考中...' } : a));
          
          try {
            // Initialize AI client INSIDE the loop to prevent stale connections
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            response = await withTimeout(ai.models.generateContent({
              model: modelName,
              contents: promptContent,
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.6,
              }
            }), timeoutMs);
            break; // Success
          } catch (err: any) {
            lastError = err;
            if (attempt < 2 && !cancelRef.current) {
              console.log(`Attempt ${attempt} failed, retrying in 5s...`, err);
              setArticles(prev => prev.map(a => a.id === article.id ? { ...a, detail: `尝试失败，5秒后重试...` } : a));
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }
        
        if (cancelRef.current) {
           setArticles(prev => prev.map(a => (a.status === 'pending' || a.status === 'generating') ? { ...a, status: 'cancelled', content: '已手动取消生成。' } : a));
           break;
        }
        if (!response) throw lastError;

        const content = response.text || '生成失败，未返回内容。';
        
        const completedArticle = { ...article, content, status: 'completed' as const, detail: undefined, createdAt: Date.now() };
        setArticles(prev => prev.map(a => a.id === article.id ? completedArticle : a));
        if (user) await syncArticleToCloud(completedArticle);
      } catch (error: any) {
        console.error("Generation error:", error);
        const errMsg = error?.message || '生成过程中发生未知错误，可能是网络超时或触发了安全限制。';
        const errorArticle = { ...article, status: 'error' as const, content: `**生成失败**：\n\n${errMsg}`, detail: undefined, createdAt: Date.now() };
        setArticles(prev => prev.map(a => a.id === article.id ? errorArticle : a));
        if (user) await syncArticleToCloud(errorArticle);
      }
      
      setProgress(prev => ({ ...prev, current: i + 1 }));
    }

    setIsGeneratingBatch(false);
  };

  const handleCancel = () => {
    cancelRef.current = true;
    setIsGeneratingBatch(false);
  };

  // Handle Book Extraction
  const handleExtract = async () => {
    if (!bookMaterial.trim()) return;
    
    setIsExtracting(true);
    setExtractedContent('');

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const modelName = modelType === 'flash' ? 'gemini-3-flash-preview' : 'gemini-3.1-pro-preview';

    try {
      const timeoutMs = modelType === 'flash' ? 60000 : 150000;
      const response = await withTimeout(ai.models.generateContent({
        model: modelName,
        contents: `资料内容：\n${bookMaterial}`,
        config: {
          systemInstruction: extractPrompt,
          temperature: 0.4, 
        }
      }), timeoutMs);

      setExtractedContent(response.text || '提取失败。');
    } catch (error: any) {
      console.error("Extraction error:", error);
      const errMsg = error?.message || '提取过程中发生未知错误。';
      setExtractedContent(`**提取失败**：\n\n${errMsg}`);
    } finally {
      setIsExtracting(false);
    }
  };

  // Export to ZIP
  const exportToZip = async () => {
    const zip = new JSZip();
    
    const completedArticles = articles.filter(a => a.status === 'completed');
    if (completedArticles.length > 0) {
      const articleFolder = zip.folder("认知升级知识库");
      completedArticles.forEach(article => {
        const safeTitle = article.title.replace(/[/\\?%*:|"<>]/g, '-');
        let finalContent = article.content;
        if (!finalContent.trim().startsWith('#')) {
          finalContent = `# ${article.title}\n\n${finalContent}`;
        }
        articleFolder?.file(`${safeTitle}.md`, finalContent);
      });
    }

    if (extractedContent) {
      zip.file("书籍资料提炼.md", extractedContent);
    }

    if (Object.keys(zip.files).length === 0) {
      alert("没有可导出的内容。");
      return;
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "IMA导入包_认知升级知识库.zip");
  };

  // Export Single Article
  const exportSingleArticle = (article: GeneratedContent) => {
    let finalContent = article.content;
    if (!finalContent.trim().startsWith('#')) {
      finalContent = `# ${article.title}\n\n${finalContent}`;
    }
    const blob = new Blob([finalContent], { type: 'text/markdown;charset=utf-8' });
    const safeTitle = article.title.replace(/[/\\?%*:|"<>]/g, '-');
    saveAs(blob, `${safeTitle}.md`);
  };

  const handleDeleteArticle = async (id: string) => {
    if (window.confirm('确定要删除这篇文章吗？')) {
      if (user) {
        await deleteArticleFromCloud(id);
      }
      setArticles(prev => prev.filter(a => a.id !== id));
    }
  };

  const clearArticles = async () => {
    if (window.confirm('确定要清空所有生成的文章吗？')) {
      if (user) {
        for (const article of articles) {
          await deleteArticleFromCloud(article.id);
        }
      }
      setArticles([]);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCF8] flex flex-col md:flex-row font-sans">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-[#F9F8F6] text-stone-800 border-r border-stone-200 flex flex-col shrink-0">
        <div className="p-6">
          <h1 className="text-xl font-serif font-bold flex items-center gap-2 text-stone-900">
            <BrainCircuit className="w-5 h-5 text-stone-700" />
            认知升级引擎
          </h1>
          <p className="text-stone-500 text-xs mt-2 font-serif italic">社科哲学知识库自动化构建</p>
        </div>
        
        <nav className="px-4 space-y-2 shrink-0">
          <button
            onClick={() => setActiveTab('batch-article')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
              activeTab === 'batch-article' ? 'bg-stone-800 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-200/50'
            }`}
          >
            <FileText className="w-4 h-4" />
            批量文章生成
          </button>
          <button
            onClick={() => setActiveTab('book-extract')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
              activeTab === 'book-extract' ? 'bg-stone-800 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-200/50'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            书籍资料提炼
          </button>
        </nav>

        {/* Sidebar Section for Saved Articles */}
        <div className="flex-1 overflow-y-auto mt-6 px-4 shrink-0">
          <div className="text-xs font-serif font-semibold text-stone-400 mb-3 px-2 uppercase tracking-widest flex justify-between items-center">
            <span>已入库文章 ({articles.filter(a => a.status === 'completed').length})</span>
          </div>
          <div className="space-y-1 pb-4">
            {articles.filter(a => a.status === 'completed').map(a => (
              <div 
                key={a.id} 
                className="w-full flex items-center justify-between group text-xs text-stone-600 px-3 py-2.5 bg-white/50 hover:bg-white rounded-md border border-transparent hover:border-stone-200 transition-all shadow-sm hover:shadow" 
              >
                <span 
                  className="truncate pr-2 font-serif cursor-pointer flex-1" 
                  onClick={() => exportSingleArticle(a)} 
                  title={`点击下载单篇：${a.title}`}
                >
                  {a.title}
                </span>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => exportSingleArticle(a)} className="text-stone-400 hover:text-stone-800" title="下载">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteArticle(a.id)} className="text-stone-400 hover:text-red-600" title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {articles.filter(a => a.status === 'completed').length === 0 && (
              <div className="text-xs text-stone-400 px-2 py-2 font-serif italic">暂无已完成文章</div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-stone-200 shrink-0">
          {/* Auth UI */}
          {isAuthReady && (
            <div className="mb-4 bg-white rounded-lg p-3 border border-stone-200 shadow-sm">
              {user ? (
                <div className="flex flex-col space-y-3">
                  <div className="flex items-center space-x-3">
                    <img src={user.photoURL || ''} alt="avatar" className="w-8 h-8 rounded-full border border-stone-200" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{user.displayName}</p>
                      <div className="flex items-center text-xs text-stone-500">
                        {isSyncing ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin text-stone-400" />
                        ) : (
                          <Cloud className="w-3 h-3 mr-1 text-stone-400" />
                        )}
                        <span>{isSyncing ? '同步中...' : '云端同步已开启'}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={logout}
                    className="w-full flex items-center justify-center gap-2 bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-2 rounded-md text-xs font-medium transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </div>
              ) : (
                <div className="flex flex-col space-y-2">
                  <p className="text-xs text-stone-500 text-center font-serif">登录以开启多端云同步</p>
                  <button 
                    onClick={loginWithGoogle}
                    className="w-full flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 text-white px-3 py-2 rounded-md text-sm font-medium transition-colors shadow-sm"
                  >
                    <LogIn className="w-4 h-4" />
                    Google 账号登录
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={exportToZip}
            className="w-full flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 text-white px-4 py-3 rounded-lg font-medium transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            导出 IMA 兼容包
          </button>
          <p className="text-xs text-stone-400 mt-3 text-center font-serif italic">
            导出为纯净 Markdown 压缩包
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-hidden flex flex-col">
        {activeTab === 'batch-article' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <header className="bg-white border-b border-stone-100 px-8 py-6 shrink-0 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-serif font-bold text-stone-800">批量文章生成 <span className="text-xs font-sans font-normal text-stone-500 bg-stone-100 px-2 py-1 rounded ml-2 border border-stone-200">社科哲学专版</span></h2>
                <p className="text-stone-500 text-sm mt-2 font-serif italic">将深奥的理论转化为普通人能听懂的“认知升级”脚手架。</p>
              </div>
              
              {/* Model Selection Toggle */}
              <div className="flex bg-stone-50 p-1 rounded-lg border border-stone-200">
                <button
                  onClick={() => setModelType('flash')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    modelType === 'flash' ? 'bg-white text-stone-800 shadow-sm border border-stone-200/50' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  闪电极速版
                </button>
                <button
                  onClick={() => setModelType('pro')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    modelType === 'pro' ? 'bg-white text-amber-700 shadow-sm border border-stone-200/50' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  <Brain className="w-4 h-4" />
                  深度思考版
                </button>
              </div>
            </header>
            
            {modelType === 'pro' && (
              <div className="bg-amber-50/50 border-b border-amber-100 px-8 py-3 flex items-start gap-3 shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900 font-serif">
                  <strong>深度思考版 (Pro) 提示：</strong> 该模型推理能力极强，但生成速度较慢（单篇约 30-60 秒）。
                  <br />
                  <span className="text-amber-700">⚠️ 免费版 API 限制 Pro 模型 <strong>每分钟仅能请求 2 次</strong>。如需批量生成，请每次仅输入 1-2 个标题，否则会报错失败。</span>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-8 flex flex-col lg:flex-row gap-8">
              {/* Left Column: Inputs */}
              <div className="w-full lg:w-1/3 flex flex-col gap-6 shrink-0">
                
                {/* System Prompt */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100">
                  <label className="flex items-center justify-between text-sm font-serif font-semibold text-stone-800 mb-3">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-stone-400" />
                      质量控制规则 (System Prompt)
                    </div>
                    <button onClick={resetSystemPrompt} className="text-xs font-sans text-stone-400 hover:text-stone-800 flex items-center gap-1 transition-colors">
                      <RotateCcw className="w-3 h-3" /> 恢复默认
                    </button>
                  </label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="w-full h-40 p-4 text-xs text-stone-600 border border-stone-200 rounded-lg focus:ring-1 focus:ring-stone-400 focus:border-stone-400 outline-none resize-none bg-stone-50/50 leading-relaxed"
                    placeholder="定义 AI 写作的角色和文章结构..."
                  />
                </div>

                {/* Global Context */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100">
                  <label className="flex items-center justify-between text-sm font-serif font-semibold text-stone-800 mb-2">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-stone-400" />
                      全局背景知识 (强烈建议)
                    </div>
                    <span className="text-xs font-sans text-stone-400">已自动保存</span>
                  </label>
                  <p className="text-xs text-stone-500 mb-4 font-serif italic">输入你的核心价值观。AI 会在写每篇文章时参考这些信息，确保调性统一。</p>
                  <textarea
                    value={globalContext}
                    onChange={(e) => setGlobalContext(e.target.value)}
                    className="w-full h-24 p-4 text-sm text-stone-700 border border-stone-200 rounded-lg focus:ring-1 focus:ring-stone-400 focus:border-stone-400 outline-none resize-none bg-stone-50/50 leading-relaxed"
                    placeholder="例如：本知识库旨在帮助普通人打破信息茧房。解释概念时，多用《乌合之众》或《第一性原理》的视角，强调独立思考的重要性..."
                  />
                </div>

                {/* Topics */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100 flex-1 flex flex-col min-h-[250px]">
                  <label className="flex items-center justify-between text-sm font-serif font-semibold text-stone-800 mb-3">
                    <span>输入文章标题 (每行一个)</span>
                    <span className="text-xs font-sans font-normal text-stone-500 bg-stone-50 px-2 py-1 rounded border border-stone-100">
                      {topicsInput.split('\n').filter(t => t.trim().length > 0).length} 个标题
                    </span>
                  </label>
                  <textarea
                    value={topicsInput}
                    onChange={(e) => setTopicsInput(e.target.value)}
                    className="w-full flex-1 p-4 text-sm text-stone-700 border border-stone-200 rounded-lg focus:ring-1 focus:ring-stone-400 focus:border-stone-400 outline-none resize-none bg-stone-50/50 leading-relaxed"
                    placeholder="例如：&#10;什么是“幸存者偏差”？它如何影响我们的投资决策？&#10;从斯多葛学派看现代人的精神内耗&#10;消费主义陷阱：鲍德里亚的《消费社会》通俗解读"
                  />
                  
                  {/* Progress Bar */}
                  {isGeneratingBatch && progress.total > 0 && (
                    <div className="mt-5 p-4 bg-stone-50 rounded-lg border border-stone-200">
                      <div className="flex justify-between text-xs font-medium text-stone-700 mb-2 font-sans">
                        <span>生成进度</span>
                        <span>{progress.current} / {progress.total} ({Math.round((progress.current / progress.total) * 100)}%)</span>
                      </div>
                      <div className="w-full bg-stone-200 rounded-full h-1.5">
                        <div 
                          className="bg-stone-800 h-1.5 rounded-full transition-all duration-300" 
                          style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex gap-3">
                    <button
                      onClick={handleGenerateBatch}
                      disabled={isGeneratingBatch || topicsInput.trim() === ''}
                      className="flex-1 flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg font-medium transition-colors shadow-sm"
                    >
                      {isGeneratingBatch ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> 正在高质量生成...</>
                      ) : (
                        <><Play className="w-5 h-5" /> 开始批量生成</>
                      )}
                    </button>
                    {isGeneratingBatch && (
                      <button
                        onClick={handleCancel}
                        className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-3 rounded-lg font-medium transition-colors shadow-sm shrink-0"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Results */}
              <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-sm border border-stone-100 flex flex-col overflow-hidden">
                <div className="px-8 py-5 border-b border-stone-100 flex justify-between items-center bg-[#FDFCF8] shrink-0">
                  <h3 className="font-serif font-semibold text-stone-800">生成进度与结果</h3>
                  {articles.length > 0 && (
                    <button 
                      onClick={clearArticles}
                      className="text-sm font-sans text-stone-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" /> 清空列表
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-auto p-8 bg-[#FDFCF8]/50">
                  {articles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-stone-300">
                      <FileText className="w-16 h-16 mb-4 text-stone-200" />
                      <p className="font-serif">在左侧输入标题并点击开始生成</p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {articles.map((article) => (
                        <div key={article.id} className="bg-white border border-stone-100 rounded-xl shadow-sm overflow-hidden">
                          <div className="px-6 py-5 bg-white flex items-center justify-between border-b border-stone-100">
                            <h4 className="font-serif font-bold text-stone-800 text-lg truncate pr-4">{article.title}</h4>
                            <div className="shrink-0 flex items-center gap-3">
                              {article.status === 'pending' && <span className="text-xs text-stone-500 bg-stone-50 px-3 py-1.5 rounded-full font-medium border border-stone-200">等待中</span>}
                              {article.status === 'generating' && <span className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-amber-200"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {article.detail || '撰写中'}</span>}
                              {article.status === 'completed' && <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-emerald-200"><CheckCircle2 className="w-3.5 h-3.5" /> 已完成</span>}
                              {article.status === 'error' && <span className="text-xs text-red-700 bg-red-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-red-200"><AlertCircle className="w-3.5 h-3.5" /> 失败</span>}
                              {article.status === 'cancelled' && <span className="text-xs text-stone-500 bg-stone-100 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-stone-200">已取消</span>}
                              
                              {article.status === 'completed' && (
                                <button 
                                  onClick={() => exportSingleArticle(article)}
                                  className="text-stone-400 hover:text-stone-800 transition-colors ml-2"
                                  title="下载 Markdown"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                          {article.content && (
                            <div className="p-8 bg-white max-h-[500px] overflow-y-auto prose prose-stone prose-sm max-w-none prose-headings:font-serif prose-a:text-stone-800 prose-blockquote:border-l-stone-300 prose-blockquote:text-stone-500 prose-blockquote:font-serif">
                              <div className="markdown-body">
                                <Markdown>{article.content}</Markdown>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'book-extract' && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <header className="bg-white border-b border-stone-100 px-8 py-6 shrink-0 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-serif font-bold text-stone-800">书籍资料提炼</h2>
                <p className="text-stone-500 text-sm mt-2 font-serif italic">将冗长的读书笔记、网页摘录或原文片段，一键转化为结构化的知识卡片。</p>
              </div>
              
              {/* Model Selection Toggle */}
              <div className="flex bg-stone-50 p-1 rounded-lg border border-stone-200">
                <button
                  onClick={() => setModelType('flash')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    modelType === 'flash' ? 'bg-white text-stone-800 shadow-sm border border-stone-200/50' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  闪电极速版
                </button>
                <button
                  onClick={() => setModelType('pro')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    modelType === 'pro' ? 'bg-white text-amber-700 shadow-sm border border-stone-200/50' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  <Brain className="w-4 h-4" />
                  深度思考版
                </button>
              </div>
            </header>
            
            {modelType === 'pro' && (
              <div className="bg-amber-50/50 border-b border-amber-100 px-8 py-3 flex items-start gap-3 shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900 font-serif">
                  <strong>深度思考版 (Pro) 提示：</strong> 该模型推理能力极强，但生成速度较慢。
                  <br />
                  <span className="text-amber-700">⚠️ 免费版 API 限制 Pro 模型 <strong>每分钟仅能请求 2 次</strong>。请耐心等待，如果报错请稍后再试。</span>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-8 flex flex-col lg:flex-row gap-8">
              {/* Left Column: Inputs */}
              <div className="w-full lg:w-1/2 flex flex-col gap-6 shrink-0">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100">
                  <label className="flex items-center justify-between text-sm font-serif font-semibold text-stone-800 mb-3">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-stone-400" />
                      提炼规则 (System Prompt)
                    </div>
                    <button onClick={resetExtractPrompt} className="text-xs font-sans text-stone-400 hover:text-stone-800 flex items-center gap-1 transition-colors">
                      <RotateCcw className="w-3 h-3" /> 恢复默认
                    </button>
                  </label>
                  <textarea
                    value={extractPrompt}
                    onChange={(e) => setExtractPrompt(e.target.value)}
                    className="w-full h-24 p-4 text-sm text-stone-700 border border-stone-200 rounded-lg focus:ring-1 focus:ring-stone-400 focus:border-stone-400 outline-none resize-none bg-stone-50/50 leading-relaxed"
                  />
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-100 flex-1 flex flex-col">
                  <label className="text-sm font-serif font-semibold text-stone-800 mb-3">
                    粘贴原始资料内容
                  </label>
                  <textarea
                    value={bookMaterial}
                    onChange={(e) => setBookMaterial(e.target.value)}
                    className="w-full flex-1 min-h-[300px] p-4 text-sm text-stone-700 border border-stone-200 rounded-lg focus:ring-1 focus:ring-stone-400 focus:border-stone-400 outline-none resize-none bg-stone-50/50 leading-relaxed"
                    placeholder="在此粘贴《乌合之众》、《自私的基因》等书籍原文、长篇笔记或网页摘录..."
                  />
                  <button
                    onClick={handleExtract}
                    disabled={isExtracting || bookMaterial.trim() === ''}
                    className="mt-5 w-full flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg font-medium transition-colors shadow-sm"
                  >
                    {isExtracting ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> 正在深度提炼...</>
                    ) : (
                      <><Play className="w-5 h-5" /> 开始提炼知识点</>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Column: Results */}
              <div className="w-full lg:w-1/2 bg-white rounded-xl shadow-sm border border-stone-100 flex flex-col overflow-hidden">
                <div className="px-8 py-5 border-b border-stone-100 bg-[#FDFCF8] shrink-0">
                  <h3 className="font-serif font-semibold text-stone-800">提炼结果 (Markdown)</h3>
                </div>
                
                <div className="flex-1 overflow-auto p-8 bg-[#FDFCF8]/50">
                  {extractedContent ? (
                    <div className="prose prose-stone prose-sm max-w-none prose-headings:font-serif prose-a:text-stone-800 prose-blockquote:border-l-stone-300 prose-blockquote:text-stone-500 prose-blockquote:font-serif">
                      <div className="markdown-body">
                        <Markdown>{extractedContent}</Markdown>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-stone-300">
                      <BookOpen className="w-16 h-16 mb-4 text-stone-200" />
                      <p className="font-serif">提炼后的结构化知识将显示在这里</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
