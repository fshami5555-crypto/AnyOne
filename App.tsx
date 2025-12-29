
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v28-'; // نسخة جديدة لتجنب تداخل البيانات القديمة
const MAX_SLOTS = 8; 
const MATCH_TIMEOUT = 30;

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

  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [callerId, setCallerId] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const isBusy = useRef<boolean>(false);
  
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const timersRef = useRef<{ match?: number, session?: number, ring?: any }>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);

  // تهيئة الصوت لضمان العمل فور الرد
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    // تشغيل عنصر الصوت الفارغ لفك حظر المتصفح
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
  }, []);

  // التعامل مع الرسائل من الـ Service Worker (عند الضغط على "رد" في الإشعار)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'ACTION_ANSWER') {
        handleAccept();
      } else if (event.data.type === 'ACTION_REJECT') {
        handleReject();
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    
    // التحقق من وجود بارامتر رد في الرابط عند الفتح
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'answer') {
      setTimeout(handleAccept, 1000);
    }

    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [incomingCall]);

  // طلب الصلاحيات
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {}
    };
    requestWakeLock();
    return () => { if (wakeLockRef.current) wakeLockRef.current.release(); };
  }, []);

  const startRinging = (from: string) => {
    initAudio();
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('مكالمة واردة - AnyOne', {
        body: `يرن الآن من: ${from}`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3616/3616215.png',
        tag: 'call-' + from,
        renotify: true,
        requireInteraction: true,
        actions: [
          { action: 'answer', title: 'رد ✅' },
          { action: 'reject', title: 'رفض ❌' }
        ]
      } as any);
    }

    const ctx = audioCtxRef.current!;
    const playTone = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.5);
    };
    playTone();
    timersRef.current.ring = setInterval(playTone, 2000);
  };

  const stopRinging = () => {
    if (timersRef.current.ring) {
      clearInterval(timersRef.current.ring);
      timersRef.current.ring = null;
    }
  };

  useEffect(() => {
    const peer = new Peer(getPersistentNumericId(), {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      debug: 1
    });
    
    peer.on('open', (id) => {
      setMyPeerId(id);
      peerRef.current = peer;
    });

    peer.on('connection', (conn) => setupDataConnection(conn));

    peer.on('call', (call) => {
      if (isBusy.current) {
        call.answer(); 
        setTimeout(() => call.close(), 500);
        return;
      }
      setCallerId(call.peer);
      setIncomingCall(call);
      startRinging(call.peer);
    });

    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        cleanup();
        setError("هذا المعرف غير متصل حالياً.");
        setAppState(AppState.ERROR);
      }
    });

    return () => { peer.destroy(); stopRinging(); };
  }, []);

  const cleanup = useCallback(() => {
    isBusy.current = false;
    stopRinging();
    Object.values(timersRef.current).forEach(t => { if (typeof t === 'number') window.clearInterval(t); });
    if (callRef.current) callRef.current.close();
    if (dataConnRef.current) {
      dataConnRef.current.send({ type: 'DISCONNECT' });
      dataConnRef.current.close();
    }
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    
    callRef.current = null;
    dataConnRef.current = null;
    localStreamRef.current = null;
    setIncomingCall(null);
    setCallerId(null);
    setAppState(AppState.IDLE);
    setElapsedTime(0);
    setMatchTimer(MATCH_TIMEOUT);
    setIsVideoActive(false);
    setIsChatOpen(false);
    setMessages([]);
    setInputText('');
    setDialerValue('');
    setIsDialerOpen(false);
  }, []);

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (data?.type === 'REJECTED') {
        cleanup();
        setError("تم رفض المكالمة من الطرف الآخر.");
        setAppState(AppState.ERROR);
      } else if (data?.type === 'DISCONNECT') {
        cleanup();
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
      remoteAudioRef.current.play().catch(() => {
        setToast("اضغط في أي مكان لتفعيل الصوت");
      });

      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      }
      isBusy.current = true;
      setAppState(AppState.CONNECTED);
      if (!timersRef.current.session) {
        timersRef.current.session = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
      }
    });
    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  const handleAccept = async (callInstance?: any) => {
    const activeCall = callInstance || incomingCall;
    if (!activeCall) return;
    initAudio();
    stopRinging();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoActive });
      localStreamRef.current = stream;
      activeCall.answer(stream);
      setupCall(activeCall);
      setIncomingCall(null);
      setCallerId(null);
    } catch (e) {
      setToast("يرجى تفعيل الميكروفون");
    }
  };

  const handleReject = () => {
    stopRinging();
    if (dataConnRef.current) dataConnRef.current.send({ type: 'REJECTED' });
    if (incomingCall) incomingCall.close();
    setIncomingCall(null);
    setCallerId(null);
  };

  const handleDialerCall = async () => {
    if (!dialerValue.trim()) return;
    initAudio();
    setAppState(AppState.MATCHING);
    setStatusMsg(`جاري الاتصال بـ ${dialerValue}...`);
    setIsDialerOpen(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const conn = peerRef.current!.connect(dialerValue, { reliable: true });
      setupDataConnection(conn);
      const call = peerRef.current!.call(dialerValue, stream);
      setupCall(call);
    } catch (e) {
      cleanup();
      setError("صلاحيات الميكروفون مطلوبة");
    }
  };

  const toggleVideo = async () => {
    initAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isVideoActive });
      localStreamRef.current = stream;
      if (!isVideoActive) {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        if (dataConnRef.current) dataConnRef.current.send({ type: 'VIDEO_SIGNAL' });
        if (callRef.current && peerRef.current) {
          setupCall(peerRef.current.call(callRef.current.peer, stream));
        }
        setIsVideoActive(true);
      } else {
        stream.getVideoTracks().forEach(t => t.stop());
        setIsVideoActive(false);
      }
    } catch (e) { setToast("فشل تفعيل الكاميرا"); }
  };

  // تحسين سرعة البحث
  const startMatching = async (slot: number) => {
    if (slot > MAX_SLOTS) {
      setStatusMsg("جاري المحاولة مجدداً...");
      setTimeout(() => startMatching(1), 500);
      return;
    }
    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    setStatusMsg(`فحص القناة ${slot}...`);
    
    const conn = peerRef.current!.connect(roomId, { reliable: true, connectionTimeout: 1000 });
    
    const timeout = setTimeout(() => {
      conn.close();
      becomeHost(slot);
    }, 1200);

    conn.on('open', async () => {
      clearTimeout(timeout);
      setStatusMsg(`تم الربط!`);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setupDataConnection(conn);
        setupCall(peerRef.current!.call(roomId, stream));
      } catch (e) { cleanup(); }
    });
  };

  const becomeHost = (slot: number) => {
    if (isBusy.current) return;
    const roomId = `${APP_PREFIX}${selectedLang}-${slot}`;
    const roomPeer = new Peer(roomId);
    roomPeer.on('open', () => {
      setStatusMsg(`في انتظار شريك...`);
      roomPeer.on('connection', (conn) => setupDataConnection(conn));
      roomPeer.on('call', async (call) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          call.answer(stream);
          setupCall(call);
        } catch (e) {}
      });
      setTimeout(() => {
        if (!isBusy.current && appState === AppState.MATCHING) {
          roomPeer.destroy();
          startMatching(slot + 1);
        }
      }, 4000); // تقليل وقت الانتظار لزيادة السرعة
    });
    roomPeer.on('error', () => {
      roomPeer.destroy();
      startMatching(slot + 1);
    });
  };

  const handleStart = (langCode: string) => {
    initAudio();
    setSelectedLang(langCode);
    setAppState(AppState.MATCHING);
    setMatchTimer(MATCH_TIMEOUT);
    timersRef.current.match = window.setInterval(() => {
      setMatchTimer(prev => {
        if (prev <= 1) { cleanup(); setError("لم يتم العثور على أحد متاح."); return 0; }
        return prev - 1;
      });
    }, 1000);
    startMatching(1);
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  const copyId = () => {
    navigator.clipboard.writeText(myPeerId);
    setToast("تم النسخ ✅");
    setTimeout(() => setToast(null), 2000);
  };

  const dial = (num: string) => { initAudio(); if (dialerValue.length < 12) setDialerValue(prev => prev + num); };

  return (
    <div onClick={initAudio} className="h-screen w-screen bg-[#020617] text-white flex flex-col items-center justify-center relative overflow-hidden font-sans select-none">
      
      {/* عنصر الصوت الخفي - مهم جداً لفك حظر الصوت */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Navbar */}
      <div className="fixed top-0 left-0 right-0 h-16 bg-slate-900/50 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">AnyOne</span>
        </div>
        <button onClick={copyId} className="flex flex-col items-end active:scale-95">
          <span className="text-[10px] font-bold text-slate-500 uppercase">My ID</span>
          <span className="text-lg font-mono font-black text-indigo-400">{myPeerId}</span>
        </button>
      </div>

      {/* Video Background */}
      {isVideoActive && (
        <div className="absolute inset-0 z-0 flex flex-col bg-black">
          <video ref={remoteVideoRef} autoPlay playsInline className="flex-1 object-cover" />
          <video ref={localVideoRef} autoPlay playsInline muted className="flex-1 object-cover border-t border-white/10" />
        </div>
      )}

      {/* Incoming Call UI */}
      {callerId && (
        <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 px-6 text-center">
           <div className="w-32 h-32 bg-indigo-600 rounded-full mb-8 flex items-center justify-center shadow-[0_0_60px_rgba(79,70,229,0.5)] animate-pulse">
             <svg className="w-16 h-16 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
           </div>
           <h2 className="text-xl font-black text-indigo-400 uppercase tracking-widest mb-2">Incoming Call</h2>
           <p className="text-5xl font-mono font-black mb-20 text-white tracking-widest">{callerId}</p>
           <div className="flex gap-12">
             <button onClick={handleReject} className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl border-4 border-white/10"><svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={5}/></svg></button>
             <button onClick={() => handleAccept()} className="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center shadow-2xl border-4 border-white/10 animate-bounce"><svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg></button>
           </div>
        </div>
      )}

      {/* Main Home Screen */}
      {appState === AppState.IDLE && (
        <div className="z-10 w-full max-w-md px-10 text-center animate-in slide-in-from-bottom-10 duration-700 overflow-y-auto pb-24 no-scrollbar">
          <div className="mb-10 pt-12">
            <h1 className="text-7xl font-black italic tracking-tighter text-white mb-2">AnyOne</h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest">Connect Instantly</p>
          </div>
          <div className="grid gap-3">
            {LANGUAGES.map(lang => (
              <button key={lang.code} onClick={() => handleStart(lang.code)} className="flex items-center justify-between bg-white/5 border border-white/10 p-5 rounded-[2rem] active:scale-95 transition-all">
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{lang.flag}</span>
                  <span className="text-xl font-bold">{lang.name}</span>
                </div>
                <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M14 5l7 7-7 7" strokeWidth={4} /></svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dialer Button */}
      {appState === AppState.IDLE && !isDialerOpen && (
        <button onClick={() => setIsDialerOpen(true)} className="fixed bottom-10 right-10 w-20 h-20 bg-green-600 rounded-full flex items-center justify-center shadow-2xl z-40 border-4 border-white/20 active:scale-90 transition-all">
          <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
        </button>
      )}

      {/* Dialer View */}
      {isDialerOpen && (
        <div className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-3xl flex flex-col animate-in slide-in-from-bottom duration-400 p-8">
           <button onClick={() => setIsDialerOpen(false)} className="self-end p-4 text-slate-500"><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3}/></svg></button>
           <div className="flex-1 flex flex-col items-center justify-center">
              <span className="text-7xl font-mono font-black mb-12 tracking-tighter">{dialerValue || '--------'}</span>
              <div className="grid grid-cols-3 gap-5 mb-12">
                {[1,2,3,4,5,6,7,8,9,'*',0,'#'].map(n => (
                  <button key={n} onClick={() => dial(n.toString())} className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-black text-2xl active:bg-white/20">{n}</button>
                ))}
              </div>
              <button onClick={handleDialerCall} className="w-28 h-28 bg-green-600 rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all"><svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg></button>
           </div>
        </div>
      )}

      {/* Outgoing Call Screen */}
      {appState === AppState.MATCHING && (
        <div className="fixed inset-0 z-[150] bg-[#020617] flex flex-col items-center justify-center">
          <div className="relative w-72 h-72 flex items-center justify-center mb-10">
            <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full radar-wave" />
            <span className="text-8xl font-black italic text-indigo-500">{matchTimer}</span>
          </div>
          <h2 className="text-3xl font-black italic mb-4">جاري الاتصال...</h2>
          <p className="bg-white/5 px-8 py-3 rounded-full text-indigo-400 text-xs font-black tracking-widest uppercase">{statusMsg}</p>
          <button onClick={cleanup} className="mt-20 bg-red-600/20 text-red-500 px-10 py-4 rounded-full font-bold">إلغاء</button>
        </div>
      )}

      {/* Connected Call UI */}
      {appState === AppState.CONNECTED && (
        <div className="z-10 flex flex-col items-center justify-between w-full h-full py-24 px-8">
          <div className="bg-black/60 backdrop-blur-2xl px-12 py-4 rounded-full text-5xl font-mono font-black text-indigo-400 shadow-2xl">
            {Math.floor(elapsedTime/60)}:{(elapsedTime%60).toString().padStart(2, '0')}
          </div>
          {!isVideoActive && (
            <div className="flex flex-col items-center gap-10">
               <div className="w-64 h-64 rounded-[4rem] bg-indigo-500/5 border-2 border-indigo-500/20 flex items-center justify-center">
                  <div className="flex gap-3 items-center h-32">
                    {[...Array(7)].map((_, i) => (
                      <div key={i} className="w-3 bg-indigo-500 rounded-full animate-pulse" style={{ height: `${30 + Math.random()*70}%`, animationDelay: `${i*0.1}s` }} />
                    ))}
                  </div>
               </div>
               <p className="text-white text-2xl font-black italic uppercase tracking-tighter">Live Conversation</p>
            </div>
          )}
          <div className="flex items-center gap-8">
             <button onClick={() => setIsChatOpen(true)} className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"><svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2}/></svg></button>
             <button onClick={cleanup} className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl border-4 border-white/10 active:scale-90 transition-all"><svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={5}/></svg></button>
             <button onClick={toggleVideo} className={`w-16 h-16 rounded-full border flex items-center justify-center ${isVideoActive ? 'bg-green-600 border-green-400' : 'bg-white/5 border-white/10'}`}><svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2}/></svg></button>
          </div>
        </div>
      )}

      {/* Error UI */}
      {appState === AppState.ERROR && (
        <div className="z-10 flex flex-col items-center gap-8 text-center px-10">
          <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center border-2 border-red-500/20"><svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2.5}/></svg></div>
          <h2 className="text-4xl font-black italic">فشل الاتصال</h2>
          <p className="text-slate-400">{error}</p>
          <button onClick={cleanup} className="bg-indigo-600 px-12 py-5 rounded-full font-black text-xl shadow-2xl active:scale-95 transition-all">العودة للرئيسية</button>
        </div>
      )}

      {/* Chat Component */}
      {isChatOpen && (
        <div className="fixed inset-0 z-[200] bg-[#020617] flex flex-col animate-in slide-in-from-bottom duration-400">
           <div className="p-8 border-b border-white/5 flex justify-between items-center bg-slate-900/40 backdrop-blur-3xl">
             <h3 className="text-3xl font-black italic text-indigo-400">Secure Chat</h3>
             <button onClick={() => setIsChatOpen(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3}/></svg></button>
           </div>
           <div className="flex-1 overflow-y-auto p-8 space-y-4 no-scrollbar">
             {messages.map((m, i) => (
               <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`px-6 py-4 rounded-[1.5rem] max-w-[85%] text-lg font-bold shadow-xl border ${m.sender === 'me' ? 'bg-white text-black rounded-tr-none' : 'bg-indigo-600 text-white rounded-tl-none border-indigo-500'}`}>{m.text}</div>
               </div>
             ))}
           </div>
           <div className="p-8 pb-14 flex gap-3 bg-slate-900/50 backdrop-blur-3xl">
             <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} placeholder="Message..." className="flex-1 bg-white/5 border border-white/10 rounded-full px-8 py-5 focus:outline-none focus:border-indigo-500 transition-all font-bold text-lg" />
             <button onClick={sendMessage} className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center active:scale-90"><svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4}/></svg></button>
           </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-white text-black px-8 py-3 rounded-full text-xs font-black uppercase animate-bounce shadow-2xl z-[300] border-2 border-indigo-500">
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
