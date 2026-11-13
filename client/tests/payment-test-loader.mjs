import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Keep server-only imports and TypeScript transformation scoped to the test process.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: 'data:text/javascript,export {};', shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return nextResolve(specifier.replace(/\.js$/, '') + '.ts', context);
    }
    if (specifier === 'next/headers') return nextResolve('next/headers.js', context);
    throw error;
  }
}

export function load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) return nextLoad(url, context);
  return {
    shortCircuit: true,
    format: 'module',
    source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    }).outputText,
  };
}
