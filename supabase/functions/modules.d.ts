// Editor types for the Node checker. The Edge Runtime still loads the real jsr: and npm: modules.

declare module "jsr:@std/encoding/base64" {
  export function encodeBase64(data: Uint8Array): string;
}

declare module "npm:zod@4.6.7" {
  export { z } from "zod";
}

declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};
