/** DOM surface used by the pinned, Node-only source metadata adapter. */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { contentType?: string });
    readonly window: Window;
  }
}
