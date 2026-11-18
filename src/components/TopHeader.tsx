import React from 'react';
import { Menu, Moon, Sun, QrCode, ShieldCheck, Copy, Check, LogOut } from 'lucide-react';
import { TeacherAccount } from '../types';

interface TopHeaderProps {
  onToggleMobileMenu: () => void;
  activeTab: string;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenProjector: () => void;
  onOpenStudentMode: () => void;
  onLogout: () => void;
  tokenCode: string;
  teacherRole?: TeacherAccount['role'];
}

const getTabTitles = (
  teacherRole: TeacherAccount['role']
): Record<string, { category: string; title: string }> => {
  const isPengawas = teacherRole === 'Pengawas';
  const isAdmin = teacherRole === 'Admin Sekolah';

  return {
    dashboard: {
      category: isPengawas ? 'Portal Pengawas' : isAdmin ? 'Admin Sekolah' : 'Portal Guru',
      title: isPengawas
        ? 'Dashboard Pengawas Ujian'
        : isAdmin
        ? 'Dashboard Admin Sekolah'
        : 'Dashboard Guru',
    },
    generator: { category: 'Pembuatan Soal', title: 'AI Generator Soal Cerdas' },
    bank: { category: 'Pembuatan Soal', title: 'Bank Soal Guru' },
    google_forms: { category: 'Pembuatan Soal', title: 'Google Forms' },
    token: {
      category: isPengawas ? 'Pengawasan Ujian' : 'Distribusi & Pelaksanaan',
      title: isPengawas ? 'Token & Ruang Ujian' : 'Token Siswa & Manajemen Akses',
    },
    distribusi: {
      category: isPengawas ? 'Pengawasan Ujian' : 'Distribusi & Pelaksanaan',
      title: isPengawas ? 'Distribusi Ujian' : 'Distribusi Google Form',
    },
    monitoring: {
      category: isPengawas ? 'Pengawasan Ujian' : 'Distribusi & Pelaksanaan',
      title: 'Ujian Live',
    },
    nilai_siswa: {
      category: isPengawas ? 'Ketertiban & Hasil' : 'Distribusi & Pelaksanaan',
      title: 'Nilai Siswa',
    },
    rekap: {
      category: isPengawas ? 'Ketertiban & Hasil' : 'Evaluasi & Analisis',
      title: 'Rekap Nilai Siswa',
    },
    pelanggaran: {
      category: isPengawas ? 'Ketertiban & Hasil' : 'Evaluasi & Analisis',
      title: 'Riwayat Pelanggaran',
    },
    teacher_users: { category: 'Administrasi Sekolah', title: 'Pengguna Guru & Pengawas' },
    student_users: { category: 'Administrasi Sekolah', title: 'Peserta Ujian & Upload Excel' },
    settings_gas: { category: 'Administrasi Sekolah', title: 'Setting Web App (Code.gs)' },
    clear_data: { category: 'Administrasi Sekolah', title: 'Clear Data & Cache' },
    download: {
      category: isPengawas ? 'Perangkat Pengawas' : 'Administrasi Sekolah',
      title: 'Download Aplikasi',
    },
    paket: { category: 'Administrasi Sekolah', title: 'Status Paket & Akun' },
  };
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  onToggleMobileMenu,
  activeTab,
  isDark,
  onToggleTheme,
  onOpenProjector,
  onOpenStudentMode,
  onLogout,
  tokenCode,
  teacherRole = 'Admin Sekolah',
}) => {
  const tabTitles = getTabTitles(teacherRole);
  const currentInfo = tabTitles[activeTab] || { category: 'Dashboard', title: 'Ringkasan' };
  const [copied, setCopied] = React.useState(false);

  const handleCopyToken = () => {
    if (!tokenCode) return;
    navigator.clipboard.writeText(tokenCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="h-16 px-4 sm:px-6 bg-white/90 dark:bg-[#080f1e]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-4 sticky top-0 z-30">
      {/* Left: Mobile Toggle & Single-Line Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-label="Buka Menu Navigasi"
          className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          <span className="hidden sm:inline text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
            {currentInfo.category}
          </span>
          <span className="hidden sm:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
            /
          </span>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100 tracking-tight truncate">
            {currentInfo.title}
          </h2>
        </nav>
      </div>

      {/* Right: Clean Actions */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {tokenCode && (
          <button
            type="button"
            onClick={handleCopyToken}
            title="Salin kode token aktif"
            className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-slate-200/90 dark:border-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span className="text-slate-400 dark:text-slate-500">Token</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {tokenCode}
            </span>
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenProjector}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800/70 hover:bg-slate-200/80 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          title="Tampilkan Layar QR Proyektor"
        >
          <QrCode className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="hidden md:inline">Layar Proyektor</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Ganti Tema Gelap atau Terang"
          title="Ganti Tema Gelap / Terang"
          className="h-9 w-9 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onOpenStudentMode}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">Portal Siswa</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          aria-label="Keluar Akun"
          title="Keluar / Logout Guru"
          className="h-9 w-9 flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
