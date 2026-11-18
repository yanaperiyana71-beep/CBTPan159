import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { AiGeneratorView } from './components/AiGeneratorView';
import { BankSoalView } from './components/BankSoalView';
import { TokenManagerView } from './components/TokenManagerView';
import { DistribusiGoogleFormView } from './components/DistribusiGoogleFormView';
import { LiveMonitoringView } from './components/LiveMonitoringView';
import { ProjectorScreenModal } from './components/ProjectorScreenModal';
import { SecureExamPlayer } from './components/SecureExamPlayer';
import { RekapNilaiView } from './components/RekapNilaiView';
import { RiwayatPelanggaranView } from './components/RiwayatPelanggaranView';
import { DownloadAplikasiView } from './components/DownloadAplikasiView';
import { StatusPaketView } from './components/StatusPaketView';
import { GasSettingsView } from './components/GasSettingsView';
import { DashboardView } from './components/DashboardView';
import { GoogleFormsView, ManualGoogleFormEntry } from './components/GoogleFormsView';
import { LoginView, AuthSession } from './components/LoginView';
import { TeacherUsersView } from './components/TeacherUsersView';
import { StudentParticipantsView } from './components/StudentParticipantsView';
import { ClearDataView } from './components/ClearDataView';
import { INITIAL_PACKAGES, INITIAL_SCORES, INITIAL_VIOLATIONS } from './data/mockBankSoal';
import { QuestionPackage, ExamTokenConfig, StudentScoreRecord, StudentViolationLog, TeacherAccount, ManagedTokenEntry, StudentParticipantAccount } from './types';
import { parseResponseJsonSafe } from './utils/safeFetchJson';

const MANUAL_FORMS_STORAGE_KEY = 'soalpintar_manual_google_forms';
const AUTH_SESSION_STORAGE_KEY = 'soalpintar_auth_session';
const REGISTERED_TEACHERS_STORAGE_KEY = 'soalpintar_registered_teachers';
const REGISTERED_STUDENTS_STORAGE_KEY = 'soalpintar_registered_students_v1';
const STRICT_STUDENTS_STORAGE_KEY = 'soalpintar_strict_students_v1';
const PACKAGES_STORAGE_KEY = 'soalpintar_packages_v1';
const SCORES_STORAGE_KEY = 'soalpintar_scores_v1';
const VIOLATIONS_STORAGE_KEY = 'soalpintar_violations_v1';
const TOKENS_STORAGE_KEY = 'soalpintar_created_tokens_v2';

const DB_PURGED_FLAG_KEY = 'soalpintar_db_purged_v1';

const DEFAULT_MANAGED_TOKENS: ManagedTokenEntry[] = [];

const DEFAULT_TEACHER_ACCOUNTS: TeacherAccount[] = [
  {
    id: 'teacher-default-1',
    name: 'Apendi Mukdor, S.Pd.',
    email: 'apendimukdor86@guru.smp.belajar.id',
    password: 'guru123',
    subject: 'Matematika & IPA',
    school: 'SMP Negeri Penggerak',
    role: 'Admin Sekolah',
    status: 'Aktif',
    createdAt: '2026-11-01T08:00:00.000Z',
    source: 'pengaturan',
  },
  {
    id: 'teacher-default-2',
    name: 'Siti Rahayu, S.Pd.',
    email: 'pengawas@guru.smp.belajar.id',
    password: 'pengawas123',
    subject: 'Pengawas Ruang Ujian',
    school: 'SMP Negeri Penggerak',
    role: 'Pengawas',
    status: 'Aktif',
    createdAt: '2026-11-01T08:05:00.000Z',
    source: 'pengaturan',
  },
];

const ALLOWED_TABS_BY_ROLE: Record<TeacherAccount['role'], string[]> = {
  'Admin Sekolah': [
    'dashboard',
    'generator',
    'bank',
    'google_forms',
    'token',
    'distribusi',
    'monitoring',
    'nilai_siswa',
    'rekap',
    'pelanggaran',
    'teacher_users',
    'student_users',
    'settings_gas',
    'clear_data',
    'download',
    'paket',
  ],
  Pengawas: [
    'dashboard',
    'monitoring',
    'token',
    'distribusi',
    'pelanggaran',
    'nilai_siswa',
    'rekap',
    'download',
  ],
  'Guru Mapel': [
    'dashboard',
    'generator',
    'bank',
    'google_forms',
    'token',
    'distribusi',
    'monitoring',
    'nilai_siswa',
    'rekap',
    'pelanggaran',
    'download',
  ],
};

function sanitizePackages(raw: unknown): QuestionPackage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && item.id))
    .map((p) => ({
      ...p,
      id: String(p.id),
      title: String(p.title || 'Paket Soal Tanpa Judul'),
      subject: String(p.subject || 'Umum'),
      grade: String(p.grade || 'SMP'),
      topic: String(p.topic || ''),
      createdAt: String(p.createdAt || ''),
      questions: Array.isArray(p.questions)
        ? p.questions
            .filter((q: unknown): q is Record<string, any> => Boolean(q && typeof q === 'object'))
            .map((q: any, idx: number) => {
              const qType = q.type === 'isian' || q.type === 'uraian' ? q.type : 'pilihan_ganda';
              const rawAns =
                q.correctAnswer !== undefined && q.correctAnswer !== null
                  ? String(q.correctAnswer)
                  : '';
              return {
                ...q,
                id: String(q.id || `q-${idx + 1}`),
                number: Number(q.number) || idx + 1,
                type: qType,
                stimulus: q.stimulus ? String(q.stimulus) : '',
                question: String(q.question || ''),
                options: Array.isArray(q.options)
                  ? q.options
                      .filter((o: unknown): o is Record<string, any> => Boolean(o && typeof o === 'object'))
                      .map((o: any, oIdx: number) => ({
                        key: String(o.key || String.fromCharCode(65 + oIdx)),
                        text: String(o.text || ''),
                      }))
                  : [],
                correctAnswer:
                  rawAns.trim() !== '' ? rawAns : qType === 'pilihan_ganda' ? 'A' : '',
                explanation: String(q.explanation || ''),
                cognitiveLevel: String(q.cognitiveLevel || 'C2'),
                points: Number(q.points) > 0 ? Number(q.points) : 10,
              };
            })
        : [],
    }));
}

function sanitizeManualForms(raw: unknown): ManualGoogleFormEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && item.url))
    .map((m, idx) => ({
      id: String(m.id || `gform-${idx}`),
      label: String(m.label || 'Google Form Kuis'),
      url: String(m.url || ''),
      createdAt: String(m.createdAt || ''),
      timeAgo: String(m.timeAgo || 'Baru saja'),
    }));
}

