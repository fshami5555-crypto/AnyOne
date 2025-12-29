
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v25-';
const MAX_SLOTS = 10; 
const MATCH_TIMEOUT = 45; // زيادة وقت البحث لضمان فرصة أفضل للربط

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
    Object.values(timersRef.current).forEach(t => {
      if (typeof t === 'number') window.clearInterval(t);
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
    conn.on('open', () => {
      console.log("Data connection established");
    });
    conn.on('data', (data: any) => {
      if (data?.type === 'BUSY') {
        cleanup();
        setError("المستخدم مشغول حالياً");
      } else if (data?.type === 'VIDEO_SIGNAL') {
        setIsVideoActive(true);
      } else if (typeof data === 'string') {
        setMessages(prev => [...prev, { sender: 'them', text: data }]);
      }
    });
    conn.on('close', cleanup);
    conn.on('error', cleanup);
  };

  const setupCall = (call: any) => {
    callRef.current = call;
    call.on('stream', (remoteStream: MediaStream) => {
      console.log("Received remote stream");
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => console.error("Audio play error", e));

      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      }
      onConnected();
    });
    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  // نظام "القمع" - المحاولة التسلسلية للربط
  const startMatching = async (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang) return;
    if (slot > MAX_SLOTS) {
      setStatusMsg("جاري إعادة المحاولة من القناة 1...");
      setTimeout(() => startMatching(1), 1000);
      return;
    }

    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    setStatusMsg(`فحص القناة ${slot}...`);

    // 1. محاولة الانضمام أولاً كـ "ضيف"
    const guestPeer = new Peer();
    peerRef.current = guestPeer;

    guestPeer.on('open', () => {
      console.log(`Checking slot ${slot} as guest...`);
      const conn = guestPeer.connect(roomId, { reliable: true });
      
      let connectionTimeout = setTimeout(() => {
        console.log(`Slot ${slot} appears empty, trying to host...`);
        guestPeer.destroy();
        becomeHost(slot);
      }, 2500);

      conn.on('open', async () => {
        clearTimeout(connectionTimeout);
        setStatusMsg(`تم العثور على شريك في القناة ${slot}!`);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          setupDataConnection(conn);
          setupCall(guestPeer.call(roomId, stream));
        } catch (e) {
          cleanup();
          setError("يرجى تفعيل الميكروفون للمتابعة");
        }
      });

      conn.on('error', (err) => {
        console.log("Guest connection error, probably no host:", err);
        clearTimeout(connectionTimeout);
        guestPeer.destroy();
        becomeHost(slot);
      });
    });
  };

  const becomeHost = (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang) return;
    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    
    const host = new Peer(roomId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    peerRef.current = host;

    host.on('open', () => {
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
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          incomingCall.answer(stream);
          setupCall(incomingCall);
        } catch (e) {
          console.error("Microphone error", e);
        }
      });

      // إذا مر وقت طويل ولم يدخل أحد، ننتقل للغرفة التالية لزيادة احتمالية الالتقاء
      setTimeout(() => {
        if (!isBusy.current && appState === AppState.MATCHING) {
          console.log(`No guest in slot ${slot}, moving to next...`);
          host.destroy();
          startMatching(slot + 1);
        }
      }, 10000);
    });

    host.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        console.log(`Slot ${slot} just taken by someone else, trying next.`);
        host.destroy();
        startMatching(slot + 1);
      } else {
        host.destroy();
        startMatching(slot + 1);
      }
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
          setError("لم نجد أحداً حالياً.. تأكد أن أشخاصاً آخرين يستخدمون نفس اللغة");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // إضافة تأخير عشوائي بسيط جداً لمنع التصادم اللحظي عند الضغط الجماعي
    setTimeout(() => startMatching(1), Math.random() * 300);
  };

  const toggleVideo = async () => {
    if (elapsedTime < 60 && !isVideoActive) {
      setToast(`الفيديو متاح بعد ${60 - elapsedTime} ثانية`);
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
    } catch (e) {
      setToast("فشل فتح الكاميرا");
      setTimeout(() => setToast(null), 3000);
    }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  return (
    <div className="h-screen w-screen bg-[#020617] text-white flex flex-col items-center justify-center relative overflow-hidden font-sans">
      
      {/* طبقة الفيديو */}
      {isVideoActive && (
        <div className="absolute inset-0 z-0 flex flex-col animate-in fade-in duration-700">
          <div className="flex-1 relative bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-6 left-6 bg-black/50 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">Stranger</div>
          </div>
          <div className="flex-1 relative bg-black border-t border-white/10">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-32 left-6 bg-indigo-600/50 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">You</div>
          </div>
        </div>
      )}

      {/* واجهة البداية */}
      {appState === AppState.IDLE && (
        <div className="z-10 w-full max-w-md px-10 text-center animate-in slide-in-from-bottom-10 duration-700">
          <div className="mb-12">
            <h1 className="text-8xl font-black italic tracking-tighter mb-4 text-white drop-shadow-[0_0_40px_rgba(79,70,229,0.4)]">AnyOne</h1>
            <p className="text-slate-400 font-medium italic text-lg">اربط العالم بصوتك.. اختر لغتك وابدأ</p>
          </div>
          <div className="space-y-3">
            {LANGUAGES.map(lang => (
              <button 
                key={lang.code} 
                onClick={() => handleStart(lang.code)}
                className="w-full group flex items-center justify-between bg-white/5 border border-white/10 hover:border-indigo-500 hover:bg-indigo-500/10 p-6 rounded-[2rem] transition-all active:scale-95"
              >
                <div className="flex items-center gap-5">
                  <span className="text-5xl">{lang.flag}</span>
                  <span className="text-2xl font-bold">{lang.name}</span>
                </div>
                <div className="w-12 h-12 rounded-full bg-indigo-600/20 flex items-center justify-center group-hover:bg-indigo-600 transition-colors shadow-lg">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M14 5l7 7-7 7" strokeWidth={3.5} /></svg>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-12 text-slate-500 text-sm font-medium">نظام ربط فوري آمن ومباشر</p>
        </div>
      )}

      {/* واجهة البحث */}
      {appState === AppState.MATCHING && (
        <div className="z-10 flex flex-col items-center gap-14 text-center animate-in zoom-in-95">
          <div className="relative w-64 h-64 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-indigo-500/10 rounded-full radar-wave" />
            <div className="absolute inset-0 border-4 border-indigo-500/5 rounded-full radar-wave" style={{animationDelay:'0.5s'}} />
            <div className="absolute inset-0 border-2 border-indigo-500/20 rounded-full" />
            <div className="flex flex-col items-center z-10">
               <span className="text-8xl font-black italic text-indigo-500 drop-shadow-[0_0_20px_rgba(99,102,241,0.5)]">{matchTimer}</span>
               <span className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 mt-3">Matching...</span>
            </div>
          </div>
          <div className="space-y-5">
            <h2 className="text-4xl font-black italic tracking-tight animate-pulse text-white">جاري البحث عن شريك...</h2>
            <div className="bg-white/5 border border-white/10 px-8 py-3 rounded-full inline-block backdrop-blur-md">
               <span className="text-indigo-400 text-xs font-black uppercase tracking-widest">{statusMsg}</span>
            </div>
          </div>
          <button onClick={cleanup} className="text-slate-400 hover:text-white font-bold transition-colors py-3 px-10 border border-white/10 rounded-full bg-white/5 hover:bg-white/10">إلغاء البحث</button>
        </div>
      )}

      {/* واجهة الاتصال */}
      {appState === AppState.CONNECTED && (
        <div className="z-10 flex flex-col items-center justify-between w-full h-full py-20 px-8">
          <div className="bg-black/60 backdrop-blur-2xl border border-white/10 px-12 py-5 rounded-full text-5xl font-mono font-black shadow-2xl tracking-tighter text-indigo-400 drop-shadow-[0_0_15px_rgba(129,140,248,0.3)]">
            {Math.floor(elapsedTime/60)}:{(elapsedTime%60).toString().padStart(2, '0')}
          </div>

          {!isVideoActive && (
            <div className="flex flex-col items-center gap-12">
               <div className="w-64 h-64 rounded-full bg-indigo-500/5 border-4 border-indigo-500/20 flex items-center justify-center relative shadow-[0_0_100px_rgba(79,70,229,0.1)]">
                  <div className="flex gap-3 items-center">
                    {[...Array(7)].map((_, i) => (
                      <div key={i} className="w-3 bg-indigo-500 rounded-full animate-pulse" style={{ height: `${30 + Math.random()*50}px`, animationDelay: `${i*0.12}s` }} />
                    ))}
                  </div>
                  <div className="absolute -bottom-5 bg-green-500 text-black px-6 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-xl">مكالمة نشطة</div>
               </div>
               <div className="text-center space-y-2">
                 <p className="text-white text-2xl font-bold italic">أنت متصل الآن!</p>
                 <p className="text-slate-400 font-medium">ابدأ الحديث، شريكك يسمعك بوضوح</p>
               </div>
            </div>
          )}

          <div className={`flex items-center gap-8 ${isVideoActive ? 'fixed bottom-10' : ''}`}>
             <button 
              onClick={() => elapsedTime >= 30 ? setIsChatOpen(true) : setToast(`الشات متاح بعد ${30 - elapsedTime} ثانية`)}
              className={`w-18 h-18 rounded-full flex items-center justify-center transition-all shadow-2xl border ${elapsedTime >= 30 ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-white/5 border-white/5 opacity-30'}`}
              style={{ width: '72px', height: '72px' }}
             >
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2.5} /></svg>
             </button>
             
             <button onClick={cleanup} className="w-28 h-28 bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_60px_rgba(220,38,38,0.4)] hover:bg-red-500 active:scale-90 transition-all border-4 border-red-500/20">
               <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={4.5} /></svg>
             </button>

             <button 
              onClick={toggleVideo}
              className={`w-18 h-18 rounded-full flex items-center justify-center border transition-all shadow-2xl ${isVideoActive ? 'bg-green-600 border-green-400 shadow-[0_0_40px_rgba(22,163,74,0.4)]' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
              style={{ width: '72px', height: '72px' }}
             >
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2.5} /></svg>
             </button>
          </div>
          
          {toast && (
            <div className="fixed bottom-48 bg-white text-black px-8 py-3 rounded-2xl text-xs font-black uppercase animate-bounce shadow-[0_0_30px_rgba(255,255,255,0.3)] z-50">
              {toast}
            </div>
          )}
        </div>
      )}

      {/* واجهة الخطأ */}
      {appState === AppState.ERROR && (
        <div className="z-10 flex flex-col items-center gap-10 text-center animate-in zoom-in-95">
          <div className="w-28 h-28 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20 shadow-[0_0_40px_rgba(239,68,68,0.1)]">
            <svg className="w-14 h-14 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2.5} /></svg>
          </div>
          <div className="space-y-3 px-10">
            <h2 className="text-5xl font-black italic text-white">عذراً!</h2>
            <p className="text-slate-400 font-medium text-lg max-w-sm">{error}</p>
          </div>
          <div className="flex flex-col gap-4 w-full px-12">
            <button onClick={() => handleStart(selectedLang!)} className="bg-indigo-600 px-12 py-6 rounded-[2rem] font-black shadow-2xl shadow-indigo-600/40 hover:bg-indigo-500 active:scale-95 transition-all text-2xl">حاول مجدداً</button>
            <button onClick={cleanup} className="text-slate-500 font-bold hover:text-white transition-colors py-4">العودة للرئيسية</button>
          </div>
        </div>
      )}

      {/* مودال الشات */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col animate-in slide-in-from-bottom duration-400">
           <div className="p-8 border-b border-white/5 flex justify-between items-center bg-slate-900/40 backdrop-blur-3xl">
             <h3 className="text-3xl font-black italic uppercase tracking-tighter">Live Chat</h3>
             <button onClick={() => setIsChatOpen(false)} className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3.5} /></svg>
             </button>
           </div>
           <div className="flex-1 overflow-y-auto p-8 space-y-6">
             {messages.length === 0 && (
               <div className="flex flex-col items-center justify-center h-full opacity-20 grayscale">
                 <svg className="w-24 h-24 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeWidth={2} /></svg>
                 <p className="text-xl font-bold italic">ابدأ المحادثة الآن..</p>
               </div>
             )}
             {messages.map((m, i) => (
               <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-${m.sender === 'me' ? 'right' : 'left'}-4`}>
                 <div className={`px-7 py-4 rounded-[2rem] max-w-[88%] text-base font-semibold shadow-2xl ${m.sender === 'me' ? 'bg-white text-black rounded-tr-none' : 'bg-indigo-600 text-white rounded-tl-none'}`}>{m.text}</div>
               </div>
             ))}
           </div>
           <div className="p-8 pb-14 flex gap-4 border-t border-white/5 bg-slate-900/50 backdrop-blur-3xl">
             <input 
              value={inputText} 
              onChange={e => setInputText(e.target.value)} 
              onKeyPress={e => e.key === 'Enter' && sendMessage()} 
              placeholder="اكتب رسالة..." 
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-8 py-5 focus:outline-none focus:border-indigo-500 transition-all font-bold text-lg" 
             />
             <button onClick={sendMessage} className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center shadow-2xl active:scale-90 hover:bg-indigo-500 transition-all">
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4.5} /></svg>
             </button>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;
