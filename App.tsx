
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const SLOT_PREFIX = 'anyone-v5-room-';
const MAX_SLOTS = 5;
const SCAN_TIMEOUT = 7000;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  
  // Call Stats
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');

  // Derived Visibility
  const showChatButton = elapsedTime >= 60;
  const showVideoButton = elapsedTime >= 120;

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const scanTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (callRef.current) callRef.current.close();
    if (dataConnRef.current) dataConnRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (peerRef.current) peerRef.current.destroy();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    
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
  }, []);

  const enableVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      if (dataConnRef.current) {
        dataConnRef.current.send({ type: 'SIGNAL_VIDEO_ENABLE' });
      }

      if (callRef.current && peerRef.current) {
        const remotePeerId = callRef.current.peer;
        callRef.current.close();
        const newCall = peerRef.current.call(remotePeerId, stream);
        handleCall(newCall);
      }

      setIsVideoActive(true);
    } catch (e) {
      setError("Camera permission denied");
    }
  };

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      if (typeof data === 'object' && data.type === 'SIGNAL_VIDEO_ENABLE') {
        if (!isVideoActive) enableVideo();
      } else {
        setMessages(prev => [...prev, { sender: 'them', text: String(data) }]);
      }
    });
    conn.on('close', cleanup);
  };

  const handleCall = (call: any) => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    callRef.current = call;
    
    call.on('stream', (remoteStream: MediaStream) => {
      if (remoteStream.getVideoTracks().length > 0) {
        setIsVideoActive(true);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      }

      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(console.error);
      
      if (appState !== AppState.CONNECTED) {
        setAppState(AppState.CONNECTED);
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        intervalRef.current = window.setInterval(() => {
          setElapsedTime(prev => prev + 1);
        }, 1000);
      }
    });

    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  const startScanning = async (roomIndex: number) => {
    if (appState === AppState.CONNECTED) return;
    if (peerRef.current) peerRef.current.destroy();
    
    const roomNumber = ((roomIndex - 1) % MAX_SLOTS) + 1;
    setStatusMsg(`Checking Frequency ${roomNumber}...`);
    const targetId = `${SLOT_PREFIX}${roomNumber}`;
    
    const peer = new Peer(targetId, {
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    peerRef.current = peer;

    peer.on('open', () => {
      setStatusMsg(`Waiting in Room ${roomNumber}...`);
      peer.on('call', async (incomingCall) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        incomingCall.answer(stream);
        handleCall(incomingCall);
      });
      peer.on('connection', (conn) => {
        setupDataConnection(conn);
      });

      scanTimerRef.current = window.setTimeout(() => startScanning(roomNumber + 1), SCAN_TIMEOUT);
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        initiateConnection(targetId);
      } else {
        startScanning(roomNumber + 1);
      }
    });
  };

  const initiateConnection = async (targetId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const caller = new Peer();
      peerRef.current = caller;

      caller.on('open', () => {
        const call = caller.call(targetId, stream);
        handleCall(call);
        const conn = caller.connect(targetId);
        setupDataConnection(conn);
      });
      caller.on('error', cleanup);
    } catch (e) {
      setError("Microphone access denied");
      cleanup();
    }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !dataConnRef.current) return;
    dataConnRef.current.send(inputText);
    setMessages(prev => [...prev, { sender: 'me', text: inputText }]);
    setInputText('');
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white relative overflow-hidden">
      {/* Split Video Background */}
      {isVideoActive && (
        <div className="absolute inset-0 flex flex-col z-0">
          <div className="flex-1 relative bg-black overflow-hidden border-b border-white/10">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute top-4 left-4 bg-black/60 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest backdrop-blur-md">Stranger</div>
          </div>
          <div className="flex-1 relative bg-black overflow-hidden">
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute bottom-4 left-4 bg-black/60 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest backdrop-blur-md">You</div>
          </div>
        </div>
      )}

      {/* Background Glow (Audio mode) */}
      {!isVideoActive && (
        <div className={`absolute inset-0 transition-all duration-1000 ${appState === AppState.CONNECTED ? 'bg-indigo-600/20' : 'bg-transparent'}`} />
      )}

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-sm text-center px-6">
        
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-10 duration-700 w-full">
            <h1 className="text-7xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
              AnyOne
            </h1>
            <p className="text-slate-400 font-medium mb-16 italic tracking-wide">Pure, anonymous connections.</p>
            <button
              onClick={() => { setError(null); setAppState(AppState.MATCHING); startScanning(Math.floor(Math.random() * MAX_SLOTS) + 1); }}
              className="relative w-64 h-64 mx-auto flex items-center justify-center group"
            >
              <div className="absolute inset-0 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
              <div className="absolute inset-0 border-2 border-white/10 rounded-full animate-[ping_4s_linear_infinite]" />
              <div className="w-52 h-52 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(255,255,255,0.2)] active:scale-95 transition-transform">
                <span className="text-3xl font-black uppercase tracking-widest">Start</span>
              </div>
            </button>
            {error && <div className="mt-8 text-red-400 text-sm font-bold bg-red-500/10 p-3 rounded-lg">{error}</div>}
          </div>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-10 animate-in zoom-in-95 duration-500">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-indigo-500/60 rounded-full radar-wave" />
              <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full radar-wave [animation-delay:0.7s]" />
              <div className="w-4 h-4 bg-indigo-500 rounded-full animate-pulse" />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-bold tracking-tight">Searching...</h2>
              <div className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-full">
                <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em]">{statusMsg}</p>
              </div>
            </div>
            <button onClick={cleanup} className="text-slate-500 hover:text-white text-sm font-bold transition-colors">Cancel</button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-12 animate-in fade-in duration-500 w-full">
            {/* Timer Display */}
            <div className="text-3xl font-mono font-bold tracking-widest text-white bg-black/40 backdrop-blur-xl px-8 py-3 rounded-full border border-white/20 shadow-2xl">
              {formatTime(elapsedTime)}
            </div>

            {!isVideoActive && (
              <div className="flex flex-col items-center gap-6">
                <div className="w-56 h-56 rounded-full bg-white/5 flex items-center justify-center border-4 border-white/10 relative backdrop-blur-sm">
                  <div className="absolute inset-0 flex items-center justify-center gap-2">
                    {[...Array(6)].map((_, i) => (
                      <div 
                        key={i} 
                        className="w-2.5 bg-indigo-500 rounded-full animate-wave" 
                        style={{ animationDelay: `${i * 0.15}s`, height: '30px' }} 
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-black italic uppercase tracking-tighter">Live Voice</h2>
                  <div className="inline-flex items-center gap-2 text-green-400 text-[10px] font-bold uppercase tracking-widest">
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_#4ade80]" />
                    Real-time
                  </div>
                </div>
              </div>
            )}

            <div className={`flex items-center gap-6 ${isVideoActive ? 'mt-auto pb-12' : ''}`}>
              {/* Chat Button */}
              {showChatButton && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 hover:bg-white/20 transition-all active:scale-90 relative"
                >
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  {messages.filter(m => m.sender === 'them').length > 0 && !isChatOpen && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full border-2 border-slate-950" />
                  )}
                </button>
              )}

              {/* End Call Button */}
              <button
                onClick={cleanup}
                className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-2xl hover:bg-red-500 hover:scale-110 transition-all active:scale-90"
              >
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Video Button (Visible after 120s) */}
              {showVideoButton && !isVideoActive && (
                <button
                  onClick={enableVideo}
                  className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center border border-white/20 hover:bg-indigo-500 transition-all active:scale-90 animate-pulse shadow-[0_0_20px_rgba(79,70,229,0.5)]"
                  title="Reveal Camera"
                >
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chat Overlay */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-2xl animate-in slide-in-from-bottom duration-300">
          <div className="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 className="text-xl font-bold tracking-tight">Secure Chat</h3>
            <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl shadow-sm ${msg.sender === 'me' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white/10 text-slate-200 rounded-tl-none border border-white/5'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 border-t border-white/10 flex gap-3 pb-12">
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Send a secret..."
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-6 py-3.5 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button onClick={sendMessage} className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-500 active:scale-90 transition-all shadow-lg shadow-indigo-500/20">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wave {
          0%, 100% { height: 30px; opacity: 0.3; }
          50% { height: 90px; opacity: 1; }
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
