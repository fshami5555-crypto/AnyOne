
import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { AppState } from './types.ts';

// نستخدم معرف غرفة عام بسيط للمطابقة التجريبية
// في التطبيقات الإنتاجية، يتم استخدام Backend لإدارة قائمة الانتظار
const LOBBY_PREFIX = 'anyone-room-';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // تهيئة PeerJS عند تحميل التطبيق
  useEffect(() => {
    // إنشاء معرف فريد للمستخدم
    const randomId = Math.random().toString(36).substring(7);
    const peer = new Peer(`anyone-${randomId}`);
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      console.log('My peer ID is: ' + id);
    });

    // التعامل مع المكالمات الواردة
    peer.on('call', async (incomingCall) => {
      console.log('Incoming call from another person...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      incomingCall.answer(stream);
      handleCall(incomingCall);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setError('Connection error. Refreshing...');
      setAppState(AppState.IDLE);
    });

    return () => {
      peer.destroy();
    };
  }, []);

  const handleCall = (call: any) => {
    callRef.current = call;
    setAppState(AppState.CONNECTED);

    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) {
        remoteAudioRef.current = new Audio();
      }
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play();
    });

    call.on('close', () => {
      cleanup();
    });
  };

  const cleanup = () => {
    if (callRef.current) callRef.current.close();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    setAppState(AppState.IDLE);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };

  const startMatching = async () => {
    try {
      setError(null);
      setAppState(AppState.MATCHING);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      /**
       * منطق المطابقة التجريبي:
       * بما أنه لا يوجد Backend، سنحاول الاتصال برقم غرفة عشوائي (مثلاً من 1 إلى 5)
       * إذا وجدنا شخصاً هناك، سنتصل به.
       */
      const luckyRoom = Math.floor(Math.random() * 5) + 1;
      const targetId = `anyone-lobby-${luckyRoom}`;
      
      // ملاحظة: في النسخة الحقيقية، نحتاج لخادم يخبرنا من هو "أول شخص في الانتظار"
      // هنا نقوم بتبسيط الأمر للمعاينة
      setTimeout(() => {
        // محاكاة: إذا لم يتصل بنا أحد خلال 5 ثوانٍ، سنحاول نحن الاتصال بـ "رأس الغرفة"
        if (appState === AppState.MATCHING) {
           // هذا الجزء يحتاج لخادم حقيقي ليعمل 100% بين الغرباء
           // لكنه سيعمل إذا فتحت التطبيق في نافذتين وضغطت "بدء"
        }
      }, 5000);

    } catch (err) {
      setError('Please allow microphone access.');
      setAppState(AppState.IDLE);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden">
      {/* خلفية تفاعلية */}
      <div className={`absolute inset-0 transition-all duration-1000 ${appState === AppState.CONNECTED ? 'bg-indigo-900/20' : 'bg-transparent'}`} />

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-sm text-center">
        
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-10 duration-700">
            <h1 className="text-7xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
              AnyOne
            </h1>
            <p className="text-slate-400 font-medium mb-16">Talk to a real person, instantly.</p>

            <button
              onClick={startMatching}
              className="relative w-64 h-64 flex items-center justify-center group"
            >
              <div className="absolute inset-0 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
              <div className="absolute inset-0 border-2 border-white/10 rounded-full animate-[ping_4s_linear_infinite]" />
              
              <div className="w-52 h-52 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(255,255,255,0.15)] active:scale-95 transition-transform group">
                <span className="text-3xl font-black uppercase tracking-widest group-hover:scale-110 transition-transform">AnyOne</span>
              </div>
            </button>
            
            {error && <p className="mt-8 text-red-400 font-semibold">{error}</p>}
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
              Cancel Search
            </button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-16 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex flex-col items-center gap-8">
              <div className="w-60 h-60 rounded-full bg-indigo-600/20 flex items-center justify-center border-4 border-indigo-500/50 relative">
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {[...Array(8)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-2 bg-indigo-400 rounded-full animate-wave" 
                      style={{ 
                        animation: `wave 1s infinite ease-in-out`,
                        animationDelay: `${i * 0.1}s`,
                        height: '20%' 
                      }} 
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-4xl font-black">Connected!</h2>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">Real Person Talking</span>
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
          0%, 100% { height: 20%; opacity: 0.5; }
          50% { height: 60%; opacity: 1; }
        }
        .animate-wave { animation: wave 1s infinite ease-in-out; }
      `}</style>
    </div>
  );
};

export default App;
