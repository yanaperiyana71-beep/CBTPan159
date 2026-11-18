import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  RefreshCw,
  Link2,
  Upload,
  Shuffle,
  Download,
  Edit3,
  Trash2,
  Plus,
  X,
  Check,
  FileSpreadsheet,
  ChevronDown,
  BarChart3,
} from 'lucide-react';
import {
  FormItemMeta,
  ManagedTokenEntry,
  QuestionPackage,
  StudentScoreRecord,
} from '../types';
import { parseResponseJsonSafe } from '../utils/safeFetchJson';

interface ManualGoogleFormEntry {
  id: string;
  label: string;
  url: string;
  createdAt: string;
  timeAgo?: string;
}

interface LiveRoomSummary {
  token: string;
  title: string;
  subject: string;
  grade?: string;
  googleFormUrl?: string;
  googleFormEditUrl?: string;
  createdAt?: number;
  participants?: Record<string, any>;
}

interface RekapNilaiViewProps {
  initialViewMode?: 'list' | 'detail';
  scores: StudentScoreRecord[];
  packages?: QuestionPackage[];
  managedTokens?: ManagedTokenEntry[];
  manualForms?: ManualGoogleFormEntry[];
  webAppUrl?: string;
  apiSecret?: string;
  onOpenGasSettings?: () => void;
  onImportScores?: (newScores: StudentScoreRecord[]) => void;
  onUpdatePackage?: (updatedPkg: QuestionPackage) => void;
}

interface FormOptionItem {
  key: string;
  formId: string;
  editUrl: string;
  title: string;
  subject?: string;
  grade?: string;
  token?: string;
  subtitle: string;
  sourceLabel: string;
  packageId?: string;
  createdAt?: number;
  liveParticipantScores?: StudentScoreRecord[];
}

interface PersistedFormMetaMap {
  [formId: string]: {
    formId?: string;
    editUrl?: string;
    title?: string;
    lastSyncedAt?: number;
    maxScore?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    items?: FormItemMeta[];
  };
}

const REKAP_META_STORAGE_KEY = 'soalpintar_rekap_form_meta_v1';
const ACTIVE_FORM_KEY_STORAGE = 'soalpintar_rekap_active_form_key_v1';

function extractEditFormId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/\/d\/e\//i.test(raw) || /^1FAIpQL/i.test(raw)) {
    return '__PUBLISHED_LINK__';
  }
  if (raw.includes('/d/')) {
    const match = raw.match(/\/d\/(?!e\/)([a-zA-Z0-9_-]+)/);
    return match && match[1] ? match[1] : '';
  }
  if (/^[a-zA-Z0-9_-]{15,}$/.test(raw)) {
    return raw;
  }
  return '';
}

function formatShortDateTime(input: string | number | undefined): string {
  if (input === undefined || input === null || input === '' || input === '-') return '-';
  const dt = typeof input === 'number' ? new Date(input) : new Date(input);
  if (Number.isNaN(dt.getTime())) return String(input);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const day = dt.getDate();
  const mon = months[dt.getMonth()];
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${hh}:${mm}`;
}

function formatSyncTimestamp(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return 'Belum pernah diambil';
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return 'Belum pernah diambil';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const day = dt.getDate();
  const mon = months[dt.getMonth()];
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${yr} ${hh}:${mm}`;
}

