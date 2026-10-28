"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, ChevronDown, Database, ExternalLink, LoaderCircle, LockKeyhole, LogIn, RefreshCw, Send, ShieldCheck, SlidersHorizontal, Trash2, UserRound, X } from "lucide-react";
import styles from "./AgentWorkspace.module.css";
import { AGENT_CONVERSATION_STORAGE_KEY, readStoredAgentConversation, serializeAgentConversation } from "../lib/agentConversation";

const DATASETS = [
  { key: "market_overview", label: "市场概览", detail: "涨跌家数、中位数、快照状态" },
  { key: "mainline_rankings", label: "主线排名", detail: "综合排名前 15 个方向" },
  { key: "sector_details", label: "板块明细", detail: "所选板块的分项与核心股" },
  { key: "limit_up_stocks", label: "涨停池", detail: "当日涨停股票与成交额" },
  { key: "selected_stocks", label: "指定个股", detail: "行情、产业归属与产品标签" },
];

function errorMessage(payload, fallback) {
  return payload?.error?.message || payload?.error || payload?.detail || fallback;
}

function parseEventFrames(buffer) {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
  return { frames: frames.slice(0, -1), rest: frames.at(-1) || "" };
}

export default function AgentPage({ embedded = false, initialDate = "", onClose = null }) {
  const [session, setSession] = useState({ loading: true, authenticated: false });
  const [catalog, setCatalog] = useState({ dates: [], sectors: [], selected_date: "" });
  const [date, setDate] = useState("");
  const [datasets, setDatasets] = useState(["market_overview", "mainline_rankings"]);
  const [sectors, setSectors] = useState([]);
  const [stockCodes, setStockCodes] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const messagesViewportRef = useRef(null);
  const storageWarningRef = useRef(false);
  const latestMessagesRef = useRef([]);
  const conversationLoadedRef = useRef(false);

  const selection = useMemo(() => ({
    date,
    datasets,
    sectors,
    stock_codes: stockCodes.split(/[\s,，;；]+/).filter(Boolean),
  }), [date, datasets, sectors, stockCodes]);

  async function loadSession() {
    const response = await fetch("/api/agent/session", { cache: "no-store" });
    const payload = await response.json();
    setSession({ ...payload, loading: false });
    if (payload.error) setError(payload.error);
    return payload;
  }

  async function loadCatalog(nextDate = "") {
    const query = nextDate ? `?date=${encodeURIComponent(nextDate)}` : "";
    const response = await fetch(`/api/agent/catalog${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "无法读取数据目录"));
    setCatalog(payload);
    if (payload.selected_date) setDate((current) => current || payload.selected_date);
    setSectors((current) => current.filter((key) => payload.sectors.some((sector) => sector.key === key)));
  }

  async function loadModels() {
    const response = await fetch("/api/agent/models", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "无法读取模型列表"));
    setModels(payload.models || []);
    setModel((current) => current || payload.models?.[0]?.id || "");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") setNotice("ChatGPT 已连接，可以使用你的套餐进行研判。");
    if (params.get("auth") === "error") setError(params.get("message") || "ChatGPT 登录失败");
    if (params.has("auth")) window.history.replaceState({}, "", window.location.pathname);
    Promise.all([loadSession(), loadCatalog(initialDate)]).then(([currentSession]) => {
      if (currentSession.authenticated && currentSession.plan_usage_enabled) loadModels().catch((reason) => setError(reason.message));
    }).catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    try {
      const restored = readStoredAgentConversation(window.localStorage.getItem(AGENT_CONVERSATION_STORAGE_KEY));
      if (restored.length) setMessages(restored);
    } catch {
      setError("无法读取本机保存的对话；请检查浏览器隐私设置。");
    } finally {
      setConversationLoaded(true);
    }
  }, []);

  useEffect(() => {
    latestMessagesRef.current = messages;
    conversationLoadedRef.current = conversationLoaded;
    if (!conversationLoaded) return undefined;
    const saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(AGENT_CONVERSATION_STORAGE_KEY, serializeAgentConversation(messages));
        storageWarningRef.current = false;
      } catch {
        if (!storageWarningRef.current) {
          storageWarningRef.current = true;
          setError("对话已保留在当前窗口，但写入本机浏览器失败；请检查浏览器存储空间或隐私设置。");
        }
      }
    }, 250);
    return () => window.clearTimeout(saveTimer);
  }, [conversationLoaded, messages]);

  useEffect(() => () => {
    if (!conversationLoadedRef.current) return;
    try {
      window.localStorage.setItem(AGENT_CONVERSATION_STORAGE_KEY, serializeAgentConversation(latestMessagesRef.current));
    } catch {
      // The visible storage warning is handled while the component is mounted.
    }
  }, []);

  useEffect(() => {
    if (!embedded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [embedded, onClose]);

  useEffect(() => {
    if (!date) return;
    loadCatalog(date).catch((reason) => setError(reason.message));
    setPreview(null);
  }, [date]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return undefined;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy, session.loading]);

  function clearConversation() {
    if (busy || !messages.length) return;
    if (!window.confirm("确定清空本机保存的 GPT 研判对话吗？此操作无法撤销。")) return;
    setMessages([]);
    setNotice("本机保存的研判对话已清空。");
  }

  function toggleDataset(key) {
    setDatasets((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    setPreview(null);
  }

  function toggleSector(key) {
    setSectors((current) => current.includes(key) ? current.filter((item) => item !== key) : current.length < 5 ? [...current, key] : current);
    setPreview(null);
  }

  async function connect() {
    setError("");
    const response = await fetch("/api/agent/auth/start", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) return setError(errorMessage(payload, "无法开始 ChatGPT 登录"));
    window.location.assign(payload.authorization_url);
  }

  async function previewData() {
    setPreviewing(true);
    setError("");
    try {
      const response = await fetch("/api/agent/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "数据预览失败"));
      setPreview(payload);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function ask() {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || busy) return;
    if (!session.authenticated || !session.plan_usage_enabled) return setError("请先连接可使用套餐的 ChatGPT 账号");
    if (!model) return setError("当前账号没有返回可用模型，请重新连接后再试");
    setBusy(true);
    setError("");
    setQuestion("");
    const history = messages.map(({ role, content }) => ({ role, content }));
    const nextMessages = [...messages, { role: "user", content: cleanQuestion }, { role: "assistant", content: "" }];
    setMessages(nextMessages);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, question: cleanQuestion, history, selection }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(errorMessage(payload, `研判请求失败：HTTP ${response.status}`));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let answer = "";
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const parsed = parseEventFrames(pending);
        pending = parsed.rest;
        for (const frame of parsed.frames) {
          const eventName = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = frame.split("\n").filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim()).join("\n");
          if (!data) continue;
          const payload = JSON.parse(data);
          if (eventName === "delta") {
            answer += payload.delta || "";
            setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: answer } : message));
          }
          if (eventName === "error") throw new Error(payload.message || "模型流式回答失败");
        }
        if (done) break;
      }
    } catch (reason) {
      setError(reason.message);
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === "assistant" && !message.content)));
    } finally {
      setBusy(false);
    }
  }

  function handleQuestionKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }

  return (
    <main className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
      <aside className={styles.evidenceRail}>
        <header className={styles.railHeader}>
          {!embedded && <a href="/" className={styles.backLink}><ArrowLeft size={16} /> 返回分类库</a>}
          <div className={styles.productMark}><Bot size={22} /><span>量化研判助手</span></div>
          <p>你决定交给 GPT 哪些数据。系统算法提供事实，模型负责综合解释。</p>
        </header>

        <section className={styles.controlSection}>
          <label className={styles.fieldLabel} htmlFor="agent-date">分析日期</label>
          <select id="agent-date" value={date} onChange={(event) => setDate(event.target.value)} disabled={!catalog.dates.length}>
            {!catalog.dates.length && <option value="">暂无主线快照</option>}
            {catalog.dates.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </section>

        <section className={styles.controlSection}>
          <div className={styles.sectionTitle}><span>选择证据</span><small>{datasets.length} 项</small></div>
          <div className={styles.datasetList}>
            {DATASETS.map((item) => {
              const selected = datasets.includes(item.key);
              return (
                <button type="button" key={item.key} className={selected ? styles.datasetSelected : ""} onClick={() => toggleDataset(item.key)} aria-pressed={selected}>
                  <span className={styles.checkBox}>{selected && <Check size={13} />}</span>
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </button>
              );
            })}
          </div>
        </section>

        {datasets.includes("sector_details") && (
          <section className={styles.controlSection}>
            <div className={styles.sectionTitle}><span>关注板块</span><small>最多 5 个</small></div>
            <div className={styles.sectorList}>
              {catalog.sectors.slice(0, 40).map((sector) => {
                const selected = sectors.includes(sector.key);
                return <button type="button" key={sector.key} className={selected ? styles.sectorSelected : ""} onClick={() => toggleSector(sector.key)} aria-pressed={selected}>
                  <span>{sector.rank ? `${sector.rank}.` : "—"} {sector.name}</span><small>{sector.primary}</small>
                </button>;
              })}
            </div>
          </section>
        )}

        {datasets.includes("selected_stocks") && (
          <section className={styles.controlSection}>
            <label className={styles.fieldLabel} htmlFor="stock-codes">股票代码</label>
            <textarea id="stock-codes" rows={3} value={stockCodes} onChange={(event) => { setStockCodes(event.target.value); setPreview(null); }} placeholder="例如：600519, 000858" />
          </section>
        )}

        <div className={styles.previewArea}>
          <button type="button" className={styles.previewButton} onClick={previewData} disabled={!date || previewing || !datasets.length}>
            {previewing ? <LoaderCircle className={styles.spin} size={16} /> : <Database size={16} />}
            {previewing ? "正在整理数据" : "预览将发送的数据"}
          </button>
          {preview && (
            <details className={styles.previewDisclosure}>
              <summary><ShieldCheck size={15} /> 已准备 {preview.character_count.toLocaleString()} 字符 <ChevronDown size={14} /></summary>
              <pre>{JSON.stringify(preview.context, null, 2)}</pre>
            </details>
          )}
          <p className={styles.privacyNote}><LockKeyhole size={13} /> 只有本次勾选的精简数据会被发送。</p>
        </div>
      </aside>

      <section className={styles.chatWorkspace}>
        <header className={styles.chatHeader}>
          <div>
            <h1>用证据提问，而不是让模型猜测</h1>
            <p>{date ? `${date} · ${datasets.length} 组系统数据待选` : "等待可用的分析快照"}</p>
          </div>
          <div className={styles.accountArea}>
            {session.loading ? <span className={styles.sessionLoading}><LoaderCircle className={styles.spin} size={15} /> 检查登录</span> : session.authenticated ? (
              <div className={styles.accountBadge}>
                <UserRound size={16} /><span><strong>{session.profile?.name || "ChatGPT 用户"}</strong><small>{session.plan_usage_enabled ? "使用 ChatGPT 套餐" : "未授权套餐使用"}</small></span>
              </div>
            ) : <button type="button" className={styles.loginButton} onClick={connect}><LogIn size={16} /> 使用 ChatGPT 登录</button>}
            {session.authenticated && <select className={styles.modelSelect} value={model} onChange={(event) => setModel(event.target.value)} aria-label="模型">
              {!models.length && <option value="">暂无可用模型</option>}
              {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
            <button type="button" className={styles.historyButton} onClick={clearConversation} disabled={busy || !messages.length} aria-label="清空本机保存的研判对话" title="清空本机对话"><Trash2 size={15} /><span>清空</span></button>
            {embedded && <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭 GPT 智能研判"><X size={18} /></button>}
          </div>
        </header>

        {(notice || error) && <div className={error ? styles.errorBanner : styles.noticeBanner} role="status">
          <span>{error || notice}</span>
          <button type="button" onClick={() => { setError(""); setNotice(""); }}>关闭</button>
        </div>}

        <div className={styles.messages} ref={messagesViewportRef} aria-live="polite" tabIndex={0} aria-label="GPT 研判对话记录，可上下滚动">
          {!messages.length && (
            <div className={styles.emptyState}>
              <div className={styles.emptyGlyph}><SlidersHorizontal size={30} /></div>
              <h2>先选择证据，再提出判断问题</h2>
              <p>适合询问市场主线、板块相对强弱、核心股表现与风险信号。回答会明确区分系统事实、模型推断和缺失信息。</p>
              <div className={styles.promptExamples}>
                {["今天最强的三条主线分别靠什么支撑？", "所选板块的强度是持续改善，还是单日脉冲？", "比较指定个股与所属板块的相对强弱。"].map((text) => (
                  <button type="button" key={text} onClick={() => setQuestion(text)}>{text}<ExternalLink size={13} /></button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
              <div className={styles.messageRole}>{message.role === "user" ? <UserRound size={16} /> : <Bot size={16} />}</div>
              <div>{message.content || (busy && index === messages.length - 1 ? <span className={styles.thinking}><i /><i /><i /> 正在结合系统证据研判</span> : "")}</div>
            </article>
          ))}
        </div>

        <footer className={styles.composerArea}>
          {!session.loading && !session.authenticated && <div className={styles.loginCallout}>
            <div><LockKeyhole size={18} /><span><strong>连接你的 ChatGPT Plus</strong><small>无需 API Key；授权后由你的套餐完成推理。</small></span></div>
            <button type="button" onClick={connect}>开始登录</button>
          </div>}
          <div className={styles.composer}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={handleQuestionKeyDown} placeholder="例如：今天排名靠前的板块中，哪个持续性更可靠？" rows={3} disabled={busy} />
            <button type="button" onClick={ask} disabled={busy || !question.trim() || !session.authenticated || !model} aria-label="发送问题">
              {busy ? <RefreshCw className={styles.spin} size={19} /> : <Send size={19} />}
            </button>
          </div>
          <p>Enter 发送 · Shift + Enter 换行 · 对话自动保存在本机 · 研判结果不构成投资建议</p>
        </footer>
      </section>
    </main>
  );
}
