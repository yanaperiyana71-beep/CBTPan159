import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error || 'Terjadi kesalahan aplikasi.'),
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Application runtime error:', error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetSessionAndReload = () => {
    try {
      const preservedKeys = new Set([
        'soalpintar_gas_webapp_url',
        'soalpintar_gas_guru_name',
        'soalpintar_gas_api_secret',
        'soalpintar_gas_shuffle_q',
        'soalpintar_gas_shuffle_o',
        'soalpintar_gas_custom_code_gs',
      ]);
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('soalpintar_') && !preservedKeys.has(key)) {
          toRemove.push(key);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Ignore storage error
    }
    window.location.href = window.location.pathname;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#020617] text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="w-full max-w-md bg-[#0b1324] border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-950/70 border border-rose-800/70 text-rose-400 flex items-center justify-center mx-auto font-bold text-lg">
              !
            </div>
            <h1 className="text-lg font-bold text-white">Aplikasi Mengalami Gangguan Tampilan</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Sistem mendeteksi kesalahan data atau sesi lokal yang menghalangi tampilan. Anda dapat memuat ulang halaman atau mereset cache sesi lokal dengan aman.
            </p>
            {this.state.errorMessage && (
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-rose-300 break-words">
                {this.state.errorMessage}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              >
                Muat Ulang Halaman
              </button>
              <button
                type="button"
                onClick={this.handleResetSessionAndReload}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
              >
                Reset Sesi &amp; Muat Ulang
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

