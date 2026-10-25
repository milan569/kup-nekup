import { useEffect, useState } from "react";

/** Cycles through `list` every `ms` while `active`; starts at a random entry. */
export function useRotatingPhrase<T>(list: T[], active: boolean, ms = 3500): T {
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, list.length)));
  useEffect(() => {
    if (!active || list.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % list.length), ms);
    return () => clearInterval(id);
  }, [active, ms, list.length]);
  return list[i % Math.max(1, list.length)]!;
}
