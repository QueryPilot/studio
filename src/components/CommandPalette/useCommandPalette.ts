import { useState } from "react";
import type { PaletteMode } from "./CommandPalette";

interface CommandPaletteState {
  isOpen: boolean;
  mode: PaletteMode;
}

export function useCommandPalette() {
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    mode: ">",
  });

  const open = (mode: PaletteMode = ">") => {
    setState({ isOpen: true, mode });
  };

  const close = () => {
    setState((prev) => ({ ...prev, isOpen: false }));
  };

  const toggle = (mode: PaletteMode = ">") => {
    setState((prev) => ({
      isOpen: !prev.isOpen,
      mode: prev.isOpen ? prev.mode : mode,
    }));
  };

  return {
    isOpen: state.isOpen,
    mode: state.mode,
    open,
    close,
    toggle,
    setOpen: (isOpen: boolean) => {
      setState((prev) => ({ ...prev, isOpen }));
    },
  };
}
