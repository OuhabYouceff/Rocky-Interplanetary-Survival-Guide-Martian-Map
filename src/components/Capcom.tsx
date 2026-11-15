// CAPCOM (ported from TETHER): voice/text mission-control assistant that operates Rocky's planner.
// Engine badge always shows who produced the words: "WebLLM · <model>" (on-device LLM) or "offline analyst".
// Lazy-loaded from App.tsx on first open; the model itself downloads only when the user presses Wake.
// Styles: .capcom* in styles.css (Rocky tokens).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset } from '../data';
import { ask, loadLlm, llmReady, pickModel, shortModel, webgpuSupport, type CapcomReply, type LlmState } from '../ai/capcomEngine';
import type { ToolResult } from '../ai/capcomTools';

interface Msg { id: number; who: 'you' | 'capcom' | 'sys'; text: string; engine?: string; planner?: string; results?: ToolResult[]; ms?: number }

// ---------------------------------------------------------------- speech helpers
type Rec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const RecCtor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

function pickVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const pref = ['Daniel', 'Google UK English Male', 'Samantha', 'Karen', 'Moira', 'Alex', 'Google US English', 'Serena', 'Arthur'];
  for (const p of pref) { const v = vs.find((x) => x.name.startsWith(p)); if (v) return v; }
  return vs.find((v) => v.lang === 'en-US') ?? vs[0] ?? null;
}
function speakable(t: string) {
  return t.replace(/→/g, ', then ').replace(/µSv/g, ' microsieverts').replace(/(\d+)\s*h\s+(\d+)\s*min/g, '$1 hours $2 minutes')
    .replace(/(\d)\s*km\b/g, '$1 kilometres').replace(/(\d)\s*m\b/g, '$1 metres').replace(/\bEVA\b/g, 'E V A').replace(/%/g, ' percent');
}

const SUGGEST = [
  'Can I visit Altadena and Campo Marte in 3 hours with a 25% reserve?',
  'Simulate a solar storm.',
  'Make it a 4 hour walk.',
  "What's my radiation dose?",
];

