import React, { useState, useEffect } from 'react';
import { ExternalLink, Clock, PlusCircle, Folder, Edit3, Send, Play, Pause, Check, FileSpreadsheet } from 'lucide-react';
import { ExamTokenConfig, ManagedTokenEntry } from '../types';
import { parseResponseJsonSafe } from '../utils/safeFetchJson';

interface DistribusiGoogleFormViewProps {
  config: ExamTokenConfig;
  onUpdateConfig: (config: ExamTokenConfig) => void;
  onSyncTokenEntry?: (token: string, updates: Partial<ManagedTokenEntry>) => void;
  onOpenLiveMonitoring: () => void;
  onOpenSecureExam: () => void;
}

export const DistribusiGoogleFormView: React.FC<DistribusiGoogleFormViewProps> = ({
  config,
  onUpdateConfig,
  onSyncTokenEntry,
  onOpenLiveMonitoring,
  onOpenSecureExam,
}) => {
  const [googleFormUrl, setGoogleFormUrl] = useState(config.googleFormUrl);
  const [googleFormEditUrl, setGoogleFormEditUrl] = useState(config.googleFormEditUrl || '');
  const [driveFolderUrl, setDriveFolderUrl] = useState(config.driveFolderUrl || '');
  const [durationInput, setDurationInput] = useState<string>(String(config.durationMinutes || 90));
  const [isEditingDuration, setIsEditingDuration] = useState<boolean>(false);
  const [durationSavedMsg, setDurationSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setGoogleFormUrl(config.googleFormUrl || '');
    setGoogleFormEditUrl(config.googleFormEditUrl || '');
    setDriveFolderUrl(config.driveFolderUrl || '');
  }, [config.googleFormUrl, config.googleFormEditUrl, config.driveFolderUrl]);

  useEffect(() => {
    if (!isEditingDuration) {
      setDurationInput(String(config.durationMinutes || 90));
    }
  }, [config.durationMinutes, isEditingDuration]);

  const formatSeconds = (sec: number) => {
    const safeSec = Math.max(0, Math.floor(Number(sec) || 0));
    const hours = Math.floor(safeSec / 3600);
    const minutes = Math.floor((safeSec % 3600) / 60);
    const seconds = safeSec % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleExtendTime = async (mins: number) => {
    const newRemaining = Math.max(0, (config.remainingSeconds || 0) + mins * 60);
    const newDuration = Math.max(0, (config.durationMinutes || 0) + mins);
    const updated = {
      ...config,
      remainingSeconds: newRemaining,
      durationMinutes: newDuration,
    };
    onUpdateConfig(updated);

    const cleanToken = String(config.token || '').trim().toUpperCase();
    if (!cleanToken) return;
    onSyncTokenEntry?.(cleanToken, { durationMinutes: newDuration });

    try {
      await fetch(`/api/rooms/${encodeURIComponent(cleanToken)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'extend_time',
          addMinutes: mins,
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const parseValidDuration = (raw: string): number => {
    const parsed = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, config.durationMinutes || 90);
    return Math.min(600, parsed);
  };

  const handleSaveDuration = async (customMinutes?: number, overrideExamStarted?: boolean) => {
    const newMins = customMinutes ?? parseValidDuration(durationInput);
    const nextStarted = overrideExamStarted !== undefined ? overrideExamStarted : config.isExamStarted;
    const updated: ExamTokenConfig = {
      ...config,
      durationMinutes: newMins,
      remainingSeconds: newMins * 60,
      isExamStarted: nextStarted,
    };

    setDurationInput(String(newMins));
    setIsEditingDuration(false);
    onUpdateConfig(updated);

    const cleanToken = String(config.token || '').trim().toUpperCase();
    if (cleanToken) {
      onSyncTokenEntry?.(cleanToken, {
        durationMinutes: newMins,
        ...(overrideExamStarted !== undefined ? { isExamStarted: nextStarted } : {}),
      });

      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(cleanToken)}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_duration',
            durationMinutes: newMins,
          }),
        });
        if (res.status === 404) {
          await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
          });
        }
      } catch (err) {
        console.error(err);
      }
    }

    setDurationSavedMsg(`Alokasi waktu disimpan: ${newMins} Menit`);
    setTimeout(() => setDurationSavedMsg(null), 3000);
    return updated;
  };

  const handleToggleExamState = async () => {
    const nextStarted = !config.isExamStarted;
    const parsedInput = parseInt(String(durationInput || '').replace(/[^\d]/g, ''), 10);
    const hasPendingDuration =
      isEditingDuration &&
      Number.isFinite(parsedInput) &&
      parsedInput >= 1 &&
      parsedInput !== config.durationMinutes;

    const appliedMins = hasPendingDuration
      ? Math.min(600, parsedInput)
      : config.durationMinutes;

    const updated: ExamTokenConfig = {
      ...config,
      durationMinutes: appliedMins,
      remainingSeconds: hasPendingDuration ? appliedMins * 60 : config.remainingSeconds,
      isExamStarted: nextStarted,
    };

    if (hasPendingDuration) {
      setDurationInput(String(appliedMins));
      setIsEditingDuration(false);
      setDurationSavedMsg(`Waktu diubah ke ${appliedMins} Menit & ${nextStarted ? 'dimulai' : 'dijeda'}`);
      setTimeout(() => setDurationSavedMsg(null), 3000);
    }

    onUpdateConfig(updated);

    const cleanToken = String(config.token || '').trim().toUpperCase();
    if (!cleanToken) return;
    onSyncTokenEntry?.(cleanToken, {
      isExamStarted: nextStarted,
      ...(hasPendingDuration ? { durationMinutes: appliedMins } : {}),
    });

    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(cleanToken)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: nextStarted ? 'start_exam' : 'pause_exam',
          ...(hasPendingDuration ? { durationMinutes: appliedMins } : {}),
        }),
      });
      if (res.status === 404) {
        await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveIntegration = async () => {
    const parsedInput = parseInt(String(durationInput || '').replace(/[^\d]/g, ''), 10);
    const hasPendingDuration =
      isEditingDuration &&
      Number.isFinite(parsedInput) &&
      parsedInput >= 1 &&
      parsedInput !== config.durationMinutes;
    const nextDuration = hasPendingDuration ? Math.min(600, parsedInput) : config.durationMinutes;

    const updated: ExamTokenConfig = {
      ...config,
      googleFormUrl,
      googleFormEditUrl,
      driveFolderUrl,
      durationMinutes: nextDuration,
      remainingSeconds: hasPendingDuration ? nextDuration * 60 : config.remainingSeconds,
    };
    if (hasPendingDuration) {
      setDurationInput(String(nextDuration));
      setIsEditingDuration(false);
    }
    onUpdateConfig(updated);

    const cleanToken = String(config.token || '').trim().toUpperCase();
    if (cleanToken) {
      onSyncTokenEntry?.(cleanToken, {
        googleFormUrl,
        googleFormEditUrl,
        driveFolderUrl,
        durationMinutes: nextDuration,
      });
    }

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        const data = await parseResponseJsonSafe(res);
        if (data?.success && data.room?.token && !updated.token) {
          onUpdateConfig({ ...updated, token: data.room.token });
        }
      }
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Distribusi Google Form & Integrasi Workspace
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Hubungkan kuis Google Form Anda langsung ke dalam portal evaluasi ujian aman Soalpintar.ai dengan kontrol hitung mundur dan akses folder Google Drive terpadu.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Google Form Links & Workspace Management */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-4 border-b border-slate-100 dark:border-slate-800 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Tautan Google Form & Google Drive (v2-soalpintar.ai)</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tautan Pengerjaan Google Form Siswa (URL /viewform)
              </label>
              <input
                type="url"
                value={googleFormUrl}
                onChange={(e) => setGoogleFormUrl(e.target.value)}
                placeholder="https://docs.google.com/forms/d/e/.../viewform"
                className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Tautan ini akan dimuat di dalam Portal Ujian Aman Anti-Curang siswa.
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tautan Editor Google Form Guru (URL /edit)
              </label>
              <input
                type="url"
                value={googleFormEditUrl}
                onChange={(e) => setGoogleFormEditUrl(e.target.value)}
                placeholder="https://docs.google.com/forms/d/.../edit"
                className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Tautan Folder Kuis Google Drive
              </label>
              <input
                type="url"
                value={driveFolderUrl}
                onChange={(e) => setDriveFolderUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/v2-soalpintar-ai..."
                className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={handleSaveIntegration}
              className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Simpan Perubahan Tautan
            </button>
            <div className="flex items-center gap-2">
              {savedSuccess && (
                <span className="text-xs text-emerald-600 font-semibold animate-pulse">
                  ✓ Integrasi berhasil diperbarui!
                </span>
              )}
              <span className="text-xs text-slate-400">
                Token Terhubung: {config.token || 'Belum ada token'}
              </span>
            </div>
          </div>

          {/* Quick Direct Links Cards */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Akses Langsung Google Workspace:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {googleFormUrl && googleFormUrl.startsWith('https://docs.google.com/forms/') && !googleFormUrl.includes('contoh-') ? (
                <a
                  href={googleFormUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-lg border border-purple-200 dark:border-purple-800 text-xs flex items-center justify-between hover:bg-purple-100 transition-colors"
                >
                  <span className="font-semibold text-purple-700 dark:text-purple-300">Form Siswa</span>
                  <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                </a>
              ) : (
                <div
                  className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between text-slate-400 opacity-75"
                  title="Formulir belum ditautkan atau masih kosong"
                >
                  <span>Form Siswa (Belum Ada)</span>
                  <span className="text-[10px]">⚠️</span>
                </div>
              )}

              {googleFormEditUrl && googleFormEditUrl.startsWith('https://docs.google.com/forms/') && !googleFormEditUrl.includes('contoh-') ? (
                <a
                  href={googleFormEditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs flex items-center justify-between hover:bg-indigo-100 transition-colors"
                >
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">Editor Form</span>
                  <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                </a>
              ) : (
                <div
                  className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between text-slate-400 opacity-75"
                  title="Tautan editor form belum diisi"
                >
                  <span>Editor Form (Kosong)</span>
                  <span className="text-[10px]">⚠️</span>
                </div>
              )}

              <a
                href={driveFolderUrl || 'https://drive.google.com'}
                target="_blank"
                rel="noreferrer"
                className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between hover:bg-slate-100 transition-colors"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">Folder Drive</span>
                <Folder className="w-3.5 h-3.5 text-slate-400" />
              </a>
            </div>
          </div>
        </div>

        {/* Right: Countdown Timer & Exam Session Controller */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs text-center space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-500">HITUNGAN JAM MUNDUR (TIMER)</span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-sm ${
                  config.isExamStarted
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {config.isExamStarted ? 'Ujian Berjalan' : 'Ujian Dijeda / Belum Dimulai'}
              </span>
            </div>

            {/* Giant Visual Timer */}
            <div className="py-2 space-y-2.5">
              <div className="text-4xl md:text-5xl font-mono font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {formatSeconds(config.remainingSeconds)}
              </div>

              {!isEditingDuration ? (
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    Total Alokasi Waktu:{' '}
                    <strong className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                      {config.durationMinutes} Menit
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDurationInput(String(config.durationMinutes || 90));
                      setIsEditingDuration(true);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer"
                    title="Edit total alokasi waktu ujian"
                  >
                    <Edit3 className="w-3 h-3" />
                    Edit
                  </button>
                </div>
              ) : (
                <div className="mx-auto max-w-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 text-left">
                    Ubah Total Alokasi Waktu (Menit):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={durationInput}
                      onChange={(e) => setDurationInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveDuration();
                        }
                      }}
                      placeholder="90"
                      className="w-24 text-sm font-mono font-bold text-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 tabular-nums"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400">Menit</span>
                    <button
                      type="button"
                      onClick={() => handleSaveDuration()}
                      className="ml-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDurationInput(String(config.durationMinutes || 90));
                        setIsEditingDuration(false);
                      }}
                      className="px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {durationSavedMsg && (
                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  ✓ {durationSavedMsg}
                </div>
              )}
            </div>

            {/* Quick Extension Buttons */}
            <div className="space-y-2">
              <div className="text-left text-xs font-semibold text-slate-700 dark:text-slate-300">
                Perpanjangan Waktu Cepat (Add Time):
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleExtendTime(15)}
                  className="py-2 px-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                  +15 Menit
                </button>
                <button
                  onClick={() => handleExtendTime(30)}
                  className="py-2 px-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                  +30 Menit
                </button>
                <button
                  onClick={() => handleExtendTime(45)}
                  className="py-2 px-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                  +45 Menit
                </button>
              </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="pt-2 space-y-2">
              <button
                onClick={handleToggleExamState}
                className={`w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  config.isExamStarted ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {config.isExamStarted ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {config.isExamStarted ? 'Jeda Waktu Ujian' : 'Mulai / Lanjutkan Waktu Ujian'}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onOpenLiveMonitoring}
                  className="py-2 px-3 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Live Monitor
                </button>
                <button
                  onClick={onOpenSecureExam}
                  className="py-2 px-3 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Simulasi Siswa
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
