
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { AppState } from './types.ts';

// بادئة فريدة لضمان عدم التداخل مع تطبيقات أخرى تستخدم PeerJS
const SLOT_PREFIX = 'anyone-app-v2-slot-';
const MAX_SLOTS = 20; // عدد الغرف الافتراضية للبحث

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // تنظيف الاتصالات
  const cleanup = useCallback(() => {
    if (callRef.current) {
      callRef.current.close();
      callRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setAppState(AppState.IDLE);
  }, []);

  const handleIncomingCall = (call: any) => {
    console.log('Receiving call from a stranger...');
    callRef.current = call;
    
    call.on('stream', (remoteStream: MediaStream) => {
      console.log('Remote stream received');
      if (!remoteAudioRef.current) {
        remoteAudioRef.current = new Audio();
      }
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => console.error("Audio play error", e));
      setAppState(AppState.CONNECTED);
    });

    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  const tryConnectToSlot = async (slotIndex: number) => {
    if (slotIndex > MAX_SLOTS) {
      setError("No one available right now. Try again!");
      cleanup();
      return;
    }

    const targetSlotId = `${SLOT_PREFIX}${slotIndex}`;
    
    // محاولة أن نكون نحن "المستقبل" في هذه الفتحة
    const peer = new Peer(targetSlotId);
    peerRef.current = peer;

    peer.on('open', (id) => {
      console.log(`Occupied slot: ${id}. Waiting for a caller...`);
      // نحن الآن ننتظر مكالمة
      peer.on('call', async (incomingCall) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          incomingCall.answer(stream);
          handleIncomingCall(incomingCall);
        } catch (e) {
          setError("Microphone access required.");
          cleanup();
        }
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // الفتحة مشغولة، يعني يوجد شخص ينتظرنا هناك!
        console.log(`Slot ${slotIndex} is busy, calling the occupant...`);
        peer.destroy();
        initiateCallToSlot(targetSlotId);
      } else {
        console.error("Peer error:", err);
        // ننتقل للفتحة التالية في حال وجود خطأ آخر
        tryConnectToSlot(slotIndex + 1);
      }
    });
  };

  const initiateCallToSlot = async (targetId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // إنشاء Peer بهوية عشوائية للاتصال
      const callerPeer = new Peer();
      peerRef.current = callerPeer;

      callerPeer.on('open', () => {
        const call = callerPeer.call(targetId, stream);
        handleIncomingCall(call);
      });

      callerPeer.on('error', (err) => {
        console.error("Caller Peer Error:", err);
        cleanup();
      });

    } catch (e) {
      setError("Microphone access required.");
      setAppState(AppState.IDLE);
    }
  };

  const startMatching = () => {
    setError(null);
    setAppState(AppState.MATCHING);
    // نبدأ من فتحة عشوائية لتقليل التصادمات بين المستخدمين
    const startSlot = Math.floor(Math.random() * MAX_SLOTS) + 1;
    tryConnectToSlot(startSlot);
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden">
      {/* Dynamic Background Gradient */}
      <div className={`absolute inset-0 transition-all duration-1000 ${appState === AppState.CONNECTED ? 'bg-indigo-600/10' : 'bg-transparent'}`} />

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-sm text-center px-6">
        
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-10 duration-700 w-full">
            <h1 className="text-7xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
              AnyOne
            </h1>
            <p className="text-slate-400 font-medium mb-16">Talk to a real stranger, now.</p>

            <button
              onClick={startMatching}
              className="relative w-64 h-64 mx-auto flex items-center justify-center group"
            >
              <div className="absolute inset-0 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
              <div className="absolute inset-0 border-2 border-white/10 rounded-full animate-[ping_4s_linear_infinite]" />
              
              <div className="w-52 h-52 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(255,255,255,0.15)] active:scale-95 transition-transform">
                <span className="text-3xl font-black uppercase tracking-widest">AnyOne</span>
              </div>
            </button>
            
            {error && (
              <div className="mt-12 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-bold">
                {error}
              </div>
            )}
          </div>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-12 animate-in zoom-in-95 duration-500">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-500/80 rounded-full radar-wave" />
              <div className="absolute inset-0 border-4 border-blue-500/40 rounded-full radar-wave [animation-delay:0.5s]" />
              <div className="absolute inset-0 border-4 border-blue-500/10 rounded-full radar-wave [animation-delay:1s]" />
              <div className="w-6 h-6 bg-blue-500 rounded-full animate-pulse shadow-[0_0_30px_#3b82f6]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-bold">Matching...</h2>
              <p className="text-blue-400 text-xs font-bold uppercase tracking-[0.3em] animate-pulse">Searching for someone live</p>
            </div>
            <button 
              onClick={cleanup}
              className="px-8 py-3 bg-white/5 hover:bg-white/10 rounded-full text-sm font-bold border border-white/10 transition-all"
            >
              Stop Searching
            </button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-16 animate-in fade-in zoom-in-95 duration-500 w-full">
            <div className="flex flex-col items-center gap-8">
              <div className="w-60 h-60 rounded-full bg-indigo-600/10 flex items-center justify-center border-4 border-indigo-500/30 relative">
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {[...Array(8)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-2 bg-indigo-400 rounded-full animate-wave" 
                      style={{ 
                        animation: `wave 1s infinite ease-in-out`,
                        animationDelay: `${i * 0.1}s`,
                        height: '24px' 
                      }} 
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-4xl font-black">Connected!</h2>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">Audio Live</span>
                </div>
              </div>
            </div>

            <button
              onClick={cleanup}
              className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center shadow-[0_10px_40px_rgba(220,38,38,0.4)] hover:bg-red-500 hover:scale-110 transition-all active:scale-90"
            >
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { height: 24px; opacity: 0.5; }
          50% { height: 80px; opacity: 1; }
        }
        .animate-wave { animation: wave 1s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
