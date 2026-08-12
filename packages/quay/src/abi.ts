// Provider ABI view-model types (ADR-012 single-source ABI contract).
// All providers (native, github) and Core are type-checked against these
// interfaces via tsc --noEmit; runtime enforcement remains in
// provider-abi-conformance.test.mjs.

export interface Task {
  id: string;
  title: string;
  status: 'todo' | 'ready' | 'done' | 'needs-human' | 'superseded';
  role: 'primitive' | 'compound';
  labels: string[];
  parent: string | null;
  children: string[];
  body: string;
  extra: Record<string, unknown>;
}

export interface AdrRecord {
  id: string;
  title: string;
  status: string;
  body: string;
}

export interface Manifest {
  [key: string]: unknown;
}
