// Ambient module shims for dependencies that ship no usable TypeScript types.

// Side-effect CSS imports (Vite handles these; TS just needs the module to exist).
declare module '*.css';

// html2canvas (v1) ships no .d.ts and @types/html2canvas is unmaintained.
// We use only the default-export call form: html2canvas(el, opts) -> Promise<canvas>.
declare module 'html2canvas' {
  export interface Html2CanvasOptions {
    backgroundColor?: string | null;
    scale?: number;
    useCORS?: boolean;
    logging?: boolean;
    width?: number;
    height?: number;
    windowWidth?: number;
    windowHeight?: number;
    [option: string]: unknown;
  }
  export default function html2canvas(
    element: HTMLElement,
    options?: Html2CanvasOptions,
  ): Promise<HTMLCanvasElement>;
}

// vite-plugin-pwa's virtual module (see src/pwa/registerUpdates.js). Shimmed
// locally so type-checking never depends on the plugin's bundled client types.
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(
    options?: RegisterSWOptions,
  ): (reloadPage?: boolean) => Promise<void>;
}
