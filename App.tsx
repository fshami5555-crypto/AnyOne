
import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { AppState, Persona } from './types.ts';
import { PERSONAS, AUDIO_SAMPLE_RATE, INPUT_SAMPLE_RATE } from './constants.ts';
import { decode, decodeAudioData, createPcmBlob } from './services/audioService.ts';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [error, setError] = useState<string | null>(null);
  
  // Audio handling refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Connection and stream refs
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const cleanup = useCallback(() => {
    console.log("Cleaning up session...");
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setAppState(AppState.IDLE);
  }, []);

  const startMatching = async () => {
    try {
      setError(null);
      setAppState(AppState.MATCHING);

      // 1. Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2. Setup Audio Contexts
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      }
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
      }

      // Crucial: Resume contexts on user interaction
      await audioContextRef.current.resume();
      await outputAudioContextRef.current.resume();

      // 3. Initialize Gemini
      const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Connect to Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voice } }
          },
          systemInstruction: `You are ${persona.name}. ${persona.instruction}. This is a random chat app called 'AnyOne'. Be warm, spontaneous, and keep the conversation flowing.`
        },
        callbacks: {
          onopen: () => {
            console.log("Live connection opened");
            setAppState(AppState.CONNECTED);
            
            // Start streaming audio from mic
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              // Send data only after session promise resolves
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              }).catch(() => {});
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(base64Audio), ctx, AUDIO_SAMPLE_RATE, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => sourcesRef.current.delete(source);
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.add(source);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error("Live Error Callback:", e);
            setError("The connection was lost. Try again?");
            cleanup();
          },
          onclose: () => {
            console.log("Live connection closed");
            cleanup();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error("Connection Failed:", err);
      if (err.name === 'NotAllowedError') {
        setError("Microphone permission is required.");
      } else {
        setError("Failed to connect to the network. Please check your internet.");
      }
      cleanup();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white overflow-hidden relative">
      {/* Dynamic Themed Background */}
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
              <p className="text-slate-400 text-lg font-medium opacity-80">One click to meet anyone.</p>
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
              <h2 className="text-3xl font-bold tracking-tight">Searching...</h2>
              <p className="text-blue-400 font-medium animate-pulse uppercase tracking-widest text-xs">Finding a match</p>
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
                  <svg className="w-24 h-24 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {/* Wave effect when someone speaks */}
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
                  <span className="text-green-400 text-xs font-bold uppercase tracking-wider">Live Voice</span>
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
