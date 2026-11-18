import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  BookOpen,
  KeyRound,
  FileSpreadsheet,
  Users,
  BarChart3,
  ShieldAlert,
  Smartphone,
  CreditCard,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  LogOut,
  X,
  FileCode,
  LayoutDashboard,
  Radio,
  FileText,
  Eraser,
  Search,
  Award,
  QrCode,
  GraduationCap,
} from 'lucide-react';
import { TeacherAccount } from '../types';

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenProjector: () => void;
  onOpenStudentMode: () => void;
  onLogout: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  tokenCode: string;
  teacherName?: string;
  teacherEmail?: string;
  teacherRole?: TeacherAccount['role'];
  teachersCount?: number;
  studentsCount?: number;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  meta?: string;
}

interface MenuGroup {
  id: string;
  groupTitle: string;
  items: MenuItem[];
}

function getInitials(name: string): string {
  const parts = String(name || '')
    .replace(/,.*$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'GR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenProjector,
  onOpenStudentMode,
  onLogout,
  isOpenMobile,
  onCloseMobile,
  tokenCode,
  teacherName = 'Apendi Mukdor, S.Pd.',
  teacherEmail = 'apendimukdor86@guru.smp.belajar.id',
  teacherRole = 'Admin Sekolah',
  teachersCount = 1,
  studentsCount = 0,
}) => {
  const [menuQuery, setMenuQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isAdmin = teacherRole === 'Admin Sekolah';
  const isPengawas = teacherRole === 'Pengawas';

  const workspaceSubtitle = isPengawas
    ? 'Portal Guru Pengawas'
    : isAdmin
    ? 'Admin Sekolah & CBT'
    : 'Workspace Guru Mapel';

  const roleDisplayName = isPengawas
    ? 'Guru Pengawas'
    : isAdmin
    ? 'Admin Sekolah'
    : 'Guru Mapel';

  const menuGroups: MenuGroup[] = useMemo(() => {
    if (isPengawas) {
      return [
        {
          id: 'utama',
          groupTitle: 'Utama',
          items: [
            {
              id: 'dashboard',
              label: 'Dashboard Pengawas',
              icon: LayoutDashboard,
            },
          ],
        },
        {
          id: 'pengawasan',
          groupTitle: 'Pengawasan Ujian',
          items: [
            {
              id: 'monitoring',
              label: 'Ujian Live',
              icon: Radio,
            },
            {
              id: 'token',
              label: 'Token & Ruang Ujian',
              icon: KeyRound,
              meta: tokenCode || undefined,
            },
            {
              id: 'distribusi',
              label: 'Distribusi Ujian',
              icon: FileSpreadsheet,
            },
          ],
        },
        {
          id: 'evaluasi',
          groupTitle: 'Ketertiban & Hasil',
          items: [
            {
              id: 'pelanggaran',
              label: 'Riwayat Pelanggaran',
              icon: ShieldAlert,
            },
            {
              id: 'nilai_siswa',
              label: 'Nilai Siswa',
              icon: Award,
            },
            {
              id: 'rekap',
              label: 'Rekap Nilai Siswa',
              icon: BarChart3,
            },
          ],
        },
        {
          id: 'perangkat',
          groupTitle: 'Perangkat Pengawas',
          items: [
            {
              id: 'download',
              label: 'Download Aplikasi',
              icon: Smartphone,
            },
          ],
        },
      ];
    }

    if (!isAdmin) {
      // Guru Mapel
      return [
        {
          id: 'utama',
          groupTitle: 'Utama',
          items: [
            {
              id: 'dashboard',
              label: 'Dashboard Guru',
              icon: LayoutDashboard,
            },
          ],
        },
        {
          id: 'soal',
          groupTitle: 'Pembuatan Soal',
          items: [
            {
              id: 'generator',
              label: 'AI Generator Soal',
              icon: Sparkles,
            },
            {
              id: 'bank',
              label: 'Bank Soal Guru',
              icon: BookOpen,
            },
            {
              id: 'google_forms',
              label: 'Google Forms',
              icon: FileText,
            },
          ],
        },
        {
          id: 'distribusi',
          groupTitle: 'Distribusi & Pelaksanaan',
          items: [
            {
              id: 'token',
              label: 'Token Siswa',
              icon: KeyRound,
              meta: tokenCode || undefined,
            },
            {
              id: 'distribusi',
              label: 'Distribusi Google Form',
              icon: FileSpreadsheet,
            },
            {
              id: 'monitoring',
              label: 'Ujian Live',
              icon: Radio,
            },
            {
              id: 'nilai_siswa',
              label: 'Nilai Siswa',
              icon: Award,
            },
          ],
        },
        {
          id: 'evaluasi',
          groupTitle: 'Evaluasi & Analisis',
          items: [
            {
              id: 'rekap',
              label: 'Rekap Nilai Siswa',
              icon: BarChart3,
            },
            {
              id: 'pelanggaran',
              label: 'Riwayat Pelanggaran',
              icon: ShieldAlert,
            },
          ],
        },
        {
          id: 'perangkat',
          groupTitle: 'Perangkat',
          items: [
            {
              id: 'download',
              label: 'Download Aplikasi',
              icon: Smartphone,
            },
          ],
        },
      ];
    }

    // Admin Sekolah (Full System Menus)
    return [
      {
        id: 'utama',
        groupTitle: 'Utama',
        items: [
          {
            id: 'dashboard',
            label: 'Dashboard Admin',
            icon: LayoutDashboard,
          },
        ],
      },
      {
        id: 'soal',
        groupTitle: 'Pembuatan Soal',
        items: [
          {
            id: 'generator',
            label: 'AI Generator Soal',
            icon: Sparkles,
          },
          {
            id: 'bank',
            label: 'Bank Soal Guru',
            icon: BookOpen,
          },
          {
            id: 'google_forms',
            label: 'Google Forms',
            icon: FileText,
          },
        ],
      },
      {
        id: 'distribusi',
        groupTitle: 'Distribusi & Pelaksanaan',
        items: [
          {
            id: 'token',
            label: 'Token Siswa',
            icon: KeyRound,
            meta: tokenCode || undefined,
          },
          {
            id: 'distribusi',
            label: 'Distribusi Google Form',
            icon: FileSpreadsheet,
          },
          {
            id: 'monitoring',
            label: 'Ujian Live',
            icon: Radio,
          },
          {
            id: 'nilai_siswa',
            label: 'Nilai Siswa',
            icon: Award,
          },
        ],
      },
      {
        id: 'evaluasi',
        groupTitle: 'Evaluasi & Analisis',
        items: [
          {
            id: 'rekap',
            label: 'Rekap Nilai Siswa',
            icon: BarChart3,
          },
          {
            id: 'pelanggaran',
            label: 'Riwayat Pelanggaran',
            icon: ShieldAlert,
          },
        ],
      },
      {
        id: 'pengaturan',
        groupTitle: 'Administrasi Sekolah',
        items: [
          {
            id: 'teacher_users',
            label: 'Pengguna Guru & Pengawas',
            icon: Users,
            meta: String(teachersCount),
          },
          {
            id: 'student_users',
            label: 'Peserta Ujian',
            icon: GraduationCap,
            meta: String(studentsCount),
          },
          {
            id: 'settings_gas',
            label: 'Setting Web App',
            icon: FileCode,
          },
          {
            id: 'clear_data',
            label: 'Clear Data & Cache',
            icon: Eraser,
          },
          {
            id: 'download',
            label: 'Download Aplikasi',
            icon: Smartphone,
          },
          {
            id: 'paket',
            label: 'Status Paket & Akun',
            icon: CreditCard,
          },
        ],
      },
    ];
  }, [isAdmin, isPengawas, tokenCode, teachersCount, studentsCount]);

  const normalizedQuery = menuQuery.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return menuGroups;
    return menuGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(normalizedQuery) ||
            group.groupTitle.toLowerCase().includes(normalizedQuery)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [menuGroups, normalizedQuery]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const initials = getInitials(teacherName);

  const activeNavClasses = isPengawas
    ? 'bg-sky-600/10 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold'
    : 'bg-emerald-600/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold';

  const activeIconClasses = isPengawas
    ? 'text-sky-600 dark:text-sky-400'
    : 'text-emerald-600 dark:text-emerald-400';

  const activeMetaClasses = isPengawas
    ? 'text-sky-700 dark:text-sky-300 font-semibold'
    : 'text-emerald-700 dark:text-emerald-300 font-semibold';

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Sidebar Navigation Shell */}
      <aside
        aria-label={`Navigasi ${roleDisplayName}`}
        className={`fixed inset-y-0 left-0 z-50 w-[272px] bg-white dark:bg-[#080f1e] border-r border-slate-200/80 dark:border-slate-800/80 flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* 1. Brand Header */}
        <div className="h-16 px-5 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => {
              onSelectTab('dashboard');
              onCloseMobile();
            }}
            className="flex items-center gap-3 text-left group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg"
          >
            <span
              className={`w-8 h-8 rounded-lg text-white flex items-center justify-center font-extrabold text-sm tracking-tight shrink-0 ${
                isPengawas ? 'bg-sky-600' : 'bg-emerald-600'
              }`}
            >
              S
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap leading-tight">
                Soalpintar.ai
              </div>
              <div
                className={`text-[11px] font-semibold whitespace-nowrap leading-tight mt-0.5 ${
                  isPengawas
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {workspaceSubtitle}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Tutup Menu"
            className="lg:hidden min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2. Quick Menu Search */}
        <div className="px-3.5 pt-3.5 pb-1.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={menuQuery}
              onChange={(e) => setMenuQuery(e.target.value)}
              placeholder="Cari menu..."
              aria-label="Cari menu navigasi"
              className="w-full h-9 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors"
            />
            {menuQuery && (
              <button
                type="button"
                onClick={() => setMenuQuery('')}
                aria-label="Bersihkan pencarian menu"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* 3. Navigation Groups */}
        <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-4">
          {filteredGroups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
              Menu tidak ditemukan.
            </div>
          ) : (
            filteredGroups.map((group) => {
              const isCollapsed = !normalizedQuery && Boolean(collapsedGroups[group.id]);
              return (
                <div key={group.id} className="space-y-1">
                  {group.id !== 'utama' && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={!isCollapsed}
                      className="w-full px-2.5 py-1 flex items-center justify-between text-[11px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer rounded-md"
                    >
                      <span>{group.groupTitle}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-150 ${
                          isCollapsed ? '-rotate-90' : 'rotate-0'
                        }`}
                      />
                    </button>
                  )}

                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              onSelectTab(item.id);
                              onCloseMobile();
                            }}
                            aria-current={isActive ? 'page' : undefined}
                            className={`w-full min-h-[38px] text-left px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 flex items-center justify-between gap-2 group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                              isActive
                                ? activeNavClasses
                                : 'text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-100/80 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icon
                                className={`w-4 h-4 shrink-0 transition-colors ${
                                  isActive
                                    ? activeIconClasses
                                    : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                                }`}
                              />
                              <span className="truncate whitespace-nowrap">{item.label}</span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {item.meta && (
                                <span
                                  className={`text-[11px] font-mono tabular-nums ${
                                    isActive
                                      ? activeMetaClasses
                                      : 'text-slate-400 dark:text-slate-500'
                                  }`}
                                >
                                  {item.meta}
                                </span>
                              )}
                              {isActive && (
                                <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${activeIconClasses}`} />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* 4. Bottom Action & Profile */}
        <div className="p-3.5 border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#060b16] shrink-0 space-y-2.5">
          {isPengawas && (
            <button
              type="button"
              onClick={() => {
                onOpenProjector();
                onCloseMobile();
              }}
              className="w-full min-h-[38px] py-2 px-3.5 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span>Layar QR Proyektor</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onOpenStudentMode();
              onCloseMobile();
            }}
            className="w-full min-h-[40px] py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Buka Portal Siswa</span>
          </button>

          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70 flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                isPengawas
                  ? 'bg-sky-600/15 text-sky-600 dark:text-sky-300'
                  : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {teacherName}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {roleDisplayName} · {teacherEmail}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onCloseMobile();
                onLogout();
              }}
              aria-label="Keluar Akun"
              title="Keluar Akun"
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
