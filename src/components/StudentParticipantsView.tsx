import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Users,
  UserPlus,
  Upload,
  Download,
  FileSpreadsheet,
  Search,
  Edit3,
  Trash2,
  Check,
  X,
  AlertTriangle,
  ShieldCheck,
  Lock,
  Hash,
  BookOpen,
  DoorOpen,
} from 'lucide-react';
import { StudentParticipantAccount } from '../types';

interface StudentParticipantsViewProps {
  students: StudentParticipantAccount[];
  strictParticipantMode: boolean;
  onToggleStrictMode: (nextValue: boolean) => Promise<void> | void;
  onCreateStudent: (
    payload: Omit<StudentParticipantAccount, 'id' | 'createdAt'>
  ) => Promise<{ success: boolean; message?: string }>;
  onBulkImportStudents: (
    items: Array<Omit<StudentParticipantAccount, 'id' | 'createdAt'>>
  ) => Promise<{ success: boolean; addedCount?: number; updatedCount?: number; message?: string }>;
  onUpdateStudent: (
    id: string,
    updates: Partial<Omit<StudentParticipantAccount, 'id' | 'createdAt'>>
  ) => Promise<{ success: boolean; message?: string }>;
  onDeleteStudent: (id: string) => Promise<{ success: boolean; message?: string }>;
  onClearStudents: (kelas?: string) => Promise<{ success: boolean; message?: string }>;
}

interface ParsedExcelPreview {
  fileName: string;
  validItems: Array<Omit<StudentParticipantAccount, 'id' | 'createdAt'>>;
  skippedCount: number;
  detectedColumns: {
    name?: string;
    nisn?: string;
    kelas?: string;
    ruang?: string;
    pin?: string;
    status?: string;
  };
}

