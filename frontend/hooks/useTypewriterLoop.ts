import { useState, useEffect } from "react";

export function useTypewriterLoop(
  textLength: number,
  typingSpeed = 40,
  deletingSpeed = 20,
  pauseEnd = 4000,
  pauseStart = 1000
) {
  const [visibleChars, setVisibleChars] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'paused-end' | 'deleting' | 'paused-start'>('typing');

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    if (phase === 'typing') {
      if (visibleChars < textLength) {
        timeout = setTimeout(() => setVisibleChars((c) => c + 1), typingSpeed);
      } else {
        timeout = setTimeout(() => setPhase('paused-end'), 0);
      }
    } else if (phase === 'paused-end') {
      timeout = setTimeout(() => setPhase('deleting'), pauseEnd);
    } else if (phase === 'deleting') {
      if (visibleChars > 0) {
        timeout = setTimeout(() => setVisibleChars((c) => c - 1), deletingSpeed);
      } else {
        timeout = setTimeout(() => setPhase('paused-start'), 0);
      }
    } else if (phase === 'paused-start') {
      timeout = setTimeout(() => setPhase('typing'), pauseStart);
    }

    return () => clearTimeout(timeout);
  }, [visibleChars, phase, textLength, typingSpeed, deletingSpeed, pauseEnd, pauseStart]);

  return visibleChars;
}
