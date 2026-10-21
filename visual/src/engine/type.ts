// The two helper types the vendored engine (algo.ts) imports from the original repo's lava/type.ts.
export type StringMap<T> = { [k: string]: T };
export type Func<I, O> = (i: I) => O;
