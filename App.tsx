
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { AppState } from './types.ts';

const SLOT_PREFIX = 'anyone-v3-room-';
const MAX_SLOTS = 5; // عدد قليل لضمان التصادم السريع بين المستخدمين
const SCAN_TIMEOUT = 7000; // الانتقال لغرفة أخرى كل 7 ثوانٍ

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>('');
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (callRef.current) callRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current) peerRef.current.destroy();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    
    peerRef.current = null;
    callRef.current = null;
    localStreamRef.current = null;
    setAppState(AppState.IDLE);
    setStatusMsg('');
  }, []);

  const handleCall = (call: any) => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    callRef.current = call;
    
    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(console.error);
      setAppState(AppState.CONNECTED);
    });

    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  const startScanning = async (roomIndex: number) => {
    if (appState === AppState.CONNECTED) return;
    
    if (peerRef.current) peerRef.current.destroy();
    
    const roomNumber = ((roomIndex - 1) % MAX_SLOTS) + 1;
    setCurrentRoom(roomNumber);
    setStatusMsg(`Checking Frequency ${roomNumber}...`);
    
    const targetId = `${SLOT_PREFIX}${roomNumber}`;
    
    // إعداد Peer مع خوادم STUN لتجاوز مشاكل الشبكة
    const peer = new Peer(targetId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', () => {
      setStatusMsg(`Waiting in Room ${roomNumber}...`);
      // نحن الآن "مضيف" في هذه الغرفة، ننتظر أحداً ليتصل بنا
      peer.on('call', async (incomingCall) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          incomingCall.answer(stream);
          handleCall(incomingCall);
        } catch (e) {
          setError("Microphone required");
          cleanup();
        }
      });

      // إذا لم يتصل بنا أحد خلال المهلة، ننتقل للغرفة التالية
      scanTimerRef.current = window.setTimeout(() => {
        startScanning(roomNumber + 1);
      }, SCAN_TIMEOUT);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // الغرفة مشغولة، هذا يعني أن هناك "مضيف" ينتظرنا! لنتصل به فوراً
        setStatusMsg(`Someone found in Room ${roomNumber}! Connecting...`);
        peer.destroy();
        initiateConnection(targetId);
      } else {
        console.error("PeerJS Error:", err);
        startScanning(roomNumber + 1);
      }
    });
  };

  const initiateConnection = async (targetId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const caller = new Peer({
        config: {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        }
      });
      peerRef.current = caller;

      caller.on('open', () => {
        const call = caller.call(targetId, stream);
        handleCall(call);
      });
      
      caller.on('error', cleanup);
    } catch (e) {
      setError("Microphone access denied");
      cleanup();
    }
  };

  const startMatching = () => {
    setError(null);
    setAppState(AppState.MATCHING);
    startScanning(Math.floor(Math.random() * MAX_SLOTS) + 1);
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden">
      <div className={`absolute inset-0 transition-all duration-1000 ${appState === AppState.CONNECTED ? 'bg-blue-600/10' : 'bg-transparent'}`} />

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-sm text-center px-6">
        
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-10 duration-700 w-full">
            <h1 className="text-7xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
              AnyOne
            </h1>
            <p className="text-slate-400 font-medium mb-16">Talk to a real stranger, instantly.</p>

            <button
              onClick={startMatching}
              className="relative w-64 h-64 mx-auto flex items-center justify-center group"
            >
              <div className="absolute inset-0 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
              <div className="absolute inset-0 border-2 border-white/10 rounded-full animate-[ping_4s_linear_infinite]" />
              <div className="w-52 h-52 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(255,255,255,0.2)] active:scale-95 transition-transform">
                <span className="text-3xl font-black uppercase tracking-widest">AnyOne</span>
              </div>
            </button>
            
            {error && <div className="mt-8 text-red-400 text-sm font-bold bg-red-500/10 p-3 rounded-lg">{error}</div>}
          </div>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-10 animate-in zoom-in-95 duration-500">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-blue-500/10 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-500/60 rounded-full radar-wave" />
              <div className="absolute inset-0 border-4 border-blue-500/30 rounded-full radar-wave [animation-delay:0.7s]" />
              <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse" />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-bold">Scanning...</h2>
              <div className="px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full">
                <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em]">{statusMsg}</p>
              </div>
            </div>
            <button onClick={cleanup} className="text-slate-500 hover:text-white text-sm font-bold transition-colors">Cancel</button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-16 animate-in fade-in duration-500 w-full">
            <div className="flex flex-col items-center gap-8">
              <div className="w-60 h-60 rounded-full bg-blue-600/10 flex items-center justify-center border-4 border-blue-500/20 relative">
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {[...Array(6)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-2.5 bg-blue-400 rounded-full animate-wave" 
                      style={{ animationDelay: `${i * 0.1}s`, height: '30px' }} 
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-4xl font-black italic">LIVE NOW</h2>
                <p className="text-blue-400 text-xs font-bold uppercase tracking-widest">Connected with a stranger</p>
              </div>
            </div>

            <button
              onClick={cleanup}
              className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-2xl hover:bg-red-500 hover:scale-110 transition-all active:scale-90"
            >
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { height: 30px; }
          50% { height: 90px; }
        }
        .animate-wave { animation: wave 0.8s infinite ease-in-out; }
        @keyframes radar {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .radar-wave { animation: radar 2s linear infinite; }
      `}</style>
    </div>
  );
};

export default App;