export const StudentParticipantsView: React.FC<StudentParticipantsViewProps> = ({
  students,
  strictParticipantMode,
  onToggleStrictMode,
  onCreateStudent,
  onBulkImportStudents,
  onUpdateStudent,
  onDeleteStudent,
  onClearStudents,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Directory filters & pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [kelasFilter, setKelasFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Aktif' | 'Nonaktif'>('all');
  const [visibleLimit, setVisibleLimit] = useState(30);

  // Manual form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nisn, setNisn] = useState('');
  const [kelas, setKelas] = useState('');
  const [ruang, setRuang] = useState('');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'Aktif' | 'Nonaktif'>('Aktif');

  // Upload & preview states
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [excelPreview, setExcelPreview] = useState<ParsedExcelPreview | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);

  // Action & confirm states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3800);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setNisn('');
    setKelas('');
    setRuang('');
    setPin('');
    setStatus('Aktif');
    setFormError(null);
  };

  const handleStartEdit = (student: StudentParticipantAccount) => {
    setEditingId(student.id);
    setName(student.name);
    setNisn(student.nisn);
    setKelas(student.kelas);
    setRuang(student.ruang || '');
    setPin(student.pin || '');
    setStatus(student.status);
    setFormError(null);
  };

  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = name.trim();
    const cleanNisn = nisn.trim();
    const cleanKelas = kelas.trim() || '-';

    if (!cleanName) {
      setFormError('Nama lengkap peserta wajib diisi.');
      return;
    }
    if (!cleanNisn) {
      setFormError('NISN / Nomor Peserta wajib diisi.');
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        const res = await onUpdateStudent(editingId, {
          name: cleanName,
          nisn: cleanNisn,
          kelas: cleanKelas,
          ruang: ruang.trim(),
          pin: pin.trim(),
          status,
        });
        if (!res.success) {
          setFormError(res.message || 'Gagal memperbarui data peserta.');
        } else {
          showToast(`Data peserta "${cleanName}" berhasil diperbarui.`);
          resetForm();
        }
      } else {
        const res = await onCreateStudent({
          name: cleanName,
          nisn: cleanNisn,
          kelas: cleanKelas,
          ruang: ruang.trim(),
          pin: pin.trim(),
          status,
          source: 'manual',
        });
        if (!res.success) {
          setFormError(res.message || 'Gagal menambahkan peserta ujian.');
        } else {
          showToast(`Peserta "${cleanName}" berhasil ditambahkan.`);
          resetForm();
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Download Excel Template
  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'Nama Lengkap': 'Ahmad Raihan Pratama',
        NISN: '0089283741',
        Kelas: 'VII-A',
        'Ruang Ujian': 'Ruang 01',
        PIN: '1234',
        Status: 'Aktif',
      },
      {
        'Nama Lengkap': 'Nadia Putri Maharani',
        NISN: '0089283742',
        Kelas: 'VII-A',
        'Ruang Ujian': 'Ruang 01',
        PIN: '1234',
        Status: 'Aktif',
      },
      {
        'Nama Lengkap': 'Bagas Setiawan',
        NISN: '0089283743',
        Kelas: 'VII-B',
        'Ruang Ujian': 'Ruang 02',
        PIN: '',
        Status: 'Aktif',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    worksheet['!cols'] = [
      { wch: 28 },
      { wch: 16 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Peserta Ujian');
    XLSX.writeFile(workbook, 'Template_Peserta_Ujian_Soalpintar.xlsx');
    showToast('Template Excel peserta ujian berhasil diunduh.');
  };

  // Export Existing Students to Excel
  const handleExportExcel = () => {
    if (students.length === 0) {
      showToast('Belum ada data peserta untuk diekspor.');
      return;
    }
    const exportRows = students.map((s, idx) => ({
      No: idx + 1,
      'Nama Lengkap': s.name,
      NISN: s.nisn,
      Kelas: s.kelas,
      'Ruang Ujian': s.ruang || '',
      PIN: s.pin || '',
      Status: s.status,
      Sumber: s.source === 'excel' ? 'Upload Excel' : 'Input Manual',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 16 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Daftar Peserta');
    XLSX.writeFile(workbook, `Daftar_Peserta_Ujian_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`Berhasil mengekspor ${students.length} peserta ujian ke Excel.`);
  };

  // Parse Uploaded Excel File
  const processExcelFile = async (file: File) => {
    setExcelError(null);
    setExcelPreview(null);
    setIsParsingExcel(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setExcelError('File Excel tidak memiliki sheet yang dapat dibaca.');
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      if (!rows || rows.length === 0) {
        setExcelError('File Excel kosong atau tidak memiliki baris data peserta.');
        return;
      }

      const headers = Object.keys(rows[0]);
      const findCol = (patterns: RegExp[]) =>
        headers.find((h) => patterns.some((re) => re.test(h.trim())));

      const colName = findCol([
        /^nama\s*lengkap$/i,
        /^nama\s*peserta$/i,
        /^nama\s*siswa$/i,
        /^nama$/i,
        /nama/i,
        /^name$/i,
      ]);
      const colNisn = findCol([
        /^nisn$/i,
        /nisn/i,
        /no\.?\s*peserta/i,
        /nomor\s*peserta/i,
        /nomor\s*induk/i,
        /^nis$/i,
        /^username$/i,
        /^id$/i,
      ]);
      const colKelas = findCol([/^kelas$/i, /kelas/i, /rombel/i, /class/i]);
      const colRuang = findCol([/^ruang/i, /sesi/i, /room/i]);
      const colPin = findCol([/^pin$/i, /pass/i, /sandi/i, /kode\s*akses/i]);
      const colStatus = findCol([/^status$/i, /ket/i]);

      if (!colName || !colNisn) {
        setExcelError(
          `Kolom wajib tidak ditemukan. Pastikan file memiliki kolom "Nama Lengkap" dan "NISN" (Kolom terdeteksi: ${headers.join(', ')}).`
        );
        return;
      }

      const validItems: Array<Omit<StudentParticipantAccount, 'id' | 'createdAt'>> = [];
      let skippedCount = 0;

      for (const row of rows) {
        const rawName = String(row[colName] ?? '').trim();
        const rawNisn = String(row[colNisn] ?? '').trim();
        if (!rawName || !rawNisn) {
          skippedCount += 1;
          continue;
        }
        const rawKelas = colKelas ? String(row[colKelas] ?? '').trim() || '-' : '-';
        const rawRuang = colRuang ? String(row[colRuang] ?? '').trim() : '';
        const rawPin = colPin ? String(row[colPin] ?? '').trim() : '';
        const rawStatus = colStatus ? String(row[colStatus] ?? '').trim().toLowerCase() : 'aktif';

        validItems.push({
          name: rawName,
          nisn: rawNisn,
          kelas: rawKelas,
          ruang: rawRuang,
          pin: rawPin,
          status: rawStatus === 'nonaktif' || rawStatus === 'tidak aktif' ? 'Nonaktif' : 'Aktif',
          source: 'excel',
        });
      }

      if (validItems.length === 0) {
        setExcelError('Tidak ada baris peserta valid (Nama dan NISN kosong di seluruh baris).');
        return;
      }

      setExcelPreview({
        fileName: file.name,
        validItems,
        skippedCount,
        detectedColumns: {
          name: colName,
          nisn: colNisn,
          kelas: colKelas,
          ruang: colRuang,
          pin: colPin,
          status: colStatus,
        },
      });
    } catch (err: any) {
      setExcelError('Gagal membaca file Excel: ' + (err?.message || 'Format tidak didukung.'));
    } finally {
      setIsParsingExcel(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processExcelFile(file);
    }
    e.target.value = '';
  };

  const handleConfirmImportExcel = async () => {
    if (!excelPreview || excelPreview.validItems.length === 0) return;
    setIsImporting(true);
    try {
      const res = await onBulkImportStudents(excelPreview.validItems);
      if (res.success) {
        showToast(
          `Import Excel selesai: ${res.addedCount || 0} peserta baru ditambahkan, ${res.updatedCount || 0} diperbarui.`
        );
        setExcelPreview(null);
      } else {
        setExcelError(res.message || 'Gagal menyimpan hasil import Excel.');
      }
    } finally {
      setIsImporting(false);
    }
  };

  // Computed metrics & filters
  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (s.kelas && s.kelas !== '-') set.add(s.kelas);
    }
    return Array.from(set).sort();
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (kelasFilter !== 'all' && s.kelas !== kelasFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.nisn.toLowerCase().includes(q) ||
        s.kelas.toLowerCase().includes(q) ||
        (s.ruang || '').toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, kelasFilter, statusFilter]);

  const displayedStudents = filteredStudents.slice(0, visibleLimit);
  const activeCount = students.filter((s) => s.status === 'Aktif').length;
  const inactiveCount = students.length - activeCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span>Administrasi Sekolah</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-500 dark:text-slate-400 font-normal">
              Sinkron dengan Portal Login Peserta Ujian
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mt-1">
            Peserta Ujian &amp; Upload Excel
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Unggah daftar siswa dari file Excel (.xlsx / .xls / .csv) untuk otomatis melengkapi data login peserta, PIN ujian, dan pembagian ruang.
          </p>
        </div>

        {/* Summary Counters */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-400">Total Peserta: </span>
            <span className="font-bold text-slate-900 dark:text-white font-mono tabular-nums">
              {students.length}
            </span>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-400">Aktif: </span>
            <span className="font-bold text-emerald-500 font-mono tabular-nums">{activeCount}</span>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800 text-xs">
            <span className="text-slate-400">Kelas: </span>
            <span className="font-bold text-indigo-400 font-mono tabular-nums">
              {uniqueClasses.length}
            </span>
          </div>
        </div>
      </div>

      {/* Excel Upload & Strict Login Settings Card */}
      <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Import Data Peserta dari File Excel
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Format kolom yang didukung: <strong className="text-slate-700 dark:text-slate-300">Nama Lengkap</strong>,{' '}
                <strong className="text-slate-700 dark:text-slate-300">NISN</strong>,{' '}
                <strong className="text-slate-700 dark:text-slate-300">Kelas</strong>,{' '}
                <span className="text-slate-400">Ruang Ujian (opsional), PIN (opsional), Status (opsional)</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-emerald-500" />
              <span>Download Template Excel</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3.5 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Daftar (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Drag & Drop Excel Upload Area */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) processExcelFile(dropped);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer ${
            isDragging
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/60 bg-slate-50/70 dark:bg-[#0e172a]/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <div className="w-11 h-11 rounded-xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mx-auto mb-3">
            <Upload className="w-5 h-5" />
          </div>
          <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
            {isParsingExcel
              ? 'Membaca isi file Excel...'
              : 'Klik untuk memilih file Excel atau seret file ke sini'}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Mendukung format .xlsx, .xls, dan .csv · NISN yang sama otomatis diperbarui tanpa duplikat
          </p>
        </div>

        {excelError && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{excelError}</span>
          </div>
        )}

        {/* Excel Preview Before Confirming Import */}
        {excelPreview && (
          <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  Pratinjau Import: {excelPreview.fileName}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  <strong className="font-mono tabular-nums">{excelPreview.validItems.length}</strong> baris siap diimpor
                  {excelPreview.skippedCount > 0 && (
                    <span> · {excelPreview.skippedCount} baris kosong dilewati</span>
                  )}{' '}
                  · Kolom: {excelPreview.detectedColumns.name}, {excelPreview.detectedColumns.nisn}
                  {excelPreview.detectedColumns.kelas ? `, ${excelPreview.detectedColumns.kelas}` : ''}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setExcelPreview(null)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImportExcel}
                  disabled={isImporting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {isImporting
                      ? 'Mengimpor...'
                      : `Simpan ${excelPreview.validItems.length} Peserta`}
                  </span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-emerald-200/80 dark:border-emerald-800/50 bg-white dark:bg-[#0b1324]">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-[#0e172a] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                  <tr>
                    <th className="py-2 px-3">Nama Lengkap</th>
                    <th className="py-2 px-3">NISN</th>
                    <th className="py-2 px-3">Kelas</th>
                    <th className="py-2 px-3">Ruang</th>
                    <th className="py-2 px-3">PIN</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {excelPreview.validItems.slice(0, 5).map((item, i) => (
                    <tr key={`${item.nisn}-${i}`}>
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {item.nisn}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{item.kelas}</td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{item.ruang || '-'}</td>
                      <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">
                        {item.pin ? '••••' : '-'}
                      </td>
                      <td className="py-2 px-3 text-emerald-600 dark:text-emerald-400 font-medium">
                        {item.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {excelPreview.validItems.length > 5 && (
                <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                  Menampilkan 5 dari {excelPreview.validItems.length} baris peserta...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Strict Validation Mode Toggle */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-500" />
              <span>Wajibkan Terdaftar di Daftar Peserta Saat Login (Mode Ketat)</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {strictParticipantMode
                ? 'Aktif: Hanya siswa dengan NISN terdaftar (dan berstatus Aktif) yang boleh masuk ujian.'
                : 'Nonaktif: NISN terdaftar akan otomatis melengkapi Nama & Kelas; siswa lain tetap bisa masuk manual.'}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={strictParticipantMode}
            onClick={() => onToggleStrictMode(!strictParticipantMode)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0 border ${
              strictParticipantMode
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {strictParticipantMode ? 'Mode Ketat: AKTIF' : 'Mode Ketat: NONAKTIF'}
          </button>
        </div>
      </div>

      {/* Main Grid: Manual Add/Edit Form (Left) + Directory Table (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Add / Edit Student Form */}
        <div className="lg:col-span-4">
          <form
            onSubmit={handleSubmitManual}
            className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <UserPlus className="w-4 h-4 text-emerald-500" />
                <span>{editingId ? 'Edit Data Peserta' : 'Tambah Peserta Manual'}</span>
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Batal</span>
                </button>
              )}
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nama Lengkap Siswa
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Ahmad Raihan Pratama"
                required
                className="w-full text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  NISN / No. Peserta
                </label>
                <div className="relative">
                  <Hash className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={nisn}
                    onChange={(e) => setNisn(e.target.value)}
                    placeholder="0089283741"
                    required
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Kelas / Rombel
                </label>
                <div className="relative">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={kelas}
                    onChange={(e) => setKelas(e.target.value)}
                    placeholder="VII-A"
                    required
                    className="w-full text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Ruang (Opsional)
                </label>
                <div className="relative">
                  <DoorOpen className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={ruang}
                    onChange={(e) => setRuang(e.target.value)}
                    placeholder="Ruang 01"
                    className="w-full text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  PIN (Opsional)
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="Contoh: 1234"
                    className="w-full text-xs font-mono bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Status Peserta
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Aktif' | 'Nonaktif')}
                className="w-full text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              >
                <option value="Aktif">Aktif (Diizinkan Ujian)</option>
                <option value="Nonaktif">Nonaktif (Ditangguhkan)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <Check className="w-4 h-4" />
              <span>
                {isSaving
                  ? 'Menyimpan...'
                  : editingId
                  ? 'Simpan Perubahan Peserta'
                  : 'Tambahkan Peserta'}
              </span>
            </button>
          </form>
        </div>

        {/* Right: Student Participants Directory */}
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-[#0b1324] border border-slate-200 dark:border-slate-800/80 rounded-2xl shadow-xs overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <Users className="w-4 h-4 text-indigo-500" />
                  <span>Daftar Peserta Ujian ({filteredStudents.length})</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {students.length > 0 &&
                    (confirmClearAll ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await onClearStudents(kelasFilter);
                            setConfirmClearAll(false);
                            showToast(
                              kelasFilter === 'all'
                                ? 'Semua daftar peserta ujian berhasil dikosongkan.'
                                : `Peserta kelas ${kelasFilter} berhasil dihapus.`
                            );
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          {kelasFilter === 'all'
                            ? 'Ya, Kosongkan Semua'
                            : `Hapus Kelas ${kelasFilter}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearAll(false)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        className="px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>
                          {kelasFilter === 'all' ? 'Kosongkan Daftar' : `Hapus Kelas ${kelasFilter}`}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setVisibleLimit(30);
                    }}
                    placeholder="Cari nama siswa, NISN, kelas, atau ruang..."
                    className="w-full text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-2 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={kelasFilter}
                    onChange={(e) => {
                      setKelasFilter(e.target.value);
                      setVisibleLimit(30);
                    }}
                    aria-label="Filter Kelas"
                    className="text-xs bg-slate-50 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="all">Semua Kelas ({uniqueClasses.length})</option>
                    {uniqueClasses.map((k) => (
                      <option key={k} value={k}>
                        Kelas {k}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#0e172a] border border-slate-200 dark:border-slate-800 rounded-xl text-xs">
                    {(['all', 'Aktif', 'Nonaktif'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          statusFilter === st
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {st === 'all'
                          ? `Semua (${students.length})`
                          : st === 'Aktif'
                          ? `Aktif (${activeCount})`
                          : `Nonaktif (${inactiveCount})`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Table */}
            {filteredStudents.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {students.length === 0
                    ? 'Belum ada data Peserta Ujian'
                    : 'Tidak ada peserta yang sesuai dengan filter pencarian'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {students.length === 0
                    ? 'Unduh template Excel di atas, isi data siswa (Nama Lengkap, NISN, Kelas), lalu unggah file Excel untuk mengimpor peserta sekaligus.'
                    : 'Coba ubah kata kunci pencarian atau filter kelas Anda.'}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-[#0e172a] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                      <tr>
                        <th className="py-3 px-4">Nama &amp; Sumber</th>
                        <th className="py-3 px-4">NISN</th>
                        <th className="py-3 px-4">Kelas</th>
                        <th className="py-3 px-4">Ruang / PIN</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {displayedStudents.map((student) => (
                        <tr
                          key={student.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {student.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {student.source === 'excel' ? 'Import Excel' : 'Input Manual'}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {student.nisn}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                            {student.kelas}
                          </td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                            <div>{student.ruang || '-'}</div>
                            {student.pin && (
                              <div className="text-[11px] font-mono text-indigo-500 dark:text-indigo-400">
                                PIN: {student.pin}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateStudent(student.id, {
                                  status: student.status === 'Aktif' ? 'Nonaktif' : 'Aktif',
                                })
                              }
                              className={`text-xs font-semibold cursor-pointer ${
                                student.status === 'Aktif'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-500 dark:text-rose-400'
                              }`}
                              title="Klik untuk ubah status Aktif/Nonaktif"
                            >
                              {student.status}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(student)}
                                title="Edit data peserta"
                                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:text-emerald-500 text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              {confirmDeleteId === student.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onDeleteStudent(student.id);
                                      setConfirmDeleteId(null);
                                      if (editingId === student.id) resetForm();
                                      showToast(`Peserta "${student.name}" dihapus.`);
                                    }}
                                    className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Hapus
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] cursor-pointer"
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(student.id)}
                                  title="Hapus peserta"
                                  className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filteredStudents.length > visibleLimit && (
                  <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((prev) => prev + 50)}
                      className="px-4 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl cursor-pointer transition-colors"
                    >
                      Muat Lebih Banyak ({filteredStudents.length - visibleLimit} tersisa)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

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
