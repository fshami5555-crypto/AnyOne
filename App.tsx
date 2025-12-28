
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { AppState, Persona } from './types.ts';
import { PERSONAS, AUDIO_SAMPLE_RATE, INPUT_SAMPLE_RATE } from './constants.ts';
import { decode, decodeAudioData, createPcmBlob } from './services/audioService.ts';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [currentPersona, setCurrentPersona] = useState<Persona | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Refs for audio and session
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
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
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setAppState(AppState.IDLE);
  }, []);

  const startMatching = async () => {
    try {
      setAppState(AppState.MATCHING);
      setError(null);

      // Randomly pick a persona to simulate "anyone"
      const persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
      setCurrentPersona(persona);

      // Initialize Audio Contexts
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      }
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_SAMPLE_RATE });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voice } }
          },
          systemInstruction: `${persona.instruction}. You are talking on a random voice chat app called 'AnyOne'. Greet the user naturally when you hear them.`
        },
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setAppState(AppState.CONNECTED);
            
            // Start streaming microphone
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(base64Audio), ctx, AUDIO_SAMPLE_RATE, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.onended = () => {
                sourcesRef.current.delete(source);
              };
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error("Live Error:", e);
            setError("Connection failed. Please try again.");
            cleanup();
          },
          onclose: () => {
            console.log("Session Closed");
            cleanup();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err) {
      console.error("Initialization Error:", err);
      setError("Microphone access is required for AnyOne.");
      setAppState(AppState.IDLE);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white overflow-hidden relative">
      {/* Dynamic Background */}
      <div className={`absolute inset-0 transition-all duration-1000 ease-in-out opacity-30 ${
        appState === AppState.CONNECTED ? 'bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 scale-110' : 
        appState === AppState.MATCHING ? 'bg-gradient-to-tr from-blue-900 to-indigo-950 animate-pulse' : 
        'bg-slate-950'
      }`} />

      {/* Main Content */}
      <div className="z-10 flex flex-col items-center gap-12 px-6 text-center max-w-md">
        
        {appState === AppState.IDLE && (
          <>
            <div className="space-y-4">
              <h1 className="text-6xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                AnyOne
              </h1>
              <p className="text-slate-400 text-lg">Talk to a random stranger, instantly.</p>
            </div>

            <button
              onClick={startMatching}
              className="group relative w-48 h-48 flex items-center justify-center bg-white text-black rounded-full font-bold text-2xl shadow-[0_0_50px_rgba(255,255,255,0.2)] hover:shadow-[0_0_80px_rgba(255,255,255,0.4)] transition-all duration-300 transform active:scale-90"
            >
              <div className="absolute inset-0 rounded-full border-4 border-white opacity-20 group-hover:animate-ping" />
              AnyOne
            </button>

            {error && <p className="text-red-400 font-medium animate-bounce">{error}</p>}
          </>
        )}

        {appState === AppState.MATCHING && (
          <div className="flex flex-col items-center gap-8">
            <div className="relative">
              <div className="w-32 h-32 bg-blue-500/20 rounded-full animate-pulse flex items-center justify-center">
                 <div className="w-24 h-24 bg-blue-500/40 rounded-full animate-ping absolute" />
                 <div className="w-16 h-16 bg-blue-500 rounded-full shadow-[0_0_30px_#3b82f6]" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-bold">Finding someone...</h2>
              <p className="text-slate-400 animate-pulse">Wait a moment</p>
            </div>
            <button 
              onClick={cleanup}
              className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-full text-sm font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {appState === AppState.CONNECTED && (
          <div className="flex flex-col items-center gap-12 w-full">
            <div className="flex flex-col items-center gap-4">
              <div className="w-48 h-48 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-2xl relative">
                <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-spin-slow" />
                <svg className="w-24 h-24 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Connected</h2>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <p className="text-slate-400 text-sm">Live Audio</p>
                </div>
              </div>
            </div>

            {/* Visualizer Mock */}
            <div className="flex gap-1 h-12 items-end">
              {[...Array(12)].map((_, i) => (
                <div 
                  key={i} 
                  className="w-1.5 bg-white/40 rounded-full animate-wave" 
                  style={{ 
                    height: `${Math.random() * 100}%`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: '0.5s'
                  }} 
                />
              ))}
            </div>

            <button
              onClick={cleanup}
              className="group w-20 h-20 flex items-center justify-center bg-red-600 hover:bg-red-500 rounded-full shadow-lg transition-all transform hover:scale-110 active:scale-90"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Floating Particles for Visual Interest */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20">
        {[...Array(10)].map((_, i) => (
          <div 
            key={i}
            className="absolute rounded-full bg-white animate-float"
            style={{
              width: `${Math.random() * 8 + 4}px`,
              height: `${Math.random() * 8 + 4}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${Math.random() * 10 + 10}s`
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes wave {
          0%, 100% { height: 20%; }
          50% { height: 100%; }
        }
        .animate-wave {
          animation: wave infinite ease-in-out;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); }
          33% { transform: translateY(-20px) translateX(10px); }
          66% { transform: translateY(10px) translateX(-15px); }
        }
        .animate-float {
          animation: float infinite linear;
        }
        .animate-spin-slow {
          animation: spin 8s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default App;
