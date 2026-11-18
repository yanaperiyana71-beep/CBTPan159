import React, { useState, useEffect } from 'react';
import {
  Calendar,
  BarChart2,
  HelpCircle,
  FileText,
  Key,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Zap,
  Check,
  X,
  Radio,
  Users,
  QrCode,
  Award,
  Shield,
  GraduationCap,
} from 'lucide-react';
import {
  QuestionPackage,
  StudentViolationLog,
  ExamTokenConfig,
  ManagedTokenEntry,
  TeacherAccount,
} from '../types';
import { ManualGoogleFormEntry } from './GoogleFormsView';
import { parseResponseJsonSafe } from '../utils/safeFetchJson';

interface DashboardViewProps {
  teacherName?: string;
  teacherRole?: TeacherAccount['role'];
  packages: QuestionPackage[];
  manualForms?: ManualGoogleFormEntry[];
  violations: StudentViolationLog[];
  examConfig: ExamTokenConfig;
  managedTokens?: ManagedTokenEntry[];
  onNavigate: (tabId: string) => void;
  onSelectPackageForDistribution: (pkg: QuestionPackage) => void;
  onOpenProjector?: () => void;
}

const isValidGoogleFormUrl = (url?: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  return (
    (url.startsWith('https://docs.google.com/forms/') || url.startsWith('https://forms.gle/')) &&
    !url.includes('contoh-')
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  teacherName = 'Apendi Mukdor, S.Pd.',
  teacherRole = 'Admin Sekolah',
  packages,
  manualForms = [],
  violations,
  examConfig,
  managedTokens,
  onNavigate,
  onSelectPackageForDistribution,
  onOpenProjector,
}) => {
  const isAdmin = teacherRole === 'Admin Sekolah';
  const isPengawas = teacherRole === 'Pengawas';

  // Live rooms summary (used prominently in Dashboard Pengawas & Admin)
  const [liveRoomsCount, setLiveRoomsCount] = useState<number>(0);
  const [liveActiveStudents, setLiveActiveStudents] = useState<number>(0);
  const [liveBlockedStudents, setLiveBlockedStudents] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const loadRoomsSummary = async () => {
      try {
        const res = await fetch('/api/rooms');
        if (!res.ok) return;
        const data = await parseResponseJsonSafe(res);
        if (!active || !data?.success || !Array.isArray(data.rooms)) return;
        let working = 0;
        let blocked = 0;
        for (const r of data.rooms) {
          const parts = r?.participants && typeof r.participants === 'object' ? Object.values(r.participants) : [];
          for (const p of parts as any[]) {
            if (p?.status === 'mengerjakan') working += 1;
            else if (p?.status === 'diblokir') blocked += 1;
          }
        }
        setLiveRoomsCount(data.rooms.length);
        setLiveActiveStudents(working);
        setLiveBlockedStudents(blocked);
      } catch {
        // Ignore offline error
      }
    };
    loadRoomsSummary();
    const timer = setInterval(loadRoomsSummary, 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // UTS schedule modal state (persisted in localStorage)
  const UTS_STORAGE_KEY = 'soalpintar_uts_schedule_v1';
  const savedUts = (() => {
    try {
      const raw = localStorage.getItem(UTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [showUtsModal, setShowUtsModal] = useState(false);
  const [utsDate, setUtsDate] = useState<string>(savedUts?.utsDate || '2026-12-07');
  const [utsStudentCount, setUtsStudentCount] = useState<string>(savedUts?.utsStudentCount || '320');
  const [utsNotes, setUtsNotes] = useState<string>(savedUts?.utsNotes || 'Asesmen Tengah Semester Ganjil SMP');
  const [utsScheduled, setUtsScheduled] = useState<boolean>(Boolean(savedUts?.utsScheduled));

  // Dynamic calculations from database
  const totalQuiz = packages.length;
  const totalSoal = packages.reduce((acc, p) => acc + (p.questions?.length || 0), 0);
  const linkedPkgFormsCount = packages.filter((p) => isValidGoogleFormUrl(p.googleFormUrl)).length;
  const googleFormsCount = linkedPkgFormsCount + manualForms.length;

  const { activeTokensCount, totalTokensCount, activeTokensList } = (() => {
    if (Array.isArray(managedTokens)) {
      const valid = managedTokens.filter((t) => t && t.token && t.token.trim() !== '');
      const active = valid.filter((t) => t.isActive !== false);
      return {
        activeTokensCount: active.length,
        totalTokensCount: valid.length,
        activeTokensList: valid,
      };
    }
    const hasDefault = Boolean(examConfig.token && examConfig.token.trim());
    return {
      activeTokensCount: hasDefault && examConfig.isActive !== false ? 1 : 0,
      totalTokensCount: hasDefault ? 1 : 0,
      activeTokensList: [] as ManagedTokenEntry[],
    };
  })();

  // Check violations in the past 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentViolations = violations.filter((v) => Number(v.timestamp) > oneDayAgo);

  const handleSaveUts = (e: React.FormEvent) => {
    e.preventDefault();
    setUtsScheduled(true);
    try {
      localStorage.setItem(
        UTS_STORAGE_KEY,
        JSON.stringify({
          utsScheduled: true,
          utsDate,
          utsStudentCount,
          utsNotes,
        })
      );
    } catch {
      // Ignore storage error
    }
    setShowUtsModal(false);
  };

  // =========================================================================
  // DEDICATED VIEW: DASHBOARD GURU PENGAWAS
  // =========================================================================
  if (isPengawas) {
    return (
      <div className="space-y-6 text-slate-900 dark:text-slate-100">
        {/* 1. Header Zone */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Dashboard Pengawas Ujian
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Selamat bertugas, {teacherName} · Fokus pengawasan ruang, token aktif &amp; ketertiban peserta
            </p>
          </div>

          <div className="self-start sm:self-auto flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400">
            <Radio className="w-4 h-4 shrink-0" />
            <span>Guru Pengawas</span>
          </div>
        </div>

        {/* 2. Supervision Action Banner */}
        <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/80 border border-sky-200 dark:border-sky-800/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {liveRoomsCount > 0
                  ? `${liveRoomsCount} Ruang Ujian Siap Dipantau (${liveActiveStudents} Siswa Aktif)`
                  : 'Pantau Ruang Ujian & Layar QR Proyektor'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Gunakan menu Ujian Live untuk memantau peserta secara real-time, mengirim peringatan pengawas, dan membuka blokir perangkat siswa.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenProjector && (
              <button
                type="button"
                onClick={onOpenProjector}
                className="whitespace-nowrap px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5 text-sky-500" />
                <span>Layar QR</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('monitoring')}
              className="whitespace-nowrap px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Buka Ujian Live</span>
            </button>
          </div>
        </div>

        {/* 3. 4 Proctor Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/80 border border-sky-200 dark:border-sky-800/50 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
                {liveRoomsCount}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Ruang Ujian Live
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
                {liveActiveStudents}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Siswa Mengerjakan
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
                {totalTokensCount > 0 ? (
                  <>
                    {activeTokensCount}
                    <span className="text-lg font-normal text-slate-500">/{totalTokensCount}</span>
                  </>
                ) : (
                  '0/0'
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Token Ujian Aktif
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
                {recentViolations.length + liveBlockedStudents}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Pelanggaran / Blokir
              </div>
            </div>
          </div>
        </div>

        {/* 4. Pelanggaran Ujian 24 Jam */}
        <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Pelanggaran Ketertiban Ujian
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {recentViolations.length} pelanggaran tercatat dalam 24 jam terakhir
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('pelanggaran')}
              className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium flex items-center gap-1 transition-colors self-start sm:self-auto cursor-pointer"
            >
              <span>Lihat riwayat lengkap</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentViolations.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Belum ada pelanggaran ketertiban ujian dalam 24 jam terakhir.
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              {recentViolations.slice(0, 4).map((v) => {
                const dt = new Date(Number(v.timestamp) || Date.now());
                const timeStr = isNaN(dt.getTime())
                  ? '-'
                  : dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-200">
                        {v.studentName || 'Siswa'}
                      </span>
                      <span className="text-slate-500 ml-2">({v.kelas || '-'})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-rose-500 dark:text-rose-400 font-semibold">{v.type}</span>
                      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
                        {timeStr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 5. Lower Section: Aksi Cepat Pengawas & Daftar Token/Ruang */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Aksi Cepat Pengawas */}
          <div className="lg:col-span-5 space-y-3.5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Aksi Cepat Pengawas
            </h2>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => onNavigate('monitoring')}
                className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-sky-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/80 border border-sky-200 dark:border-sky-800/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-sky-500 transition-colors">
                      Pantau Ujian Live
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Awasi progres, kirim peringatan &amp; buka blokir
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition-colors" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('token')}
                className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-amber-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-amber-500 transition-colors">
                      Token &amp; Ruang Ujian
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Atur token akses, batas waktu &amp; ruang tunggu
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-500 transition-colors" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('pelanggaran')}
                className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-rose-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-rose-500 transition-colors">
                      Riwayat Pelanggaran
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Log pindah tab, keluar fullscreen &amp; split screen
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-rose-500 transition-colors" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('nilai_siswa')}
                className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-emerald-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors">
                      Nilai &amp; Rekap Siswa
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Cek kehadiran submit &amp; unduh nilai siswa
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-colors" />
              </button>
            </div>
          </div>

          {/* Right Column: Token & Sesi Ujian Tersedia */}
          <div className="lg:col-span-7 space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Token &amp; Sesi Ujian Ruang
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('token')}
                className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium flex items-center gap-1 transition-colors cursor-pointer"
              >
                <span>Kelola Token</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              {activeTokensList.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl space-y-3">
                  <p>Belum ada token ujian yang aktif saat ini.</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('token')}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                  >
                    Buat atau Sinkronkan Token
                  </button>
                </div>
              ) : (
                activeTokensList.slice(0, 5).map((tok) => (
                  <div
                    key={tok.token}
                    onClick={() => onNavigate('monitoring')}
                    className="p-4 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-sky-500/40 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 cursor-pointer group shadow-sm"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="px-3 py-2 rounded-xl bg-sky-50 dark:bg-[#111e38] border border-sky-200 dark:border-sky-800/50 text-sky-700 dark:text-sky-300 font-mono font-bold text-xs tracking-wider shrink-0">
                        {tok.token}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-sky-500 transition-colors">
                          {tok.quizTitle || 'Ujian CBT'}
                        </h4>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {tok.subject || 'Umum'} · {tok.grade || 'SMP'} · {tok.durationMinutes ?? 90} menit
                        </div>
                      </div>
                    </div>

                    <div className="text-xs font-semibold shrink-0">
                      <span
                        className={
                          tok.isActive !== false
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-500 dark:text-rose-400'
                        }
                      >
                        {tok.isActive !== false ? 'Aktif · Pantau Live' : 'Dijeda'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // ADMIN SEKOLAH / GURU MAPEL DASHBOARD
  // =========================================================================
  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      {/* 1. Header Zone */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isAdmin ? 'Dashboard Admin Sekolah' : 'Dashboard Guru Mapel'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Selamat datang, {teacherName}!
          </p>
        </div>

        <div className="self-start sm:self-auto flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <Shield className="w-4 h-4 shrink-0" />
          <span>{isAdmin ? 'Admin Sekolah' : 'Guru Mapel'}</span>
        </div>
      </div>

      {/* 2. Banner: Kapan UTS di sekolah Anda? */}
      <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-sm">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {utsScheduled
                ? `Jadwal UTS Terjadwal: ${utsDate} (${utsStudentCount} Siswa)`
                : 'Kapan UTS di sekolah Anda?'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {utsScheduled
                ? 'Server cloud telah dipersiapkan dan dioptimalkan untuk kelancaran sesi ujian sekolah Anda.'
                : 'Isi tanggal dan jumlah siswanya (± 1 menit). Kami pakai untuk menyiapkan server agar ujian lancar.'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowUtsModal(true)}
          className="self-start md:self-auto whitespace-nowrap px-4 py-2 bg-[#4f46e5] hover:bg-[#4338ca] active:bg-[#3730a3] text-white text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-sm shrink-0"
        >
          {utsScheduled ? 'Ubah jadwal' : 'Isi jadwal'}
        </button>
      </div>

      {/* 3. 4 Stat Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-700/80 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <BarChart2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {totalQuiz}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Total Quiz</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-700/80 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/80 border border-teal-200 dark:border-teal-800/50 text-teal-600 dark:text-teal-400 flex items-center justify-center">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {totalSoal}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Total Soal</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-700/80 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {googleFormsCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Google Forms</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-700/80 transition-colors">
          <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <Key className="w-4 h-4" />
          </div>
          <div>
            <div className="text-3xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {totalTokensCount > 0 ? (
                <>
                  {activeTokensCount}
                  <span className="text-lg font-normal text-slate-500">/{totalTokensCount}</span>
                </>
              ) : (
                '0/0'
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Token Aktif</div>
          </div>
        </div>
      </div>

      {/* 4. Section: Pelanggaran Ujian */}
      <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Pelanggaran Ujian</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {recentViolations.length} pelanggaran hari ini · menampilkan 24 jam terakhir
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('pelanggaran')}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium flex items-center gap-1 transition-colors self-start sm:self-auto cursor-pointer"
          >
            <span>Lihat riwayat lengkap</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentViolations.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Belum ada pelanggaran dalam 24 jam terakhir.
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {recentViolations.slice(0, 3).map((v) => {
              const dt = new Date(Number(v.timestamp) || Date.now());
              const timeStr = isNaN(dt.getTime())
                ? '-'
                : dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-200">
                      {v.studentName || 'Siswa'}
                    </span>
                    <span className="text-slate-500 ml-2">({v.kelas || '-'})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-rose-500 dark:text-rose-400 font-semibold">{v.type}</span>
                    <span className="text-slate-500 font-mono tabular-nums text-[11px]">
                      {timeStr}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Lower Section: 2 Columns (Aksi Cepat Left, Quiz Terbaru Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-3.5">
          <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Aksi Cepat</h2>

          <div className="space-y-3">
            <button
              onClick={() => onNavigate('generator')}
              className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/80 border border-teal-200 dark:border-teal-800/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-teal-500 transition-colors">
                    Generate Soal AI
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Buat soal otomatis dengan AI
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white transition-colors" />
            </button>

            <button
              onClick={() => onNavigate('bank')}
              className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors">
                    Bank Soal
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Lihat koleksi soal Anda
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white transition-colors" />
            </button>

            <button
              onClick={() => onNavigate('token')}
              className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-800/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-amber-500 transition-colors">
                    Token Siswa
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Kelola token akses ujian
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-white transition-colors" />
            </button>

            {isAdmin && (
              <>
                <button
                  onClick={() => onNavigate('teacher_users')}
                  className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-emerald-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-500 transition-colors">
                        Kelola Guru &amp; Pengawas
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Atur akun Admin Sekolah &amp; Guru Pengawas
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                </button>

                <button
                  onClick={() => onNavigate('student_users')}
                  className="w-full text-left p-3.5 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-indigo-500/40 transition-all flex items-center justify-between group cursor-pointer shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors">
                        Peserta Ujian (Upload Excel)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Unggah daftar siswa dari file Excel &amp; atur akses
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                </button>

                <div className="p-4 rounded-2xl bg-white dark:bg-[#0b1324] border border-emerald-200 dark:border-emerald-900/40 space-y-3 shadow-sm">
                  <button
                    onClick={() => onNavigate('paket')}
                    className="w-full text-left flex items-start justify-between cursor-pointer group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Paket Sekolah</div>
                        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                          Paket Guru Juara CBT
                        </div>
                        <div className="text-[11px] text-emerald-600/90 dark:text-emerald-400/90 font-medium">
                          Sinkronisasi Admin &amp; Guru Pengawas
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 font-mono">
                          Aktif s/d 10 Nov 2027
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-colors mt-2" />
                  </button>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <button
                      onClick={() => onNavigate('paket')}
                      className="w-full text-left text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                      <span>Lihat detail kuota &amp; lisensi sekolah</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Quiz Terbaru */}
        <div className="lg:col-span-7 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              Quiz Terbaru
            </h2>
            <button
              onClick={() => onNavigate('bank')}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>Lihat Semua</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {packages.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl">
                Belum ada kuis yang dibuat. Klik Generate Soal AI untuk membuat kuis baru!
              </div>
            ) : (
              packages.slice(0, 5).map((pkg) => {
                const gradeStr = String(pkg.grade || 'SMP');
                const titleStr = String(pkg.title || pkg.subject || 'Kuis');
                const subjectStr = String(pkg.subject || 'Umum');
                const badgeTop = gradeStr.includes('SMA') ? 'SMA' : gradeStr.includes('SD') ? 'SD' : 'SMP';
                const badgeSub = gradeStr.includes('7')
                  ? 'Kelas 7'
                  : gradeStr.includes('8')
                  ? 'Kelas 8'
                  : gradeStr.includes('9')
                  ? 'Kelas 9'
                  : '';
                const hasRealForm = isValidGoogleFormUrl(pkg.googleFormUrl);

                return (
                  <div
                    key={pkg.id}
                    onClick={() => onSelectPackageForDistribution(pkg)}
                    className="p-4 rounded-2xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 cursor-pointer group shadow-sm"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-[#131d36] border border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex flex-col items-center justify-center text-center p-1 shrink-0 font-bold">
                        <span className="text-[11px] leading-tight">{badgeTop}</span>
                        {badgeSub && (
                          <span className="text-[9px] leading-tight font-normal">{badgeSub}</span>
                        )}
                      </div>

                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors line-clamp-1">
                          {titleStr}
                        </h4>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {subjectStr} · {(pkg.questions || []).length} soal · {pkg.timeAgo || pkg.createdAt || 'Baru saja'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto text-[11px] font-semibold">
                      {hasRealForm ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" />
                          Form
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">CBT Lokal</span>
                      )}
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {pkg.status || 'Siap'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* UTS Schedule Modal */}
      {showUtsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <Calendar className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <span>Jadwalkan UTS / Ujian Sekolah</span>
              </div>
              <button
                onClick={() => setShowUtsModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sistem Soalpintar.ai menggunakan data jadwal ini untuk menyiapkan dan mengalokasikan server agar pengerjaan siswa tidak mengalami lag atau kendala akses.
            </p>

            <form onSubmit={handleSaveUts} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Pelaksanaan UTS:
                </label>
                <input
                  type="date"
                  value={utsDate}
                  onChange={(e) => setUtsDate(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Perkiraan Jumlah Siswa Bersamaan:
                </label>
                <input
                  type="number"
                  value={utsStudentCount}
                  onChange={(e) => setUtsStudentCount(e.target.value)}
                  placeholder="Contoh: 320"
                  className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Keterangan / Jenjang:
                </label>
                <input
                  type="text"
                  value={utsNotes}
                  onChange={(e) => setUtsNotes(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUtsModal(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl cursor-pointer"
                >
                  Simpan Jadwal Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
