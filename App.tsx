
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v15-';
const MAX_SLOTS = 20; // عدد الغرف المتاحة لكل لغة
const HANDSHAKE_TIMEOUT = 2500; // وقت انتظار الرد من المضيف قبل الانتقال للغرفة التالية

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
  const [matchTimer, setMatchTimer] = useState(30);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');
  const [toast, setToast] = useState<{msg: string, target: 'chat' | 'video'} | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const matchCountdownRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const isBusy = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    isBusy.current = false;
    if (matchCountdownRef.current) window.clearInterval(matchCountdownRef.current);
    if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);
    
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
    setMatchTimer(30);
    setIsVideoActive(false);
    setIsChatOpen(false);
    setMessages([]);
    setInputText('');
  }, []);

  const handleConnected = () => {
    isBusy.current = true;
    setAppState(AppState.CONNECTED);
    if (matchCountdownRef.current) window.clearInterval(matchCountdownRef.current);
    sessionTimerRef.current = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
  };

  const setupDataHandlers = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (data?.type === 'BUSY') {
        // المضيف مشغول، ننتقل للغرفة التالية فوراً
        conn.close();
      } else if (data?.type === 'VIDEO_ON') {
        setIsVideoActive(true);
      } else {
        setMessages(prev => [...prev, { sender: 'them', text: String(data) }]);
      }
    });
    conn.on('close', cleanup);
  };

  const trySlot = async (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang) return;
    if (slot > MAX_SLOTS) {
      setAppState(AppState.ERROR);
      setError("جميع الغرف مشغولة حالياً، حاول مجدداً");
      return;
    }

    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    setStatusMsg(`فحص الغرفة ${slot}...`);

    if (peerRef.current) peerRef.current.destroy();
    
    const peer = new Peer(roomId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    peerRef.current = peer;

    peer.on('open', () => {
      // نجحت في حجز الغرفة كمضيف
      setStatusMsg(`أنت المضيف في الغرفة ${slot}.. ننتظر زائراً`);
      peer.on('connection', (conn) => {
        if (isBusy.current) {
          conn.on('open', () => conn.send({ type: 'BUSY' }));
          setTimeout(() => conn.close(), 500);
          return;
        }
        setupDataHandlers(conn);
      });
      peer.on('call', async (call) => {
        if (isBusy.current) {
          call.answer(); 
          setTimeout(() => call.close(), 500);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        call.answer(stream);
        setupCallHandlers(call);
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // الغرفة محجوزة، لنحاول الدخول كـ "ضيف"
        joinAsGuest(roomId, slot);
      } else {
        trySlot(slot + 1);
      }
    });
  };

  const joinAsGuest = async (roomId: string, slot: number) => {
    setStatusMsg(`الغرفة ${slot} مأهولة.. نحاول الانضمام...`);
    const guestPeer = new Peer();
    peerRef.current = guestPeer;

    guestPeer.on('open', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;

        const conn = guestPeer.connect(roomId);
        let responded = false;

        const timeout = setTimeout(() => {
          if (!responded) {
            guestPeer.destroy();
            trySlot(slot + 1);
          }
        }, HANDSHAKE_TIMEOUT);

        conn.on('open', () => {
          responded = true;
          clearTimeout(timeout);
          setupDataHandlers(conn);
          const call = guestPeer.call(roomId, stream);
          setupCallHandlers(call);
        });

        conn.on('data', (data: any) => {
          if (data?.type === 'BUSY') {
            responded = true;
            clearTimeout(timeout);
            guestPeer.destroy();
            trySlot(slot + 1);
          }
        });

        conn.on('error', () => {
          responded = true;
          clearTimeout(timeout);
          guestPeer.destroy();
          trySlot(slot + 1);
        });

      } catch (e) {
        cleanup();
      }
    });
  };

  const setupCallHandlers = (call: any) => {
    callRef.current = call;
    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});

      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      }
      handleConnected();
    });
    call.on('close', cleanup);
  };

  const handleStart = (langCode: string) => {
    setSelectedLang(langCode);
    setAppState(AppState.MATCHING);
    setMatchTimer(30);
    
    matchCountdownRef.current = window.setInterval(() => {
      setMatchTimer(prev => {
        if (prev <= 1) {
          cleanup();
          setAppState(AppState.ERROR);
          setError("انتهى الوقت ولم نجد أحداً، جرب لغة أخرى أو حاول لاحقاً");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    trySlot(1);
  };

  const toggleVideo = async () => {
    if (elapsedTime < 120 && !isVideoActive) {
      setToast({ msg: `انتظر ${120 - elapsedTime} ثانية للفيديو`, target: 'video' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (dataConnRef.current) dataConnRef.current.send({ type: 'VIDEO_ON' });
      
      // إعادة الاتصال مع الفيديو
      if (callRef.current && peerRef.current) {
        const newCall = peerRef.current.call(callRef.current.peer, stream);
        setupCallHandlers(newCall);
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
    <div className="h-screen w-screen bg-slate-950 text-white flex flex-col items-center justify-center relative overflow-hidden font-sans">
      {/* طبقة الفيديو */}
      {isVideoActive && (
        <div className="absolute inset-0 z-0 flex flex-col animate-in fade-in duration-700">
          <video ref={remoteVideoRef} autoPlay playsInline className="flex-1 bg-black object-cover border-b border-white/10" />
          <video ref={localVideoRef} autoPlay playsInline muted className="flex-1 bg-black object-cover" />
          <div className="absolute top-6 left-6 bg-black/50 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest border border-white/10 uppercase">Stranger</div>
          <div className="absolute bottom-32 left-6 bg-indigo-600/50 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest border border-white/10 uppercase">You</div>
        </div>
      )}

      {/* واجهة البداية */}
      {appState === AppState.IDLE && (
        <div className="z-10 w-full max-w-sm px-8 text-center animate-in slide-in-from-bottom-12 duration-700">
          <h1 className="text-8xl font-black italic tracking-tighter mb-4 drop-shadow-2xl">AnyOne</h1>
          <p className="text-slate-400 mb-10 font-medium tracking-tight">تحدث مع الغرباء فوراً وبكل سهولة</p>
          <div className="grid grid-cols-1 gap-3">
            {LANGUAGES.map(lang => (
              <button key={lang.code} onClick={() => handleStart(lang.code)} className="group flex items-center justify-between bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10 px-6 py-5 rounded-3xl transition-all active:scale-95">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{lang.flag}</span>
                  <span className="font-bold text-xl">{lang.name}</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M14 5l7 7-7 7" strokeWidth={3} /></svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* واجهة البحث */}
      {appState === AppState.MATCHING && (
        <div className="z-10 flex flex-col items-center gap-10 text-center animate-in zoom-in-95">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-indigo-500 rounded-full transition-all duration-1000" 
                 style={{ clipPath: `polygon(50% 50%, -50% -50%, ${100 - (matchTimer/30)*100}% -50%, 150% -50%, 150% 150%, -50% 150%, -50% -50%)`, transform: 'rotate(-90deg)' }} />
            <div className="flex flex-col items-center">
              <span className="text-6xl font-black italic">{matchTimer}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Wait</span>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-black italic animate-pulse">Searching...</h2>
            <p className="bg-white/5 border border-white/10 px-6 py-2 rounded-full text-indigo-400 text-xs font-black uppercase tracking-widest">{statusMsg}</p>
          </div>
          <button onClick={cleanup} className="text-slate-500 hover:text-white font-bold transition-colors">إلغاء</button>
        </div>
      )}

      {/* واجهة الاتصال */}
      {appState === AppState.CONNECTED && (
        <div className="z-10 flex flex-col items-center gap-10 w-full max-w-sm px-8 h-full pt-20">
          <div className="bg-black/60 backdrop-blur-3xl border border-white/10 px-8 py-4 rounded-full text-4xl font-mono font-black shadow-2xl tracking-tighter">
            {Math.floor(elapsedTime/60)}:{(elapsedTime%60).toString().padStart(2, '0')}
          </div>

          {!isVideoActive && (
            <div className="flex-1 flex flex-col items-center justify-center gap-8">
              <div className="w-48 h-48 rounded-full bg-indigo-500/10 border-4 border-indigo-500/30 flex items-center justify-center relative">
                 <div className="flex gap-1.5 items-center">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="w-2 bg-indigo-500 rounded-full animate-wave" style={{ animationDelay: `${i*0.1}s` }} />
                    ))}
                 </div>
                 <div className="absolute -bottom-4 bg-green-500 text-black px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Live Audio</div>
              </div>
              <p className="text-slate-400 font-medium italic">أنت متصل الآن بمستخدم {LANGUAGES.find(l => l.code === selectedLang)?.name}</p>
            </div>
          )}

          <div className={`flex items-center gap-6 pb-12 ${isVideoActive ? 'fixed bottom-4' : ''}`}>
             <button onClick={() => elapsedTime >= 60 ? setIsChatOpen(true) : setToast({msg: `انتظر ${60 - elapsedTime} ثانية للشات`, target: 'chat'})} 
                     className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all">
               <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2} /></svg>
             </button>
             <button onClick={cleanup} className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl hover:bg-red-500 active:scale-90 transition-all border-4 border-red-500/20">
               <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={4} /></svg>
             </button>
             <button onClick={toggleVideo} className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all ${isVideoActive ? 'bg-green-600 border-green-400' : 'bg-white/5 border-white/10'}`}>
               <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2} /></svg>
             </button>
          </div>
          {toast && <div className="fixed bottom-40 bg-white text-black px-6 py-2 rounded-2xl text-[10px] font-black uppercase animate-bounce shadow-2xl">{toast.msg}</div>}
        </div>
      )}

      {/* واجهة الخطأ */}
      {appState === AppState.ERROR && (
        <div className="z-10 flex flex-col items-center gap-8 text-center animate-in zoom-in-95">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center border border-red-500/30">
            <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2} /></svg>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black italic">عذراً!</h2>
            <p className="text-slate-400 max-w-xs">{error}</p>
          </div>
          <button onClick={() => handleStart(selectedLang!)} className="bg-indigo-600 px-10 py-4 rounded-3xl font-black shadow-xl shadow-indigo-600/20 hover:bg-indigo-500 active:scale-95 transition-all">حاول مجدداً</button>
          <button onClick={cleanup} className="text-slate-500 font-bold">رجوع</button>
        </div>
      )}

      {/* نظام المحادثة */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-in slide-in-from-bottom duration-300">
           <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-900/50 backdrop-blur-xl">
             <h3 className="text-2xl font-black italic tracking-tighter uppercase">Chat Room</h3>
             <button onClick={() => setIsChatOpen(false)} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
               <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3} /></svg>
             </button>
           </div>
           <div className="flex-1 overflow-y-auto p-6 space-y-4">
             {messages.map((m, i) => (
               <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`px-5 py-3 rounded-2xl max-w-[80%] text-sm font-semibold shadow-lg ${m.sender === 'me' ? 'bg-white text-black' : 'bg-indigo-600 text-white'}`}>{m.text}</div>
               </div>
             ))}
           </div>
           <div className="p-6 pb-12 flex gap-2 border-t border-white/5">
             <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} placeholder="اكتب رسالة..." className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-4 focus:outline-none focus:border-indigo-500 transition-all" />
             <button onClick={sendMessage} className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all">
               <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4} /></svg>
             </button>
           </div>
        </div>
      )}

      <style>{`
        @keyframes wave { 0%, 100% { height: 10px; } 50% { height: 40px; } }
        .animate-wave { animation: wave 0.8s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
