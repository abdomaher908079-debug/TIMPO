/// <reference types="vite/client" />

// Set in vite.config.ts.
// Address of the speech runtime's WebAssembly file on the live site.
declare const __SPEECH_RUNTIME_URL__: string;
// The gzipped copy of that file on our own site ('' when VITE_SPEECH_RUNTIME_URL is used instead).
declare const __SPEECH_RUNTIME_GZ__: string;
// The commit the site was built from, shown on /diagnose.
declare const __APP_VERSION__: string;
