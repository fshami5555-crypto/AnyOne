
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v27-';
const MAX_SLOTS = 10; 
const MATCH_TIMEOUT = 45;

const LANGUAGES = [
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
];

const getPersistentNumericId = () => {
  const storageKey = 'anyone_device_id';
  let savedId = localStorage.getItem(storageKey);
  
  if (!savedId) {
    savedId = Math.floor(10000000 + Math.random() * 90000000).toString();
    localStorage.setItem(storageKey, savedId);
  }
  
  return savedId;
};

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
  
  const [myPeerId, setMyPeerId] = useState<string>('...');
  const [dialerValue, setDialerValue] = useState<string>('');
  const [isDialerOpen, setIsDialerOpen] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const isBusy = useRef<boolean>(false);
  
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const timersRef = useRef<{ match?: number, session?: number }>({});

  useEffect(() => {
    const numericId = getPersistentNumericId();
    
    const initPeer = () => {
      const peer = new Peer(numericId, {
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      });
      
      peer.on('open', (id) => {
        setMyPeerId(id);
        peerRef.current = peer;
      });

      peer.on('connection', (conn) => {
        // نربط البيانات حتى لو كنا مشغولين لتمكين إرسال إشارة الفيديو
        setupDataConnection(conn);
      });

      peer.on('call', async (incomingCall) => {
        // إذا كنا في مكالمة بالفعل، نقوم بالرد تلقائياً لتحديث البث (ترقية لفيديو)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: isVideoActive // الرد بنفس الحالة الحالية للمستخدم
          });
          localStreamRef.current = stream;
          incomingCall.answer(stream);
          setupCall(incomingCall);
        } catch (e) {
          console.error("Call error", e);
        }
      });

      peer.on('error', (err) => {
        console.error("Peer error:", err);
        if (err.type === 'unavailable-id') {
           setError("هذا المعرف مستخدم بالفعل في نافذة أخرى.");
           setAppState(AppState.ERROR);
        } else if (err.type === 'peer-unavailable') {
          setError("عذراً، المعرف الرقمي غير متاح حالياً أو غير موجود");
          setAppState(AppState.ERROR);
        }
      });
    };

    initPeer();
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [isVideoActive]);

  const cleanup = useCallback(() => {
    isBusy.current = false;
    Object.values(timersRef.current).forEach(t => {
      if (typeof t === 'number') window.clearInterval(t);
    });
    
    if (callRef.current) {
      callRef.current.removeAllListeners();
      callRef.current.close();
    }
    if (dataConnRef.current) {
      dataConnRef.current.removeAllListeners();
      dataConnRef.current.close();
    }
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    
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
    setDialerValue('');
    setIsDialerOpen(false);
  }, []);

  const onConnected = () => {
    isBusy.current = true;
    setAppState(AppState.CONNECTED);
    setIsDialerOpen(false);
    if (timersRef.current.match) window.clearInterval(timersRef.current.match);
    if (!timersRef.current.session) {
      timersRef.current.session = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    }
  };

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (data?.type === 'BUSY') {
        cleanup();
        setError("الشريك في مكالمة أخرى حالياً");
      } else if (data?.type === 'VIDEO_SIGNAL') {
        setIsVideoActive(true);
      } else if (typeof data === 'string') {
        setMessages(prev => [...prev, { sender: 'them', text: data }]);
      }
    });
    conn.on('close', cleanup);
  };

  const setupCall = (call: any) => {
    // إذا كان هناك مكالمة قديمة، نزيل المستمعات منها قبل استبدالها
    if (callRef.current && callRef.current !== call) {
      callRef.current.removeAllListeners();
      callRef.current.close();
    }

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
    call.on('error', cleanup);
  };

  const handleDialerCall = async () => {
    if (!dialerValue.trim() || !peerRef.current) return;
    setAppState(AppState.MATCHING);
    setStatusMsg(`جاري الاتصال بـ ${dialerValue}...`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const conn = peerRef.current.connect(dialerValue, { reliable: true });
      setupDataConnection(conn);
      setupCall(peerRef.current.call(dialerValue, stream));
    } catch (e) {
      cleanup();
      setError("يرجى تفعيل الميكروفون");
    }
  };

  const toggleVideo = async () => {
    // تقليل القيد الزمني للمساعدة في تجربة المستخدم
    if (elapsedTime < 5 && !isVideoActive) {
      setToast(`الفيديو متاح قريباً`);
      setTimeout(() => setToast(null), 3000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isVideoActive });
      localStreamRef.current = stream;
      
      if (!isVideoActive) {
        // تفعيل الفيديو
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        if (dataConnRef.current) dataConnRef.current.send({ type: 'VIDEO_SIGNAL' });
        
        // إعادة الاتصال بالبث الجديد (فيديو) مع تعطيل المستمعات القديمة لمنع cleanup
        if (callRef.current && peerRef.current) {
          const partnerId = callRef.current.peer;
          const newCall = peerRef.current.call(partnerId, stream);
          setupCall(newCall);
        }
        setIsVideoActive(true);
      } else {
        // تعطيل الفيديو (العودة للصوت فقط)
        stream.getVideoTracks().forEach(t => t.stop());
        setIsVideoActive(false);
        // إشعار الطرف الآخر (اختياري، هنا سنعتمد على انقطاع البث)
      }
    } catch (e) { 
      console.error(e);
      setToast("فشل فتح الكاميرا - تأكد من إعطاء الصلاحية"); 
    }
  };

  const startMatching = async (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang || !peerRef.current) return;
    if (slot > MAX_SLOTS) {
      setStatusMsg("إعادة محاولة الربط...");
      setTimeout(() => startMatching(1), 1000);
      return;
    }
    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    setStatusMsg(`فحص القناة ${slot}...`);
    const scanner = new Peer();
    let scanTimeout = setTimeout(() => {
      scanner.destroy();
      becomeHost(slot);
    }, 2000);
    scanner.on('open', () => {
      const conn = scanner.connect(roomId, { reliable: true });
      conn.on('open', async () => {
        clearTimeout(scanTimeout);
        scanner.destroy();
        setStatusMsg(`تم العثور على شريك!`);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          const mainConn = peerRef.current!.connect(roomId, { reliable: true });
          setupDataConnection(mainConn);
          setupCall(peerRef.current!.call(roomId, stream));
        } catch (e) {
          cleanup();
          setError("مشكلة في الميكروفون");
        }
      });
    });
    scanner.on('error', () => {
      clearTimeout(scanTimeout);
      scanner.destroy();
      becomeHost(slot);
    });
  };

  const becomeHost = (slot: number) => {
    if (appState === AppState.CONNECTED || !selectedLang || !peerRef.current) return;
    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    const roomPeer = new Peer(roomId);
    roomPeer.on('open', () => {
      setStatusMsg(`ننتظر شريكاً في القناة ${slot}..`);
      roomPeer.on('connection', (conn) => setupDataConnection(conn));
      roomPeer.on('call', async (incomingCall) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          incomingCall.answer(stream);
          setupCall(incomingCall);
        } catch (e) { console.error(e); }
      });
      setTimeout(() => {
        if (!isBusy.current && appState === AppState.MATCHING) {
          roomPeer.destroy();
          startMatching(slot + 1);
        }
      }, 8000);
    });
    roomPeer.on('error', () => {
      roomPeer.destroy();
      startMatching(slot + 1);
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
          setError("لا يوجد مستخدمين متاحين حالياً");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    setTimeout(() => startMatching(1), 200);
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  const copyId = () => {
    navigator.clipboard.writeText(myPeerId);
    setToast("تم نسخ المعرف الرقمي");
    setTimeout(() => setToast(null), 2000);
  };

  const dial = (num: string) => {
    if (dialerValue.length < 12) setDialerValue(prev => prev + num);
  };

  const backspace = () => {
    setDialerValue(prev => prev.slice(0, -1));
  };

  return (
    <div className="h-screen w-screen bg-[#020617] text-white flex flex-col items-center justify-center relative overflow-hidden font-sans">
      
      <div className="fixed top-0 left-0 right-0 h-16 bg-slate-900/50 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">AnyOne</span>
        </div>
        <button onClick={copyId} className="flex flex-col items-end active:scale-95 transition-all">
          <span className="text-[10px] font-bold text-slate-500 uppercase">My Digital ID</span>
          <span className="text-lg font-mono font-black text-indigo-400 tracking-wider">{myPeerId}</span>
        </button>
      </div>

      {isVideoActive && (
        <div className="absolute inset-0 z-0 flex flex-col animate-in fade-in duration-700 bg-black">
          <div className="flex-1 relative">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-20 left-6 bg-black/60 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">Partner</div>
          </div>
          <div className="flex-1 relative border-t border-white/10">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-32 left-6 bg-indigo-600/60 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold border border-white/10 uppercase tracking-widest">You</div>
          </div>
        </div>
      )}

      {appState === AppState.IDLE && (
        <div className="z-10 w-full max-w-md px-10 text-center animate-in slide-in-from-bottom-10 duration-700 overflow-y-auto no-scrollbar pb-24">
          <div className="mb-12 pt-12">
            <div className="w-24 h-24 bg-indigo-600 rounded-[2.5rem] mx-auto mb-6 flex items-center justify-center shadow-[0_0_50px_rgba(79,70,229,0.3)] border-4 border-white/10">
              <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 18.5a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM12 18.5L12 18.5" strokeWidth={2.5}/><path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2" strokeWidth={2.5} /></svg>
            </div>
            <h1 className="text-7xl font-black italic tracking-tighter text-white mb-2">AnyOne</h1>
            <p className="text-slate-400 font-medium italic">اختر لغتك المفضلة للبدء</p>
          </div>

          <div className="space-y-4">
            {LANGUAGES.map(lang => (
              <button key={lang.code} onClick={() => handleStart(lang.code)} className="w-full group flex items-center justify-between bg-white/5 border border-white/10 hover:border-indigo-500 hover:bg-indigo-500/10 p-6 rounded-[2rem] transition-all active:scale-95">
                <div className="flex items-center gap-5">
                  <span className="text-5xl">{lang.flag}</span>
                  <span className="text-2xl font-bold">{lang.name}</span>
                </div>
                <div className="w-12 h-12 rounded-full bg-indigo-600/10 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M14 5l7 7-7 7" strokeWidth={3.5} /></svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {appState === AppState.IDLE && !isDialerOpen && (
        <button onClick={() => setIsDialerOpen(true)} className="fixed bottom-10 right-10 w-20 h-20 bg-green-600 rounded-full flex items-center justify-center shadow-[0_20px_40px_rgba(22,163,74,0.4)] hover:bg-green-500 active:scale-90 transition-all z-40 border-4 border-white/20">
          <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
        </button>
      )}

      {isDialerOpen && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-3xl flex flex-col animate-in slide-in-from-bottom duration-500">
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <button onClick={() => setIsDialerOpen(false)} className="absolute top-10 right-10 text-slate-500 hover:text-white">
               <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={2.5}/></svg>
            </button>
            <div className="mb-12 text-center">
              <span className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-4 block">اتصال مباشر بالمعرف</span>
              <div className="h-20 flex items-center justify-center">
                <span className="text-6xl font-mono font-black tracking-widest text-white">{dialerValue || '--------'}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6 max-w-xs w-full">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map((n) => (
                <button key={n} onClick={() => dial(n.toString())} className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex flex-col items-center justify-center hover:bg-white/10 active:bg-white/20 transition-all">
                  <span className="text-3xl font-bold">{n}</span>
                </button>
              ))}
            </div>
            <div className="mt-12 flex gap-8 items-center">
              <button onClick={backspace} className="w-16 h-16 rounded-full flex items-center justify-center text-slate-500 hover:text-white">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.41-6.41C9.77 5.22 10.19 5 10.64 5H20c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-9.36c-.45 0-.87-.22-1.23-.59L3 12z" strokeWidth={2}/></svg>
              </button>
              <button onClick={handleDialerCall} disabled={!dialerValue} className="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center shadow-2xl shadow-green-600/30 hover:bg-green-500 active:scale-90 transition-all disabled:opacity-30 disabled:grayscale">
                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
              </button>
              <div className="w-16" />
            </div>
          </div>
        </div>
      )}

      {appState === AppState.MATCHING && (
        <div className="z-10 flex flex-col items-center gap-14 text-center animate-in zoom-in-95">
          <div className="relative w-64 h-64 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-indigo-500/10 rounded-full radar-wave" />
            <div className="absolute inset-0 border-4 border-indigo-500/5 rounded-full radar-wave" style={{animationDelay:'0.5s'}} />
            <div className="flex flex-col items-center z-10">
               <span className="text-8xl font-black italic text-indigo-500 drop-shadow-[0_0_20px_rgba(99,102,241,0.5)]">{matchTimer}</span>
               <span className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 mt-3">Calling...</span>
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-black italic text-white animate-pulse">جاري الربط</h2>
            <div className="bg-white/5 border border-white/10 px-8 py-3 rounded-full text-indigo-400 text-xs font-black uppercase tracking-widest">{statusMsg}</div>
          </div>
          <button onClick={cleanup} className="bg-white/5 px-10 py-4 rounded-full font-bold text-slate-400 hover:text-white transition-colors">إلغاء</button>
        </div>
      )}

      {appState === AppState.CONNECTED && (
        <div className="z-10 flex flex-col items-center justify-between w-full h-full py-24 px-8">
          <div className="bg-black/60 backdrop-blur-2xl border border-white/10 px-12 py-5 rounded-full text-5xl font-mono font-black text-indigo-400 shadow-2xl">
            {Math.floor(elapsedTime/60)}:{(elapsedTime%60).toString().padStart(2, '0')}
          </div>

          {!isVideoActive && (
            <div className="flex flex-col items-center gap-12">
               <div className="w-64 h-64 rounded-[3rem] bg-indigo-500/10 border-4 border-indigo-500/20 flex items-center justify-center relative">
                  <div className="flex gap-3 items-center">
                    {[...Array(7)].map((_, i) => (
                      <div key={i} className="w-3 bg-indigo-500 rounded-full animate-pulse" style={{ height: `${30 + Math.random()*50}px`, animationDelay: `${i*0.1}s` }} />
                    ))}
                  </div>
                  <div className="absolute -bottom-5 bg-green-500 text-black px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest shadow-xl">متصل</div>
               </div>
               <p className="text-white text-2xl font-bold italic">أنت على الهواء الآن!</p>
            </div>
          )}

          <div className={`flex items-center gap-8 ${isVideoActive ? 'fixed bottom-10' : ''}`}>
             <button onClick={() => setIsChatOpen(true)} className="w-18 h-18 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 transition-all shadow-xl" style={{ width: '72px', height: '72px' }}>
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2.5}/></svg>
             </button>
             <button onClick={cleanup} className="w-28 h-28 bg-red-600 rounded-full flex items-center justify-center shadow-2xl hover:bg-red-500 active:scale-90 transition-all border-4 border-white/10">
               <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={5}/></svg>
             </button>
             <button onClick={toggleVideo} className={`w-18 h-18 rounded-full flex items-center justify-center border transition-all shadow-xl ${isVideoActive ? 'bg-green-600 border-green-400' : 'bg-white/10 border-white/20'}`} style={{ width: '72px', height: '72px' }}>
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2.5}/></svg>
             </button>
          </div>
        </div>
      )}

      {appState === AppState.ERROR && (
        <div className="z-10 flex flex-col items-center gap-10 text-center animate-in zoom-in-95">
          <div className="w-28 h-28 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
            <svg className="w-14 h-14 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2.5}/></svg>
          </div>
          <div className="space-y-3">
            <h2 className="text-4xl font-black italic">حدث خطأ</h2>
            <p className="text-slate-400 max-w-xs">{error}</p>
          </div>
          <button onClick={cleanup} className="bg-indigo-600 px-12 py-5 rounded-[2rem] font-black text-xl hover:bg-indigo-500 transition-all">العودة للرئيسية</button>
        </div>
      )}

      {isChatOpen && (
        <div className="fixed inset-0 z-[200] bg-[#020617] flex flex-col animate-in slide-in-from-bottom duration-400">
           <div className="p-8 border-b border-white/5 flex justify-between items-center bg-slate-900/40 backdrop-blur-3xl">
             <h3 className="text-3xl font-black italic tracking-tighter uppercase">Chat</h3>
             <button onClick={() => setIsChatOpen(false)} className="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
               <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3.5}/></svg>
             </button>
           </div>
           <div className="flex-1 overflow-y-auto p-8 space-y-6 no-scrollbar">
             {messages.map((m, i) => (
               <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-${m.sender === 'me' ? 'right' : 'left'}-4`}>
                 <div className={`px-7 py-4 rounded-[2rem] max-w-[85%] text-base font-bold shadow-2xl ${m.sender === 'me' ? 'bg-white text-black rounded-tr-none' : 'bg-indigo-600 text-white rounded-tl-none'}`}>{m.text}</div>
               </div>
             ))}
           </div>
           <div className="p-8 pb-14 flex gap-4 border-t border-white/5 bg-slate-900/50 backdrop-blur-3xl">
             <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} placeholder="اكتب رسالة..." className="flex-1 bg-white/5 border border-white/10 rounded-full px-8 py-5 focus:outline-none focus:border-indigo-500 transition-all font-bold text-lg" />
             <button onClick={sendMessage} className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center shadow-2xl hover:bg-indigo-500 transition-all"><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4}/></svg></button>
           </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-white text-black px-8 py-3 rounded-full text-xs font-black uppercase animate-bounce shadow-2xl z-[300]">
          {toast}
        </div>
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;
