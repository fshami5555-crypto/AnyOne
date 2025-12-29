import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v10-';
const FAST_TIMEOUT = 2500;
const MAX_SEQUENTIAL_SLOTS = 10;

const LANGUAGES = [
  { code: 'ar', name: 'العربية', flag: '🇸🇦', baseCount: 42 },
  { code: 'en', name: 'English', flag: '🇺🇸', baseCount: 128 },
  { code: 'fr', name: 'Français', flag: '🇫🇷', baseCount: 35 },
  { code: 'es', name: 'Español', flag: '🇪🇸', baseCount: 22 },
  { code: 'pt', name: 'Português', flag: '🇧🇷', baseCount: 18 },
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');
  const [toast, setToast] = useState<{msg: string, target: 'chat' | 'video'} | null>(null);

  const isChatEnabled = elapsedTime >= 60;
  const isVideoEnabled = elapsedTime >= 120;

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const matchingTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  // نظام محاكاة عدد المستخدمين المباشرين
  useEffect(() => {
    // تعيين الأرقام الأولية
    const initial: Record<string, number> = {};
    LANGUAGES.forEach(l => initial[l.code] = l.baseCount + Math.floor(Math.random() * 10));
    setLiveCounts(initial);

    // تحديث الأرقام كل 5 ثوانٍ بشكل عشوائي طفيف
    const countInterval = setInterval(() => {
      setLiveCounts(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(code => {
          const change = Math.random() > 0.5 ? 1 : -1;
          next[code] = Math.max(5, next[code] + (Math.random() > 0.7 ? change : 0));
        });
        return next;
      });
    }, 5000);

    return () => clearInterval(countInterval);
  }, []);

  useEffect(() => {
    const initPermissions = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        setError("يرجى تفعيل صلاحيات الكاميرا والميكروفون للمتابعة");
      }
    };
    initPermissions();
  }, []);

  const cleanup = useCallback(() => {
    // FIX: Corrected variable name from matchingTimeoutRef to matchingTimerRef
    if (matchingTimerRef.current) window.clearTimeout(matchingTimerRef.current);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    
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
    setIsVideoActive(false);
    setIsChatOpen(false);
    setMessages([]);
    setInputText('');
    setToast(null);
  }, []);

  const handleCall = (call: any) => {
    // FIX: Corrected variable name from matchingTimeoutRef to matchingTimerRef
    if (matchingTimerRef.current) window.clearTimeout(matchingTimerRef.current);
    callRef.current = call;
    
    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});

      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
      }
      
      if (appState !== AppState.CONNECTED) {
        setAppState(AppState.CONNECTED);
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        intervalRef.current = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
      }
    });

    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (data?.type === 'SIGNAL_VIDEO_ENABLE') {
        enableVideo(true);
      } else {
        setMessages(prev => [...prev, { sender: 'them', text: String(data) }]);
      }
    });
    conn.on('close', cleanup);
    conn.on('error', cleanup);
  };

  const enableVideo = async (force: boolean = false) => {
    if (isVideoActive) return;
    if (!isVideoEnabled && !force) {
      setToast({ msg: `متبقي ${120 - elapsedTime} ثانية للفيديو`, target: 'video' });
      setTimeout(() => setToast(null), 2000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (dataConnRef.current && !force) dataConnRef.current.send({ type: 'SIGNAL_VIDEO_ENABLE' });

      if (callRef.current && peerRef.current) {
        const remoteId = callRef.current.peer;
        handleCall(peerRef.current.call(remoteId, stream));
      }
      setIsVideoActive(true);
    } catch (e) { console.error(e); }
  };

  const startMatching = async (slotIndex: number = 1) => {
    if (appState === AppState.CONNECTED || !selectedLang) return;
    
    const currentSlot = slotIndex > MAX_SEQUENTIAL_SLOTS ? 1 : slotIndex;
    const targetRoomId = `${APP_PREFIX}${selectedLang}-slot-${currentSlot}`;
    
    if (peerRef.current) {
      peerRef.current.removeAllListeners();
      peerRef.current.destroy();
    }

    setStatusMsg(`فحص القناة ${currentSlot}...`);

    const peer = new Peer(targetRoomId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      debug: 1
    });
    peerRef.current = peer;

    peer.on('open', () => {
      setStatusMsg('في انتظار دخول شخص آخر...');
      peer.on('call', async (incomingCall) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        incomingCall.answer(stream);
        handleCall(incomingCall);
      });
      peer.on('connection', setupDataConnection);
      matchingTimerRef.current = window.setTimeout(() => startMatching(currentSlot + 1), 6000);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        initiateCall(targetRoomId, currentSlot);
      } else {
        startMatching(currentSlot + 1);
      }
    });
  };

  const initiateCall = async (targetId: string, currentSlot: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const caller = new Peer();
      peerRef.current = caller;

      const failTimer = window.setTimeout(() => {
        if (appState !== AppState.CONNECTED) {
          caller.destroy();
          startMatching(currentSlot + 1);
        }
      }, FAST_TIMEOUT);

      caller.on('open', () => {
        const call = caller.call(targetId, stream);
        handleCall(call);
        setupDataConnection(caller.connect(targetId));
      });

      caller.on('error', () => {
        window.clearTimeout(failTimer);
        startMatching(currentSlot + 1);
      });
    } catch (e) {
      cleanup();
    }
  };

  const handleStart = (langCode: string) => {
    setSelectedLang(langCode);
    setAppState(AppState.MATCHING);
    startMatching(1);
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden font-sans">
      {/* Video Layers */}
      {isVideoActive && (
        <div className="absolute inset-0 flex flex-col z-0 animate-in fade-in duration-1000">
          <div className="flex-1 relative bg-black border-b border-white/5">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-6 left-6 bg-black/40 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border border-white/10">Stranger</div>
          </div>
          <div className="flex-1 relative bg-black">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-6 left-6 bg-black/40 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border border-white/10">You</div>
          </div>
        </div>
      )}

      {/* Main UI */}
      <div className="z-10 flex flex-col items-center w-full max-w-sm px-8 text-center">
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 w-full">
            <h1 className="text-8xl font-black tracking-tighter mb-2 italic text-white drop-shadow-2xl">AnyOne</h1>
            <p className="text-slate-400 mb-8 font-medium">اتصال مباشر.. صوت وصورة</p>
            
            <div className="grid grid-cols-1 gap-3 w-full">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleStart(lang.code)}
                  className="group relative flex items-center justify-between bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10 px-6 py-5 rounded-3xl transition-all active:scale-95 overflow-hidden"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{lang.flag}</span>
                    <div className="flex flex-col items-start">
                      <span className="font-bold text-xl">{lang.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        <span className="text-[10px] font-black text-green-500/80 uppercase tracking-tighter">
                          {liveCounts[lang.code] || 0} Online
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>

            {error && <p className="mt-8 text-red-500 text-sm font-bold bg-red-500/10 p-4 rounded-2xl border border-red-500/20">{error}</p>}
          </div>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-12 animate-in zoom-in-95">
            <div className="relative w-48 h-48">
              <div className="absolute inset-0 border-2 border-indigo-500/30 rounded-full animate-[ping_2s_infinite]" />
              <div className="absolute inset-0 border-2 border-indigo-400/20 rounded-full animate-[ping_3.5s_infinite]" />
              <div className="w-full h-full bg-indigo-600/5 rounded-full flex items-center justify-center border border-white/10 backdrop-blur-xl">
                <span className="text-6xl animate-pulse drop-shadow-2xl">{LANGUAGES.find(l => l.code === selectedLang)?.flag}</span>
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="text-4xl font-black italic tracking-tight">Matching...</h2>
              <div className="bg-white/5 border border-white/10 px-6 py-2 rounded-full inline-block backdrop-blur-md">
                <span className="text-indigo-400 text-[11px] font-black uppercase tracking-widest">{statusMsg}</span>
              </div>
            </div>
            <button onClick={cleanup} className="text-slate-500 font-bold hover:text-white transition-colors py-2 px-6 border border-white/5 rounded-full hover:bg-white/5">إلغاء البحث</button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-10 w-full">
            <div className="bg-black/60 backdrop-blur-3xl border border-white/10 px-10 py-4 rounded-full text-4xl font-mono font-bold shadow-2xl z-20 tracking-tighter">
              {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
            </div>

            {!isVideoActive && (
              <div className="flex flex-col items-center gap-8 py-12">
                <div className="w-56 h-56 rounded-full bg-indigo-500/5 border-4 border-indigo-500/20 flex items-center justify-center relative overflow-hidden shadow-[0_0_80px_rgba(79,70,229,0.1)]">
                  <div className="absolute inset-0 flex items-center justify-center opacity-10 text-9xl grayscale">
                    {LANGUAGES.find(l => l.code === selectedLang)?.flag}
                  </div>
                  <div className="flex gap-2 h-20 items-center z-10">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="w-2.5 bg-white rounded-full animate-wave shadow-sm" style={{ animationDelay: `${i * 0.12}s` }} />
                    ))}
                  </div>
                </div>
                <div className="inline-flex items-center gap-2.5 text-green-400 text-xs font-black uppercase tracking-widest bg-green-500/10 px-6 py-2 rounded-full border border-green-500/20">
                  <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                  Live in {LANGUAGES.find(l => l.code === selectedLang)?.name}
                </div>
              </div>
            )}

            <div className={`flex items-center gap-8 z-20 ${isVideoActive ? 'fixed bottom-12' : ''}`}>
              <button 
                onClick={() => isChatEnabled ? setIsChatOpen(true) : setToast({msg: `متبقي ${60 - elapsedTime} ثانية للدردشة`, target: 'chat'})}
                className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all shadow-xl ${isChatEnabled ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-white/5 border-transparent opacity-20 cursor-not-allowed'}`}
              >
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" strokeWidth={2.5} /></svg>
              </button>

              <button onClick={cleanup} className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-2xl active:scale-90 hover:bg-red-500 transition-all border-4 border-red-500/20">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={4} /></svg>
              </button>

              <button 
                onClick={() => enableVideo()}
                className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all shadow-xl ${isVideoActive ? 'bg-green-600 border-green-400' : isVideoEnabled ? 'bg-indigo-600 border-indigo-400 animate-pulse' : 'bg-white/5 border-transparent opacity-20 cursor-not-allowed'}`}
              >
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeWidth={2.5} /></svg>
              </button>
            </div>
            {toast && <div className="fixed bottom-40 bg-white text-black px-6 py-2.5 rounded-2xl text-[11px] font-black animate-bounce z-50 shadow-2xl border-4 border-black/5 uppercase tracking-tighter">{toast.msg}</div>}
          </div>
        )}
      </div>

      {/* Chat Modal */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 animate-in slide-in-from-bottom duration-300">
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-900/40 backdrop-blur-xl">
            <h3 className="font-black italic tracking-tighter text-2xl uppercase">Private Chat</h3>
            <button onClick={() => setIsChatOpen(false)} className="w-12 h-12 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={3} /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                <div className={`px-6 py-3.5 rounded-3xl max-w-[85%] text-sm font-semibold shadow-lg ${m.sender === 'me' ? 'bg-white text-black rounded-tr-none' : 'bg-indigo-600 text-white rounded-tl-none'}`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 pb-12 bg-slate-900/40 backdrop-blur-xl flex gap-3 border-t border-white/5">
            <input 
              value={inputText} 
              onChange={e => setInputText(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && sendMessage()}
              placeholder="اكتب رسالة..."
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-7 py-4 focus:outline-none focus:border-indigo-500 focus:bg-white/10 transition-all font-medium"
            />
            <button onClick={sendMessage} className="w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center active:scale-90 transition-all shadow-lg hover:bg-indigo-500">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={4} /></svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wave { 0%, 100% { height: 20px; opacity: 0.3; transform: scaleY(1); } 50% { height: 64px; opacity: 1; transform: scaleY(1.2); } }
        .animate-wave { animation: wave 1s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;