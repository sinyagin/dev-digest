/* useElapsed — ms since `since`, ticking once a second while `active`. */
"use client";

import React from "react";

export function useElapsed(since: string, active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  const start = Date.parse(since);
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}
