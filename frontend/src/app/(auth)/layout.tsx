'use client';

// Auth route group layout — split narrative and glassmorphic card design
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black flex flex-col md:flex-row items-stretch justify-center relative overflow-hidden font-sans select-none">
      {/* CSS Animation Styles */}
      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes floatSlow {
          0%, 100% {
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            transform: translateY(-10px) rotate(0.5deg);
          }
        }
        @keyframes drift {
          0%, 100% {
            transform: translate(0px, 0px);
          }
          50% {
            transform: translate(15px, -15px);
          }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .animate-float {
          animation: floatSlow 6s ease-in-out infinite;
        }
        .animate-drift {
          animation: drift 12s ease-in-out infinite;
        }
      `}</style>

      {/* Decorative premium radial gradients (monochrome) */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-zinc-800/10 blur-[150px] pointer-events-none animate-drift" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-zinc-700/10 blur-[150px] pointer-events-none animate-drift" style={{ animationDelay: '-6s' }} />

      {/* Left panel: Product Narrative & Brand visual */}
      <div className="hidden md:flex flex-1 flex-col justify-between p-12 lg:p-16 border-r border-zinc-900 bg-gradient-to-b from-zinc-950 to-black relative z-10 overflow-hidden">
        {/* Floating background graphic */}
        <div className="absolute top-[30%] right-[-10%] w-72 h-72 rounded-full border border-white/5 bg-white/[0.01] backdrop-blur-3xl animate-float pointer-events-none" />

        {/* Top: Logo & Name */}
        <div className="flex items-center gap-3 animate-fade-in-up">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/20">
            <svg viewBox="0 0 24 24" fill="black" className="w-6 h-6">
              <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 2a4 4 0 110 8 4 4 0 010-8z" />
            </svg>
          </div>
          <span className="font-bold text-xl tracking-tight text-white">FlowForge</span>
        </div>

        {/* Middle: Brand Pitch and simulated board */}
        <div className="my-auto max-w-lg space-y-8 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
          <div className="space-y-4">
            <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Forge your workflow. <br />
              <span className="text-zinc-500">Without distraction.</span>
            </h2>
            <p className="text-base text-zinc-400 leading-relaxed">
              FlowForge is a minimal, keyboard-first workspace designed for modern engineering teams.
              Track tasks, optimize pipelines, and release software with absolute clarity.
            </p>
          </div>

          {/* Minimalist mock dashboard column */}
          <div className="border border-white/5 rounded-2xl p-4 bg-white/[0.02] backdrop-blur-md shadow-2xl relative">
            <div className="flex items-center justify-between mb-3 text-xs font-mono text-zinc-500">
              <span>ACTIVE PIPELINE</span>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            </div>
            <div className="space-y-2.5">
              <div className="p-3 bg-zinc-950/60 border border-zinc-900 rounded-xl flex flex-col gap-1.5 hover:border-zinc-800 transition-colors">
                <span className="text-[10px] font-mono font-bold tracking-wider text-zinc-500">FF-102</span>
                <p className="text-xs font-semibold text-zinc-200">Refactor database adapter layers</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                  <span className="text-[9px] font-bold text-zinc-500 uppercase">High Priority</span>
                </div>
              </div>
              <div className="p-3 bg-zinc-950/60 border border-zinc-900 rounded-xl flex flex-col gap-1.5 hover:border-zinc-800 transition-colors">
                <span className="text-[10px] font-mono font-bold tracking-wider text-zinc-500">FF-105</span>
                <p className="text-xs font-semibold text-zinc-200">Design black-and-white glassmorphic interface</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  <span className="text-[9px] font-bold text-zinc-300 uppercase">In Progress</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Footer metrics */}
        <div className="flex items-center gap-8 text-xs font-mono text-zinc-500 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <div>
            <p className="text-sm font-semibold text-white">100%</p>
            <p>Monochrome Focus</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">60fps</p>
            <p>Silky Interaction</p>
          </div>
        </div>
      </div>

      {/* Right panel: Glassmorphic auth card */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 relative z-10 bg-black">
        {/* Mobile Header */}
        <div className="flex md:hidden flex-col items-center mb-8 animate-fade-in-up">
          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-3 ring-1 ring-white/20">
            <svg viewBox="0 0 24 24" fill="black" className="w-7 h-7">
              <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 2a4 4 0 110 8 4 4 0 010-8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">FlowForge</h1>
          <p className="text-xs text-zinc-500 mt-1">Project management for modern teams</p>
        </div>

        <div className="w-full max-w-md bg-zinc-950/40 backdrop-blur-2xl rounded-3xl border border-zinc-800/80 p-8 md:p-10 shadow-2xl ring-1 ring-white/10 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
