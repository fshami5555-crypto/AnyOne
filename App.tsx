
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const APP_PREFIX = 'anyone-v7-';
const SCAN_TIMEOUT = 5000;
const CONNECT_TIMEOUT = 4000;

// Helper to round coordinates for "Zone" matching
const getZoneId = (lat: number, lng: number, offsetLat: number = 0, offsetLng: number = 0) => {
  // Rounding to 1 decimal place gives a zone of roughly 11km x 11km
  const precision = 1;
  const zLat = (lat + offsetLat).toFixed(precision);
  const zLng = (lng + offsetLng).toFixed(precision);
  return `${APP_PREFIX}zone-${zLat}-${zLng}`;
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');
  const [toast, setToast] = useState<{msg: string, target: 'chat' | 'video'} | null>(null);
  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);

  const isChatEnabled = elapsedTime >= 60;
  const isVideoEnabled = elapsedTime >= 120;

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const scanTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);

  // Request all permissions immediately
  useEffect(() => {
    const initPermissions = async () => {
      try {
        // Request Location
        setStatusMsg('جاري تحديد موقعك...');
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });

        // Request Media
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop());
        
        setStatusMsg('الصلاحيات مكتملة');
      } catch (err) {
        console.error(err);
        setError("يرجى تفعيل الموقع والكاميرا والميكروفون للمتابعة");
      }
    };
    initPermissions();
  }, []);

  const cleanup = useCallback(() => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
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
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (connectTimeoutRef.current) window.clearTimeout(connectTimeoutRef.current);
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
      const remaining = 120 - elapsedTime;
      setToast({ msg: `متبقي ${remaining} ثانية`, target: 'video' });
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
        const newCall = peerRef.current.call(remoteId, stream);
        handleCall(newCall);
      }
      setIsVideoActive(true);
    } catch (e) {
      console.error(e);
    }
  };

  // Matching Logic based on Location Zones
  const startMatching = async (step: number = 0) => {
    if (appState === AppState.CONNECTED) return;
    if (!coords) {
      setError("لم يتم تحديد الموقع بعد");
      return;
    }

    if (peerRef.current) {
      peerRef.current.removeAllListeners();
      peerRef.current.destroy();
    }

    // Try current zone, then try expanding search to neighbors
    const offsets = [
      [0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]
    ];
    const currentOffset = offsets[step % offsets.length];
    const targetZoneId = getZoneId(coords.lat, coords.lng, currentOffset[0], currentOffset[1]);
    
    setStatusMsg(step === 0 ? 'جاري البحث عن أشخاص بالقرب منك...' : `توسيع نطاق البحث (${step})...`);
    
    const peer = new Peer(targetZoneId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      debug: 1
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log('Listening on Zone ID:', id);
      peer.on('call', async (incomingCall) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        incomingCall.answer(stream);
        handleCall(incomingCall);
      });
      peer.on('connection', setupDataConnection);
      
      // If nobody calls us in 5s, rotate to next zone attempt
      scanTimerRef.current = window.setTimeout(() => startMatching(step + 1), SCAN_TIMEOUT);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Someone is already "Host" of this zone, let's call them
        peer.destroy();
        initiateConnection(targetZoneId, step);
      } else {
        startMatching(step + 1);
      }
    });
  };

  const initiateConnection = async (targetId: string, step: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const caller = new Peer(); // Random ID for caller
      peerRef.current = caller;

      connectTimeoutRef.current = window.setTimeout(() => {
        if (appState !== AppState.CONNECTED) {
          caller.destroy();
          startMatching(step + 1);
        }
      }, CONNECT_TIMEOUT);

      caller.on('open', () => {
        const call = caller.call(targetId, stream);
        handleCall(call);
        const conn = caller.connect(targetId);
        setupDataConnection(conn);
      });

      caller.on('error', () => startMatching(step + 1));
    } catch (e) {
      cleanup();
    }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden">
      {/* Video Layers */}
      {isVideoActive && (
        <div className="absolute inset-0 flex flex-col z-0 animate-in fade-in duration-1000">
          <div className="flex-1 relative bg-black border-b border-white/5">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-6 left-6 bg-black/40 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">Stranger</div>
          </div>
          <div className="flex-1 relative bg-black">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute bottom-6 left-6 bg-black/40 backdrop-blur-md px-4 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">You</div>
          </div>
        </div>
      )}

      <div className="z-10 flex flex-col items-center w-full max-w-sm px-8 text-center">
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h1 className="text-8xl font-black tracking-tighter mb-2 italic">AnyOne</h1>
            <p className="text-slate-500 mb-12 font-medium">Connect with people near you.</p>
            <button 
              onClick={() => { setAppState(AppState.MATCHING); startMatching(0); }}
              className="w-56 h-56 bg-white text-black rounded-full font-black text-2xl uppercase tracking-widest shadow-[0_0_60px_rgba(255,255,255,0.15)] active:scale-90 transition-all hover:scale-105"
            >
              Start
            </button>
            {error && <p className="mt-8 text-red-500 text-sm font-bold bg-red-500/10 p-3 rounded-xl border border-red-500/20">{error}</p>}
          </div>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-12 animate-in zoom-in-95">
            <div className="relative w-44 h-44">
              <div className="absolute inset-0 border-2 border-indigo-500 rounded-full animate-[ping_2s_infinite]" />
              <div className="absolute inset-0 border-2 border-indigo-400 rounded-full animate-[ping_3.5s_infinite]" />
              <div className="w-full h-full bg-indigo-600/10 rounded-full flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <svg className="w-12 h-12 text-indigo-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-bold italic tracking-tight">Matching...</h2>
              <div className="bg-white/5 border border-white/10 px-6 py-2 rounded-full inline-block">
                <span className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">{statusMsg}</span>
              </div>
            </div>
            <button onClick={cleanup} className="text-slate-500 font-bold hover:text-white transition-colors">Cancel</button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-10 w-full h-full">
            <div className="bg-black/40 backdrop-blur-2xl border border-white/10 px-8 py-3 rounded-full text-3xl font-mono font-bold shadow-2xl z-20">
              {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
            </div>

            {!isVideoActive && (
              <div className="flex flex-col items-center gap-8 py-12">
                <div className="w-48 h-48 rounded-full bg-indigo-500/10 border-4 border-indigo-500/30 flex items-center justify-center">
                  <div className="flex gap-1.5 h-16 items-center">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="w-2 bg-indigo-500 rounded-full animate-wave" style={{ animationDelay: `${i * 0.1}s` }} />
                    ))}
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 text-green-400 text-xs font-black uppercase tracking-widest">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Connected Nearby
                </div>
              </div>
            )}

            <div className={`flex items-center gap-6 z-20 ${isVideoActive ? 'fixed bottom-10' : ''}`}>
              {/* Chat */}
              <div className="relative">
                {toast?.target === 'chat' && (
                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold py-2 px-4 rounded-xl shadow-2xl animate-bounce">
                    {toast.msg}
                  </div>
                )}
                <button 
                  onClick={() => isChatEnabled ? setIsChatOpen(true) : setToast({msg: `متبقي ${60 - elapsedTime} ثانية`, target: 'chat'})}
                  className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all ${isChatEnabled ? 'bg-white/10 border-white/20' : 'bg-white/5 border-transparent opacity-20 grayscale'}`}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </button>
              </div>

              {/* End */}
              <button onClick={cleanup} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-xl active:scale-90 hover:bg-red-500 transition-all">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Camera */}
              <div className="relative">
                {toast?.target === 'video' && (
                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold py-2 px-4 rounded-xl shadow-2xl animate-bounce">
                    {toast.msg}
                  </div>
                )}
                <button 
                  onClick={() => enableVideo()}
                  className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all ${isVideoActive ? 'bg-green-600 border-green-400' : isVideoEnabled ? 'bg-indigo-600 border-indigo-400 animate-pulse' : 'bg-white/5 border-transparent opacity-20 grayscale'}`}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chat Modal */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 animate-in slide-in-from-bottom duration-300">
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-slate-900/50">
            <h3 className="font-black italic tracking-tighter text-xl">Private Session</h3>
            <button onClick={() => setIsChatOpen(false)} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" strokeWidth={2} /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-5 py-3 rounded-2xl max-w-[80%] text-sm font-medium ${m.sender === 'me' ? 'bg-white text-black rounded-tr-none' : 'bg-white/10 text-white rounded-tl-none'}`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 pb-12 bg-slate-900/50 flex gap-3">
            <input 
              value={inputText} 
              onChange={e => setInputText(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && sendMessage()}
              placeholder="Say something..."
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-4 focus:outline-none focus:border-white/40 transition-all"
            />
            <button onClick={sendMessage} className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center active:scale-90 transition-all">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth={3} /></svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wave {
          0%, 100% { height: 16px; opacity: 0.3; }
          50% { height: 48px; opacity: 1; }
        }
        .animate-wave { animation: wave 1s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
