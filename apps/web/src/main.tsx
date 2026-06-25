import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './lib/AuthContext.js';
import { ActiveSelectionProvider } from './lib/ActiveSelectionContext.js';
import { initTheme } from './lib/theme.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

// Apply the resolved light/dark theme to <html> before first paint (avoids a flash).
initTheme();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
       * useTransitions={false}: react-router v7 wraps location updates in
       * React.startTransition by default (v6 did not). That defers URL/searchParam
       * updates, so inputs controlled by the URL (the DataGrid filter/column
       * checkboxes, rows-per-page select) briefly revert to their pre-click value
       * before the deferred render settles — enough for the controlled checkbox to
       * read as "unchecked" right after a click. Opting out restores v6's synchronous
       * navigation so URL-controlled inputs stay in lockstep with the interaction.
       */}
      <BrowserRouter useTransitions={false}>
        <AuthProvider>
          <ActiveSelectionProvider>
            <App />
          </ActiveSelectionProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
