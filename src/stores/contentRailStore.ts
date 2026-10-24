import { useMemo } from 'react';
import { create } from 'zustand';
import { WIDE_CONTENT_MAX_WIDTH } from '../constants/layout';

// Ancho del riel de contenido en pantallas grandes. Arranca en
// WIDE_CONTENT_MAX_WIDTH y crece hasta lo que ocupa la fila completa de días
// (Lunes…Domingo), así en el Mac se ve la semana entera y todo lo demás queda
// alineado a ese mismo ancho. Si la ventana es más angosta, el maxWidth no
// cambia nada y los días se deslizan como antes (Jonathan, 24/10/2026).
interface ContentRailStore {
  dayRowWidth: number;
  setDayRowWidth: (width: number) => void;
}

export const useContentRailStore = create<ContentRailStore>((set, get) => ({
  dayRowWidth: 0,
  setDayRowWidth: (width) => {
    const rounded = Math.ceil(width);
    if (rounded !== get().dayRowWidth) set({ dayRowWidth: rounded });
  },
}));

export const useContentRail = () => {
  const dayRowWidth = useContentRailStore((s) => s.dayRowWidth);
  return useMemo(() => {
    const maxWidth = Math.max(WIDE_CONTENT_MAX_WIDTH, dayRowWidth);
    return {
      maxWidth,
      rail: { maxWidth },
      // Lists add 12 of padding on each side around the cards.
      railPadded: { maxWidth: maxWidth + 24 },
    };
  }, [dayRowWidth]);
};
