/// <reference types="vite/client" />

// CSS-only font packages ship no type declarations. TS6 reports TS2882 for
// side-effect imports of modules without declarations, so declare them as
// untyped modules (they are resolved and bundled by Vite at build time).
declare module '@fontsource-variable/inter';
declare module '@fontsource-variable/jetbrains-mono';
