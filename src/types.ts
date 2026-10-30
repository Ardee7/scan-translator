export interface Selection {
  x: number; y: number; width: number; height: number;
  viewportWidth: number; viewportHeight: number;
  scrollX: number; scrollY: number; dpr: number; url: string;
}
export interface Translation {
  language: string;
  bubbles: { source: string; translation: string; unreadable: boolean }[];
}
export interface HistoryEntry {
  id: string;
  createdAt: number;
  result: Translation;
}
export interface ScanJob {
  id: string;
  createdAt: number;
  status: 'translating' | 'error';
  message: string;
}
export interface State {
  clickMode?: boolean;
  flexibleBubbles?: boolean;
  captureBusy?: boolean;
  activeRequests?: number;
  jobs?: ScanJob[];
  history?: HistoryEntry[];
  phase: 'idle' | 'selecting' | 'translating' | 'success' | 'error';
  message: string;
  result?: Translation;
}
