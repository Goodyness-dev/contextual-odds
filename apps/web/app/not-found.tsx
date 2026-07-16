import Link from "next/link";
import { FiArrowLeft } from "react-icons/fi";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0C0D0E] flex flex-col items-center justify-center relative overflow-hidden text-white font-sans selection:bg-[var(--color-red)] selection:text-white">
      {/* Background Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
          backgroundPosition: "center center"
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center text-center px-4 max-w-2xl mx-auto">
        <h1 
          className="text-[120px] md:text-[200px] leading-none font-bold text-[var(--color-red)] tracking-tighter"
          style={{ fontFamily: "'Inktera', 'Inktera Bold Display', sans-serif" }}
        >
          404
        </h1>
        
        <div className="bg-white/5 border border-white/10 px-6 py-2 rounded-full mb-8 backdrop-blur-sm">
          <p className="font-mono text-sm uppercase tracking-widest text-[var(--color-gold)]">
            Offside Detected
          </p>
        </div>

        <h2 className="text-3xl md:text-5xl font-display font-bold uppercase tracking-tight mb-6">
          You&apos;ve wandered <br /> out of bounds
        </h2>

        <p className="text-white/60 font-mono text-sm md:text-base max-w-md mx-auto mb-12 leading-relaxed">
          The page you are looking for has been moved, deleted, or never existed in the first place. Let&apos;s get you back on the pitch.
        </p>

        <Link 
          href="/" 
          className="group relative inline-flex items-center gap-3 bg-white text-black px-8 py-4 font-mono text-sm uppercase tracking-widest font-bold hover:bg-[var(--color-red)] hover:text-white transition-all duration-300"
        >
          <FiArrowLeft className="group-hover:-translate-x-1 transition-transform" />
          <span>Return Home</span>
          
          {/* Brutalist accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-transparent group-hover:border-white transition-colors" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-transparent group-hover:border-white transition-colors" />
        </Link>
      </div>

      {/* Decorative Brand Text */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-20 pointer-events-none">
        <div className="font-bold text-[10vw] leading-none whitespace-nowrap" style={{ fontFamily: "'Inktera', 'Inktera Bold Display', sans-serif" }}>
          ELASTICO
        </div>
      </div>
    </div>
  );
}
