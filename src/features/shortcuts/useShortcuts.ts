import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getConfig, setConfig } from "@/lib/config-store";
import { bindingsFor, matches, type Overrides } from "./shortcuts";

const KEY = ["shortcuts"] as const;

export function useShortcutOverrides() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => getConfig<Overrides>("shortcuts", {}) });
  const overrides = data ?? {};
  const save = (next: Overrides) => {
    queryClient.setQueryData(KEY, next);
    setConfig("shortcuts", next);
  };
  return {
    loaded: data !== undefined,
    overrides,
    setBinding: (id: string, binding: string) => save({ ...overrides, [id]: binding }),
    reset: (id: string) => save(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== id))),
  };
}

/** Runs `handler` when the action's current binding is pressed. The handler
 * decides about preventDefault and about where the key applies (e.g. not in
 * the terminal or a text field). */
export function useShortcut(id: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const { overrides } = useShortcutOverrides();
  const bindings = bindingsFor(id, overrides);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const bindingKey = bindings.join("|");

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (bindings.some((b) => matches(e, b))) handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bindingKey]);
}
