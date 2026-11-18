import React, { useState, useEffect } from 'react';
import {
  Users,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Send,
  CheckCircle2,
  QrCode,
  Copy,
  Search,
  ShieldX,
  PlayCircle,
  Check,
  Radio,
  ArrowLeft,
  X,
  Maximize2,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { StudentExamSession, ExamTokenConfig, QuestionPackage, ManagedTokenEntry } from '../types';
import { generateQrCodeDataUrl } from '../utils/qr';
import { parseResponseJsonSafe } from '../utils/safeFetchJson';

interface LiveRoomData {
  token: string;
  quizId?: string;
  title: string;
  subject: string;
  grade?: string;
  totalQuestions?: number;
  durationMinutes: number;
  remainingSeconds: number;
  maxViolations: number;
  waitingRoomEnabled?: boolean;
  isExamStarted?: boolean;
  isActive?: boolean;
  expiryDateTime?: string;
  googleFormUrl?: string;
  googleFormEditUrl?: string;
  driveFolderUrl?: string;
  createdAt?: number;
  participants: Record<string, StudentExamSession>;
  activeCount?: number;
  totalParticipantsCount?: number;
}

interface LiveMonitoringViewProps {
  config: ExamTokenConfig;
  onOpenProjector: () => void;
  onOpenStudentSimulation: (token: string) => void;
  packages?: QuestionPackage[];
  managedTokens?: ManagedTokenEntry[];
  onNavigateToToken?: () => void;
}

export const LiveMonitoringView: React.FC<LiveMonitoringViewProps> = ({
  config,
  onOpenProjector,
  onOpenStudentSimulation,
  packages = [],
  managedTokens = [],
  onNavigateToToken,
}) => {
  // Active rooms list state (synced from backend /api/rooms + managedTokens recovery)
  const [rooms, setRooms] = useState<LiveRoomData[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Selected room for detailed real-time monitoring (null = room grid overview)
  const [selectedRoomToken, setSelectedRoomToken] = useState<string | null>(null);
  const selectedRoomTokenRef = React.useRef<string | null>(null);
  const dismissedTokensRef = React.useRef<Set<string>>(new Set());
  const hasAutoSyncedRef = React.useRef<boolean>(false);

  useEffect(() => {
    selectedRoomTokenRef.current = selectedRoomToken;
  }, [selectedRoomToken]);

  // Dedicated QR Code Modal for specific room
  const [selectedQrRoom, setSelectedQrRoom] = useState<LiveRoomData | null>(null);
  const [qrModalDataUrl, setQrModalDataUrl] = useState<string>('');
  const [isCopiedQrLink, setIsCopiedQrLink] = useState(false);
  const [isCopiedToken, setIsCopiedToken] = useState(false);

  // Detail Room Monitoring State
  const [participants, setParticipants] = useState<StudentExamSession[]>([]);
  const [remainingSec, setRemainingSec] = useState<number>(config.remainingSeconds);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Warning Modal State
  const [warningTargetStudent, setWarningTargetStudent] = useState<StudentExamSession | null>(null);
  const [isBroadcastWarning, setIsBroadcastWarning] = useState<boolean>(false);
  const [warningText, setWarningText] = useState<string>('Peringatan Pengawas: Harap tetap fokus pada layar ujian Anda!');
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const mapRawRooms = (rawRooms: any[]): LiveRoomData[] => {
    return rawRooms
      .filter((r) => r && typeof r === 'object' && String(r.token || '').trim() !== '')
      .map((r: any) => {
        const cleanToken = String(r.token).trim().toUpperCase();
        const parts = r.participants && typeof r.participants === 'object' ? Object.values(r.participants) : [];
        const active = parts.filter((p: any) => p?.status === 'mengerjakan').length;
        return {
          ...r,
          token: cleanToken,
          title: String(r.title || r.quizTitle || 'Ujian CBT'),
          subject: String(r.subject || 'Umum'),
          participants: r.participants && typeof r.participants === 'object' ? r.participants : {},
          activeCount: active,
          totalParticipantsCount: parts.length,
        };
      })
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  };

  const syncManagedTokensToServer = async (forceAll = false): Promise<boolean> => {
    const tokensToSync = (Array.isArray(managedTokens) ? managedTokens : []).filter((t) => {
      const code = String(t?.token || '').trim().toUpperCase();
      if (!code) return false;
      if (!forceAll && dismissedTokensRef.current.has(code)) return false;
      return true;
    });

    if (forceAll) {
      dismissedTokensRef.current.clear();
    }

    if (tokensToSync.length === 0) return false;

    try {
      const syncRes = await fetch('/api/rooms/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: tokensToSync }),
      });
      if (!syncRes.ok) return false;
      const syncData = await parseResponseJsonSafe(syncRes);
      if (syncData?.success && Array.isArray(syncData.rooms)) {
        const mapped = mapRawRooms(syncData.rooms).filter(
          (r) => !dismissedTokensRef.current.has(r.token)
        );
        setRooms(mapped);
        return mapped.length > 0;
      }
    } catch (err) {
      console.error('Error syncing managed tokens to Ujian Live:', err);
    }
    return false;
  };

  // Fetch all rooms for overview
  const fetchAllRooms = async (manual = false) => {
    if (manual) setIsRefreshing(true);
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return;
      const data = await parseResponseJsonSafe(res);
      if (data?.success && Array.isArray(data.rooms)) {
        const serverTokens = new Set(
          data.rooms
            .filter((r: any) => r && r.token)
            .map((r: any) => String(r.token).trim().toUpperCase())
        );

        const missingTokens = (Array.isArray(managedTokens) ? managedTokens : []).filter((t) => {
          const code = String(t?.token || '').trim().toUpperCase();
          return Boolean(code) && !serverTokens.has(code) && !dismissedTokensRef.current.has(code);
        });

        // Auto-recover rooms from persisted managedTokens if server lost in-memory state or missed sync
        if (!hasAutoSyncedRef.current && missingTokens.length > 0) {
          hasAutoSyncedRef.current = true;
          const syncedOk = await syncManagedTokensToServer(false);
          if (syncedOk) return;
        }

        const mapped = mapRawRooms(data.rooms);
        setRooms(mapped);

        const currentSelected = selectedRoomTokenRef.current;
        if (currentSelected && !mapped.some((m) => m.token === currentSelected)) {
          setSelectedRoomToken(null);
          setParticipants([]);
        }
      }
    } catch (err) {
      console.error('Error fetching rooms:', err);
    } finally {
      setIsLoadingRooms(false);
      if (manual) setIsRefreshing(false);
    }
  };

  // Delete a specific live room
  const handleDeleteRoom = async (token: string) => {
    const cleanToken = String(token || '').trim().toUpperCase();
    dismissedTokensRef.current.add(cleanToken);
    try {
      await fetch(`/api/rooms/${encodeURIComponent(cleanToken)}`, { method: 'DELETE' });
      setRooms((prev) => prev.filter((r) => r.token !== cleanToken));
      if (selectedRoomToken === cleanToken) {
        setSelectedRoomToken(null);
        setParticipants([]);
      }
      if (selectedQrRoom?.token === cleanToken) {
        setSelectedQrRoom(null);
      }
      showToast(`Sesi ruang ujian "${cleanToken}" berhasil dihapus dari Ujian Live.`);
    } catch (err) {
      console.error('Error deleting room:', err);
    }
  };

  // Fetch specific room data when in detail monitoring mode
  const fetchActiveRoomDetail = async (token: string) => {
    const cleanToken = String(token || '').trim().toUpperCase();
    if (!cleanToken) return;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(cleanToken)}?viewer=teacher`);
      if (!res.ok) {
        setParticipants([]);
        setSelectedRoomToken(null);
        return;
      }
      const data = await parseResponseJsonSafe(res);
      if (data?.success && data.room) {
        setParticipants(Object.values(data.room.participants || {}));
        setRemainingSec(Math.max(0, Number(data.room.remainingSeconds) || 0));
      } else {
        setParticipants([]);
        setSelectedRoomToken(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAllRooms();
    const interval = setInterval(() => fetchAllRooms(false), 4000);
    return () => clearInterval(interval);
  }, [managedTokens]);

  useEffect(() => {
    if (selectedRoomToken) {
      fetchActiveRoomDetail(selectedRoomToken);
      const interval = setInterval(() => fetchActiveRoomDetail(selectedRoomToken), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedRoomToken]);

  // Open Layar QR Modal
  const handleOpenQrModal = async (room: LiveRoomData) => {
    setSelectedQrRoom(room);
    const url = `${window.location.origin}/?mode=student&token=${room.token}`;
    const qrData = await generateQrCodeDataUrl(url);
    setQrModalDataUrl(qrData);
  };

  // Copy helpers
  const handleCopyQrUrl = () => {
    if (!selectedQrRoom) return;
    const url = `${window.location.origin}/?mode=student&token=${selectedQrRoom.token}`;
    navigator.clipboard.writeText(url);
    setIsCopiedQrLink(true);
    showToast('Tautan portal ujian siswa berhasil disalin!');
    setTimeout(() => setIsCopiedQrLink(false), 2000);
  };

  const handleCopyQrToken = () => {
    if (!selectedQrRoom) return;
    navigator.clipboard.writeText(selectedQrRoom.token);
    setIsCopiedToken(true);
    showToast(`Token "${selectedQrRoom.token}" berhasil disalin!`);
    setTimeout(() => setIsCopiedToken(false), 2000);
  };

  const handleSendWarning = async () => {
    if (!selectedRoomToken) return;
    try {
      await fetch(`/api/rooms/${selectedRoomToken}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_warning',
          studentId: isBroadcastWarning ? undefined : warningTargetStudent?.id,
          message: warningText,
        }),
      });
      setShowWarningModal(false);
      showToast('Peringatan pengawas berhasil dikirim!');
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetStudent = async (student: StudentExamSession) => {
    if (!selectedRoomToken) return;
    try {
      await fetch(`/api/rooms/${selectedRoomToken}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_device_lock',
          studentId: student.id,
          deviceId: student.deviceId,
          nisn: student.nisn,
        }),
      });
      fetchActiveRoomDetail(selectedRoomToken);
      showToast(`Akses & kunci perangkat untuk ${student.name} berhasil dibuka ulang.`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartExamAll = async () => {
    if (!selectedRoomToken) return;
    try {
      await fetch(`/api/rooms/${selectedRoomToken}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start_exam',
        }),
      });
      fetchActiveRoomDetail(selectedRoomToken);
      fetchAllRooms();
      showToast('Ujian serentak telah dimulai! Ruang tunggu dibuka.');
    } catch (err) {
      console.error(err);
    }
  };

  const copyExamLink = (tok: string) => {
    const url = `${window.location.origin}/?mode=student&token=${tok}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    showToast('Tautan soal berhasil disalin ke clipboard!');
    setTimeout(() => setIsCopied(false), 2000);
  };

  const formatSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Calculate total students currently taking exams across all rooms
  const totalActiveStudents = rooms.reduce((acc, r) => acc + (r.activeCount || 0), 0);

  const countActive = participants.filter((p) => p.status === 'mengerjakan').length;
  const countWaiting = participants.filter((p) => p.status === 'ruang_tunggu').length;
  const countBlocked = participants.filter((p) => p.status === 'diblokir').length;
  const countDisconnected = participants.filter((p) => p.status === 'terputus').length;
  const countDone = participants.filter((p) => p.status === 'selesai').length;

  const filtered = participants.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      String(p?.name || '').toLowerCase().includes(q) ||
      String(p?.nisn || '').toLowerCase().includes(q) ||
      String(p?.kelas || '').toLowerCase().includes(q);
    const matchesFilter = filterStatus === 'all' || p?.status === filterStatus;
    return matchesQuery && matchesFilter;
  });

  const activeRoomData = rooms.find((r) => r.token === selectedRoomToken);

  return (
    <div className="space-y-6">
      {/* =========================================================================
          VIEW MODE 1: ACTIVE ROOMS OVERVIEW
         ========================================================================= */}
      {!selectedRoomToken ? (
        <div className="space-y-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
                <Radio className="w-6 h-6 text-emerald-500 shrink-0" />
                <span>Ujian Live &amp; Pemantauan Real-Time</span>
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Pantau seluruh ruang ujian aktif, tampilkan Layar QR proyektor, buka ruang tunggu, dan awasi status pengerjaan siswa secara langsung.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  setIsRefreshing(true);
                  await syncManagedTokensToServer(false);
                  await fetchAllRooms(true);
                  showToast('Data ruang Ujian Live berhasil disegarkan.');
                }}
                disabled={isRefreshing}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Muat Ulang</span>
              </button>

              {onNavigateToToken && (
                <button
                  type="button"
                  onClick={onNavigateToToken}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Kelola Token Siswa</span>
                </button>
              )}
            </div>
          </div>

          {/* Top Banner: Siswa sedang ujian di akun Anda */}
          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-4 md:p-5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-[#09221e] border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Radio className="w-5 h-5 animate-pulse" />
              </div>
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Siswa sedang ujian di akun Anda:{' '}
                <strong className="font-bold text-slate-900 dark:text-white ml-1">{totalActiveStudents} / 999</strong>
              </div>
            </div>

            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Ruang Aktif: <strong className="font-mono text-slate-900 dark:text-white">{rooms.length}</strong>
            </div>
          </div>

          {/* Grid of Live Exam Cards or Empty State */}
          {isLoadingRooms && rooms.length === 0 ? (
            <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-10 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Memuat daftar ruang Ujian Live...
              </p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Radio className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Belum Ada Ruang Ujian Live Aktif
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  {managedTokens.length > 0
                    ? `Anda memiliki ${managedTokens.length} token tersimpan. Klik tombol di bawah untuk menampilkan kembali ruang ujian dari token Anda ke monitor Ujian Live.`
                    : 'Semua sesi Ujian Live sudah dibersihkan atau belum ada token yang dibuat. Buat token baru di menu Token Siswa untuk memulai sesi ujian live.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                {managedTokens.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setIsRefreshing(true);
                      await syncManagedTokensToServer(true);
                      setIsRefreshing(false);
                      showToast(`${managedTokens.length} token berhasil dimuat ke Ujian Live.`);
                    }}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Muat {managedTokens.length} Token ke Ujian Live</span>
                  </button>
                )}
                {onNavigateToToken && (
                  <button
                    type="button"
                    onClick={onNavigateToToken}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>Buka Menu Token Siswa</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rooms.map((room) => {
                const activeCount = room.activeCount || 0;
                const totalJoined = room.totalParticipantsCount || 0;
                const durationLabel =
                  room.durationMinutes && room.durationMinutes > 0
                    ? `${room.durationMinutes} menit`
                    : 'tanpa batas waktu';
                const isRoomPaused = room.isActive === false;

                return (
                  <div
                    key={room.token}
                    className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700/80 transition-all"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Token Pill Badge */}
                          <span className="inline-block px-3 py-1 bg-indigo-50 dark:bg-[#18213e] border border-indigo-200 dark:border-indigo-800/40 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-xs rounded-lg tracking-wider">
                            {room.token}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                              isRoomPaused
                                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/40'
                                : room.isExamStarted === false
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40'
                                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                            }`}
                          >
                            {isRoomPaused ? 'Dijeda' : room.isExamStarted === false ? 'Ruang Tunggu' : 'Live'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteRoom(room.token)}
                          title="Hapus Ruang Ujian Live ini"
                          className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800/40 text-rose-500 dark:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Quiz Title */}
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-3.5 leading-snug">
                        {room.title}
                      </h3>

                      {/* Subject / Grade */}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {room.subject || room.title}{room.grade ? ` · ${room.grade}` : ''}
                      </p>

                      {/* Meta info: X mengerjakan · duration */}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-3.5 flex items-center flex-wrap gap-1.5">
                        <span><strong className="text-slate-800 dark:text-slate-200 font-mono">{activeCount}</strong> mengerjakan</span>
                        {totalJoined > activeCount && (
                          <>
                            <span>·</span>
                            <span>{totalJoined} total bergabung</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{durationLabel}</span>
                      </p>
                    </div>

                    {/* Two Action Buttons: Layar QR & Pantau */}
                    <div className="mt-6 flex items-center gap-3">
                      {/* Layar QR */}
                      <button
                        type="button"
                        onClick={() => handleOpenQrModal(room)}
                        className="flex-1 bg-indigo-50 dark:bg-[#1a233d] hover:bg-indigo-100 dark:hover:bg-[#233054] border border-indigo-200 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-200 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                        title="Tampilkan Kode QR Ujian di Layar Proyektor"
                      >
                        <QrCode className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
                        <span>Layar QR</span>
                      </button>

                      {/* Pantau */}
                      <button
                        type="button"
                        onClick={() => setSelectedRoomToken(room.token)}
                        className="flex-1 bg-emerald-50 dark:bg-[#0b2824] hover:bg-emerald-100 dark:hover:bg-[#103a34] border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                        title="Buka Pemantauan Real-Time Ruang Ujian Ini"
                      >
                        <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Pantau</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* =========================================================================
            VIEW MODE 2: DETAIL LIVE ROOM MONITORING (When Teacher Clicks "Pantau")
           ========================================================================= */
        <div className="space-y-6 animate-in fade-in">
          {/* Top Back Navigation & Fast Actions */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setSelectedRoomToken(null)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-xl transition-colors cursor-pointer mb-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Daftar Ujian Live</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-emerald-300 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-800">
                  TOKEN: {selectedRoomToken}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  · {activeRoomData?.durationMinutes ? `Sisa: ${formatSec(remainingSec)}` : 'Tanpa Batas Waktu'}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
                Ujian Live: {activeRoomData?.title || 'Pemantauan Real-Time'}
              </h1>
              <p className="text-xs text-slate-400">
                Materi: <strong className="text-slate-200">{activeRoomData?.subject || 'Umum'}</strong> · Deteksi otomatis perpindahan tab, split-screen, dan kecurangan siswa.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copyExamLink(selectedRoomToken)}
                className="px-3 py-2 text-xs font-medium text-slate-300 bg-[#0e172a] border border-slate-800 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Salin Tautan</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsBroadcastWarning(true);
                  setWarningTargetStudent(null);
                  setShowWarningModal(true);
                }}
                className="px-3 py-2 text-xs font-medium text-amber-300 bg-amber-950/50 border border-amber-800/60 rounded-xl hover:bg-amber-900/50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Kirim Peringatan Umum</span>
              </button>

              {activeRoomData && (
                <button
                  type="button"
                  onClick={() => handleOpenQrModal(activeRoomData)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Layar QR Proyektor</span>
                </button>
              )}

              {activeRoomData && (!activeRoomData.isExamStarted || countWaiting > 0) && (
                <button
                  type="button"
                  onClick={handleStartExamAll}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Mulai Ujian Serentak ({countWaiting})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onOpenStudentSimulation(selectedRoomToken)}
                className="px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Tes Portal Siswa</span>
              </button>
            </div>
          </div>

          {/* KPI Overview Strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-[#0b1324] border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Total Peserta</span>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {participants.length}
              </div>
            </div>
            <div className="bg-[#0b1324] border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-[11px] text-emerald-400 uppercase tracking-wider font-semibold">Mengerjakan</span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {countActive}
              </div>
            </div>
            <div className="bg-[#0b1324] border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-[11px] text-amber-400 uppercase tracking-wider font-semibold">Terputus / Lag</span>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                {countDisconnected}
              </div>
            </div>
            <div className="bg-[#0b1324] border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-[11px] text-rose-400 uppercase tracking-wider font-semibold">Diblokir (Curang)</span>
              <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                {countBlocked}
              </div>
            </div>
            <div className="bg-[#0b1324] border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Selesai Submit</span>
              <div className="text-xl font-bold font-mono text-slate-300 mt-1">
                {countDone}
              </div>
            </div>
          </div>

          {/* Filter and Table Container */}
          <div className="bg-[#0b1324] border border-slate-800/80 rounded-2xl shadow-xs overflow-hidden">
            {/* Table Toolbar */}
            <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama siswa, NISN, atau kelas..."
                  className="w-full text-xs pl-9 pr-3 py-2 bg-[#0e172a] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Segmented status filter buttons */}
              <div className="flex items-center gap-1 p-1 bg-[#0e172a] border border-slate-800/80 rounded-xl text-xs font-medium w-full md:w-auto overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setFilterStatus('all')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'all'
                      ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Semua ({participants.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('mengerjakan')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'mengerjakan'
                      ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Mengerjakan ({countActive})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('ruang_tunggu')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'ruang_tunggu'
                      ? 'bg-sky-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ruang Tunggu ({countWaiting})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('diblokir')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'diblokir'
                      ? 'bg-rose-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Diblokir ({countBlocked})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('terputus')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'terputus'
                      ? 'bg-amber-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Terputus ({countDisconnected})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('selesai')}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                    filterStatus === 'selesai'
                      ? 'bg-slate-700 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Selesai ({countDone})
                </button>
              </div>
            </div>

            {/* Live Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0e172a] border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Nama Siswa & NISN</th>
                    <th className="py-3 px-4">Kelas</th>
                    <th className="py-3 px-4">Status Real-Time</th>
                    <th className="py-3 px-4 text-center">Pelanggaran</th>
                    <th className="py-3 px-4 text-center">Progres Soal</th>
                    <th className="py-3 px-4 text-center">Nilai</th>
                    <th className="py-3 px-4 text-right">Tindakan Pengawas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 text-xs">
                        {participants.length === 0
                          ? 'Belum ada siswa yang bergabung di ruang ujian ini. Siswa dapat scan Layar QR atau memasukkan Token.'
                          : 'Tidak ada siswa yang sesuai filter pencarian.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((student) => {
                      return (
                        <tr
                          key={student.id}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">
                              {student.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              NISN: {student.nisn}
                            </div>
                            {student.deviceId && (
                              <div
                                className="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-[200px]"
                                title={`Device ID: ${student.deviceId}`}
                              >
                                {student.deviceType ? `${student.deviceType} · ` : ''}ID: {student.deviceId.slice(0, 12)}...
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-300 font-medium">
                            {student.kelas}
                          </td>
                          <td className="py-3.5 px-4">
                            {student.status === 'mengerjakan' && (
                              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Mengerjakan
                              </span>
                            )}
                            {student.status === 'ruang_tunggu' && (
                              <span className="inline-flex items-center gap-1.5 font-medium text-sky-400">
                                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
                                Ruang Tunggu
                              </span>
                            )}
                            {student.status === 'terputus' && (
                              <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                Terputus (Lag)
                              </span>
                            )}
                            {student.status === 'diblokir' && (
                              <span className="inline-flex items-center gap-1.5 font-bold text-rose-400">
                                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                Diblokir
                              </span>
                            )}
                            {student.status === 'selesai' && (
                              <span className="inline-flex items-center gap-1.5 font-medium text-slate-400">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                Selesai
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {student.violationsCount > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-950/60 text-rose-400 border border-rose-800/60">
                                <AlertTriangle className="w-3 h-3" />
                                {student.violationsCount}x Pelanggaran
                              </span>
                            ) : (
                              <span className="text-slate-500 font-mono text-[11px]">0</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="font-mono text-slate-300">
                              {student.currentQuestionIndex || 0} / {activeRoomData?.totalQuestions ?? 10}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {student.score !== undefined ? (
                              <span className="font-bold text-emerald-400 font-mono">
                                {student.score}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {student.status === 'diblokir' || student.status === 'selesai' ? (
                                <button
                                  type="button"
                                  onClick={() => handleResetStudent(student)}
                                  className="px-2.5 py-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800 hover:bg-emerald-900/60 rounded-lg cursor-pointer"
                                >
                                  {student.status === 'selesai' ? 'Izinkan Ulang' : 'Buka Blokir'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsBroadcastWarning(false);
                                    setWarningTargetStudent(student);
                                    setShowWarningModal(true);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-medium text-amber-300 bg-amber-950/60 border border-amber-800 hover:bg-amber-900/60 rounded-lg cursor-pointer"
                                >
                                  Tegur
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: LAYAR QR CODE (For Projector / Big Screen Classroom Display)
         ========================================================================= */}
      {selectedQrRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-[#0b1324] border border-slate-800 rounded-3xl w-full max-w-lg p-6 md:p-8 shadow-2xl text-white text-center space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-base text-white">Layar QR Ujian Siswa</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQrRoom(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Room Info */}
            <div>
              <h2 className="text-xl font-extrabold text-white">{selectedQrRoom.title}</h2>
              <p className="text-xs text-slate-400 mt-1">
                {selectedQrRoom.subject || 'Umum'} · {selectedQrRoom.grade || 'SMP'}
              </p>
            </div>

            {/* QR Code Graphic Box */}
            <div className="bg-white p-5 rounded-2xl inline-block mx-auto shadow-xl border-4 border-slate-800">
              {qrModalDataUrl ? (
                <img
                  src={qrModalDataUrl}
                  alt="QR Code Ujian Siswa"
                  className="w-56 h-56 object-contain mx-auto"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-slate-800 text-xs">
                  Membuat QR Code...
                </div>
              )}
            </div>

            {/* Big Token Display */}
            <div className="bg-[#0e172a] border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
              <div className="text-left">
                <span className="block text-[11px] text-slate-400 uppercase font-semibold">Kode Token Ujian</span>
                <span className="text-2xl font-mono font-black text-indigo-300 tracking-widest">
                  {selectedQrRoom.token}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyQrToken}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isCopiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopiedToken ? 'Tersalin' : 'Salin Token'}</span>
              </button>
            </div>

            {/* Instructions */}
            <p className="text-xs text-slate-400 leading-relaxed">
              Siswa cukup membuka kamera ponsel atau tablet dan memindai QR di atas untuk langsung masuk ke portal ujian anti-curang.
            </p>

            {/* Modal Bottom Buttons */}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleCopyQrUrl}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isCopiedQrLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopiedQrLink ? 'Tautan Tersalin' : 'Salin Tautan'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRoomToken(selectedQrRoom.token);
                  setSelectedQrRoom(null);
                }}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Buka Pantauan Live</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: KIRIM PERINGATAN (Warning Broadcast / Individual)
         ========================================================================= */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-[#0b1324] border border-amber-900/60 rounded-2xl w-full max-w-md p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/70 border border-amber-800/60 text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {isBroadcastWarning ? 'Peringatan ke Semua Siswa' : `Teguran ke ${warningTargetStudent?.name}`}
                </h3>
                <p className="text-xs text-slate-400">
                  Peringatan akan bergetar dan muncul melayang di layar ponsel/laptop siswa.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Isi Pesan Peringatan
              </label>
              <textarea
                value={warningText}
                onChange={(e) => setWarningText(e.target.value)}
                rows={3}
                className="w-full text-xs bg-[#0e172a] border border-slate-800 rounded-xl p-3 text-white focus:outline-hidden focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowWarningModal(false)}
                className="px-3.5 py-2 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSendWarning}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors cursor-pointer shadow-xs"
              >
                Kirim Peringatan Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
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