function formatRelativeUpdate(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return 'Belum diambil';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Diperbarui baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Diperbarui ${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `Diperbarui ${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `Diperbarui ${diffDay} hari lalu`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `Diperbarui ${diffWeek} minggu lalu`;
  return `Diperbarui ${formatShortDateTime(ts)}`;
}

function formatCardTitle(title: string, grade?: string): string {
  const cleanTitle = String(title || 'Ujian CBT').trim();
  const cleanGrade = String(grade || '').trim();
  if (!cleanGrade) return cleanTitle;
  if (cleanTitle.toLowerCase().includes(cleanGrade.toLowerCase())) return cleanTitle;
  return `${cleanTitle} (${cleanGrade})`;
}

function parseScoreCell(rawVal: unknown): { score: number; maxScore: number } {
  const s = String(rawVal ?? '').trim();
  if (!s) return { score: 0, maxScore: 100 };
  const slashMatch = s.match(/(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (slashMatch) {
    const sc = Number(slashMatch[1].replace(',', '.'));
    const mx = Number(slashMatch[2].replace(',', '.'));
    return {
      score: Number.isFinite(sc) ? sc : 0,
      maxScore: Number.isFinite(mx) && mx > 0 ? mx : 100,
    };
  }
  const num = Number(s.replace(',', '.'));
  return {
    score: Number.isFinite(num) ? num : 0,
    maxScore: 100,
  };
}

export const RekapNilaiView: React.FC<RekapNilaiViewProps> = ({
  initialViewMode = 'detail',
  scores,
  packages = [],
  managedTokens = [],
  manualForms = [],
  webAppUrl = '',
  apiSecret = '',
  onOpenGasSettings,
  onImportScores,
  onUpdatePackage,
}) => {
  const [viewMode, setViewMode] = useState<'detail' | 'list'>(initialViewMode);
  const [activeTab, setActiveTab] = useState<'nilai' | 'analisis'>('nilai');
  const [liveRooms, setLiveRooms] = useState<LiveRoomSummary[]>([]);
  const [formSearchInput, setFormSearchInput] = useState('');
  const [formSearchQuery, setFormSearchQuery] = useState('');

  // Fetch Ujian Live rooms so Nilai Siswa displays real live exam cards
  const fetchLiveRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return;
      const data = await parseResponseJsonSafe(res);
      if (data?.success && Array.isArray(data.rooms)) {
        setLiveRooms(data.rooms);
      }
    } catch {
      // Ignore transient room fetch error
    }
  };

  useEffect(() => {
    fetchLiveRooms();
  }, []);

  useEffect(() => {
    if (viewMode === 'list') {
      fetchLiveRooms();
    }
  }, [viewMode]);

  // Persisted form metadata (lastSyncedAt, items for Analisis Butir Soal, shuffle flags, editUrl)
  const [formMetaMap, setFormMetaMap] = useState<PersistedFormMetaMap>(() => {
    try {
      const saved = localStorage.getItem(REKAP_META_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // Ignore storage error
    }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(REKAP_META_STORAGE_KEY, JSON.stringify(formMetaMap));
    } catch {
      // Ignore storage error
    }
  }, [formMetaMap]);

  // Build unified list of available forms prioritized from Ujian Live rooms + Token Siswa + Bank Soal + Manual Forms
  const formOptions = useMemo<FormOptionItem[]>(() => {
    const byKey = new Map<string, FormOptionItem>();
    const seenTokens = new Set<string>();
    const seenFormIds = new Set<string>();

    const registerLiveOrToken = (item: {
      token: string;
      title: string;
      subject?: string;
      grade?: string;
      googleFormEditUrl?: string;
      createdAt?: number;
      participants?: Record<string, any>;
    }) => {
      const cleanToken = String(item.token || '').trim().toUpperCase();
      if (!cleanToken || seenTokens.has(cleanToken)) return;
      seenTokens.add(cleanToken);

      const tokenKey = `token:${cleanToken}`;
      const savedTokenMeta = formMetaMap[tokenKey];
      const editUrl = savedTokenMeta?.editUrl || item.googleFormEditUrl || '';
      const extracted = extractEditFormId(editUrl);
      const validFormId =
        extracted && extracted !== '__PUBLISHED_LINK__'
          ? extracted
          : savedTokenMeta?.formId || '';

      if (validFormId) seenFormIds.add(validFormId);

      const parts = item.participants && typeof item.participants === 'object' ? Object.values(item.participants) : [];
      const liveParticipantScores: StudentScoreRecord[] = parts
        .filter((p: any) => p && typeof p === 'object' && p.score !== undefined && p.score !== null && Number.isFinite(Number(p.score)))
        .map((p: any, idx: number) => {
          const sc = Number(p.score);
          const maxSc = Number(p.totalScore) > 0 ? Number(p.totalScore) : 100;
          const pct = Math.min(100, Math.round((sc / maxSc) * 100));
          const ts = Number(p.lastPing || p.startedAt || Date.now());
          return {
            id: `live-${cleanToken}-${String(p.id || idx)}`,
            studentName: String(p.name || `Siswa ${idx + 1}`),
            nisn: String(p.nisn || '-'),
            absen: String(p.nisn || '-'),
            kelas: String(p.kelas || '-'),
            token: cleanToken,
            formId: validFormId || undefined,
            formTitle: item.title,
            score: sc,
            maxScore: maxSc,
            percentage: pct,
            statusKetuntasan: pct >= 75 ? 'Tuntas' : 'Belum Tuntas',
            submittedAt: formatShortDateTime(ts),
            submittedTimestamp: ts,
            violations: Number(p.violationsCount || 0),
          };
        });

      byKey.set(tokenKey, {
        key: tokenKey,
        formId: validFormId,
        editUrl: editUrl || (validFormId ? `https://docs.google.com/forms/d/${validFormId}/edit` : ''),
        title: formatCardTitle(item.title, item.grade),
        subject: item.subject || '',
        grade: item.grade || '',
        token: cleanToken,
        subtitle: `${item.subject || 'Umum'}${item.grade ? ` · ${item.grade}` : ''}`,
        sourceLabel: 'Dibuat aplikasi',
        createdAt: Number(item.createdAt) || 0,
        liveParticipantScores,
      });
    };

    for (const room of liveRooms) {
      if (room && room.token) {
        registerLiveOrToken(room);
      }
    }

    for (const tok of managedTokens) {
      if (tok && tok.token) {
        registerLiveOrToken({
          token: tok.token,
          title: tok.quizTitle || tok.label || `Ujian ${tok.token}`,
          subject: tok.subject,
          grade: tok.grade,
          googleFormEditUrl: tok.googleFormEditUrl,
          createdAt: tok.createdAt,
        });
      }
    }

    for (const pkg of packages) {
      const editUrl =
        pkg.googleFormEditUrl ||
        (pkg.formId && !pkg.formId.startsWith('manual-') ? `https://docs.google.com/forms/d/${pkg.formId}/edit` : '');
      const extracted = extractEditFormId(editUrl || pkg.formId || '');
      const fId = extracted && extracted !== '__PUBLISHED_LINK__' ? extracted : '';
      if (fId && !seenFormIds.has(fId)) {
        seenFormIds.add(fId);
        byKey.set(fId, {
          key: fId,
          formId: fId,
          editUrl: editUrl || `https://docs.google.com/forms/d/${fId}/edit`,
          title: formatCardTitle(pkg.title, pkg.grade),
          subject: pkg.subject,
          grade: pkg.grade,
          subtitle: `${pkg.subject} · ${pkg.grade}`,
          sourceLabel: 'Dibuat aplikasi',
          packageId: pkg.id,
        });
      }
    }

    for (const mf of manualForms) {
      const extracted = extractEditFormId(mf.url);
      if (extracted && extracted !== '__PUBLISHED_LINK__' && !seenFormIds.has(extracted)) {
        seenFormIds.add(extracted);
        byKey.set(extracted, {
          key: extracted,
          formId: extracted,
          editUrl: mf.url,
          title: mf.label || 'Google Form Manual',
          subtitle: mf.createdAt || 'Google Form',
          sourceLabel: 'Google Form',
        });
      }
    }

    for (const [k, meta] of Object.entries(formMetaMap)) {
      if (!k || k === '__default__' || k.startsWith('token:')) continue;
      if (!seenFormIds.has(k) && !byKey.has(k)) {
        seenFormIds.add(k);
        byKey.set(k, {
          key: k,
          formId: meta.formId || k,
          editUrl: meta.editUrl || `https://docs.google.com/forms/d/${k}/edit`,
          title: meta.title || `Google Form (${k.slice(0, 8)}...)`,
          subtitle: meta.lastSyncedAt ? `Diperbarui ${formatSyncTimestamp(meta.lastSyncedAt)}` : 'Form Terhubung',
          sourceLabel: 'Dibuat aplikasi',
        });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [liveRooms, managedTokens, packages, manualForms, formMetaMap]);

  const [selectedFormKey, setSelectedFormKey] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_FORM_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  });

  // Automatically pick first linked form if none selected or stored key no longer exists
  useEffect(() => {
    if (formOptions.length > 0) {
      const exists =
        selectedFormKey &&
        (formOptions.some((f) => f.key === selectedFormKey) || Boolean(formMetaMap[selectedFormKey]));
      if (!exists) {
        setSelectedFormKey(formOptions[0].key);
      }
    }
  }, [selectedFormKey, formOptions, formMetaMap]);

  useEffect(() => {
    try {
      if (selectedFormKey) {
        localStorage.setItem(ACTIVE_FORM_KEY_STORAGE, selectedFormKey);
      }
    } catch {
      // Ignore storage error
    }
  }, [selectedFormKey]);

  const activeForm = useMemo(
    () => formOptions.find((f) => f.key === selectedFormKey) || null,
    [formOptions, selectedFormKey]
  );

  // Card 2: Link edit form input
  const [editLinkInput, setEditLinkInput] = useState<string>('');
  const [linkStatusMsg, setLinkStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeForm) {
      setEditLinkInput(activeForm.editUrl || '');
    } else if (selectedFormKey && formMetaMap[selectedFormKey]?.editUrl) {
      setEditLinkInput(formMetaMap[selectedFormKey].editUrl || '');
    }
  }, [activeForm, selectedFormKey, formMetaMap]);

  // Card 1: Ambil otomatis state
  const [resyncAll, setResyncAll] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  // Card 3: Upload CSV / Excel state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // Row 2: Acak di Google Form state
  const currentMetaKey = activeForm?.formId || selectedFormKey || '__default__';
  const currentMeta = formMetaMap[currentMetaKey] || {};
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(
    currentMeta.shuffleQuestions ?? true
  );
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(
    currentMeta.shuffleOptions ?? false
  );
  const [isSavingShuffle, setIsSavingShuffle] = useState(false);

  useEffect(() => {
    const meta = formMetaMap[currentMetaKey];
    if (meta) {
      if (typeof meta.shuffleQuestions === 'boolean') setShuffleQuestions(meta.shuffleQuestions);
      if (typeof meta.shuffleOptions === 'boolean') setShuffleOptions(meta.shuffleOptions);
    }
  }, [currentMetaKey, formMetaMap]);

  // Table Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'highest' | 'lowest' | 'name_asc'>('newest');

  // Toast & Edit/Add Modal
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const [editingScore, setEditingScore] = useState<StudentScoreRecord | null>(null);
  const [showAddScoreModal, setShowAddScoreModal] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newAbsenOrNisn, setNewAbsenOrNisn] = useState('');
  const [newKelas, setNewKelas] = useState('9b');
  const [newScoreVal, setNewScoreVal] = useState('80');
  const [newMaxScoreVal, setNewMaxScoreVal] = useState('100');

  // Normalize all scores safely
  const safeScores: StudentScoreRecord[] = useMemo(
    () =>
      scores.map((s, idx) => {
        const sc = Number.isFinite(Number(s?.score)) ? Number(s.score) : 0;
        const maxSc = Number.isFinite(Number(s?.maxScore)) && Number(s.maxScore) > 0 ? Number(s.maxScore) : 100;
        const pct = Number.isFinite(Number(s?.percentage)) ? Number(s.percentage) : Math.round((sc / maxSc) * 100);
        return {
          ...s,
          id: String(s?.id || `sc-${idx}`),
          studentName: String(s?.studentName || `Siswa ${idx + 1}`),
          nisn: String(s?.nisn || '-'),
          absen: s?.absen ? String(s.absen) : undefined,
          kelas: String(s?.kelas || '-'),
          token: String(s?.token || '-'),
          score: sc,
          maxScore: maxSc,
          percentage: pct,
          statusKetuntasan: pct >= 75 ? 'Tuntas' : 'Belum Tuntas',
          submittedAt: String(s?.submittedAt || '-'),
          violations: Number.isFinite(Number(s?.violations)) ? Number(s.violations) : 0,
        };
      }),
    [scores]
  );

  // Helper to get combined scores belonging to a specific FormOptionItem (synced scores + Ujian Live participant scores)
  const getScoresForItem = (item: FormOptionItem | null): StudentScoreRecord[] => {
    if (!item) return safeScores;
    const matched = safeScores.filter(
      (s) =>
        (item.formId && s.formId === item.formId) ||
        (item.token && s.token === item.token)
    );
    const liveExtras = (item.liveParticipantScores || []).filter(
      (lp) =>
        !matched.some(
          (m) =>
            m.id === lp.id ||
            (m.studentName.toLowerCase() === lp.studentName.toLowerCase() &&
              m.token === lp.token)
        )
    );
    return [...matched, ...liveExtras];
  };

  // Filter scores belonging to selected form
  const formScopedScores = useMemo(() => {
    if (!activeForm) return safeScores;
    const combined = getScoresForItem(activeForm);
    const anyTagged = safeScores.some((s) => Boolean(s.formId) || (s.token && s.token !== '-' && s.token !== 'GFORM-LIVE'));
    if (combined.length > 0) return combined;
    if (!anyTagged && !activeForm.token && !activeForm.formId) return safeScores;
    return combined;
  }, [safeScores, activeForm]);

  // Unique classes for dropdown
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    for (const s of formScopedScores) {
      const k = String(s.kelas || '').trim();
      if (k && k !== '-') set.add(k);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [formScopedScores]);

  // Filtered + sorted rows
  const filteredScores = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = formScopedScores.filter((s) => {
      const matchSearch =
        !q ||
        s.studentName.toLowerCase().includes(q) ||
        s.nisn.toLowerCase().includes(q) ||
        (s.absen || '').toLowerCase().includes(q) ||
        s.kelas.toLowerCase().includes(q);
      const matchClass = classFilter === 'all' || s.kelas === classFilter;
      return matchSearch && matchClass;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortOrder === 'highest') return b.percentage - a.percentage || b.score - a.score;
      if (sortOrder === 'lowest') return a.percentage - b.percentage || a.score - b.score;
      if (sortOrder === 'name_asc') return a.studentName.localeCompare(b.studentName, 'id');
      const ta = a.submittedTimestamp || 0;
      const tb = b.submittedTimestamp || 0;
      if (sortOrder === 'oldest') return ta - tb;
      return tb - ta;
    });
    return sorted;
  }, [formScopedScores, searchQuery, classFilter, sortOrder]);

  // KPI summary (from scoped scores or filtered view)
  const kpiSource = filteredScores.length > 0 || searchQuery || classFilter !== 'all' ? filteredScores : formScopedScores;
  const totalResponses = kpiSource.length;
  const averageNilai =
    totalResponses > 0
      ? Math.round(kpiSource.reduce((acc, s) => acc + s.percentage, 0) / totalResponses)
      : 0;
  const highestNilai = totalResponses > 0 ? Math.max(...kpiSource.map((s) => s.percentage)) : 0;
  const lowestNilai = totalResponses > 0 ? Math.min(...kpiSource.map((s) => s.percentage)) : 0;

  const isFormConnected = Boolean(extractEditFormId(editLinkInput) && extractEditFormId(editLinkInput) !== '__PUBLISHED_LINK__');

  // Resolve token for GAS calls
  const resolveApiSecret = () => {
    if (apiSecret) return apiSecret;
    try {
      return localStorage.getItem('soalpintar_gas_api_secret') || '';
    } catch {
      return '';
    }
  };

  // Handler: Save "Link edit form"
  const handleSaveEditLink = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = editLinkInput.trim();
    if (!raw) {
      setLinkStatusMsg({ type: 'error', text: 'Tempel link editor Google Form (/forms/d/.../edit).' });
      return;
    }

    const extracted = extractEditFormId(raw);
    if (extracted === '__PUBLISHED_LINK__') {
      setLinkStatusMsg({
        type: 'error',
        text: 'Link /forms/d/e/1FAIpQL... adalah link siswa. Gunakan link editor (/forms/d/<ID>/edit).',
      });
      return;
    }
    if (!extracted) {
      setLinkStatusMsg({
        type: 'error',
        text: 'Format URL editor Google Form tidak valid. Contoh: https://docs.google.com/forms/d/<ID>/edit',
      });
      return;
    }

    const canonicalEditUrl = raw.includes('http') ? raw : `https://docs.google.com/forms/d/${extracted}/edit`;
    setEditLinkInput(canonicalEditUrl);
    const nextMetaKey = activeForm?.key || extracted;
    if (!activeForm) {
      setSelectedFormKey(extracted);
    }
    setFormMetaMap((prev) => ({
      ...prev,
      [nextMetaKey]: {
        ...prev[nextMetaKey],
        formId: extracted,
        editUrl: canonicalEditUrl,
        title: prev[nextMetaKey]?.title || activeForm?.title || `Google Form (${extracted.slice(0, 8)}...)`,
      },
      ...(nextMetaKey !== extracted
        ? {
            [extracted]: {
              ...prev[extracted],
              formId: extracted,
              editUrl: canonicalEditUrl,
              title: prev[extracted]?.title || activeForm?.title || `Google Form (${extracted.slice(0, 8)}...)`,
            },
          }
        : {}),
    }));

    if (activeForm?.token) {
      const targetToken = activeForm.token.toUpperCase();
      setLiveRooms((prev) =>
        prev.map((r) =>
          r.token?.toUpperCase() === targetToken ? { ...r, googleFormEditUrl: canonicalEditUrl } : r
        )
      );
      fetch('/api/rooms/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [{ token: targetToken, googleFormEditUrl: canonicalEditUrl }],
        }),
      }).catch(() => {});
    }

    if (activeForm?.packageId && onUpdatePackage) {
      const pkg = packages.find((p) => p.id === activeForm.packageId);
      if (pkg) {
        onUpdatePackage({
          ...pkg,
          formId: extracted,
          googleFormEditUrl: canonicalEditUrl,
        });
      }
    }

    setLinkStatusMsg({ type: 'success', text: 'Link edit form berhasil disimpan & terhubung.' });
    showToast('Link edit Google Form berhasil disimpan.');
    setTimeout(() => setLinkStatusMsg(null), 3000);
  };

  // Handler: "Ambil Nilai Baru"
  const handleFetchResponses = async () => {
    if (!webAppUrl) {
      setSyncNotice({
        type: 'info',
        text: 'URL Web App Google Apps Script belum diatur. Silakan atur di menu Setting Web App (Code.gs).',
      });
      if (onOpenGasSettings) onOpenGasSettings();
      return;
    }

    const targetId = extractEditFormId(editLinkInput || activeForm?.editUrl || activeForm?.formId || '');
    if (!targetId) {
      setSyncNotice({
        type: 'error',
        text: 'Hubungkan Link edit form (/forms/d/.../edit) terlebih dahulu sebelum mengambil nilai.',
      });
      linkInputRef.current?.focus();
      return;
    }
    if (targetId === '__PUBLISHED_LINK__') {
      setSyncNotice({
        type: 'error',
        text: 'Gunakan link editor (/forms/d/<ID>/edit), bukan link siswa (/d/e/1FAIpQL...).',
      });
      return;
    }

    setIsSyncing(true);
    setSyncNotice(null);

    const existingMeta = formMetaMap[targetId];
    const sinceParam = !resyncAll && existingMeta?.lastSyncedAt ? existingMeta.lastSyncedAt : undefined;

    try {
      const res = await fetch('/api/gas/get-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl,
          token: resolveApiSecret() || undefined,
          form_id: targetId,
          ...(sinceParam ? { since: sinceParam } : {}),
          nocache: true,
        }),
      });

      const data = await parseResponseJsonSafe(res);
      if (!res.ok || !data) {
        setSyncNotice({
          type: 'error',
          text:
            data?.message ||
            `Gagal terhubung ke Web App (HTTP ${res.status}). Pastikan Code.gs v3.6 telah di-deploy ulang.`,
        });
        return;
      }

      if (!data.success || data.data?.status !== 'success') {
        setSyncNotice({
          type: 'error',
          text: data.data?.message || data.message || 'Gagal membaca respons Google Form.',
        });
        return;
      }

      const gasResult = data.data;
      if (gasResult.is_quiz === false) {
        setSyncNotice({
          type: 'error',
          text: 'Google Form ini belum mengaktifkan Mode Kuis sehingga belum memiliki skor.',
        });
        return;
      }

      const rows = Array.isArray(gasResult.responses) ? gasResult.responses : [];
      const maxScore = Number(gasResult.max_score) > 0 ? Number(gasResult.max_score) : 100;
      const itemsMeta: FormItemMeta[] = Array.isArray(gasResult.items) ? gasResult.items : existingMeta?.items || [];
      const formTitle = String(gasResult.title || activeForm?.title || 'Google Form Kuis');
      const nowTs = Date.now();

      const activeKeyToSave = activeForm?.key || targetId;
      setFormMetaMap((prev) => ({
        ...prev,
        [activeKeyToSave]: {
          ...prev[activeKeyToSave],
          formId: targetId,
          editUrl: editLinkInput || prev[activeKeyToSave]?.editUrl || `https://docs.google.com/forms/d/${targetId}/edit`,
          title: formTitle,
          lastSyncedAt: nowTs,
          maxScore,
          items: itemsMeta,
        },
        ...(activeKeyToSave !== targetId
          ? {
              [targetId]: {
                ...prev[targetId],
                formId: targetId,
                editUrl: editLinkInput || prev[targetId]?.editUrl || `https://docs.google.com/forms/d/${targetId}/edit`,
                title: formTitle,
                lastSyncedAt: nowTs,
                maxScore,
                items: itemsMeta,
              },
            }
          : {}),
      }));
      if (!activeForm) {
        setSelectedFormKey(targetId);
      }

      if (rows.length === 0) {
        setSyncNotice({
          type: 'info',
          text: sinceParam
            ? 'Belum ada respons baru sejak sinkronisasi terakhir. Centang "Ambil ulang semua respons" jika ingin memuat ulang semua data.'
            : 'Form terhubung, namun belum ada respons siswa yang masuk.',
        });
        return;
      }

      const imported: StudentScoreRecord[] = rows
        .filter((r: unknown): r is Record<string, any> => Boolean(r && typeof r === 'object'))
        .map((r: any, idx: number) => {
          const rawScore =
            r.score !== null && r.score !== undefined && Number.isFinite(Number(r.score))
              ? Number(r.score)
              : 0;
          const pct = maxScore > 0 ? Math.min(100, Math.round((rawScore / maxScore) * 100)) : 0;
          const ts = r.submitted_at ? new Date(r.submitted_at).getTime() : nowTs;
          const cleanAbsen = r.absen ? String(r.absen).trim() : '';
          const cleanEmail = r.email ? String(r.email).trim() : '';
          const displayName = String(
            r.name || (cleanEmail ? cleanEmail.split('@')[0] : `Siswa ${idx + 1}`)
          );
          return {
            id: String(r.id ? `gas-${targetId}-${r.id}` : `gas-${targetId}-${idx}`),
            studentName: displayName,
            nisn: cleanAbsen || '-',
            absen: cleanAbsen || '-',
            email: cleanEmail || undefined,
            kelas: String(r.kelas || '-'),
            token: activeForm?.token || 'GFORM-LIVE',
            formId: targetId,
            formTitle,
            score: rawScore,
            maxScore,
            percentage: pct,
            statusKetuntasan: pct >= 75 ? 'Tuntas' : 'Belum Tuntas',
            submittedAt: formatShortDateTime(Number.isFinite(ts) ? ts : r.submitted_at),
            submittedTimestamp: Number.isFinite(ts) ? ts : nowTs,
            violations: 0,
            answers: r.answers && typeof r.answers === 'object' ? r.answers : undefined,
          };
        });

      if (onImportScores) {
        const byId = new Map(safeScores.map((s) => [s.id, s]));
        for (const rec of imported) {
          byId.set(rec.id, rec);
        }
        onImportScores(Array.from(byId.values()));
      }

      setSyncNotice({
        type: 'success',
        text: `${imported.length} respons siswa berhasil diambil dari Google Form.`,
      });
      showToast(`${imported.length} nilai siswa berhasil diperbarui.`);
    } catch (err: any) {
      setSyncNotice({
        type: 'error',
        text: 'Terjadi kesalahan saat mengambil nilai: ' + (err?.message || 'Koneksi gagal'),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Handler: "Simpan ke form" (Acak di Google Form)
  const handleSaveShuffleToForm = async () => {
    if (!webAppUrl) {
      showToast('URL Web App Apps Script belum diatur. Silakan atur di menu Setting Web App.');
      if (onOpenGasSettings) onOpenGasSettings();
      return;
    }

    const targetId = extractEditFormId(editLinkInput || activeForm?.editUrl || activeForm?.formId || '');
    if (!targetId || targetId === '__PUBLISHED_LINK__') {
      showToast('Hubungkan Link edit form (/forms/d/.../edit) yang valid terlebih dahulu.');
      linkInputRef.current?.focus();
      return;
    }

    setIsSavingShuffle(true);
    try {
      const res = await fetch('/api/gas/set-shuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl,
          token: resolveApiSecret() || undefined,
          form_id: targetId,
          questions: shuffleQuestions,
          options: shuffleOptions,
        }),
      });

      const data = await parseResponseJsonSafe(res);
      if (!res.ok || !data?.success) {
        showToast(data?.message || `Gagal menyimpan pengaturan acak (HTTP ${res.status}).`);
        return;
      }

      setFormMetaMap((prev) => ({
        ...prev,
        [targetId]: {
          ...prev[targetId],
          shuffleQuestions: Boolean(data.shuffle_questions),
          shuffleOptions: Boolean(data.shuffle_options),
        },
      }));

      const extraMsg = data.options_message ? ` (${data.options_message})` : '';
      showToast(`Pengaturan acak disimpan ke Google Form${extraMsg}`);
    } catch (err: any) {
      showToast('Gagal menyimpan ke form: ' + (err?.message || 'Koneksi gagal'));
    } finally {
      setIsSavingShuffle(false);
    }
  };

  // Handler: Upload CSV / Excel (.csv, .tsv, .xlsx, .xls)
  const handleUploadSpreadsheet = async () => {
    if (!selectedFile) {
      showToast('Pilih file .csv atau .xlsx terlebih dahulu.');
      return;
    }

    setIsUploadingFile(true);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        showToast('File tidak memiliki lembar data yang terbaca.');
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      if (!rows || rows.length === 0) {
        showToast('File kosong atau tidak berisi baris data siswa.');
        return;
      }

      const headers = Object.keys(rows[0]);
      const findCol = (patterns: RegExp[]) =>
        headers.find((h) => patterns.some((re) => re.test(h.trim())));

      const colTime = findCol([/timestamp/i, /waktu/i, /tanggal/i, /submitted/i]);
      const colName = findCol([/^nama/i, /nama\s*lengkap/i, /nama\s*siswa/i, /^name$/i, /student/i, /email/i]);
      const colKelas = findCol([/^kelas$/i, /kelas/i, /class/i, /rombel/i]);
      const colAbsen = findCol([/^absen$/i, /no\.?\s*absen/i, /nisn/i, /nomor/i]);
      const colScore = findCol([/^skor$/i, /^score$/i, /^nilai$/i, /total\s*score/i, /poin/i]);

      // Detect optional per-item score columns exported by Google Forms CSV (e.g. "Question [Score]" or "Soal 1 [Skor]")
      const scoreCols = headers.filter((h) => /\[(score|skor)\]/i.test(h));
      const targetFormId = activeForm?.formId || selectedFormKey || `csv-${Date.now()}`;
      const nowTs = Date.now();

      const importedRecords: StudentScoreRecord[] = rows
        .map((row, idx): StudentScoreRecord => {
          const rawName = colName ? String(row[colName] || '').trim() : '';
          const emailFallback =
            !rawName && headers.some((h) => /email/i.test(h))
              ? String(row[headers.find((h) => /email/i.test(h))!] || '').split('@')[0]
              : '';
          const studentName = rawName || emailFallback || `Siswa ${idx + 1}`;
          const kelas = colKelas ? String(row[colKelas] || '-').trim() || '-' : '-';
          const absenVal = colAbsen ? String(row[colAbsen] || '-').trim() || '-' : '-';

          const parsedScore = colScore
            ? parseScoreCell(row[colScore])
            : { score: 0, maxScore: 100 };

          const pct =
            parsedScore.maxScore > 0
              ? Math.min(100, Math.round((parsedScore.score / parsedScore.maxScore) * 100))
              : 0;

          let ts = nowTs - idx * 1000;
          if (colTime && row[colTime]) {
            const d = row[colTime] instanceof Date ? row[colTime] : new Date(row[colTime]);
            if (!Number.isNaN(d.getTime())) ts = d.getTime();
          }

          let answersMap: Record<string, { r: string; s: number }> | undefined;
          if (scoreCols.length > 0) {
            answersMap = {};
            scoreCols.forEach((scCol, qIdx) => {
              const baseTitle = scCol.replace(/\s*\[(score|skor)\]\s*$/i, '').trim();
              const ansVal = baseTitle && row[baseTitle] !== undefined ? String(row[baseTitle]) : '';
              const itemParsed = parseScoreCell(row[scCol]);
              answersMap![`csv-item-${qIdx + 1}`] = {
                r: ansVal,
                s: itemParsed.score,
              };
            });
          }

          const ketuntasan: 'Tuntas' | 'Belum Tuntas' = pct >= 75 ? 'Tuntas' : 'Belum Tuntas';

          return {
            id: `upload-${targetFormId}-${idx}-${ts}`,
            studentName,
            nisn: absenVal,
            absen: absenVal,
            kelas,
            token: activeForm?.token || 'UPLOAD-FILE',
            formId: targetFormId,
            formTitle: activeForm?.title || selectedFile.name,
            score: parsedScore.score,
            maxScore: parsedScore.maxScore,
            percentage: pct,
            statusKetuntasan: ketuntasan,
            submittedAt: formatShortDateTime(ts),
            submittedTimestamp: ts,
            violations: 0,
            ...(answersMap ? { answers: answersMap } : {}),
          };
        })
        .filter((r) => r.studentName.trim() !== '');

      if (scoreCols.length > 0) {
        const csvItems: FormItemMeta[] = scoreCols.map((scCol, qIdx) => ({
          id: `csv-item-${qIdx + 1}`,
          title: scCol.replace(/\s*\[(score|skor)\]\s*$/i, '').trim() || `Butir Soal ${qIdx + 1}`,
          type: 'MULTIPLE_CHOICE',
          points: 10,
        }));
        setFormMetaMap((prev) => ({
          ...prev,
          [targetFormId]: {
            ...prev[targetFormId],
            title: prev[targetFormId]?.title || selectedFile.name,
            lastSyncedAt: nowTs,
            items: csvItems,
          },
        }));
      }

      if (onImportScores) {
        const byId = new Map(safeScores.map((s) => [s.id, s]));
        for (const rec of importedRecords) {
          byId.set(rec.id, rec);
        }
        onImportScores(Array.from(byId.values()));
      }

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast(`${importedRecords.length} baris nilai berhasil diimpor dari ${selectedFile.name}.`);
    } catch (err: any) {
      showToast('Gagal membaca file CSV/Excel: ' + (err?.message || 'Format tidak didukung'));
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Export CSV
  const escapeCsvCell = (value: unknown) => {
    const str = String(value ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };

  const handleExportCsv = () => {
    const headers = ['No', 'Nama', 'Kelas', 'Absen', 'Skor', 'Nilai', 'Waktu Kirim'];
    const rows = filteredScores.map((s, idx) => [
      escapeCsvCell(idx + 1),
      escapeCsvCell(s.studentName),
      escapeCsvCell(s.kelas),
      escapeCsvCell(s.absen || s.nisn || '-'),
      escapeCsvCell(`${s.score} / ${s.maxScore}`),
      escapeCsvCell(s.percentage),
      escapeCsvCell(s.submittedAt),
    ]);

    const csvText = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows.map((e) => e.join(','))].join('\r\n');
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Rekap_Nilai_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Edit / Delete / Add individual score row
  const handleSaveEditedScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingScore) return;
    const cleanScore = Math.max(0, Number.isFinite(Number(editingScore.score)) ? Number(editingScore.score) : 0);
    const cleanMax = Math.max(1, Number.isFinite(Number(editingScore.maxScore)) ? Number(editingScore.maxScore) : 100);
    const pct = Math.round((cleanScore / cleanMax) * 100);
    const cleanAbsen = String(editingScore.absen || editingScore.nisn || '-').trim() || '-';
    const updated: StudentScoreRecord = {
      ...editingScore,
      studentName: String(editingScore.studentName || '').trim() || 'Siswa',
      nisn: cleanAbsen,
      absen: cleanAbsen,
      kelas: String(editingScore.kelas || '').trim() || '-',
      score: cleanScore,
      maxScore: cleanMax,
      percentage: pct,
      statusKetuntasan: pct >= 75 ? 'Tuntas' : 'Belum Tuntas',
    };
    const updatedList = safeScores.map((s) => (s.id === updated.id ? updated : s));
    if (onImportScores) onImportScores(updatedList);
    showToast(`Data nilai ${updated.studentName} berhasil diperbarui.`);
    setEditingScore(null);
  };

  const handleDeleteScore = (id: string, name: string) => {
    if (onImportScores) {
      onImportScores(safeScores.filter((s) => s.id !== id));
    }
    showToast(`Data nilai ${name} telah dihapus.`);
  };

  const handleAddNewScore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim()) return;
    const sc = Math.max(0, Number.isFinite(Number(newScoreVal)) ? Number(newScoreVal) : 0);
    const maxSc = Math.max(1, Number.isFinite(Number(newMaxScoreVal)) && Number(newMaxScoreVal) > 0 ? Number(newMaxScoreVal) : 100);
    const pct = Math.round((sc / maxSc) * 100);
    const nowTs = Date.now();
    const absenClean = newAbsenOrNisn.trim() || '-';
    const newRecord: StudentScoreRecord = {
      id: 'sc-manual-' + nowTs,
      studentName: newStudentName.trim(),
      nisn: absenClean,
      absen: absenClean,
      kelas: newKelas.trim() || '9b',
      token: activeForm?.token || 'MANUAL',
      ...(activeForm?.formId ? { formId: activeForm.formId, formTitle: activeForm.title } : {}),
      score: sc,
      maxScore: maxSc,
      percentage: pct,
      statusKetuntasan: pct >= 75 ? 'Tuntas' : 'Belum Tuntas',
      submittedAt: formatShortDateTime(nowTs),
      submittedTimestamp: nowTs,
      violations: 0,
    };
    if (onImportScores) onImportScores([newRecord, ...safeScores]);
    showToast(`Data siswa ${newRecord.studentName} berhasil ditambahkan.`);
    setShowAddScoreModal(false);
    setNewStudentName('');
    setNewAbsenOrNisn('');
  };

  // Compute Analisis Butir Soal from synced Google Form items + student answers
  const itemAnalysisRows = useMemo(() => {
    const itemsMeta = currentMeta.items || [];
    const responsesWithAnswers = formScopedScores.filter((s) => s.answers && Object.keys(s.answers).length > 0);
    if (itemsMeta.length === 0 || responsesWithAnswers.length === 0) {
      return [];
    }

    return itemsMeta.map((item, idx) => {
      let answeredCount = 0;
      let correctCount = 0;
      let totalEarned = 0;
      const itemMaxPoints = Number(item.points) > 0 ? Number(item.points) : 1;

      for (const resp of responsesWithAnswers) {
        const ans = resp.answers?.[item.id];
        if (ans) {
          answeredCount += 1;
          totalEarned += Number(ans.s || 0);
          if (Number(ans.s || 0) >= itemMaxPoints) {
            correctCount += 1;
          }
        }
      }

      const denom = answeredCount > 0 ? answeredCount : responsesWithAnswers.length;
      const difficultyRatio = denom > 0 ? Math.round((correctCount / denom) * 100) : 0;
      let category: 'Mudah' | 'Sedang' | 'Sukar' = 'Sedang';
      if (difficultyRatio >= 75) category = 'Mudah';
      else if (difficultyRatio < 40) category = 'Sukar';

      return {
        number: idx + 1,
        id: item.id,
        title: item.title || `Soal ${idx + 1}`,
        type: item.type || 'MULTIPLE_CHOICE',
        points: itemMaxPoints,
        correctCount,
        totalResponded: denom,
        difficultyRatio,
        avgPoints: denom > 0 ? Number((totalEarned / denom).toFixed(1)) : 0,
        category,
      };
    });
  }, [currentMeta.items, formScopedScores]);

  const nilaiTextColor = (nilai: number) => {
    if (nilai >= 75) return 'text-emerald-600 dark:text-emerald-400';
    if (nilai >= 50) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  };

  // =========================================================================
  // VIEW 1: NILAI SISWA / SEMUA FORM (Card Grid from Ujian Live Data)
  // =========================================================================
  if (viewMode === 'list') {
    const activeQuery = (formSearchQuery || formSearchInput).trim().toLowerCase();
    const visibleFormCards = formOptions.filter((f) => {
      if (!activeQuery) return true;
      return (
        f.title.toLowerCase().includes(activeQuery) ||
        (f.subject || '').toLowerCase().includes(activeQuery) ||
        (f.grade || '').toLowerCase().includes(activeQuery) ||
        (f.token || '').toLowerCase().includes(activeQuery) ||
        f.subtitle.toLowerCase().includes(activeQuery)
      );
    });

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Nilai Siswa
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Nilai dari respons Google Form, diambil otomatis atau lewat upload CSV/Excel
            </p>
          </div>
          <button
            type="button"
            onClick={() => setViewMode('detail')}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800/60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Buka Panel Manual / Link Form</span>
          </button>
        </div>

        {/* Search Card: Cari form / token */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormSearchQuery(formSearchInput);
          }}
          className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 sm:p-5 space-y-2"
        >
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Cari form / token
          </label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={formSearchInput}
              onChange={(e) => {
                setFormSearchInput(e.target.value);
                setFormSearchQuery(e.target.value);
              }}
              placeholder="Topik, label, atau kode token"
              className="flex-1 min-w-0 text-xs px-3.5 py-2.5 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cari
            </button>
          </div>
        </form>

        {/* Cards Grid from Ujian Live */}
        {visibleFormCards.length === 0 ? (
          <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-10 text-center space-y-3">
            <FileSpreadsheet className="w-9 h-9 text-indigo-400 mx-auto" />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {activeQuery
                ? `Tidak ditemukan form atau token dengan kata kunci "${activeQuery}"`
                : 'Belum ada data form dari Ujian Live'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Buat token ujian pada menu Token Siswa atau klik tombol di bawah untuk menempelkan link editor Google Form (/forms/d/.../edit) maupun mengunggah file CSV/Excel secara langsung.
            </p>
            <button
              type="button"
              onClick={() => setViewMode('detail')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer"
            >
              Hubungkan Form / Upload CSV
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleFormCards.map((form) => {
              const cardScores = getScoresForItem(form);
              const count = cardScores.length;
              const avgNum =
                count > 0
                  ? cardScores.reduce((acc, s) => acc + s.percentage, 0) / count
                  : 0;
              const avgFormatted = avgNum.toFixed(1).replace('.', ',');
              const metaRec = formMetaMap[form.key] || (form.formId ? formMetaMap[form.formId] : undefined);
              const latestScoreTs = cardScores.reduce(
                (maxTs, s) => Math.max(maxTs, Number(s.submittedTimestamp || 0)),
                0
              );
              const lastTs = metaRec?.lastSyncedAt || (latestScoreTs > 0 ? latestScoreTs : undefined);
              const statusTimeText = lastTs ? formatRelativeUpdate(lastTs) : 'Belum diambil';

              return (
                <button
                  key={form.key}
                  type="button"
                  onClick={() => {
                    setSelectedFormKey(form.key);
                    setEditLinkInput(form.editUrl || '');
                    setSyncNotice(null);
                    setLinkStatusMsg(null);
                    setViewMode('detail');
                  }}
                  className="text-left bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 hover:border-indigo-500/70 rounded-xl p-5 flex flex-col justify-between gap-4 transition-colors cursor-pointer min-h-[124px]"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                        {form.title}
                      </h3>
                      <span className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/75 border border-indigo-200/70 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-md whitespace-nowrap shrink-0">
                        {form.sourceLabel}
                      </span>
                    </div>

                    {form.token && (
                      <div>
                        <span className="inline-block font-mono tabular-nums text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/60 dark:border-indigo-800/50 px-2 py-0.5 rounded">
                          {form.token}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs pt-1">
                    <span className="text-slate-600 dark:text-slate-300 tabular-nums">
                      {count} respons
                      {count > 0 ? ` · rata-rata ${avgFormatted}` : ''}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                      {statusTimeText}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: DETAIL REKAP FORM (Matches Screenshot Layout)
  // =========================================================================
  return (
    <div className="space-y-4">
      {/* Top Back Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setViewMode('list')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Semua form</span>
        </button>

        {activeForm && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-md">
            <span className="font-medium text-slate-700 dark:text-slate-200">{activeForm.title}</span>
          </div>
        )}
      </div>

      {/* Row 1: 3 Action Cards (Ambil otomatis | Link edit form | Upload CSV / Excel) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {/* Card 1: Ambil otomatis */}
        <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between gap-3.5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <RefreshCw className={`w-4 h-4 text-indigo-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Ambil otomatis</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Membaca respons & skor langsung dari Google Form lewat Apps Script Anda.
            </p>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleFetchResponses}
              disabled={isSyncing}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Mengambil Nilai...</span>
                </>
              ) : (
                <span>Ambil Nilai Baru</span>
              )}
            </button>

            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={resyncAll}
                onChange={(e) => setResyncAll(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Ambil ulang semua respons</span>
            </label>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Terakhir diperbarui {formatSyncTimestamp(currentMeta.lastSyncedAt)}
            </div>

            {syncNotice && (
              <div
                className={`text-[11px] rounded-lg px-2.5 py-2 border ${
                  syncNotice.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300'
                    : syncNotice.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {syncNotice.text}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Link edit form */}
        <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between gap-3.5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Link2 className="w-4 h-4 text-indigo-400" />
              <span>Link edit form</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {isFormConnected
                ? 'Form sudah terhubung. Ganti hanya jika form dipindah ke akun lain.'
                : 'Tempel tautan editor Google Form (/forms/d/.../edit) untuk menghubungkan.'}
            </p>
          </div>

          <form onSubmit={handleSaveEditLink} className="space-y-2 my-auto">
            <div className="flex items-center gap-2">
              <input
                ref={linkInputRef}
                type="text"
                value={editLinkInput}
                onChange={(e) => setEditLinkInput(e.target.value)}
                placeholder="https://docs.google.com/forms/d/.../edit"
                className="flex-1 min-w-0 text-xs px-3 py-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-800/70 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Simpan
              </button>
            </div>
            {linkStatusMsg && (
              <p
                className={`text-[11px] ${
                  linkStatusMsg.type === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {linkStatusMsg.text}
              </p>
            )}
          </form>
          <div className="hidden lg:block h-2" aria-hidden="true" />
        </div>

        {/* Card 3: Upload CSV / Excel */}
        <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between gap-3.5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Upload className="w-4 h-4 text-indigo-400" />
              <span>Upload CSV / Excel</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Cadangan manual: Google Form → Respons → <strong className="font-semibold text-slate-700 dark:text-slate-200">Unduh respons (.csv)</strong>, atau dari Spreadsheet → Download .xlsx.
            </p>
          </div>

          <div className="flex items-center gap-2 my-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            >
              <span className="px-2.5 py-1 text-[11px] font-semibold bg-slate-200 dark:bg-slate-700/80 text-slate-800 dark:text-slate-100 rounded whitespace-nowrap shrink-0">
                Choose File
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {selectedFile ? selectedFile.name : 'No file chosen'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleUploadSpreadsheet}
              disabled={isUploadingFile}
              className="px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-800/70 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {isUploadingFile ? 'Proses...' : 'Upload'}
            </button>
          </div>
          <div className="hidden lg:block h-2" aria-hidden="true" />
        </div>
      </div>

      {/* Row 2: Acak di Google Form */}
      <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Shuffle className="w-3.5 h-3.5 text-indigo-400" />
            <span>Acak di Google Form</span>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Urutan soal</span>
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={(e) => setShuffleOptions(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Pilihan jawaban</span>
          </label>

          <button
            type="button"
            onClick={handleSaveShuffleToForm}
            disabled={isSavingShuffle}
            className="px-3.5 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 border border-indigo-200 dark:border-indigo-800/70 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {isSavingShuffle ? 'Menyimpan...' : 'Simpan ke form'}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Butuh Apps Script v3.1+. Data identitas siswa tetap di halaman pertama. Acak pilihan jawaban perlu layanan &quot;Google Forms API&quot; di editor Apps Script (Services → Google Forms API → Add).
        </p>
      </div>

      {/* Row 3: Underline Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('nilai')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'nilai'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Nilai Siswa
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analisis')}
            className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'analisis'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Analisis Butir Soal
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAddScoreModal(true)}
          className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Input Manual</span>
        </button>
      </div>

      {activeTab === 'nilai' ? (
        <>
          {/* Row 4: 4 KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Jumlah respons</div>
              <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {totalResponses}
              </div>
            </div>

            <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Rata-rata</div>
              <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                {averageNilai}
              </div>
              <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">dari 100</div>
            </div>

            <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Tertinggi</div>
              <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {highestNilai}
              </div>
              <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">dari 100</div>
            </div>

            <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Terendah</div>
              <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {lowestNilai}
              </div>
              <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">dari 100</div>
            </div>
          </div>

          {/* Row 5: Student Scores Table Card */}
          <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl overflow-hidden">
            {/* Filter Toolbar */}
            <div className="p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Cari nama
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Nama siswa"
                    className="w-44 sm:w-48 text-xs px-3 py-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Kelas
                  </label>
                  <div className="relative">
                    <select
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      className="appearance-none text-xs pl-3 pr-8 py-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="all">Semua kelas</option>
                      {availableClasses.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Urutkan
                  </label>
                  <div className="relative">
                    <select
                      value={sortOrder}
                      onChange={(e) =>
                        setSortOrder(
                          e.target.value as 'newest' | 'oldest' | 'highest' | 'lowest' | 'name_asc'
                        )
                      }
                      className="appearance-none text-xs pl-3 pr-8 py-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700/80 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="newest">Waktu kirim terbaru</option>
                      <option value="oldest">Waktu kirim terlama</option>
                      <option value="highest">Nilai tertinggi</option>
                      <option value="lowest">Nilai terendah</option>
                      <option value="name_asc">Nama (A-Z)</option>
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800/70 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Ekspor Excel (CSV)</span>
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-5 w-12">NO</th>
                    <th className="py-3 px-4">NAMA</th>
                    <th className="py-3 px-4">KELAS</th>
                    <th className="py-3 px-4">ABSEN</th>
                    <th className="py-3 px-4 text-right">SKOR</th>
                    <th className="py-3 px-4 text-right">NILAI</th>
                    <th className="py-3 px-4">WAKTU KIRIM</th>
                    <th className="py-3 px-5 text-right w-20">AKSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredScores.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 px-5 text-center text-slate-500 dark:text-slate-400">
                        Belum ada data nilai siswa. Klik <strong className="text-slate-700 dark:text-slate-200">Ambil Nilai Baru</strong> atau unggah file <strong className="text-slate-700 dark:text-slate-200">CSV / Excel</strong>.
                      </td>
                    </tr>
                  ) : (
                    filteredScores.map((item, idx) => (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group"
                      >
                        <td className="py-3.5 px-5 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          {item.studentName}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 dark:text-slate-200">
                          {item.kelas}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                          {item.absen || item.nisn}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                          {item.score} / {item.maxScore}
                        </td>
                        <td className={`py-3.5 px-4 text-right font-mono tabular-nums font-bold ${nilaiTextColor(item.percentage)}`}>
                          {item.percentage}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {item.submittedAt}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <div className="inline-flex items-center gap-1 opacity-75 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setEditingScore({ ...item })}
                              className="p-1.5 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              title="Edit Nilai"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteScore(item.id, item.studentName)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              title="Hapus Baris"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* TAB 2: ANALISIS BUTIR SOAL */
        <div className="space-y-4">
          {itemAnalysisRows.length === 0 ? (
            <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-10 text-center space-y-3">
              <BarChart3 className="w-9 h-9 text-indigo-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Data Analisis Butir Soal Belum Tersedia
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                Klik <strong className="text-slate-700 dark:text-slate-200">Ambil Nilai Baru</strong> (dengan centang &quot;Ambil ulang semua respons&quot;) dari Google Form yang memiliki respons, atau unggah file CSV respons Google Form untuk menghitung tingkat kesukaran per soal.
              </p>
              <button
                type="button"
                onClick={handleFetchResponses}
                disabled={isSyncing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Ambil Nilai & Analisis Butir</span>
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Jumlah butir soal</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {itemAnalysisRows.length}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Rata-rata ketepatan</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                    {Math.round(
                      itemAnalysisRows.reduce((acc, r) => acc + r.difficultyRatio, 0) /
                        itemAnalysisRows.length
                    )}
                    %
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Soal kategori mudah</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {itemAnalysisRows.filter((r) => r.category === 'Mudah').length}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl p-5">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Soal kategori sukar</div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {itemAnalysisRows.filter((r) => r.category === 'Sukar').length}
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800/80 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-5 w-12">NO</th>
                        <th className="py-3 px-4">PERTANYAAN / BUTIR SOAL</th>
                        <th className="py-3 px-4 text-right">POIN</th>
                        <th className="py-3 px-4 text-right">BENAR</th>
                        <th className="py-3 px-4 text-right">KETEPATAN</th>
                        <th className="py-3 px-5">KATEGORI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {itemAnalysisRows.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                        >
                          <td className="py-3.5 px-5 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {row.number}
                          </td>
                          <td className="py-3.5 px-4 text-slate-900 dark:text-slate-100 max-w-md">
                            <div className="line-clamp-2 font-medium">{row.title}</div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {row.points}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                            {row.correctCount} / {row.totalResponded}
                          </td>
                          <td className={`py-3.5 px-4 text-right font-mono tabular-nums font-bold ${nilaiTextColor(row.difficultyRatio)}`}>
                            {row.difficultyRatio}%
                          </td>
                          <td className="py-3.5 px-5 font-medium">
                            <span
                              className={
                                row.category === 'Mudah'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : row.category === 'Sukar'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-amber-600 dark:text-amber-400'
                              }
                            >
                              {row.category}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* MODAL: EDIT STUDENT SCORE */}
      {editingScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Perbaiki Data Nilai Siswa
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Koreksi nama, kelas, absen, atau skor siswa
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingScore(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedScore} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Nama Siswa
                </label>
                <input
                  type="text"
                  required
                  value={editingScore.studentName}
                  onChange={(e) => setEditingScore({ ...editingScore, studentName: e.target.value })}
                  className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Kelas
                  </label>
                  <input
                    type="text"
                    required
                    value={editingScore.kelas}
                    onChange={(e) => setEditingScore({ ...editingScore, kelas: e.target.value })}
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Absen / NISN
                  </label>
                  <input
                    type="text"
                    required
                    value={editingScore.absen || editingScore.nisn}
                    onChange={(e) =>
                      setEditingScore({
                        ...editingScore,
                        absen: e.target.value,
                        nisn: e.target.value,
                      })
                    }
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Skor Diperoleh
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editingScore.score}
                    onChange={(e) =>
                      setEditingScore({
                        ...editingScore,
                        score: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono font-bold text-center"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Skor Maksimal
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editingScore.maxScore}
                    onChange={(e) =>
                      setEditingScore({
                        ...editingScore,
                        maxScore: Math.max(1, Number(e.target.value) || 100),
                      })
                    }
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono text-center"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingScore(null)}
                  className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD MANUAL SCORE */}
      {showAddScoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0d1424] border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Tambah Data Nilai Manual
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Masukkan data nilai siswa secara langsung
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddScoreModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddNewScore} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Nama Siswa
                </label>
                <input
                  type="text"
                  required
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  placeholder="Contoh: Yana"
                  className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Kelas
                  </label>
                  <input
                    type="text"
                    required
                    value={newKelas}
                    onChange={(e) => setNewKelas(e.target.value)}
                    placeholder="9b"
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Absen / NISN
                  </label>
                  <input
                    type="text"
                    value={newAbsenOrNisn}
                    onChange={(e) => setNewAbsenOrNisn(e.target.value)}
                    placeholder="1"
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Skor Diperoleh
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={newScoreVal}
                    onChange={(e) => setNewScoreVal(e.target.value)}
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono font-bold text-center"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Skor Maksimal
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newMaxScoreVal}
                    onChange={(e) => setNewMaxScoreVal(e.target.value)}
                    className="w-full text-xs bg-slate-50 dark:bg-[#090f1d] border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-white font-mono text-center"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddScoreModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer"
                >
                  Tambah Siswa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOAST FEEDBACK */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white shadow-2xl text-xs font-medium">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMsg}</span>
          </div>
        </div>
      )}
    </div>
  );
};
