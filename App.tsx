
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { AppState } from './types.ts';

const SLOT_PREFIX = 'anyone-v4-room-';
const MAX_SLOTS = 5;
const SCAN_TIMEOUT = 7000;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  
  // Call Stats
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showChatButton, setShowChatButton] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<{sender: 'me' | 'them', text: string}[]>([]);
  const [inputText, setInputText] = useState('');

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<any>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
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
    setShowChatButton(false);
    setIsChatOpen(false);
    setMessages([]);
    setInputText('');
  }, []);

  const setupDataConnection = (conn: DataConnection) => {
    dataConnRef.current = conn;
    conn.on('data', (data: any) => {
      setMessages(prev => [...prev, { sender: 'them', text: String(data) }]);
    });
    conn.on('close', cleanup);
  };

  const handleCall = (call: any) => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    callRef.current = call;
    
    call.on('stream', (remoteStream: MediaStream) => {
      if (!remoteAudioRef.current) remoteAudioRef.current = new Audio();
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(console.error);
      setAppState(AppState.CONNECTED);
      
      // Start Timer
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(() => {
        setElapsedTime(prev => {
          const next = prev + 1;
          if (next >= 60) setShowChatButton(true);
          return next;
        });
      }, 1000);
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
        // Also connect for data
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
      {/* Background Glow */}
      <div className={`absolute inset-0 transition-all duration-1000 ${appState === AppState.CONNECTED ? 'bg-indigo-600/10' : 'bg-transparent'}`} />

      <div className="z-10 flex flex-col items-center gap-12 w-full max-w-sm text-center px-6">
        
        {appState === AppState.IDLE && (
          <div className="animate-in fade-in slide-in-from-bottom-10 duration-700 w-full">
            <h1 className="text-7xl font-black tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500">
              AnyOne
            </h1>
            <p className="text-slate-400 font-medium mb-16 italic">Real people. Real talk.</p>
            <button
              onClick={() => { setError(null); setAppState(AppState.MATCHING); startScanning(Math.floor(Math.random() * MAX_SLOTS) + 1); }}
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
          <div className="flex flex-col items-center gap-12 animate-in fade-in duration-500 w-full">
            {/* Timer Display */}
            <div className="text-3xl font-mono font-bold tracking-widest text-white/80 bg-white/5 px-6 py-2 rounded-full border border-white/10">
              {formatTime(elapsedTime)}
            </div>

            <div className="flex flex-col items-center gap-6">
              <div className="w-56 h-56 rounded-full bg-indigo-600/10 flex items-center justify-center border-4 border-indigo-500/20 relative">
                <div className="absolute inset-0 flex items-center justify-center gap-2">
                  {[...Array(6)].map((_, i) => (
                    <div 
                      key={i} 
                      className="w-2.5 bg-indigo-400 rounded-full animate-wave" 
                      style={{ animationDelay: `${i * 0.15}s`, height: '30px' }} 
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-black italic uppercase tracking-tighter">Connected</h2>
                <div className="inline-flex items-center gap-2 text-green-400 text-[10px] font-bold uppercase tracking-widest">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Voice Active
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {/* Chat Button (Visible after 60s) */}
              {showChatButton && (
                <button
                  onClick={() => setIsChatOpen(true)}
                  className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center border border-white/20 hover:bg-white/20 transition-all active:scale-90 relative"
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
            </div>
          </div>
        )}
      </div>

      {/* Chat Overlay */}
      {isChatOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 animate-in slide-in-from-bottom duration-300">
          <div className="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 className="text-xl font-bold">Text Chat</h3>
            <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-white/10 rounded-full">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-4 py-2 rounded-2xl ${msg.sender === 'me' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white/10 text-slate-200 rounded-tl-none'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="text-center text-slate-500 text-sm mt-10 italic">Start typing to talk privately...</p>
            )}
          </div>

          <div className="p-6 border-t border-white/10 flex gap-3 pb-10">
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-5 py-3 focus:outline-none focus:border-indigo-500"
            />
            <button 
              onClick={sendMessage}
              className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-500 active:scale-90 transition-all"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wave {
          0%, 100% { height: 30px; opacity: 0.4; }
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
