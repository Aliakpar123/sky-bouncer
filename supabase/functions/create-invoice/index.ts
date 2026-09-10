// Entry point. The request handling lives in handler.ts so it can be tested
// without binding a port.
import handler from './handler.ts';

Deno.serve(handler);