function sanitizeScores(raw: unknown): StudentScoreRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
    .map((s, idx) => {
      const score = Number.isFinite(Number(s.score)) ? Number(s.score) : 0;
      const maxScore = Number.isFinite(Number(s.maxScore)) && Number(s.maxScore) > 0 ? Number(s.maxScore) : 100;
      const pct = Number.isFinite(Number(s.percentage))
        ? Number(s.percentage)
        : Math.round((score / maxScore) * 100);
      return {
        id: String(s.id || `score-${idx}`),
        studentName: String(s.studentName || `Siswa ${idx + 1}`),
        nisn: String(s.nisn || '-'),
        kelas: String(s.kelas || '-'),
        token: String(s.token || '-'),
        score,
        maxScore,
        percentage: pct,
        statusKetuntasan: s.statusKetuntasan === 'Tuntas' ? 'Tuntas' : 'Belum Tuntas',
        submittedAt: String(s.submittedAt || '-'),
        violations: Number.isFinite(Number(s.violations)) ? Number(s.violations) : 0,
        ...(s.absen !== undefined ? { absen: String(s.absen) } : {}),
        ...(s.email !== undefined ? { email: String(s.email) } : {}),
        ...(s.formId !== undefined ? { formId: String(s.formId) } : {}),
        ...(s.formTitle !== undefined ? { formTitle: String(s.formTitle) } : {}),
        ...(Number.isFinite(Number(s.submittedTimestamp)) ? { submittedTimestamp: Number(s.submittedTimestamp) } : {}),
        ...(s.answers && typeof s.answers === 'object' ? { answers: s.answers } : {}),
      };
    });
}

function sanitizeViolations(raw: unknown): StudentViolationLog[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
    .map((v, idx) => ({
      id: String(v.id || `viol-${idx}`),
      studentId: String(v.studentId || v.nisn || `std-${idx}`),
      studentName: String(v.studentName || 'Siswa'),
      nisn: String(v.nisn || '-'),
      kelas: String(v.kelas || '-'),
      token: String(v.token || '-'),
      timestamp: Number.isFinite(Number(v.timestamp)) ? Number(v.timestamp) : Date.now(),
      type: (v.type || 'Pindah Tab') as StudentViolationLog['type'],
      penaltySeconds: Number.isFinite(Number(v.penaltySeconds)) ? Number(v.penaltySeconds) : 10,
    }));
}

function sanitizeTeachers(raw: unknown): TeacherAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && item.email && item.name))
    .map((t, idx) => ({
      id: String(t.id || `teacher-${idx}`),
      name: String(t.name),
      email: String(t.email).toLowerCase(),
      password: String(t.password || 'guru123'),
      subject: t.subject ? String(t.subject) : '',
      school: t.school ? String(t.school) : '',
      role: t.role === 'Admin Sekolah' || t.role === 'Pengawas' ? t.role : 'Guru Mapel',
      status: t.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
      createdAt: String(t.createdAt || new Date().toISOString()),
      source: t.source === 'portal_daftar' ? 'portal_daftar' : 'pengaturan',
    }));
}

function sanitizeStudents(raw: unknown): StudentParticipantAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && item.name && item.nisn))
    .map((s, idx) => ({
      id: String(s.id || `std-${idx}`),
      name: String(s.name).trim(),
      nisn: String(s.nisn).trim(),
      kelas: String(s.kelas || '-').trim(),
      ruang: s.ruang ? String(s.ruang).trim() : '',
      pin: s.pin ? String(s.pin).trim() : '',
      status: s.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
      createdAt: String(s.createdAt || new Date().toISOString()),
      source: s.source === 'excel' ? 'excel' : 'manual',
    }));
}

function sanitizeManagedTokens(raw: unknown): ManagedTokenEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object' && String(item.token || '').trim() !== ''))
    .map((item) => ({
      token: String(item.token).trim().toUpperCase(),
      label: String(item.label || 'ASAS'),
      quizTitle: String(item.quizTitle || 'Ujian CBT'),
      subject: String(item.subject || 'Umum'),
      grade: String(item.grade || 'SMP'),
      totalQuestions: Math.max(0, Number.isFinite(Number(item.totalQuestions)) ? Number(item.totalQuestions) : 10),
      durationMinutes: Number.isFinite(Number(item.durationMinutes)) && Number(item.durationMinutes) >= 0 ? Number(item.durationMinutes) : 90,
      googleFormUrl: String(item.googleFormUrl || ''),
      googleFormEditUrl: item.googleFormEditUrl ? String(item.googleFormEditUrl) : '',
      driveFolderUrl: String(item.driveFolderUrl || 'https://drive.google.com'),
      maxViolations: Math.max(1, Number(item.maxViolations) || 3),
      expiryDateTime: String(item.expiryDateTime || ''),
      waitingRoomEnabled: Boolean(item.waitingRoomEnabled),
      isExamStarted: item.isExamStarted !== false,
      isActive: item.isActive !== false,
      createdAt: Number(item.createdAt) || Date.now(),
    }));
}