export default function Capcom({ data, initialOpen = false }: { data: Dataset; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, who: 'sys', text: 'CAPCOM online. Offline analyst active. Wake the on-device model for free-form requests.' }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [llm, setLlm] = useState<LlmState>({ phase: 'idle', progress: 0, text: '', model: '' });
  const [gpu, setGpu] = useState<{ ok: boolean; f16: boolean; why?: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const idRef = useRef(1);
  const histRef = useRef<string[]>([]);
  const recRef = useRef<Rec | null>(null);
  const finalRef = useRef('');
  const pressAt = useRef(0);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const meterRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const llmModelRef = useRef(''); llmModelRef.current = llm.model;

  useEffect(() => { webgpuSupport().then(setGpu); }, []);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const f = () => { voiceRef.current = pickVoice(); };
    f(); speechSynthesis.addEventListener('voiceschanged', f);
    return () => speechSynthesis.removeEventListener('voiceschanged', f);
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy, interim]);

  const push = useCallback((m: Omit<Msg, 'id'>) => setMsgs((a) => [...a, { ...m, id: idRef.current++ }]), []);

  const say = useCallback((t: string) => {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(t));
    if (voiceRef.current) u.voice = voiceRef.current;
    u.lang = voiceRef.current?.lang ?? 'en-US'; u.rate = 0.98; u.pitch = 0.95;
    speechSynthesis.speak(u);
  }, [voiceOn]);

  const submit = useCallback(async (text: string) => {
    const q = text.trim(); if (!q || busy) return;
    setInput(''); push({ who: 'you', text: q }); setBusy('thinking');
    try {
      const r: CapcomReply = await ask(data, q, { useLlm: llmReady(), model: llm.model, history: histRef.current, onStage: setBusy });
      histRef.current = [...histRef.current, q].slice(-4);
      push({ who: 'capcom', text: r.text, engine: r.engine, planner: r.planner, results: r.results, ms: r.ms });
      say(r.text);
    } catch (e) {
      push({ who: 'sys', text: 'CAPCOM error: ' + String(e) });
    } finally { setBusy(null); }
  }, [busy, data, llm.model, push, say]);


  const wake = useCallback(async () => {
    const g = gpu ?? await webgpuSupport();
    if (!g.ok) return;
    const model = pickModel(g.f16);
    const t0 = performance.now();
    setLlm({ phase: 'loading', progress: 0, text: 'Fetching model…', model });
    try {
      await loadLlm(model, (p, text) => setLlm((s) => ({ ...s, progress: p, text })));
      const loadMs = performance.now() - t0;
      setLlm({ phase: 'ready', progress: 1, text: '', model, loadMs });
      push({ who: 'sys', text: `On-device model ${shortModel(model)} loaded in ${(loadMs / 1000).toFixed(1)} s. Runs locally on WebGPU; no data leaves this machine.` });
    } catch (e) {
      setLlm({ phase: 'error', progress: 0, text: String(e), model });
      push({ who: 'sys', text: 'Model failed to load; the offline analyst stays on duty. ' + String(e) });
    }
  }, [gpu, push]);

  // scripting hook for demos / headless tests: __capcom.ask(text), __capcom.wake(), __capcom.open()
  useEffect(() => {
    (window as unknown as { __capcom: unknown }).__capcom = {
      ask: async (t: string) => { setOpen(true); push({ who: 'you', text: t });
        const r = await ask(data, t, { useLlm: llmReady(), model: llmModelRef.current, history: [] });
        push({ who: 'capcom', text: r.text, engine: r.engine, planner: r.planner, results: r.results, ms: r.ms }); return r; },
      wake: () => wake(), ready: () => llmReady(), open: () => setOpen(true),
    };
  }, [data, push, wake]);

  // ---------------------------------------------------------------- push-to-talk
  const stopMeter = () => {
    const m = meterRef.current; if (!m) return;
    cancelAnimationFrame(m.raf); m.stream.getTracks().forEach((t) => t.stop()); m.ctx.close(); meterRef.current = null; setLevel(0);
  };
  const startMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(s / buf.length) * 5));
        if (meterRef.current) meterRef.current.raf = requestAnimationFrame(tick);
      };
      meterRef.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch { /* meter is cosmetic */ }
  };
  const startListening = () => {
    const C = RecCtor();
    if (!C) { push({ who: 'sys', text: 'Speech recognition is not available in this browser. Type instead (Chrome supports voice).' }); return; }
    if (recRef.current) return;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const r = new C(); r.lang = 'en-US'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
    finalRef.current = ''; setInterim('');
    r.onresult = (e) => {
      let fin = '', int = '';
      for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else int += res[0].transcript; }
      finalRef.current = fin; setInterim((fin + ' ' + int).trim());
      if (silenceRef.current) clearTimeout(silenceRef.current);
      if (fin && !int && !pressed.current) silenceRef.current = setTimeout(() => recRef.current?.stop(), 1600); // tap mode: stop on silence
    };
    r.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') push({ who: 'sys', text: `Mic: ${e.error}` }); };
    r.onend = () => {
      recRef.current = null; setListening(false); stopMeter();
      const t = (finalRef.current || '').trim() || interimRef.current.trim(); setInterim('');
      if (t) void submitRef.current(t);
    };
    recRef.current = r; r.start(); setListening(true); void startMeter();
  };
  const stopListening = () => { recRef.current?.stop(); };
  const interimRef = useRef(''); interimRef.current = interim;
  const submitRef = useRef(submit); submitRef.current = submit;

  const onMicDown = () => { pressed.current = true; pressAt.current = performance.now(); if (recRef.current) stopListening(); else startListening(); };
  // held > 400 ms = push-to-talk (release stops); quick tap = toggle (recognition also ends itself on silence)
  const onMicUp = () => { if (!pressed.current) return; pressed.current = false; if (recRef.current && performance.now() - pressAt.current > 400) stopListening(); };

  // hold Alt+Space anywhere to talk
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && e.altKey && !e.repeat) { e.preventDefault(); setOpen(true); if (!recRef.current) startListening(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && recRef.current) stopListening(); };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  });
  useEffect(() => () => { recRef.current?.abort(); stopMeter(); }, []);

  const engineBadge = llm.phase === 'ready' ? `WebLLM · ${shortModel(llm.model)}` : 'offline analyst';
  const stageText: Record<string, string> = { thinking: llmReady() ? 'reasoning on-device…' : 'parsing…', executing: 'operating the planner…', routing: 'route engine computing…', speaking: 'composing reply…' };

  if (!open) {
    return (
      <button className={`capcom-fab ${llm.phase === 'ready' ? 'live' : ''}`} onClick={() => setOpen(true)} title="CAPCOM: talk to mission control">
        <span className="capcom-dot" /> CAPCOM
      </button>
    );
  }

  return (
    <div className="capcom" role="dialog" aria-label="CAPCOM mission control assistant">
      <div className="capcom-sheen" />
      <header className="capcom-head">
        <div className="capcom-title"><span className={`capcom-dot ${busy ? 'busy' : ''}`} />CAPCOM</div>
        <span className={`capcom-badge ${llm.phase === 'ready' ? 'llm' : ''}`} title="Engine currently on duty">{engineBadge}</span>
        <button className={`capcom-icon ${voiceOn ? 'on' : ''}`} onClick={() => { setVoiceOn((v) => !v); speechSynthesis?.cancel(); }} title={voiceOn ? 'Mute spoken replies' : 'Speak replies'} aria-label="toggle voice" aria-pressed={voiceOn}>{voiceOn ? 'Voice on' : 'Voice off'}</button>
        <button className="capcom-icon" onClick={() => setOpen(false)} aria-label="minimise">Close</button>
      </header>

      {llm.phase !== 'ready' && (
        <div className="capcom-wake">
          {llm.phase === 'loading' ? (
            <>
              <div className="capcom-bar"><i style={{ width: `${Math.round(llm.progress * 100)}%` }} /></div>
              <div className="capcom-wake-text mono">{Math.round(llm.progress * 100)}% · {llm.text.slice(0, 90)}</div>
            </>
          ) : gpu && !gpu.ok ? (
            <div className="capcom-wake-text">WebGPU unavailable ({gpu.why}). Offline analyst handles all commands.</div>
          ) : (
            <button className="capcom-wake-btn" onClick={wake} disabled={!gpu}>
              <b>Wake CAPCOM</b><span>on-device AI · {shortModel(pickModel(gpu?.f16 ?? true))} · ~0.9 GB once, cached</span>
            </button>
          )}
          {llm.phase === 'error' && <div className="capcom-wake-text warn">{llm.text.slice(0, 140)}</div>}
        </div>
      )}

      <div className="capcom-log" ref={logRef}>
        {msgs.map((m) => (
          <div key={m.id} className={`capcom-msg from-${m.who}`}>
            <div className="capcom-who">{m.who === 'you' ? 'EV1 ›' : m.who === 'capcom' ? 'CAPCOM ›' : '··'}
              {m.engine && <span className="capcom-eng">{m.engine}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ''}</span>}</div>
            <div className="capcom-text">{m.text}</div>
            {m.results && m.results.length > 0 && (
              <div className="capcom-tools">
                {m.results.map((r, i) => <span key={i} className={`capcom-chip ${r.ok ? '' : 'bad'}`} title={r.note}>{r.ok ? '✓' : '✕'} {r.tool}</span>)}
                {m.planner && m.planner !== m.engine && <span className="capcom-plannedby">planned by {m.planner}</span>}
              </div>
            )}
          </div>
        ))}
        {interim && <div className="capcom-msg from-you live"><div className="capcom-who">EV1 › <span className="capcom-eng">listening</span></div><div className="capcom-text">{interim}</div></div>}
        {busy && <div className="capcom-msg from-capcom"><div className="capcom-who">CAPCOM ›</div><div className="capcom-text capcom-typing">{stageText[busy] ?? busy}<i /><i /><i /></div></div>}
      </div>

      {msgs.length < 4 && (
        <div className="capcom-suggest">
          {SUGGEST.map((s) => <button key={s} onClick={() => submit(s)} disabled={!!busy}>{s}</button>)}
        </div>
      )}

      <form className="capcom-input" onSubmit={(e) => { e.preventDefault(); void submit(input); }}>
        <button type="button" className={`capcom-mic ${listening ? 'on' : ''}`} style={{ ['--lvl' as string]: level.toFixed(3) }}
          onPointerDown={onMicDown} onPointerUp={onMicUp} onPointerLeave={onMicUp} title="Hold to talk, or tap to start (stops on silence). Alt+Space anywhere." aria-label="push to talk">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" /></svg>
        </button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask CAPCOM… e.g. "simulate a solar storm"'} disabled={!!busy} />
        <button type="submit" className="capcom-send" disabled={!input.trim() || !!busy}>SEND</button>
      </form>
    </div>
  );
}
