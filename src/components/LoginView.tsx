import React, { useState } from 'react';
import {
  ShieldCheck,
  Users,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  KeyRound,
  User,
  Hash,
  BookOpen,
  AlertTriangle,
  Sparkles,
  UserPlus,
  Building2,
  CheckCircle2,
  Monitor,
  Smartphone,
  Radio,
  Shield,
} from 'lucide-react';
import { ManagedTokenEntry, TeacherAccount, StudentParticipantAccount } from '../types';
import { parseResponseJsonSafe } from '../utils/safeFetchJson';
import {
  getSyncDeviceId,
  getOrCreateDeviceId,
  detectDeviceCategory,
} from '../utils/deviceId';

export type TeacherPortalRole = TeacherAccount['role'];

export interface TeacherAuthPayload {
  role: 'teacher';
  teacherRole: TeacherPortalRole;
  name: string;
  email: string;
  subject?: string;
  school?: string;
  loggedInAt: number;
}

export interface StudentAuthPayload {
  role: 'student';
  name: string;
  nisn: string;
  kelas: string;
  token: string;
  loggedInAt: number;
}

export type AuthSession = TeacherAuthPayload | StudentAuthPayload;

interface LoginViewProps {
  defaultRole?: 'pengawas' | 'admin' | 'teacher' | 'student';
  defaultToken?: string;
  defaultGuruName?: string;
  activeExamToken?: string;
  availableTokens?: ManagedTokenEntry[];
  registeredTeachers?: TeacherAccount[];
  registeredStudents?: StudentParticipantAccount[];
  strictParticipantMode?: boolean;
  onRegisterTeacher?: (
    payload: Omit<TeacherAccount, 'id' | 'createdAt'>
  ) => Promise<{ success: boolean; message?: string; teacher?: TeacherAccount }>;
  onLoginSuccess: (session: AuthSession) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  defaultRole = 'pengawas',
  defaultToken = '',
  defaultGuruName = 'Apendi Mukdor, S.Pd.',
  activeExamToken = '',
  availableTokens = [],
  registeredTeachers = [],
  registeredStudents = [],
  strictParticipantMode = false,
  onRegisterTeacher,
  onLoginSuccess,
}) => {
  const initialTab: 'pengawas' | 'admin' | 'student' =
    defaultRole === 'student'
      ? 'student'
      : defaultRole === 'admin' || defaultRole === 'teacher'
      ? 'admin'
      : 'pengawas';

  const [roleTab, setRoleTab] = useState<'pengawas' | 'admin' | 'student'>(initialTab);
  const [teacherMode, setTeacherMode] = useState<'login' | 'register'>('login');

  // Teacher login form state (separated per portal tab)
  const [pengawasEmail, setPengawasEmail] = useState('pengawas@guru.smp.belajar.id');
  const [pengawasPassword, setPengawasPassword] = useState('');
  const [adminEmail, setAdminEmail] = useState('apendimukdor86@guru.smp.belajar.id');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Teacher registration form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regSubject, setRegSubject] = useState('');
  const [regSchool, setRegSchool] = useState('');
  const [regPengawasSubRole, setRegPengawasSubRole] = useState<'Pengawas' | 'Guru Mapel'>('Pengawas');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Student login form state
  const [studentToken, setStudentToken] = useState(String(defaultToken || '').toUpperCase());
  const [studentName, setStudentName] = useState('');
  const [studentNisn, setStudentNisn] = useState('');
  const [studentKelas, setStudentKelas] = useState('VII-A');
  const [studentPin, setStudentPin] = useState('');
  const [forceShowPin, setForceShowPin] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deviceId, setDeviceId] = useState<string>(() => getSyncDeviceId());
  const deviceType = React.useMemo(() => detectDeviceCategory(), []);

  const [serverRoomsList, setServerRoomsList] = useState<any[]>([]);
  const [serverStudentsList, setServerStudentsList] = useState<StudentParticipantAccount[]>([]);
  const [serverStrictMode, setServerStrictMode] = useState<boolean>(strictParticipantMode);

  React.useEffect(() => {
    let active = true;
    fetch('/api/rooms')
      .then((res) => (res.ok ? parseResponseJsonSafe(res) : null))
      .then((data) => {
        if (active && data?.success && Array.isArray(data.rooms)) {
          setServerRoomsList(data.rooms);
        }
      })
      .catch(() => {
        // Ignore offline error
      });

    fetch('/api/students')
      .then((res) => (res.ok ? parseResponseJsonSafe(res) : null))
      .then((data) => {
        if (!active || !data?.success) return;
        if (Array.isArray(data.students)) {
          setServerStudentsList(data.students);
        }
        if (typeof data.strictParticipantMode === 'boolean') {
          setServerStrictMode(data.strictParticipantMode);
        }
      })
      .catch(() => {
        // Ignore offline error
      });

    return () => {
      active = false;
    };
  }, []);

  const effectiveStudentsList = React.useMemo(() => {
    const byNisn = new Map<string, StudentParticipantAccount>();
    for (const s of serverStudentsList) {
      const k = String(s?.nisn || '').trim().toLowerCase();
      if (k) byNisn.set(k, s);
    }
    for (const s of registeredStudents) {
      const k = String(s?.nisn || '').trim().toLowerCase();
      if (k && !byNisn.has(k)) byNisn.set(k, s);
    }
    return Array.from(byNisn.values());
  }, [serverStudentsList, registeredStudents]);

  const effectiveStrictMode = Boolean(strictParticipantMode || serverStrictMode);

  const matchedRegisteredStudent = React.useMemo(() => {
    const cleanNisn = studentNisn.trim().toLowerCase();
    if (!cleanNisn) return null;
    return (
      effectiveStudentsList.find((s) => String(s.nisn || '').trim().toLowerCase() === cleanNisn) ||
      null
    );
  }, [studentNisn, effectiveStudentsList]);

  const handleStudentNisnChange = (val: string) => {
    setStudentNisn(val);
    setForceShowPin(false);
    const clean = val.trim().toLowerCase();
    if (!clean) return;
    const found = effectiveStudentsList.find(
      (s) => String(s.nisn || '').trim().toLowerCase() === clean
    );
    if (found) {
      setStudentName(found.name);
      if (found.kelas && found.kelas !== '-') {
        setStudentKelas(found.kelas);
      }
    }
  };

  const activeTokenOptions = React.useMemo(() => {
    const now = Date.now();
    const byToken = new Map<
      string,
      { token: string; label: string; quizTitle: string; subject: string }
    >();

    for (const t of availableTokens) {
      const code = String(t.token || '').trim().toUpperCase();
      if (!code || t.isActive === false) continue;
      if (t.expiryDateTime) {
        const exp = new Date(t.expiryDateTime).getTime();
        if (Number.isFinite(exp) && exp > 0 && now > exp) continue;
      }
      byToken.set(code, {
        token: code,
        label: t.label || '',
        quizTitle: t.quizTitle || 'Ujian CBT',
        subject: t.subject || 'Umum',
      });
    }

    for (const r of serverRoomsList) {
      const code = String(r?.token || '').trim().toUpperCase();
      if (!code || r?.isActive === false) continue;
      if (r?.expiryDateTime) {
        const exp = new Date(r.expiryDateTime).getTime();
        if (Number.isFinite(exp) && exp > 0 && now > exp) continue;
      }
      if (!byToken.has(code)) {
        byToken.set(code, {
          token: code,
          label: '',
          quizTitle: String(r.title || 'Ujian CBT'),
          subject: String(r.subject || 'Umum'),
        });
      }
    }

    return Array.from(byToken.values());
  }, [availableTokens, serverRoomsList]);

  React.useEffect(() => {
    let active = true;
    getOrCreateDeviceId().then((id) => {
      if (active && id) setDeviceId(id);
    });
    return () => {
      active = false;
    };
  }, []);

  const isAdminTab = roleTab === 'admin';
  const currentTeacherEmail = isAdminTab ? adminEmail : pengawasEmail;
  const currentTeacherPassword = isAdminTab ? adminPassword : pengawasPassword;

  const setCurrentTeacherEmail = (val: string) => {
    if (isAdminTab) setAdminEmail(val);
    else setPengawasEmail(val);
  };

  const setCurrentTeacherPassword = (val: string) => {
    if (isAdminTab) setAdminPassword(val);
    else setPengawasPassword(val);
  };

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const portalType: 'admin' | 'pengawas' = isAdminTab ? 'admin' : 'pengawas';
    const trimmedEmail = currentTeacherEmail.trim().toLowerCase();

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Harap masukkan alamat email yang valid.');
      return;
    }

    if (!currentTeacherPassword || currentTeacherPassword.length < 4) {
      setErrorMsg('Kata sandi minimal 4 karakter.');
      return;
    }

    setIsLoading(true);
    try {
      const localMatch = registeredTeachers.find(
        (t) => String(t?.email || '').toLowerCase() === trimmedEmail
      );

      if (localMatch) {
        if (localMatch.status === 'Nonaktif') {
          setErrorMsg('Akun ini sedang dinonaktifkan oleh Admin Sekolah.');
          return;
        }
        if (localMatch.password !== currentTeacherPassword) {
          setErrorMsg('Kata sandi tidak sesuai untuk akun tersebut.');
          return;
        }
        if (portalType === 'admin' && localMatch.role !== 'Admin Sekolah') {
          setErrorMsg(
            `Akun "${localMatch.email}" terdaftar sebagai ${localMatch.role}. Silakan masuk melalui tab Login Guru Pengawas.`
          );
          return;
        }
        if (portalType === 'pengawas' && localMatch.role === 'Admin Sekolah') {
          setErrorMsg(
            `Akun "${localMatch.email}" terdaftar sebagai Admin Sekolah. Silakan masuk melalui tab Login Admin Sekolah.`
          );
          return;
        }

        onLoginSuccess({
          role: 'teacher',
          teacherRole: localMatch.role,
          name: localMatch.name,
          email: localMatch.email,
          subject: localMatch.subject,
          school: localMatch.school,
          loggedInAt: Date.now(),
        });
        return;
      }

      const res = await fetch('/api/teachers/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password: currentTeacherPassword,
          expectedPortalRole: portalType,
        }),
      });
      const data = await parseResponseJsonSafe(res);
      if (res.ok && data?.success && data.teacher) {
        onLoginSuccess({
          role: 'teacher',
          teacherRole: data.teacher.role || (portalType === 'admin' ? 'Admin Sekolah' : 'Pengawas'),
          name: data.teacher.name,
          email: data.teacher.email,
          subject: data.teacher.subject,
          school: data.teacher.school,
          loggedInAt: Date.now(),
        });
        return;
      }

      setErrorMsg(
        data?.message ||
          (portalType === 'admin'
            ? 'Email Admin Sekolah belum terdaftar. Klik "Daftar Akun" untuk mendaftar.'
            : 'Email Guru Pengawas belum terdaftar. Klik "Daftar Akun" untuk mendaftar.')
      );
    } catch {
      if (
        portalType === 'admin' &&
        trimmedEmail === 'apendimukdor86@guru.smp.belajar.id' &&
        currentTeacherPassword === 'guru123'
      ) {
        onLoginSuccess({
          role: 'teacher',
          teacherRole: 'Admin Sekolah',
          name: defaultGuruName || 'Apendi Mukdor, S.Pd.',
          email: trimmedEmail,
          loggedInAt: Date.now(),
        });
      } else if (
        portalType === 'pengawas' &&
        trimmedEmail === 'pengawas@guru.smp.belajar.id' &&
        currentTeacherPassword === 'pengawas123'
      ) {
        onLoginSuccess({
          role: 'teacher',
          teacherRole: 'Pengawas',
          name: 'Siti Rahayu, S.Pd.',
          email: trimmedEmail,
          loggedInAt: Date.now(),
        });
      } else {
        setErrorMsg('Email atau kata sandi belum terdaftar. Silakan periksa kembali atau daftar akun baru.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTeacherRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanName = regName.trim();
    const cleanEmail = regEmail.trim().toLowerCase();
    const targetRole: TeacherPortalRole = isAdminTab ? 'Admin Sekolah' : regPengawasSubRole;

    if (!cleanName) {
      setErrorMsg('Nama lengkap guru wajib diisi.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Harap masukkan alamat email guru yang valid.');
      return;
    }
    if (!regPassword || regPassword.length < 4) {
      setErrorMsg('Kata sandi minimal 4 karakter.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setErrorMsg('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    if (!onRegisterTeacher) {
      onLoginSuccess({
        role: 'teacher',
        teacherRole: targetRole,
        name: cleanName,
        email: cleanEmail,
        subject: regSubject.trim(),
        school: regSchool.trim(),
        loggedInAt: Date.now(),
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await onRegisterTeacher({
        name: cleanName,
        email: cleanEmail,
        password: regPassword,
        subject: regSubject.trim(),
        school: regSchool.trim(),
        role: targetRole,
        status: 'Aktif',
        source: 'portal_daftar',
      });

      if (!result.success) {
        setErrorMsg(result.message || 'Gagal mendaftarkan akun.');
        return;
      }

      setSuccessMsg(`Akun ${targetRole} berhasil didaftarkan & disimpan!`);
      onLoginSuccess({
        role: 'teacher',
        teacherRole: result.teacher?.role || targetRole,
        name: result.teacher?.name || cleanName,
        email: result.teacher?.email || cleanEmail,
        subject: result.teacher?.subject || regSubject.trim(),
        school: result.teacher?.school || regSchool.trim(),
        loggedInAt: Date.now(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const normalizedToken = studentToken.trim().toUpperCase();
    let finalName = studentName.trim();
    const trimmedNisn = studentNisn.trim();
    let finalKelas = studentKelas.trim();

    if (!normalizedToken) {
      setErrorMsg('Kode Token Ujian wajib diisi.');
      return;
    }
    if (!trimmedNisn) {
      setErrorMsg('NISN / No. Peserta wajib diisi.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Verify student participant directory (strict mode, status Aktif, & optional PIN)
      let verifiedRemotely = false;
      try {
        const verifyRes = await fetch('/api/students/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nisn: trimmedNisn,
            pin: studentPin.trim(),
          }),
        });
        const verifyCt = verifyRes.headers.get('content-type') || '';
        const verifyData = await parseResponseJsonSafe(verifyRes);

        if (verifyCt.includes('application/json') && verifyData) {
          verifiedRemotely = true;
          if (!verifyRes.ok || verifyData.allowed === false) {
            if (verifyData.requiresPin) {
              setForceShowPin(true);
            }
            if (verifyData.matchedStudent) {
              if (!finalName) finalName = String(verifyData.matchedStudent.name || '');
              if (verifyData.matchedStudent.kelas && verifyData.matchedStudent.kelas !== '-') {
                finalKelas = String(verifyData.matchedStudent.kelas);
              }
              setStudentName(finalName);
              setStudentKelas(finalKelas);
            }
            setErrorMsg(
              verifyData.message || 'Verifikasi data peserta ujian gagal. Hubungi Admin Sekolah.'
            );
            setIsLoading(false);
            return;
          }
          if (verifyData.matchedStudent) {
            finalName = String(verifyData.matchedStudent.name || finalName);
            if (verifyData.matchedStudent.kelas && verifyData.matchedStudent.kelas !== '-') {
              finalKelas = String(verifyData.matchedStudent.kelas);
            }
          }
        }
      } catch {
        // Fallback to local participant directory check if server unreachable
      }

      if (!verifiedRemotely) {
        if (!matchedRegisteredStudent) {
          if (effectiveStrictMode) {
            setErrorMsg(
              `NISN "${trimmedNisn}" belum terdaftar dalam daftar Peserta Ujian sekolah. Hubungi Admin Sekolah.`
            );
            setIsLoading(false);
            return;
          }
        } else {
          if (matchedRegisteredStudent.status === 'Nonaktif') {
            setErrorMsg(
              `Akun peserta atas nama ${matchedRegisteredStudent.name} sedang dinonaktifkan oleh Admin Sekolah.`
            );
            setIsLoading(false);
            return;
          }
          if (
            matchedRegisteredStudent.pin &&
            matchedRegisteredStudent.pin.trim() !== '' &&
            matchedRegisteredStudent.pin.trim() !== studentPin.trim()
          ) {
            setForceShowPin(true);
            setErrorMsg('PIN / Kata Sandi peserta tidak sesuai.');
            setIsLoading(false);
            return;
          }
          finalName = matchedRegisteredStudent.name || finalName;
          if (matchedRegisteredStudent.kelas && matchedRegisteredStudent.kelas !== '-') {
            finalKelas = matchedRegisteredStudent.kelas;
          }
        }
      }

      if (!finalName || !finalKelas) {
        setErrorMsg('Harap lengkapi Nama Lengkap, NISN/No. Absen, dan Kelas Anda.');
        setIsLoading(false);
        return;
      }

      // 2. Verify Exam Room & Token
      const res = await fetch(`/api/rooms/${encodeURIComponent(normalizedToken)}`);
      const ct = res.headers.get('content-type') || '';
      const data = await parseResponseJsonSafe(res);

      if (res.status === 403) {
        setErrorMsg(
          data?.message ||
            `Token "${normalizedToken}" sedang dijeda atau telah kedaluwarsa.`
        );
        setIsLoading(false);
        return;
      }

      const matchedLocal = availableTokens.find(
        (t) => String(t?.token || '').toUpperCase() === normalizedToken
      );
      const validFallback = Boolean(
        activeExamToken &&
          activeExamToken.trim() &&
          normalizedToken === activeExamToken.trim().toUpperCase()
      );

      if (!res.ok || !ct.includes('application/json')) {
        if (matchedLocal) {
          if (matchedLocal.isActive === false) {
            setErrorMsg(`Token "${normalizedToken}" sedang dijeda sementara oleh pengawas.`);
            setIsLoading(false);
            return;
          }
          const expTs = matchedLocal.expiryDateTime
            ? new Date(matchedLocal.expiryDateTime).getTime()
            : NaN;
          if (Number.isFinite(expTs) && expTs > 0 && Date.now() > expTs) {
            setErrorMsg(`Masa berlaku token "${normalizedToken}" telah berakhir.`);
            setIsLoading(false);
            return;
          }
          const dur = Number.isFinite(Number(matchedLocal.durationMinutes))
            ? Math.max(0, Number(matchedLocal.durationMinutes))
            : 90;
          await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: normalizedToken,
              title: matchedLocal.quizTitle || 'Ujian CBT',
              subject: matchedLocal.subject || 'Umum',
              grade: matchedLocal.grade || 'SMP',
              totalQuestions: matchedLocal.totalQuestions ?? 0,
              durationMinutes: dur,
              maxViolations: Math.max(1, Number(matchedLocal.maxViolations) || 3),
              waitingRoomEnabled: Boolean(matchedLocal.waitingRoomEnabled),
              isExamStarted: matchedLocal.isExamStarted !== false,
              isActive: true,
              expiryDateTime: matchedLocal.expiryDateTime || '',
              googleFormUrl: matchedLocal.googleFormUrl || '',
              googleFormEditUrl: matchedLocal.googleFormEditUrl || '',
              driveFolderUrl: matchedLocal.driveFolderUrl || 'https://drive.google.com',
            }),
          }).catch(() => {});
        } else if (!validFallback) {
          setErrorMsg(
            `Kode token "${normalizedToken}" tidak ditemukan. Periksa kembali token dari pengawas/guru.`
          );
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Allow offline/local fallback if server check fails transiently
    } finally {
      setIsLoading(false);
    }

    onLoginSuccess({
      role: 'student',
      name: finalName,
      nisn: trimmedNisn,
      kelas: finalKelas,
      token: normalizedToken,
      loggedInAt: Date.now(),
    });
  };

  const handleFillTeacherDemo = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (isAdminTab) {
      setAdminEmail('apendimukdor86@guru.smp.belajar.id');
      setAdminPassword('guru123');
    } else {
      setPengawasEmail('pengawas@guru.smp.belajar.id');
      setPengawasPassword('pengawas123');
    }
  };

  const handleFillStudentDemo = () => {
    setErrorMsg(null);
    setStudentToken((activeTokenOptions[0]?.token || activeExamToken || '').toUpperCase());
    if (effectiveStudentsList.length > 0) {
      const sample = effectiveStudentsList.find((s) => s.status === 'Aktif') || effectiveStudentsList[0];
      setStudentName(sample.name);
      setStudentNisn(sample.nisn);
      setStudentKelas(sample.kelas || 'VII-A');
      setStudentPin(sample.pin || '');
    } else {
      setStudentName('Ahmad Raihan Pratama');
      setStudentNisn('0089283741');
      setStudentKelas('VII-A');
      setStudentPin('');
    }
  };

  const switchRoleTab = (nextTab: 'pengawas' | 'admin' | 'student') => {
    setRoleTab(nextTab);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowPassword(false);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-[480px] space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-2xl bg-[#0b1324] border border-slate-800 shadow-sm">
            <span className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-base shadow-xs">
              S
            </span>
            <div className="text-left">
              <div className="text-sm font-extrabold tracking-tight text-white">
                Soalpintar.ai
              </div>
              <div className="text-[11px] text-slate-400">
                Platform Asesmen &amp; CBT Anti-Curang
              </div>
            </div>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white pt-1">
            Masuk ke Portal Ujian
          </h1>
          <p className="text-xs text-slate-400">
            Pilih akses login sesuai peran: <strong>Guru Pengawas</strong>, <strong>Admin Sekolah</strong>, atau <strong>Peserta</strong>
          </p>
        </div>

        {/* Main Login Card */}
        <div className="bg-[#0b1324] border border-slate-800/90 rounded-2xl p-6 shadow-2xl space-y-5">
          {/* 3-Role Switcher Tabs */}
          <div
            role="tablist"
            aria-label="Pilih Peran Login"
            className="grid grid-cols-3 gap-1.5 p-1 bg-[#0e172a] border border-slate-800 rounded-xl"
          >
            <button
              type="button"
              role="tab"
              aria-selected={roleTab === 'pengawas'}
              onClick={() => switchRoleTab('pengawas')}
              className={`py-2.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                roleTab === 'pengawas'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span>Guru Pengawas</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={roleTab === 'admin'}
              onClick={() => switchRoleTab('admin')}
              className={`py-2.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                roleTab === 'admin'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>Admin Sekolah</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={roleTab === 'student'}
              onClick={() => switchRoleTab('student')}
              className={`py-2.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                roleTab === 'student'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Peserta Ujian</span>
            </button>
          </div>

          {/* Distinct Role Context Info */}
          {roleTab === 'pengawas' && (
            <div className="p-3.5 rounded-xl bg-sky-950/35 border border-sky-800/60 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 text-sky-400 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-sky-300">
                  Portal Login Guru Pengawas Ruang
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Akses khusus pengawasan Ujian Live, Layar QR Proyektor, pengelolaan token sesi, blokir/buka akses siswa, dan rekap nilai.
                </p>
              </div>
            </div>
          )}

          {roleTab === 'admin' && (
            <div className="p-3.5 rounded-xl bg-emerald-950/35 border border-emerald-800/60 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-emerald-300">
                  Portal Login Guru Admin Sekolah
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Akses penuh sekolah: AI Generator &amp; Bank Soal, Google Forms, manajemen akun Guru &amp; Pengawas, Web App (Code.gs), dan pengaturan sistem.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/80 text-emerald-300 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {roleTab === 'pengawas' || roleTab === 'admin' ? (
            <div className="space-y-4">
              {/* Sub-mode switcher: Login vs Daftar */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setTeacherMode('login');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className={`text-xs font-semibold pb-1 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    teacherMode === 'login'
                      ? isAdminTab
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-sky-500 text-sky-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>{isAdminTab ? 'Masuk Admin Sekolah' : 'Masuk Guru Pengawas'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTeacherMode('register');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className={`text-xs font-semibold pb-1 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    teacherMode === 'register'
                      ? isAdminTab
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-sky-500 text-sky-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isAdminTab ? 'Daftar Admin Sekolah' : 'Daftar Guru Pengawas'}</span>
                </button>
              </div>

              {teacherMode === 'login' ? (
                <form onSubmit={handleTeacherLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      {isAdminTab ? 'Email Admin Sekolah' : 'Email Guru Pengawas / Mapel'}
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={currentTeacherEmail}
                        onChange={(e) => setCurrentTeacherEmail(e.target.value)}
                        placeholder={
                          isAdminTab
                            ? 'admin@guru.smp.belajar.id'
                            : 'pengawas@guru.smp.belajar.id'
                        }
                        required
                        className={`w-full text-xs pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 ${
                          isAdminTab ? 'focus:ring-emerald-500' : 'focus:ring-sky-500'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-slate-300">
                        Kata Sandi
                      </label>
                      <button
                        type="button"
                        onClick={handleFillTeacherDemo}
                        className={`text-[11px] font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          isAdminTab
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-sky-400 hover:text-sky-300'
                        }`}
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>{isAdminTab ? 'Isi Akun Demo Admin' : 'Isi Akun Demo Pengawas'}</span>
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={currentTeacherPassword}
                        onChange={(e) => setCurrentTeacherPassword(e.target.value)}
                        placeholder="Masukkan kata sandi..."
                        required
                        className={`w-full text-xs pl-10 pr-10 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 ${
                          isAdminTab ? 'focus:ring-emerald-500' : 'focus:ring-sky-500'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                        title={showPassword ? 'Sembunyikan sandi' : 'Lihat sandi'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full py-3 px-4 disabled:opacity-60 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                      isAdminTab
                        ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                        : 'bg-sky-600 hover:bg-sky-700 active:bg-sky-800'
                    }`}
                  >
                    <LogIn className="w-4 h-4" />
                    <span>
                      {isLoading
                        ? 'Memverifikasi Akun...'
                        : isAdminTab
                        ? 'Masuk sebagai Admin Sekolah'
                        : 'Masuk sebagai Guru Pengawas'}
                    </span>
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTeacherMode('register');
                        setErrorMsg(null);
                      }}
                      className={`text-[11px] text-slate-400 transition-colors cursor-pointer ${
                        isAdminTab ? 'hover:text-emerald-400' : 'hover:text-sky-400'
                      }`}
                    >
                      {isAdminTab ? 'Belum punya akun Admin Sekolah?' : 'Belum punya akun Guru Pengawas?'}{' '}
                      <span className="font-semibold underline">Daftar Akun Baru</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleTeacherRegister} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Nama Lengkap &amp; Gelar
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Contoh: Siti Rahayu, S.Pd."
                        required
                        className="w-full text-xs pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Email (Belajar.id / Gmail)
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="nama@guru.smp.belajar.id"
                        required
                        className="w-full text-xs pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  {!isAdminTab && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300">
                        Jenis Peran Guru
                      </label>
                      <select
                        value={regPengawasSubRole}
                        onChange={(e) =>
                          setRegPengawasSubRole(e.target.value as 'Pengawas' | 'Guru Mapel')
                        }
                        className="w-full text-xs px-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white focus:outline-hidden focus:ring-2 focus:ring-sky-500 cursor-pointer"
                      >
                        <option value="Pengawas">Guru Pengawas Ruang Ujian</option>
                        <option value="Guru Mapel">Guru Mapel (Pembuat Soal &amp; Pengawas)</option>
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300">
                        {isAdminTab ? 'Jabatan / Bidang' : 'Ruang / Mapel'}
                      </label>
                      <div className="relative">
                        <BookOpen className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={regSubject}
                          onChange={(e) => setRegSubject(e.target.value)}
                          placeholder={isAdminTab ? 'Kurikulum / IT' : 'Ruang 01 / IPA'}
                          className="w-full text-xs pl-8 pr-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300">
                        Asal Sekolah
                      </label>
                      <div className="relative">
                        <Building2 className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={regSchool}
                          onChange={(e) => setRegSchool(e.target.value)}
                          placeholder="SMPN 1..."
                          className="w-full text-xs pl-8 pr-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300">
                        Kata Sandi
                      </label>
                      <div className="relative">
                        <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type={showRegPassword ? 'text' : 'password'}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Min. 4 karakter"
                          required
                          className="w-full text-xs pl-8 pr-8 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword((prev) => !prev)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300">
                        Ulangi Sandi
                      </label>
                      <div className="relative">
                        <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type={showRegPassword ? 'text' : 'password'}
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder="Ulangi sandi"
                          required
                          className="w-full text-xs pl-8 pr-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full py-3 px-4 disabled:opacity-60 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                      isAdminTab
                        ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                        : 'bg-sky-600 hover:bg-sky-700 active:bg-sky-800'
                    }`}
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>
                      {isLoading
                        ? 'Menyimpan Akun...'
                        : isAdminTab
                        ? 'Daftar Akun Admin Sekolah'
                        : 'Daftar Akun Guru Pengawas'}
                    </span>
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTeacherMode('login');
                        setErrorMsg(null);
                      }}
                      className={`text-[11px] text-slate-400 transition-colors cursor-pointer ${
                        isAdminTab ? 'hover:text-emerald-400' : 'hover:text-sky-400'
                      }`}
                    >
                      Sudah punya akun? <span className="font-semibold underline">Masuk di sini</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <form onSubmit={handleStudentLogin} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-300">
                    Kode Token Ujian
                  </label>
                  <button
                    type="button"
                    onClick={handleFillStudentDemo}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Isi Data Demo Peserta</span>
                  </button>
                </div>

                {activeTokenOptions.length > 0 && (
                  <select
                    aria-label="Pilih Token yang Aktif"
                    value={
                      activeTokenOptions.some((o) => o.token === studentToken.trim().toUpperCase())
                        ? studentToken.trim().toUpperCase()
                        : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      if (val) {
                        setStudentToken(val);
                        setErrorMsg(null);
                      }
                    }}
                    className="w-full text-xs bg-[#0e172a] border border-emerald-500/40 rounded-xl px-3 py-2 text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  >
                    <option value="">
                      -- Pilih Token yang Aktif ({activeTokenOptions.length} tersedia) --
                    </option>
                    {activeTokenOptions.map((opt) => (
                      <option key={opt.token} value={opt.token}>
                        {opt.token} — {opt.quizTitle}
                        {opt.label ? ` (${opt.label})` : ''}
                      </option>
                    ))}
                  </select>
                )}

                <div className="relative">
                  <KeyRound className="w-4 h-4 text-emerald-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentToken}
                    onChange={(e) => setStudentToken(e.target.value.toUpperCase())}
                    placeholder="Masukkan atau pilih kode token"
                    required
                    className="w-full font-mono text-sm font-bold tracking-widest pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-emerald-400 placeholder-slate-500 uppercase focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  Nama Lengkap Peserta
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Nama sesuai absen kelas"
                    required
                    className="w-full text-xs pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    NISN / No. Absen
                  </label>
                  <div className="relative">
                    <Hash className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={studentNisn}
                      onChange={(e) => handleStudentNisnChange(e.target.value)}
                      placeholder="00892837..."
                      required
                      className="w-full text-xs font-mono pl-9 pr-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Kelas / Rombel
                  </label>
                  <div className="relative">
                    <BookOpen className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={studentKelas}
                      onChange={(e) => setStudentKelas(e.target.value)}
                      placeholder="VII-A"
                      required
                      className="w-full text-xs pl-9 pr-3 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {matchedRegisteredStudent && (
                <div
                  className={`px-3 py-2 rounded-xl border text-[11px] flex items-center gap-2 ${
                    matchedRegisteredStudent.status === 'Nonaktif'
                      ? 'bg-rose-950/50 border-rose-800/70 text-rose-300'
                      : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  }`}
                >
                  {matchedRegisteredStudent.status === 'Nonaktif' ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span>
                        Akun {matchedRegisteredStudent.name} sedang dinonaktifkan Admin Sekolah.
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        Terdaftar: <strong>{matchedRegisteredStudent.name}</strong> · Kelas{' '}
                        {matchedRegisteredStudent.kelas}
                        {matchedRegisteredStudent.ruang ? ` · ${matchedRegisteredStudent.ruang}` : ''}
                      </span>
                    </>
                  )}
                </div>
              )}

              {!matchedRegisteredStudent && effectiveStrictMode && effectiveStudentsList.length > 0 && (
                <div className="px-3 py-2 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-[11px] text-indigo-300 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>
                    Mode Daftar Terverifikasi aktif. Masukkan NISN yang terdaftar oleh Admin Sekolah.
                  </span>
                </div>
              )}

              {(forceShowPin || Boolean(matchedRegisteredStudent?.pin && matchedRegisteredStudent.pin.trim() !== '')) && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    PIN / Kata Sandi Peserta
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      value={studentPin}
                      onChange={(e) => setStudentPin(e.target.value)}
                      placeholder="Masukkan PIN peserta dari Admin Sekolah..."
                      required
                      className="w-full text-xs font-mono pl-10 pr-3.5 py-2.5 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isLoading ? 'Memverifikasi Token...' : 'Masuk ke Portal Peserta'}</span>
              </button>

              <div className="pt-2 border-t border-slate-800/70 flex items-center justify-center gap-1.5 text-[11px] font-mono text-slate-400">
                {deviceType === 'HP / Tablet' ? (
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Monitor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{deviceType} · Device ID: {deviceId}</span>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-500">
          Soalpintar.ai · Sistem Asesmen Kurikulum Merdeka &amp; Google Forms Anti-Curang
        </p>
      </div>
    </div>
  );
};
