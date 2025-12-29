import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v20-';
const MAX_SLOTS = 15; 
const MATCH_TIMEOUT = 30;

const LANGUAGES = [
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [matchTimer, setMatchTimer] = useState(MATCH_TIMEOUT);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const isBusy = useRef<boolean>(false);
  
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const timersRef = useRef<{ match?: number, session?: number }>({});

  const cleanup = useCallback(() => {
    isBusy.current = false;
    // Fix: Explicitly check for 'number' type before calling window.clearInterval to avoid 'unknown' type error.
    Object.values(timersRef.current).forEach(t => {
      if (typeof t === 'number') {
        window.clearInterval(t);
      }
    });
    
    if (callRef.current) callRef.current.close();
    if (dataConnRef.current) dataConnRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current) {
      peerRef.current.disconnect();
      peerRef.current.destroy();
    }
    
    peerRef.current = null;
    callRef.current = null;
    dataConnRef.current = null;
    localStreamRef.current = null;
    
    setAppState(AppState.IDLE);
    setStatusMsg('');
    setElapsedTime(0);
    setMatchTimer(MATCH_TIMEOUT);
    setIsVideoActive(false);
    setIsChatOpen(false);
    setMessages([]);
    setInputText('');
  }, []);

  const onConnected = () => {
    isBusy.current = true;
    setAppState(AppState.CONNECTED);
    if (timersRef.current.match) window.clearInterval(timersRef.current.match);
    timersRef.current.session = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
  };

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (data?.type === 'BUSY') {
        conn.close();
      } else if (data?.type === 'VIDEO_SIGNAL') {
        setIsVideoActive(true);
      } else if (typeof data === 'string') {
        setMessages(prev => [...prev, { sender: 'them', text: data }]);
      }
    });
    conn.on('close', cleanup);
  };

  const setupCall = (call: any) => {
    callRef.current = call;
    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});

      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      }
      onConnected();
    });
    call.on('close', cleanup);
  };

  const findPartner = async (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang) return;
    if (slot > MAX_SLOTS) {
      // إعادة الدورة من البداية بعد تأخير بسيط
      setTimeout(() => findPartner(1), 1000);
      return;
    }

    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    setStatusMsg(`جاري فحص القناة ${slot}...`);

    // 1. محاولة الاتصال كـ "ضيف" أولاً (بمعرف عشوائي)
    const scanner = new Peer();
    
    scanner.on('open', () => {
      const conn = scanner.connect(roomId, { reliable: true });
      let hasFoundHost = false;

      const timeout = setTimeout(() => {
        if (!hasFoundHost) {
          scanner.destroy();
          tryToBeHost(roomId, slot);
        }
      }, 1500);

      conn.on('open', async () => {
        hasFoundHost = true;
        clearTimeout(timeout);
        setStatusMsg(`تم العثور على مضيف في ${slot}.. جاري الربط`);
        
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          
          peerRef.current = scanner;
          setupDataConnection(conn);
          setupCall(scanner.call(roomId, stream));
        } catch (e) { cleanup(); }
      });

      conn.on('error', () => {
        hasFoundHost = true;
        clearTimeout(timeout);
        scanner.destroy();
        tryToBeHost(roomId, slot);
      });
    });
  };

  const tryToBeHost = (roomId: string, slot: number) => {
    if (appState === AppState.CONNECTED) return;
    
    const host = new Peer(roomId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    host.on('open', () => {
      peerRef.current = host;
      setStatusMsg(`أنت المضيف في القناة ${slot}.. ننتظر شريكاً`);
      
      host.on('connection', (conn) => {
        if (isBusy.current) {
          conn.on('open', () => {
            conn.send({ type: 'BUSY' });
            setTimeout(() => conn.close(), 500);
          });
          return;
        }
        setupDataConnection(conn);
      });

      host.on('call', async (incomingCall) => {
        if (isBusy.current) {
          incomingCall.answer();
          setTimeout(() => incomingCall.close(), 500);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        incomingCall.answer(stream);
        setupCall(incomingCall);
      });
    });

    host.on('error', (err) => {
      host.destroy();
      // إذا كان المعرف محجوزاً أو حدث خطأ، انتقل للغرفة التالية فوراً
      findPartner(slot + 1);
    });
  };

  const handleStart = (langCode: string) => {
    setSelectedLang(langCode);
    setAppState(AppState.MATCHING);
    setMatchTimer(MATCH_TIMEOUT);
    
    timersRef.current.match = window.setInterval(() => {
      setMatchTimer(prev => {
        if (prev <= 1) {
          cleanup();
          setAppState(AppState.ERROR);
          setError("لم نجد أحداً حالياً.. جرب مرة أخرى");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // إضافة تأخير عشوائي بسيط لمنع التصادم اللحظي
    setTimeout(() => findPartner(1), Math.random() * 500);
  };

  const toggleVideo = async () => {
    if (elapsedTime < 120 && !isVideoActive) {
      setToast(`الفيديو متاح بعد ${120 - elapsedTime} ثانية`);
      setTimeout(() => setToast(null), 3000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (dataConnRef.current) dataConnRef.current.send({ type: 'VIDEO_SIGNAL' });
      
      if (callRef.current && peerRef.current) {
        setupCall(peerRef.current.call(callRef.current.peer, stream));
      }
      setIsVideoActive(true);
    } catch (e) { console.error(e); }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  return (
    <div className="h-screen w-screen bg-[#020617] text-white flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* طبقة الفيديو الفعالة */}
      {isVideoActive && (
        <div className="absolute inset-0 z-0 flex flex-col animate-in fade-in duration-500">
          <div className="flex-1 relative bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-6 left-6 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">Stranger</div>
          </div>
          <div className="flex-1 relative bg-black border-t border-white/10">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-32 left-6 bg-indigo-600/40 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">You</div>
          </div>
        </div>
      )}

      {/* الحالة: البداية */}
      {appState === AppState.IDLE && (
        <div className="z-10 w-full max-w-md px-10 text-center animate-in slide-in-from-bottom-10 duration-700">
          <h1 className="text-8xl font-black italic tracking-tighter mb-4 text-white drop-shadow-[0_0_30px_rgba(79,70,229,0.3)]">AnyOne</h1>
          <p className="text-slate-400 mb-12 font-medium italic">اضغط على لغتك وابدأ الكلام فوراً</p>
          <div className="space-y-3">
            {LANGUAGES.map(lang => (
              <button 
                key={lang.code} 
                onClick={() => handleStart(lang.code)}
                className="w-full group flex items-center justify-between bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10 p-5 rounded-3xl transition-all active:scale-95"
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{lang.flag}</span>
                  <span className="text-xl font-bold">{lang.name}</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-indigo-600/10 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M14 5l7 7-7 7" strokeWidth={3} /></svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* الحالة: جاري البحث */}
      {appState === AppState.MATCHING && (
        <div className="z-10 flex flex-col items-center gap-12 text-center animate-in zoom-in-95">
          <div className="relative w-56 h-56 flex items-center justify-center">
            <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full animate-ping" />
            <div className="absolute inset-4 border border-indigo-500/40 rounded-full" />
            <div className="flex flex-col items-center">
               <span className="text-7xl font-black italic text-indigo-500">{matchTimer}</span>
               <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mt-2">Searching</span>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-3xl font-black italic tracking-tight animate-pulse">جاري العثور على شريك...</h2>
            <div className="bg-white/5 border border-white/10 px-6 py-2 rounded-full inline-block">
               <span className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">{statusMsg}</span>
            </div>
          </div>
          <button onClick={cleanup} className="text-slate-500 hover:text-white font-bold transition-colors py-2 px-8 border border-white/5 rounded-full">إلغاء</button>
        </div>
      )}

      {/* الحالة: متصل */}
      {appState === AppState.CONNECTED && (
        <div className="z-10 flex flex-col items-center justify-between w-full h-full py-16 px-8">
          <div className="bg-black/60 backdrop-blur-2xl border border-white/10 px-10 py-4 rounded-full text-4xl font-mono font-black shadow-2xl tracking-tighter text-indigo-400">
            {Math.floor(elapsedTime/60)}:{(elapsedTime%60).toString().padStart(2, '0')}
          </div>

          {!isVideoActive && (
            <div className="flex flex-col items-center gap-10">
               <div className="w-56 h-56 rounded-full bg-indigo-500/10 border-4 border-indigo-500/20 flex items-center justify-center relative">
                  <div className="flex gap-2 items-center">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="w-2.5 bg-indigo-500 rounded-full animate-pulse" style={{ height: `${20 + Math.random()*40}px`, animationDelay: `${i*0.1}s` }} />
                    ))}
                  </div>
                  <div className="absolute -bottom-4 bg-green-500 text-black px-5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg">متصل الآن</div>
               </div>
               <p className="text-slate-400 font-medium italic text-lg">تحدث الآن مع شخص غريب..</p>
            </div>
          )}

          <div className={`flex items-center gap-6 ${isVideoActive ? 'fixed bottom-8' : ''}`}>
             <button 
              onClick={() => elapsedTime >= 60 ? setIsChatOpen(true) : setToast(`الشات متاح بعد ${60 - elapsedTime} ثانية`)}
              className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all shadow-xl"
             >
               <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2} /></svg>
             </button>
             
             <button onClick={cleanup} className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.3)] hover:bg-red-500 active:scale-90 transition-all border-4 border-red-500/20">
               <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={4} /></svg>
             </button>

             <button 
              onClick={toggleVideo}
              className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all shadow-xl ${isVideoActive ? 'bg-green-600 border-green-400' : 'bg-white/5 border-white/10'}`}
             >
               <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2} /></svg>
             </button>
          </div>
          
          {toast && (
            <div className="fixed bottom-40 bg-white text-black px-6 py-2 rounded-2xl text-[11px] font-black uppercase animate-bounce shadow-2xl z-50">
              {toast}
            </div>
          )}
        </div>
      )}

      {/* الحالة: خطأ */}
      {appState === AppState.ERROR && (
        <div className="z-10 flex flex-col items-center gap-8 text-center animate-in zoom-in-95">
          <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
            <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2} /></svg>
          </div>
          <div className="space-y-2 px-10">
            <h2 className="text-4xl font-black italic">نأسف جداً!</h2>
            <p className="text-slate-400 font-medium">{error}</p>
          </div>
          <button onClick={() => handleStart(selectedLang!)} className="bg-indigo-600 px-12 py-5 rounded-3xl font-black shadow-2xl shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 transition-all text-xl">حاول مجدداً</button>
          <button onClick={cleanup} className="text-slate-500 font-bold hover:text-white transition-colors">رجوع للرئيسية</button>
        </div>
      )}

      {/* مودال الشات */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col animate-in slide-in-from-bottom duration-300">
           <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-900/40 backdrop-blur-2xl">
             <h3 className="text-2xl font-black italic uppercase tracking-tighter">Private Chat</h3>
             <button onClick={() => setIsChatOpen(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10">
               <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3} /></svg>
             </button>
           </div>
           <div className="flex-1 overflow-y-auto p-6 space-y-4">
             {messages.length === 0 && <p className="text-center text-slate-500 italic mt-20">لا توجد رسائل بعد..</p>}
             {messages.map((m, i) => (
               <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`px-5 py-3 rounded-2xl max-w-[85%] text-sm font-semibold shadow-lg ${m.sender === 'me' ? 'bg-white text-black' : 'bg-indigo-600 text-white'}`}>{m.text}</div>
               </div>
             ))}
           </div>
           <div className="p-6 pb-12 flex gap-3 border-t border-white/5 bg-slate-900/40 backdrop-blur-2xl">
             <input 
              value={inputText} 
              onChange={e => setInputText(e.target.value)} 
              onKeyPress={e => e.key === 'Enter' && sendMessage()} 
              placeholder="اكتب رسالة..." 
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-4 focus:outline-none focus:border-indigo-500 transition-all font-medium" 
             />
             <button onClick={sendMessage} className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg active:scale-90 hover:bg-indigo-500 transition-all">
               <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4} /></svg>
             </button>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;