export default function App() {
  // Ensure pre-seeded database keys from earlier versions are cleared once cleanly
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem(DB_PURGED_FLAG_KEY) !== '1') {
        localStorage.removeItem(PACKAGES_STORAGE_KEY);
        localStorage.removeItem(SCORES_STORAGE_KEY);
        localStorage.removeItem(VIOLATIONS_STORAGE_KEY);
        localStorage.removeItem(TOKENS_STORAGE_KEY);
        localStorage.removeItem(MANUAL_FORMS_STORAGE_KEY);
        localStorage.removeItem('soalpintar_exam_device_locks');
        localStorage.removeItem('soalpintar_uts_schedule_v1');
        localStorage.setItem(DB_PURGED_FLAG_KEY, '1');
      }
    } catch {
      // Ignore storage error
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const [managedTokens, setManagedTokens] = useState<ManagedTokenEntry[]>(() => {
    try {
      const saved = localStorage.getItem(TOKENS_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizeManagedTokens(parsed);
      }
    } catch {
      // Ignore storage error
    }
    return DEFAULT_MANAGED_TOKENS;
  });

  const initialTokenParam = (() => {
    const fromUrl = urlParams.get('token');
    if (fromUrl) return fromUrl.trim().toUpperCase();
    return managedTokens[0]?.token || '';
  })();
  const [isUrlStudentDirect, setIsUrlStudentDirect] = useState<boolean>(
    () => urlParams.get('mode') === 'student'
  );

  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    try {
      const saved = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.role === 'teacher' && parsed.email && parsed.name) {
          const restoredTeacherRole: TeacherAccount['role'] =
            parsed.teacherRole === 'Pengawas' ||
            parsed.teacherRole === 'Guru Mapel' ||
            parsed.teacherRole === 'Admin Sekolah'
              ? parsed.teacherRole
              : 'Admin Sekolah';
          return {
            ...parsed,
            role: 'teacher',
            teacherRole: restoredTeacherRole,
            name: String(parsed.name),
            email: String(parsed.email),
            loggedInAt: Number(parsed.loggedInAt) || Date.now(),
          } as AuthSession;
        }
        if (parsed && parsed.role === 'student' && parsed.token && parsed.name) {
          return {
            ...parsed,
            role: 'student',
            name: String(parsed.name),
            token: String(parsed.token).toUpperCase(),
            nisn: parsed.nisn ? String(parsed.nisn) : '',
            kelas: parsed.kelas ? String(parsed.kelas) : 'VII-A',
            loggedInAt: Number(parsed.loggedInAt) || Date.now(),
          } as AuthSession;
        }
      }
    } catch {
      // Ignore storage error
    }
    return null;
  });

  const [mode, setMode] = useState<'teacher' | 'student'>(() => {
    if (urlParams.get('mode') === 'student') return 'student';
    if (authSession?.role === 'student') return 'student';
    return 'teacher';
  });
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isDark, setIsDark] = useState<boolean>(true); // screenshot is dark navy theme
  const [showProjectorModal, setShowProjectorModal] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  // Google Apps Script Web App & Code.gs Setting State (Persisted in localStorage + Server)
  const [webAppUrl, setWebAppUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_webapp_url') || '';
    } catch {
      return '';
    }
  });
  const [guruName, setGuruName] = useState<string>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_guru_name') || 'Apendi Mukdor, S.Pd.';
    } catch {
      return 'Apendi Mukdor, S.Pd.';
    }
  });
  const [apiSecret, setApiSecret] = useState<string>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_api_secret') || '';
    } catch {
      return '';
    }
  });
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_shuffle_q') !== 'false';
    } catch {
      return true;
    }
  });
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_shuffle_o') === 'true';
    } catch {
      return false;
    }
  });
  const [customCodeGs, setCustomCodeGs] = useState<string>(() => {
    try {
      return localStorage.getItem('soalpintar_gas_custom_code_gs') || '';
    } catch {
      return '';
    }
  });

  const persistGasSettingsToServer = (payload: {
    webAppUrl?: string;
    guruName?: string;
    apiSecret?: string;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    customCodeGs?: string;
  }) => {
    fetch('/api/gas/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Ignore offline error; localStorage already holds the saved values
    });
  };

  const handleSaveWebAppUrl = (url: string) => {
    const clean = String(url ?? '').trim();
    setWebAppUrl(clean);
    try {
      localStorage.setItem('soalpintar_gas_webapp_url', clean);
    } catch {
      // Ignore storage error
    }
    persistGasSettingsToServer({ webAppUrl: clean });
  };

  const handleSaveGuruName = (name: string) => {
    const clean = String(name ?? '').trim() || 'Guru';
    setGuruName(clean);
    try {
      localStorage.setItem('soalpintar_gas_guru_name', clean);
    } catch {
      // Ignore storage error
    }
    persistGasSettingsToServer({ guruName: clean });
  };

  const handleSaveShuffleQ = (val: boolean) => {
    setShuffleQuestions(val);
    try {
      localStorage.setItem('soalpintar_gas_shuffle_q', String(val));
    } catch {
      // Ignore storage error
    }
    persistGasSettingsToServer({ shuffleQuestions: val });
  };

  const handleSaveShuffleO = (val: boolean) => {
    setShuffleOptions(val);
    try {
      localStorage.setItem('soalpintar_gas_shuffle_o', String(val));
    } catch {
      // Ignore storage error
    }
    persistGasSettingsToServer({ shuffleOptions: val });
  };

  const handleSaveAllGasSettings = (next: {
    webAppUrl: string;
    guruName: string;
    apiSecret: string;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    customCodeGs: string;
  }) => {
    const cleanUrl = String(next.webAppUrl ?? '').trim();
    const cleanGuru = String(next.guruName ?? '').trim() || 'Guru';
    const cleanSecret = String(next.apiSecret ?? '').trim();
    const cleanCode = String(next.customCodeGs ?? '');

    setWebAppUrl(cleanUrl);
    setGuruName(cleanGuru);
    setApiSecret(cleanSecret);
    setShuffleQuestions(next.shuffleQuestions);
    setShuffleOptions(next.shuffleOptions);
    setCustomCodeGs(cleanCode);

    try {
      localStorage.setItem('soalpintar_gas_webapp_url', cleanUrl);
      localStorage.setItem('soalpintar_gas_guru_name', cleanGuru);
      if (cleanSecret) {
        localStorage.setItem('soalpintar_gas_api_secret', cleanSecret);
      } else {
        localStorage.removeItem('soalpintar_gas_api_secret');
      }
      localStorage.setItem('soalpintar_gas_shuffle_q', String(next.shuffleQuestions));
      localStorage.setItem('soalpintar_gas_shuffle_o', String(next.shuffleOptions));
      if (cleanCode) {
        localStorage.setItem('soalpintar_gas_custom_code_gs', cleanCode);
      } else {
        localStorage.removeItem('soalpintar_gas_custom_code_gs');
      }
    } catch {
      // Ignore storage error
    }

    persistGasSettingsToServer({
      webAppUrl: cleanUrl,
      guruName: cleanGuru,
      apiSecret: cleanSecret,
      shuffleQuestions: next.shuffleQuestions,
      shuffleOptions: next.shuffleOptions,
      customCodeGs: cleanCode,
    });
  };

  // Core Data State (persisted so Clear Data survives refresh)
  const [packages, setPackages] = useState<QuestionPackage[]>(() => {
    try {
      const saved = localStorage.getItem(PACKAGES_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizePackages(parsed);
      }
    } catch {
      // Ignore storage error
    }
    return INITIAL_PACKAGES;
  });
  const [manualForms, setManualForms] = useState<ManualGoogleFormEntry[]>(() => {
    try {
      const saved = localStorage.getItem(MANUAL_FORMS_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizeManualForms(parsed);
      }
    } catch {
      // Ignore storage error
    }
    return [];
  });
  const [scores, setScores] = useState<StudentScoreRecord[]>(() => {
    try {
      const saved = localStorage.getItem(SCORES_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizeScores(parsed);
      }
    } catch {
      // Ignore storage error
    }
    return INITIAL_SCORES;
  });
  const [violations, setViolations] = useState<StudentViolationLog[]>(() => {
    try {
      const saved = localStorage.getItem(VIOLATIONS_STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizeViolations(parsed);
      }
    } catch {
      // Ignore storage error
    }
    return INITIAL_VIOLATIONS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(PACKAGES_STORAGE_KEY, JSON.stringify(packages));
    } catch {
      // Ignore storage error
    }
  }, [packages]);

  useEffect(() => {
    try {
      localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(scores));
    } catch {
      // Ignore storage error
    }
  }, [scores]);

  useEffect(() => {
    try {
      localStorage.setItem(VIOLATIONS_STORAGE_KEY, JSON.stringify(violations));
    } catch {
      // Ignore storage error
    }
  }, [violations]);

  const [registeredTeachers, setRegisteredTeachers] = useState<TeacherAccount[]>(() => {
    try {
      const saved = localStorage.getItem(REGISTERED_TEACHERS_STORAGE_KEY);
      if (saved) {
        const cleaned = sanitizeTeachers(JSON.parse(saved));
        if (cleaned.length > 0) return cleaned;
      }
    } catch {
      // Ignore storage error
    }
    return DEFAULT_TEACHER_ACCOUNTS;
  });

  const [registeredStudents, setRegisteredStudents] = useState<StudentParticipantAccount[]>(() => {
    try {
      const saved = localStorage.getItem(REGISTERED_STUDENTS_STORAGE_KEY);
      if (saved) {
        return sanitizeStudents(JSON.parse(saved));
      }
    } catch {
      // Ignore storage error
    }
    return [];
  });

  const [strictParticipantMode, setStrictParticipantMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STRICT_STUDENTS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(REGISTERED_TEACHERS_STORAGE_KEY, JSON.stringify(registeredTeachers));
    } catch {
      // Ignore storage error
    }
  }, [registeredTeachers]);

  useEffect(() => {
    try {
      localStorage.setItem(REGISTERED_STUDENTS_STORAGE_KEY, JSON.stringify(registeredStudents));
    } catch {
      // Ignore storage error
    }
  }, [registeredStudents]);

  useEffect(() => {
    try {
      localStorage.setItem(STRICT_STUDENTS_STORAGE_KEY, String(strictParticipantMode));
    } catch {
      // Ignore storage error
    }
  }, [strictParticipantMode]);

  useEffect(() => {
    try {
      localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(managedTokens));
    } catch {
      // Ignore storage error
    }
  }, [managedTokens]);

  // Sync local registered teachers and persisted tokens with backend store on startup
  useEffect(() => {
    fetch('/api/teachers/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teachers: registeredTeachers }),
    })
      .then((res) => (res.ok ? parseResponseJsonSafe(res) : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.teachers) && data.teachers.length > 0) {
          setRegisteredTeachers((prev) => {
            const byEmail = new Map<string, TeacherAccount>();
            for (const t of prev) byEmail.set(t.email.toLowerCase(), t);
            for (const t of sanitizeTeachers(data.teachers)) {
              if (!byEmail.has(t.email.toLowerCase())) {
                byEmail.set(t.email.toLowerCase(), t);
              }
            }
            return Array.from(byEmail.values());
          });
        }
      })
      .catch(() => {
        // Ignore offline error
      });

    // Startup student participants sync
    fetch('/api/students/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        students: registeredStudents,
        strictParticipantMode,
      }),
    })
      .then((res) => (res.ok ? parseResponseJsonSafe(res) : null))
      .then((data) => {
        if (!data?.success) return;
        if (Array.isArray(data.students)) {
          const cleaned = sanitizeStudents(data.students);
          if (cleaned.length > 0) {
            setRegisteredStudents(cleaned);
          }
        }
        if (typeof data.strictParticipantMode === 'boolean') {
          setStrictParticipantMode(data.strictParticipantMode);
        }
      })
      .catch(() => {
        // Ignore offline error
      });

    // Startup teacher & GAS settings sync (do NOT wipe server rooms on unauthenticated/student mounts)

    // Hydrate or migrate GAS Web App & Code.gs settings with persistent server store
    fetch('/api/gas/settings/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webAppUrl,
        guruName,
        apiSecret,
        shuffleQuestions,
        shuffleOptions,
        customCodeGs,
      }),
    })
      .then((res) => (res.ok ? parseResponseJsonSafe(res) : null))
      .then((data) => {
        const s = data?.settings;
        if (!data?.success || !s) return;
        const hasServerData = Boolean(s.updatedAt || s.webAppUrl || s.customCodeGs || s.apiSecret);
        if (!hasServerData) return;

        const syncedUrl = String(s.webAppUrl ?? '');
        const syncedGuru = String(s.guruName ?? '') || 'Apendi Mukdor, S.Pd.';
        const syncedSecret = String(s.apiSecret ?? '');
        const syncedCode = String(s.customCodeGs ?? '');

        setWebAppUrl(syncedUrl);
        setGuruName(syncedGuru);
        setApiSecret(syncedSecret);
        setShuffleQuestions(Boolean(s.shuffleQuestions));
        setShuffleOptions(Boolean(s.shuffleOptions));
        setCustomCodeGs(syncedCode);

        try {
          localStorage.setItem('soalpintar_gas_webapp_url', syncedUrl);
          localStorage.setItem('soalpintar_gas_guru_name', syncedGuru);
          if (syncedSecret) {
            localStorage.setItem('soalpintar_gas_api_secret', syncedSecret);
          } else {
            localStorage.removeItem('soalpintar_gas_api_secret');
          }
          localStorage.setItem('soalpintar_gas_shuffle_q', String(Boolean(s.shuffleQuestions)));
          localStorage.setItem('soalpintar_gas_shuffle_o', String(Boolean(s.shuffleOptions)));
          if (s.customCodeGs) {
            localStorage.setItem('soalpintar_gas_custom_code_gs', s.customCodeGs);
          } else {
            localStorage.removeItem('soalpintar_gas_custom_code_gs');
          }
        } catch {
          // Ignore storage error
        }
      })
      .catch(() => {
        // Ignore offline error
      });
  }, []);

  // Keep server live rooms synchronized for authenticated teacher sessions without wiping rooms from empty/student clients
  useEffect(() => {
    if (authSession?.role !== 'teacher' || mode !== 'teacher') return;
    if (!Array.isArray(managedTokens) || managedTokens.length === 0) return;

    fetch('/api/rooms/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: managedTokens }),
    }).catch(() => {
      // Ignore offline error
    });
  }, [authSession?.role, mode, managedTokens]);

  const handleCreateTeacher = async (
    payload: Omit<TeacherAccount, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; message?: string; teacher?: TeacherAccount }> => {
    const cleanEmail = payload.email.trim().toLowerCase();
    const cleanName = payload.name.trim();

    if (registeredTeachers.some((t) => t.email.toLowerCase() === cleanEmail)) {
      return {
        success: false,
        message: `Email "${cleanEmail}" sudah terdaftar di sistem.`,
      };
    }

    let createdTeacher: TeacherAccount = {
      ...payload,
      id: 'teacher-' + Date.now(),
      name: cleanName,
      email: cleanEmail,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseResponseJsonSafe(res);
      if (!res.ok && res.status !== 404 && data) {
        return { success: false, message: data?.message || 'Gagal mendaftarkan guru.' };
      }
      if (data?.success && data.teacher) {
        createdTeacher = data.teacher;
      }
    } catch {
      // Fallback to localStorage-only persistence if offline
    }

    setRegisteredTeachers((prev) => [createdTeacher, ...prev]);
    return { success: true, teacher: createdTeacher };
  };

  const handleUpdateTeacher = async (
    id: string,
    updates: Partial<Omit<TeacherAccount, 'id' | 'createdAt'>>
  ): Promise<{ success: boolean; message?: string }> => {
    if (updates.email) {
      const cleanEmail = updates.email.trim().toLowerCase();
      if (registeredTeachers.some((t) => t.id !== id && t.email.toLowerCase() === cleanEmail)) {
        return { success: false, message: `Email "${cleanEmail}" sudah digunakan akun lain.` };
      }
    }

    try {
      const res = await fetch(`/api/teachers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok && res.status !== 404) {
        const data = await parseResponseJsonSafe(res);
        if (data?.message) {
          return { success: false, message: data.message };
        }
      }
    } catch {
      // Ignore offline error
    }

    setRegisteredTeachers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    return { success: true };
  };

  const handleDeleteTeacher = async (
    id: string
  ): Promise<{ success: boolean; message?: string }> => {
    if (id === 'teacher-default-1') {
      return { success: false, message: 'Akun utama default tidak dapat dihapus.' };
    }

    try {
      await fetch(`/api/teachers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // Ignore offline error
    }

    setRegisteredTeachers((prev) => prev.filter((t) => t.id !== id));
    return { success: true };
  };

  const handleToggleStrictStudents = async (nextValue: boolean) => {
    setStrictParticipantMode(nextValue);
    try {
      await fetch('/api/students/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strictParticipantMode: nextValue }),
      });
    } catch {
      // Fallback to localStorage persistence
    }
  };

  const handleCreateStudent = async (
    payload: Omit<StudentParticipantAccount, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; message?: string }> => {
    const cleanName = payload.name.trim();
    const cleanNisn = payload.nisn.trim();
    const cleanKelas = payload.kelas.trim() || '-';

    if (!cleanName || !cleanNisn) {
      return { success: false, message: 'Nama Lengkap dan NISN / No. Peserta wajib diisi.' };
    }

    const dup = registeredStudents.find(
      (s) => s.nisn.trim().toLowerCase() === cleanNisn.toLowerCase()
    );
    if (dup) {
      return {
        success: false,
        message: `NISN "${cleanNisn}" sudah terdaftar atas nama ${dup.name}.`,
      };
    }

    let createdStudent: StudentParticipantAccount = {
      ...payload,
      id: 'std-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: cleanName,
      nisn: cleanNisn,
      kelas: cleanKelas,
      ruang: payload.ruang?.trim() || '',
      pin: payload.pin?.trim() || '',
      status: payload.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
      createdAt: new Date().toISOString(),
      source: payload.source === 'excel' ? 'excel' : 'manual',
    };

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseResponseJsonSafe(res);
      if (!res.ok && res.status !== 404 && data) {
        return { success: false, message: data?.message || 'Gagal menambahkan peserta ujian.' };
      }
      if (data?.success && Array.isArray(data.students)) {
        setRegisteredStudents(sanitizeStudents(data.students));
        return { success: true };
      }
      if (data?.success && data.student) {
        createdStudent = data.student;
      }
    } catch {
      // Fallback to local state if offline
    }

    setRegisteredStudents((prev) => [createdStudent, ...prev]);
    return { success: true };
  };

  const handleBulkImportStudents = async (
    items: Array<Omit<StudentParticipantAccount, 'id' | 'createdAt'>>
  ): Promise<{ success: boolean; addedCount?: number; updatedCount?: number; message?: string }> => {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: 'Tidak ada data peserta yang valid untuk diimpor.' };
    }

    try {
      const res = await fetch('/api/students/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: items }),
      });
      const data = await parseResponseJsonSafe(res);
      if (res.ok && data?.success) {
        if (Array.isArray(data.students)) {
          setRegisteredStudents(sanitizeStudents(data.students));
        }
        return {
          success: true,
          addedCount: Number(data.addedCount) || 0,
          updatedCount: Number(data.updatedCount) || 0,
        };
      }
      if (!res.ok && res.status !== 404 && data?.message) {
        return { success: false, message: data.message };
      }
    } catch {
      // Fallback to local upsert
    }

    let addedCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    setRegisteredStudents((prev) => {
      const next = [...prev];
      for (const item of items) {
        const cleanName = String(item.name || '').trim();
        const cleanNisn = String(item.nisn || '').trim();
        const cleanKelas = String(item.kelas || '').trim() || '-';
        if (!cleanName || !cleanNisn) continue;
        const idx = next.findIndex(
          (s) => s.nisn.trim().toLowerCase() === cleanNisn.toLowerCase()
        );
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            name: cleanName,
            kelas: cleanKelas,
            ruang: item.ruang !== undefined ? String(item.ruang || '').trim() : next[idx].ruang,
            pin: item.pin && String(item.pin).trim() ? String(item.pin).trim() : next[idx].pin,
            status: item.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
            source: 'excel',
          };
          updatedCount += 1;
        } else {
          next.unshift({
            id: 'std-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            name: cleanName,
            nisn: cleanNisn,
            kelas: cleanKelas,
            ruang: String(item.ruang || '').trim(),
            pin: String(item.pin || '').trim(),
            status: item.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
            createdAt: nowIso,
            source: 'excel',
          });
          addedCount += 1;
        }
      }
      return next;
    });

    return { success: true, addedCount, updatedCount };
  };

  const handleUpdateStudent = async (
    id: string,
    updates: Partial<Omit<StudentParticipantAccount, 'id' | 'createdAt'>>
  ): Promise<{ success: boolean; message?: string }> => {
    if (updates.nisn) {
      const cleanNisn = updates.nisn.trim().toLowerCase();
      const dup = registeredStudents.find(
        (s) => s.id !== id && s.nisn.trim().toLowerCase() === cleanNisn
      );
      if (dup) {
        return { success: false, message: `NISN "${updates.nisn}" sudah dipakai oleh ${dup.name}.` };
      }
    }

    try {
      const res = await fetch(`/api/students/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await parseResponseJsonSafe(res);
      if (!res.ok && res.status !== 404 && data?.message) {
        return { success: false, message: data.message };
      }
      if (res.ok && data?.success && Array.isArray(data.students)) {
        setRegisteredStudents(sanitizeStudents(data.students));
        return { success: true };
      }
    } catch {
      // Fallback to local state
    }

    setRegisteredStudents((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
    return { success: true };
  };

  const handleDeleteStudent = async (
    id: string
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await parseResponseJsonSafe(res);
      if (res.ok && data?.success && Array.isArray(data.students)) {
        setRegisteredStudents(sanitizeStudents(data.students));
        return { success: true };
      }
    } catch {
      // Fallback to local state
    }

    setRegisteredStudents((prev) => prev.filter((s) => s.id !== id));
    return { success: true };
  };

  const handleClearStudents = async (
    kelas?: string
  ): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch('/api/students/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kelas: kelas || 'all' }),
      });
      const data = await parseResponseJsonSafe(res);
      if (res.ok && data?.success && Array.isArray(data.students)) {
        setRegisteredStudents(sanitizeStudents(data.students));
        return { success: true };
      }
    } catch {
      // Fallback to local state
    }

    if (kelas && kelas !== 'all') {
      const target = kelas.trim().toLowerCase();
      setRegisteredStudents((prev) =>
        prev.filter((s) => s.kelas.trim().toLowerCase() !== target)
      );
    } else {
      setRegisteredStudents([]);
    }
    return { success: true };
  };

  useEffect(() => {
    try {
      localStorage.setItem(MANUAL_FORMS_STORAGE_KEY, JSON.stringify(manualForms));
    } catch {
      // Ignore storage error
    }
  }, [manualForms]);

  const handleAddManualForm = (entry: ManualGoogleFormEntry) => {
    setManualForms((prev) => [entry, ...prev]);
  };

  const handleDeleteManualForm = (id: string) => {
    setManualForms((prev) => prev.filter((m) => m.id !== id));
  };

  // Active Exam Token & Room Configuration (synced from managedTokens)
  const [examConfig, setExamConfig] = useState<ExamTokenConfig>(() => {
    const cleanToken = initialTokenParam.toUpperCase();
    if (managedTokens.length === 0 && !urlParams.get('token')) {
      return {
        token: '',
        title: '',
        subject: '',
        grade: '',
        totalQuestions: 0,
        durationMinutes: 90,
        remainingSeconds: 90 * 60,
        maxViolations: 3,
        waitingRoomEnabled: false,
        isExamStarted: false,
        isActive: false,
        googleFormUrl: '',
        googleFormEditUrl: '',
        driveFolderUrl: 'https://drive.google.com',
        expiryMode: 'jp',
        jpCount: 2,
      };
    }

    const matched =
      managedTokens.find((t) => t.token.toUpperCase() === cleanToken) || managedTokens[0];
    if (matched) {
      const dur = matched.durationMinutes ?? 90;
      return {
        token: matched.token || cleanToken,
        title: matched.quizTitle || 'Ujian CBT',
        subject: matched.subject || 'Umum',
        grade: matched.grade || 'SMP',
        totalQuestions: matched.totalQuestions,
        durationMinutes: dur,
        remainingSeconds: dur * 60,
        maxViolations: matched.maxViolations || 3,
        waitingRoomEnabled: Boolean(matched.waitingRoomEnabled),
        isExamStarted: matched.isExamStarted !== false,
        isActive: matched.isActive !== false,
        googleFormUrl: matched.googleFormUrl || '',
        googleFormEditUrl: matched.googleFormEditUrl || '',
        driveFolderUrl: matched.driveFolderUrl || 'https://drive.google.com',
        expiryMode: matched.expiryDateTime ? 'datetime' : 'jp',
        expiryDateTime: matched.expiryDateTime || undefined,
        jpCount: 2,
      };
    }

    const firstPkg = packages[0];
    return {
      token: cleanToken,
      title: firstPkg?.title || 'Ujian CBT',
      subject: firstPkg?.subject || 'Umum',
      grade: firstPkg?.grade || 'SMP',
      totalQuestions: firstPkg?.questions?.length || 0,
      durationMinutes: 90,
      remainingSeconds: 90 * 60,
      maxViolations: 3,
      waitingRoomEnabled: false,
      isExamStarted: true,
      isActive: true,
      googleFormUrl: firstPkg?.googleFormUrl || '',
      googleFormEditUrl: firstPkg?.googleFormEditUrl || '',
      driveFolderUrl: firstPkg?.driveFolderUrl || 'https://drive.google.com',
      expiryMode: 'jp',
      jpCount: 2,
    };
  });

  // Sync dark mode class
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Background timer countdown for active exam
  useEffect(() => {
    const timer = setInterval(() => {
      setExamConfig((prev) => {
        if (prev.isExamStarted && prev.isActive !== false && prev.remainingSeconds > 0) {
          return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSyncTokenEntry = (tokenCode: string, updates: Partial<ManagedTokenEntry>) => {
    const clean = String(tokenCode || '').trim().toUpperCase();
    if (!clean) return;
    setManagedTokens((prev) =>
      prev.map((t) => (t.token.toUpperCase() === clean ? { ...t, ...updates } : t))
    );
  };

  const handleAddPackage = (pkg: QuestionPackage) => {
    setPackages([pkg, ...packages]);
  };

  const handleUpdatePackage = (updatedPkg: QuestionPackage) => {
    setPackages((prev) => prev.map((p) => (p.id === updatedPkg.id ? updatedPkg : p)));
  };

  const handleDeletePackage = (id: string) => {
    setPackages((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDistributePackage = (pkg: QuestionPackage) => {
    const nextConfig: ExamTokenConfig = {
      ...examConfig,
      title: pkg.title,
      subject: pkg.subject,
      grade: pkg.grade,
      totalQuestions: pkg.questions.length,
      googleFormUrl: pkg.googleFormUrl || '',
      googleFormEditUrl: pkg.googleFormEditUrl || '',
      driveFolderUrl: pkg.driveFolderUrl || 'https://drive.google.com',
    };
    setExamConfig(nextConfig);
    setActiveTab('token');
  };

  const handleLoginSuccess = (session: AuthSession) => {
    setAuthSession(session);
    try {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignore storage error
    }

    if (session.role === 'teacher') {
      const savedGuruName = (() => {
        try {
          return localStorage.getItem('soalpintar_gas_guru_name');
        } catch {
          return null;
        }
      })();
      if (session.name && !savedGuruName) {
        handleSaveGuruName(session.name);
      }
      setIsUrlStudentDirect(false);
      setMode('teacher');
      setActiveTab('dashboard');
    } else {
      const cleanTok = session.token.trim().toUpperCase();
      const matched = managedTokens.find((t) => t.token.toUpperCase() === cleanTok);
      if (matched) {
        const dur = matched.durationMinutes ?? examConfig.durationMinutes ?? 90;
        setExamConfig({
          ...examConfig,
          token: cleanTok,
          title: matched.quizTitle || 'Ujian CBT',
          subject: matched.subject || 'Umum',
          grade: matched.grade || 'SMP',
          totalQuestions: matched.totalQuestions ?? 0,
          durationMinutes: dur,
          remainingSeconds: dur * 60,
          maxViolations: matched.maxViolations || 3,
          waitingRoomEnabled: Boolean(matched.waitingRoomEnabled),
          isExamStarted: matched.isExamStarted !== false,
          isActive: matched.isActive !== false,
          googleFormUrl: matched.googleFormUrl || '',
          googleFormEditUrl: matched.googleFormEditUrl || '',
          driveFolderUrl: matched.driveFolderUrl || 'https://drive.google.com',
          expiryMode: matched.expiryDateTime ? 'datetime' : 'jp',
          expiryDateTime: matched.expiryDateTime || undefined,
        });
      } else {
        setExamConfig((prev) => ({
          ...prev,
          token: cleanTok,
        }));
      }
      setMode('student');
    }
  };

  const handleLogout = () => {
    setAuthSession(null);
    setIsUrlStudentDirect(false);
    setShowProjectorModal(false);
    setIsMobileMenuOpen(false);
    try {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage error
    }
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setMode('teacher');
    setActiveTab('dashboard');
  };

  // Show Login portal if user has no active session and didn't enter via QR student link
  if (!authSession && !isUrlStudentDirect) {
    const firstActiveToken =
      managedTokens.find(
        (t) =>
          t.isActive !== false &&
          (!t.expiryDateTime || new Date(t.expiryDateTime).getTime() > Date.now())
      )?.token || '';
    return (
      <LoginView
        defaultRole={urlParams.get('token') ? 'student' : 'pengawas'}
        defaultToken={examConfig.token || firstActiveToken}
        defaultGuruName={guruName}
        activeExamToken={examConfig.token || firstActiveToken}
        availableTokens={managedTokens}
        registeredTeachers={registeredTeachers}
        registeredStudents={registeredStudents}
        strictParticipantMode={strictParticipantMode}
        onRegisterTeacher={handleCreateTeacher}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  // If student mode or logged-in student session is active, render the Anti-Cheat Exam Player
  if (mode === 'student' || authSession?.role === 'student') {
    const isTeacherPreview = authSession?.role === 'teacher';
    return (
      <SecureExamPlayer
        initialToken={authSession?.role === 'student' ? authSession.token : examConfig.token}
        availableTokens={managedTokens}
        initialStudentName={authSession?.role === 'student' ? authSession.name : ''}
        initialStudentNisn={authSession?.role === 'student' ? authSession.nisn : ''}
        initialStudentKelas={authSession?.role === 'student' ? authSession.kelas : 'VII-A'}
        isTeacherPreview={isTeacherPreview}
        defaultPackages={packages}
        guruName={guruName}
        fallbackExamConfig={examConfig}
        onLogout={handleLogout}
        onRecordScore={(rec) => setScores((prev) => [rec, ...prev])}
        onRecordViolation={(log) => setViolations((prev) => [log, ...prev])}
        onExitToTeacherDashboard={() => {
          if (isTeacherPreview) {
            setMode('teacher');
          } else {
            handleLogout();
          }
        }}
      />
    );
  }

  const activeTeacherName =
    authSession?.role === 'teacher' ? authSession.name : guruName;
  const activeTeacherEmail =
    authSession?.role === 'teacher'
      ? authSession.email
      : 'apendimukdor86@guru.smp.belajar.id';
  const activeTeacherRole: TeacherAccount['role'] = (() => {
    if (authSession?.role !== 'teacher') return 'Admin Sekolah';
    if (
      authSession.teacherRole === 'Pengawas' ||
      authSession.teacherRole === 'Guru Mapel' ||
      authSession.teacherRole === 'Admin Sekolah'
    ) {
      return authSession.teacherRole;
    }
    const matched = registeredTeachers.find(
      (t) => t.email.toLowerCase() === authSession.email.toLowerCase()
    );
    return matched?.role || 'Admin Sekolah';
  })();

  const allowedTabs = ALLOWED_TABS_BY_ROLE[activeTeacherRole] || ALLOWED_TABS_BY_ROLE['Admin Sekolah'];
  const effectiveActiveTab = allowedTabs.includes(activeTab) ? activeTab : 'dashboard';

  const handleSelectTab = (tab: string) => {
    if (allowedTabs.includes(tab)) {
      setActiveTab(tab);
    } else {
      setActiveTab('dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex font-sans transition-colors duration-200">
      {/* 1. Left Sidebar Navigation Menu */}
      <Sidebar
        activeTab={effectiveActiveTab}
        onSelectTab={handleSelectTab}
        onOpenProjector={() => setShowProjectorModal(true)}
        onOpenStudentMode={() => setMode('student')}
        onLogout={handleLogout}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        tokenCode={examConfig.token}
        teacherName={activeTeacherName}
        teacherEmail={activeTeacherEmail}
        teacherRole={activeTeacherRole}
        teachersCount={registeredTeachers.length}
        studentsCount={registeredStudents.length}
      />

      {/* 2. Main Content Viewport (offset by 272px) */}
      <div className="flex-1 lg:pl-[272px] flex flex-col min-w-0 min-h-screen">
        {/* Top Header Bar */}
        <TopHeader
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          activeTab={effectiveActiveTab}
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
          onOpenProjector={() => setShowProjectorModal(true)}
          onOpenStudentMode={() => setMode('student')}
          onLogout={handleLogout}
          tokenCode={examConfig.token}
          teacherRole={activeTeacherRole}
        />

        {/* Viewport Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {effectiveActiveTab === 'dashboard' && (
            <DashboardView
              teacherName={activeTeacherName || guruName || 'Apendi Mukdor, S.Pd.'}
              teacherRole={activeTeacherRole}
              packages={packages}
              manualForms={manualForms}
              violations={violations}
              examConfig={examConfig}
              managedTokens={managedTokens}
              onNavigate={(tab) => handleSelectTab(tab)}
              onSelectPackageForDistribution={(pkg) => handleDistributePackage(pkg)}
              onOpenProjector={() => setShowProjectorModal(true)}
            />
          )}

          {effectiveActiveTab === 'generator' && (
            <AiGeneratorView
              onSaveToBank={handleAddPackage}
              onUpdatePackage={handleUpdatePackage}
              onOpenDistribusi={handleDistributePackage}
              webAppUrl={webAppUrl}
              guruName={guruName}
              shuffleQuestions={shuffleQuestions}
              shuffleOptions={shuffleOptions}
              onOpenGasSettings={() => setActiveTab('settings_gas')}
            />
          )}

          {effectiveActiveTab === 'bank' && (
            <BankSoalView
              packages={packages}
              onAddPackage={handleAddPackage}
              onUpdatePackage={handleUpdatePackage}
              onDeletePackage={handleDeletePackage}
              onDistributePackage={handleDistributePackage}
              onGoToAiGenerator={() => setActiveTab('generator')}
              webAppUrl={webAppUrl}
              guruName={guruName}
              shuffleQuestions={shuffleQuestions}
              shuffleOptions={shuffleOptions}
              onOpenGasSettings={() => setActiveTab('settings_gas')}
              onUpdateWebAppUrl={handleSaveWebAppUrl}
            />
          )}

          {effectiveActiveTab === 'google_forms' && (
            <GoogleFormsView
              packages={packages}
              examConfig={examConfig}
              managedTokens={managedTokens}
              manualForms={manualForms}
              onAddManualForm={handleAddManualForm}
              onDeleteManualForm={handleDeleteManualForm}
              onUpdatePackage={handleUpdatePackage}
              onOpenBankSoal={() => setActiveTab('bank')}
            />
          )}

          {effectiveActiveTab === 'token' && (
            <TokenManagerView
              tokens={managedTokens}
              onUpdateTokens={setManagedTokens}
              currentConfig={examConfig}
              onUpdateConfig={setExamConfig}
              onOpenProjector={() => setShowProjectorModal(true)}
              onOpenLiveMonitoring={() => setActiveTab('monitoring')}
              onOpenGoogleForms={() => setActiveTab('google_forms')}
              onOpenStudentMode={() => setMode('student')}
              packages={packages}
              manualForms={manualForms}
            />
          )}

          {effectiveActiveTab === 'distribusi' && (
            <DistribusiGoogleFormView
              config={examConfig}
              onUpdateConfig={setExamConfig}
              onSyncTokenEntry={handleSyncTokenEntry}
              onOpenLiveMonitoring={() => setActiveTab('monitoring')}
              onOpenSecureExam={() => setMode('student')}
            />
          )}

          {effectiveActiveTab === 'monitoring' && (
            <LiveMonitoringView
              config={examConfig}
              packages={packages}
              managedTokens={managedTokens}
              onNavigateToToken={() => setActiveTab('token')}
              onOpenProjector={() => setShowProjectorModal(true)}
              onOpenStudentSimulation={(tok) => {
                const cleanTok = String(tok || '').trim().toUpperCase();
                const matched = managedTokens.find((t) => t.token.toUpperCase() === cleanTok);
                if (matched) {
                  const dur = matched.durationMinutes ?? examConfig.durationMinutes;
                  setExamConfig({
                    ...examConfig,
                    token: matched.token.toUpperCase(),
                    title: matched.quizTitle || examConfig.title,
                    subject: matched.subject || examConfig.subject,
                    grade: matched.grade || examConfig.grade,
                    totalQuestions: matched.totalQuestions ?? examConfig.totalQuestions,
                    durationMinutes: dur,
                    remainingSeconds: dur * 60,
                    maxViolations: matched.maxViolations ?? examConfig.maxViolations,
                    googleFormUrl: matched.googleFormUrl ?? '',
                    googleFormEditUrl: matched.googleFormEditUrl ?? '',
                    driveFolderUrl: matched.driveFolderUrl || examConfig.driveFolderUrl,
                  });
                } else {
                  setExamConfig({ ...examConfig, token: cleanTok });
                }
                setMode('student');
              }}
            />
          )}

          {effectiveActiveTab === 'nilai_siswa' && (
            <RekapNilaiView
              key="nilai-siswa-overview"
              initialViewMode="list"
              scores={scores}
              packages={packages}
              managedTokens={managedTokens}
              manualForms={manualForms}
              webAppUrl={webAppUrl}
              apiSecret={apiSecret}
              onOpenGasSettings={() => setActiveTab('settings_gas')}
              onImportScores={(newScores) => setScores(newScores)}
              onUpdatePackage={(updatedPkg) =>
                setPackages((prev) => prev.map((p) => (p.id === updatedPkg.id ? updatedPkg : p)))
              }
            />
          )}

          {effectiveActiveTab === 'rekap' && (
            <RekapNilaiView
              key="rekap-detail"
              initialViewMode="detail"
              scores={scores}
              packages={packages}
              managedTokens={managedTokens}
              manualForms={manualForms}
              webAppUrl={webAppUrl}
              apiSecret={apiSecret}
              onOpenGasSettings={() => setActiveTab('settings_gas')}
              onImportScores={(newScores) => setScores(newScores)}
              onUpdatePackage={(updatedPkg) =>
                setPackages((prev) => prev.map((p) => (p.id === updatedPkg.id ? updatedPkg : p)))
              }
            />
          )}

          {effectiveActiveTab === 'pelanggaran' && <RiwayatPelanggaranView violations={violations} />}

          {effectiveActiveTab === 'teacher_users' && (
            <TeacherUsersView
              teachers={registeredTeachers}
              activeTeacherEmail={activeTeacherEmail}
              onCreateTeacher={handleCreateTeacher}
              onUpdateTeacher={handleUpdateTeacher}
              onDeleteTeacher={handleDeleteTeacher}
            />
          )}

          {effectiveActiveTab === 'student_users' && (
            <StudentParticipantsView
              students={registeredStudents}
              strictParticipantMode={strictParticipantMode}
              onToggleStrictMode={handleToggleStrictStudents}
              onCreateStudent={handleCreateStudent}
              onBulkImportStudents={handleBulkImportStudents}
              onUpdateStudent={handleUpdateStudent}
              onDeleteStudent={handleDeleteStudent}
              onClearStudents={handleClearStudents}
            />
          )}

          {effectiveActiveTab === 'settings_gas' && (
            <GasSettingsView
              webAppUrl={webAppUrl}
              onSaveWebAppUrl={handleSaveWebAppUrl}
              guruName={guruName}
              onSaveGuruName={handleSaveGuruName}
              apiSecret={apiSecret}
              shuffleQuestions={shuffleQuestions}
              onSaveShuffleQuestions={handleSaveShuffleQ}
              shuffleOptions={shuffleOptions}
              onSaveShuffleOptions={handleSaveShuffleO}
              customCodeGs={customCodeGs}
              onSaveAllSettings={handleSaveAllGasSettings}
            />
          )}

          {effectiveActiveTab === 'clear_data' && (
            <ClearDataView
              packages={packages}
              scores={scores}
              violations={violations}
              manualForms={manualForms}
              tokens={managedTokens}
              onClearViolations={() => setViolations([])}
              onClearScores={() => setScores([])}
              onClearGoogleForms={() => {
                setManualForms([]);
                setPackages((prev) =>
                  prev.map((p) => ({
                    ...p,
                    googleFormUrl: '',
                    googleFormEditUrl: '',
                    formId: '',
                  }))
                );
                setManagedTokens((prev) =>
                  prev.map((t) => ({
                    ...t,
                    googleFormUrl: '',
                    googleFormEditUrl: '',
                  }))
                );
                setExamConfig((prev) => ({
                  ...prev,
                  googleFormUrl: '',
                  googleFormEditUrl: '',
                }));
              }}
              onClearTokens={() => {
                setManagedTokens([]);
                setExamConfig((prev) => ({
                  ...prev,
                  token: '',
                  title: '',
                  subject: '',
                  grade: '',
                  totalQuestions: 0,
                  isActive: false,
                  isExamStarted: false,
                }));
              }}
              onClearPackages={() => setPackages([])}
              onClearLogsAndHistory={() => {
                setViolations([]);
                setScores([]);
                setManualForms([]);
                setPackages((prev) =>
                  prev.map((p) => ({
                    ...p,
                    googleFormUrl: '',
                    googleFormEditUrl: '',
                    formId: '',
                  }))
                );
                setManagedTokens((prev) =>
                  prev.map((t) => ({
                    ...t,
                    googleFormUrl: '',
                    googleFormEditUrl: '',
                  }))
                );
                setExamConfig((prev) => ({
                  ...prev,
                  googleFormUrl: '',
                  googleFormEditUrl: '',
                }));
              }}
              onClearAllData={() => {
                setViolations([]);
                setScores([]);
                setManualForms([]);
                setPackages([]);
                setManagedTokens([]);
                setExamConfig((prev) => ({
                  ...prev,
                  token: '',
                  title: '',
                  subject: '',
                  grade: '',
                  totalQuestions: 0,
                  isActive: false,
                  isExamStarted: false,
                  googleFormUrl: '',
                  googleFormEditUrl: '',
                }));
              }}
              onRestoreDefaults={() => {
                setPackages([]);
                setScores([]);
                setViolations([]);
                setManualForms([]);
                setManagedTokens([]);
                setExamConfig({
                  token: '',
                  title: '',
                  subject: '',
                  grade: '',
                  totalQuestions: 0,
                  durationMinutes: 90,
                  remainingSeconds: 90 * 60,
                  maxViolations: 3,
                  waitingRoomEnabled: false,
                  isExamStarted: false,
                  isActive: false,
                  googleFormUrl: '',
                  googleFormEditUrl: '',
                  driveFolderUrl: 'https://drive.google.com',
                  expiryMode: 'jp',
                  jpCount: 2,
                });
              }}
            />
          )}

          {effectiveActiveTab === 'download' && <DownloadAplikasiView />}

          {effectiveActiveTab === 'paket' && (
            <StatusPaketView
              teacherEmail={activeTeacherEmail}
              teacherName={activeTeacherName}
            />
          )}
        </main>

        {/* Editorial Footer */}
        <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 mt-auto">
          <div>
            Soalpintar.ai &copy; 2026 · Platform AI Asesmen & CBT Google Forms
          </div>
          <div className="flex items-center gap-3 text-slate-400">
            <span>Kurikulum Merdeka</span>
            <span>·</span>
            <span>Kemdikbudristek Belajar.id</span>
            <span>·</span>
            <span>Safe Exam Anti-Cheat</span>
          </div>
        </footer>
      </div>

      {/* Classroom Projector Modal */}
      {showProjectorModal && (
        <ProjectorScreenModal
          config={examConfig}
          onClose={() => setShowProjectorModal(false)}
        />
      )}
    </div>
  );
}
