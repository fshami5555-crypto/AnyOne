
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Vapi from '@vapi-ai/web';
import { AppState } from './types.ts';
import { PERSONAS } from './constants.ts';

// Vapi Public Key provided by user
const VAPI_PUBLIC_KEY = '519c8eaf-0de2-4e32-8baf-63296ad54042';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<any>(null);

  // Initialize Vapi on mount
  useEffect(() => {
    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on('call-start', () => {
      console.log('Vapi: Stranger connected');
      setAppState(AppState.CONNECTED);
      setError(null);
    });

    vapi.on('call-end', () => {
      console.log('Vapi: Call ended');
      setAppState(AppState.IDLE);
    });

    vapi.on('error', (err: any) => {
      console.error('Vapi Error:', err);
      setError('Connection failed. Stranger is unavailable.');
      setAppState(AppState.IDLE);
    });

    return () => {
      vapi.stop();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
    }
    setAppState(AppState.IDLE);
  }, []);

  const startMatching = async () => {
    try {
      setError(null);
      setAppState(AppState.MATCHING);

      // Randomly pick a stranger's persona
      const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];

      // Configure the Vapi assistant dynamically
      await vapiRef.current.start({
        name: `Stranger - ${persona.name}`,
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Identity: ${persona.name}. Goal: You are a stranger on a voice chat app called 'AnyOne'. ${persona.instruction} Be friendly, keep responses brief and natural for voice conversation.`
            }
          ]
        },
        voice: {
          provider: "playht",
          voiceId: "jennifer", // High-quality natural voice
        },
        firstMessage: "Hi there! I'm so glad we connected. How's your day going?",
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en-US",
        }
      });

    } catch (err: any) {
      console.error("Vapi Match Failure:", err);
      setError("Failed to find a match. Check your connection.");
      setAppState(AppState.IDLE);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white overflow-hidden relative">
      {/* Background Ambience */}
      <div className={`absolute inset-0 transition-all duration-1000 ease-in-out ${
        appState === AppState.CONNECTED ? 'bg-indigo-900/40 opacity-100 scale-105' : 
        appState === AppState.MATCHING ? 'bg-blue-900/20 opacity-100' : 
        'bg-slate-950 opacity-0'
      }`} />
      
      <div className="z-10 flex flex-col items-center gap-12 px-8 text-center max-w-md w-full">
        {appState === AppState.IDLE && (
          <>
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <h1 className="text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-slate-500">
                AnyOne
              </h1>
              <p className="text-slate-400 text-lg font-medium opacity-80">Instant voice chat with strangers.</p>
            </div>

            <button
              onClick={startMatching}
              className="group relative w-56 h-56 flex items-center justify-center transition-all duration-500 transform active:scale-90"
            >
              <div className="absolute inset-0 bg-white rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-opacity" />
              <div className="absolute inset-0 border-[6px] border-white/10 rounded-full group-hover:scale-110 transition-transform duration-500" />
              <div className="absolute inset-0 border-2 border-white/5 rounded-full animate-ping-slow" />
              
              <div className="w-44 h-44 bg-white text-black rounded-full flex items-center justify-center font-black text-3xl shadow-2xl relative z-10 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-black/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                AnyOne
              </div>
            </button>

            {error && (
              <div className="px-5 py-3 bg-red-500/10 border border-red-500/20 rounded-2xl animate-in zoom-in-95 duration-300">
                <p className="text-red-400 text-sm font-semibold">{error}</p>
              </div>
            )}
          </>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-10 animate-in fade-in duration-500">
            <div className="relative w-40 h-40">
               <div className="absolute inset-0 rounded-full border-4 border-blue-500/30 animate-ping" />
               <div className="absolute inset-4 rounded-full border-4 border-blue-400/50 animate-ping delay-75" />
               <div className="absolute inset-0 flex items-center justify-center">
                 <div className="w-20 h-20 bg-blue-500 rounded-full shadow-[0_0_50px_#3b82f6] animate-pulse" />
               </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tight">Matching...</h2>
              <p className="text-blue-400 font-medium animate-pulse uppercase tracking-widest text-xs">Finding a stranger</p>
            </div>
            <button 
              onClick={cleanup}
              className="px-8 py-3 bg-slate-900 border border-white/5 hover:bg-slate-800 rounded-full text-sm font-bold transition-all"
            >
              Cancel
            </button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-12 w-full animate-in zoom-in-95 duration-500">
            <div className="flex flex-col items-center gap-6">
              <div className="w-52 h-52 rounded-full p-1 bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 shadow-2xl relative">
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 px-10">
                    {[...Array(5)].map((_, i) => (
                      <div 
                        key={i} 
                        className="w-2 bg-white/60 rounded-full animate-bar" 
                        style={{ animationDelay: `${i * 0.1}s` }} 
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-black">Connected!</h2>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400 text-xs font-bold uppercase tracking-wider">Live Stranger</span>
                </div>
              </div>
            </div>

            <button
              onClick={cleanup}
              className="w-24 h-24 flex items-center justify-center bg-red-600 hover:bg-red-500 rounded-full shadow-[0_10px_40px_rgba(220,38,38,0.3)] transition-all transform hover:scale-110 active:scale-95"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes bar {
          0%, 100% { height: 10px; }
          50% { height: 40px; }
        }
        .animate-bar {
          animation: bar 0.6s infinite ease-in-out;
        }
        @keyframes ping-slow {
          0% { transform: scale(1); opacity: 0.3; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .animate-ping-slow {
          animation: ping-slow 3s infinite;
        }
      `}</style>
    </div>
  );
};

export default App;
