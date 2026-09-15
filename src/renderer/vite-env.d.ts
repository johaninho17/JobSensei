import type { SenseiApi } from "../shared/schemas";

declare global {
  interface Window { sensei: SenseiApi; }
}

declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(input: { data: Uint8Array }): { promise: Promise<any> };
}

declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}

export {};
