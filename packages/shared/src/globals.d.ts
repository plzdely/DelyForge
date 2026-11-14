// `packages/shared` is environment-neutral: it loads neither DOM nor Node typings, so it cannot accidentally depend on
// `window`, `fs`, etc. We declare only the few universal globals it uses (available in Node, Electron and browsers).
declare class URL {
  constructor(input: string, base?: string);
  readonly protocol: string;
  readonly hostname: string;
  readonly href: string;
  readonly origin: string;
  readonly searchParams: URLSearchParams;
}
declare class URLSearchParams {
  constructor(init?: Record<string, string>);
  get(name: string): string | null;
  toString(): string;
}
