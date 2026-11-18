import http from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
const rawEnvPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
const defaultAppPort = process.env.DEFAULT_APP_PORT ? parseInt(process.env.DEFAULT_APP_PORT, 10) : 3000;
const nginxEnvPort = process.env.NGINX_PORT ? parseInt(process.env.NGINX_PORT, 10) : NaN;
const PORT =
  Number.isFinite(rawEnvPort) && rawEnvPort !== nginxEnvPort
    ? rawEnvPort
    : Number.isFinite(defaultAppPort)
      ? defaultAppPort
      : 3000;

app.use(express.json({ limit: '10mb' }));

// Initialize Google GenAI on demand from server environment
function getGeminiClient(): GoogleGenAI | null {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: 50000,
    },
  });
}

// Real-time In-memory Store for CBT Live Sessions
export interface StudentParticipant {
  id: string;
  name: string;
  nisn: string;
  kelas: string;
  token: string;
  status: 'mengerjakan' | 'terputus' | 'diblokir' | 'selesai' | 'ruang_tunggu';
  startedAt: number;
  lastPing: number;
  violationsCount: number;
  violationsLog: Array<{
    id: string;
    timestamp: number;
    type: 'Pindah Tab' | 'Keluar Fullscreen' | 'Split Screen / Resize' | 'Aplikasi Mengambang' | 'Kombinasi Tombol Dilarang';
    penaltySeconds: number;
  }>;
  score?: number;
  totalScore?: number;
  warningMessage?: string | null;
  currentQuestionIndex?: number;
  deviceId?: string;
  deviceType?: string;
}

export interface ExamDeviceLockRecord {
  token: string;
  googleFormUrl?: string;
  deviceId: string;
  nisn: string;
  studentName: string;
  completedAt: number;
}

export interface LiveExamRoom {
  token: string;
  quizId: string;
  title: string;
  subject: string;
  grade: string;
  totalQuestions: number;
  durationMinutes: number;
  remainingSeconds: number;
  maxViolations: number;
  waitingRoomEnabled: boolean;
  isExamStarted: boolean;
  isActive?: boolean;
  expiryDateTime?: string;
  googleFormUrl: string;
  googleFormEditUrl?: string;
  driveFolderUrl?: string;
  createdAt: number;
  participants: Record<string, StudentParticipant>;
  completedLocks?: ExamDeviceLockRecord[];
  unlockedLocks?: Array<{ deviceId?: string; nisn?: string; unlockedAt: number }>;
  lastBroadcastAlert?: string | null;
}

const completedFormLocks: ExamDeviceLockRecord[] = [];

function normalizeFormLinkKey(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl.trim());
    return `${u.hostname}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

function findMatchingDeviceLock(
  token: string,
  room: LiveExamRoom | undefined,
  deviceId?: string,
  nisn?: string,
  googleFormUrl?: string
): ExamDeviceLockRecord | null {
  const cleanDevice = String(deviceId || '').trim().toLowerCase();
  const cleanNisn = String(nisn || '').trim().toLowerCase();
  const cleanForm = normalizeFormLinkKey(googleFormUrl || room?.googleFormUrl);

  if (!cleanDevice && !cleanNisn) return null;

  // 1. Check room completedLocks
  if (room?.completedLocks) {
    for (const lock of room.completedLocks) {
      const sameDevice = Boolean(cleanDevice && lock.deviceId.toLowerCase() === cleanDevice);
      const sameNisn = Boolean(cleanNisn && cleanNisn !== '-' && lock.nisn.trim().toLowerCase() === cleanNisn);
      if (sameDevice || sameNisn) return lock;
    }
  }

  // 2. Check participants marked selesai in the room
  if (room?.participants) {
    for (const p of Object.values(room.participants)) {
      if (p.status !== 'selesai') continue;
      const sameDevice = Boolean(cleanDevice && p.deviceId && p.deviceId.toLowerCase() === cleanDevice);
      const sameNisn = Boolean(cleanNisn && cleanNisn !== '-' && p.nisn.trim().toLowerCase() === cleanNisn);
      if (sameDevice || sameNisn) {
        return {
          token,
          googleFormUrl: room.googleFormUrl,
          deviceId: p.deviceId || cleanDevice,
          nisn: p.nisn,
          studentName: p.name,
          completedAt: p.lastPing,
        };
      }
    }
  }

  // 3. Check global Google Form link locks (same link repeated even with another token)
  if (cleanForm) {
    for (const lock of completedFormLocks) {
      const lockForm = normalizeFormLinkKey(lock.googleFormUrl);
      if (!lockForm || lockForm !== cleanForm) continue;
      const sameDevice = Boolean(cleanDevice && lock.deviceId.toLowerCase() === cleanDevice);
      const sameNisn = Boolean(cleanNisn && cleanNisn !== '-' && lock.nisn.trim().toLowerCase() === cleanNisn);
      if (sameDevice || sameNisn) return lock;
    }
  }

  return null;
}

const ROOMS_STATE_FILE = path.resolve(process.cwd(), '.soalpintar-rooms.json');

function createInitialSeededRooms(): Record<string, LiveExamRoom> {
  return {};
}

function loadPersistedRoomsState(): {
  rooms: Record<string, LiveExamRoom>;
  completedFormLocks: ExamDeviceLockRecord[];
} {
  try {
    if (fs.existsSync(ROOMS_STATE_FILE)) {
      const raw = fs.readFileSync(ROOMS_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const loadedRooms: Record<string, LiveExamRoom> = {};
        if (parsed.rooms && typeof parsed.rooms === 'object') {
          for (const [k, v] of Object.entries(parsed.rooms)) {
            if (!v || typeof v !== 'object') continue;
            const rec = v as any;
            const tok = String(rec.token || k || '').trim().toUpperCase();
            if (!tok) continue;
            loadedRooms[tok] = {
              ...rec,
              token: tok,
              participants: rec.participants && typeof rec.participants === 'object' ? rec.participants : {},
              completedLocks: Array.isArray(rec.completedLocks) ? rec.completedLocks : [],
              unlockedLocks: Array.isArray(rec.unlockedLocks) ? rec.unlockedLocks : [],
            };
          }
        }
        const loadedLocks = Array.isArray(parsed.completedFormLocks)
          ? parsed.completedFormLocks
          : [];
        return { rooms: loadedRooms, completedFormLocks: loadedLocks };
      }
    }
  } catch (err) {
    console.warn('Could not read persisted live rooms state:', err);
  }
  return { rooms: createInitialSeededRooms(), completedFormLocks: [] };
}

const persistedRoomsState = loadPersistedRoomsState();
const rooms: Record<string, LiveExamRoom> = persistedRoomsState.rooms;
completedFormLocks.push(...persistedRoomsState.completedFormLocks);

let persistRoomsTimer: ReturnType<typeof setTimeout> | null = null;

function persistRoomsNow() {
  if (persistRoomsTimer) {
    clearTimeout(persistRoomsTimer);
    persistRoomsTimer = null;
  }
  try {
    fs.writeFileSync(
      ROOMS_STATE_FILE,
      JSON.stringify({ rooms, completedFormLocks, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (err) {
    console.warn('Could not write persisted live rooms state:', err);
  }
}

function schedulePersistRooms(delayMs = 1500) {
  if (persistRoomsTimer) return;
  persistRoomsTimer = setTimeout(() => {
    persistRoomsTimer = null;
    persistRoomsNow();
  }, delayMs);
}

// Background timer tick down
setInterval(() => {
  let changed = false;
  for (const token in rooms) {
    const room = rooms[token];
    if (room.isExamStarted && room.isActive !== false && room.remainingSeconds > 0) {
      room.remainingSeconds -= 1;
      changed = true;
    }
    // Check disconnects if lastPing > 35 seconds
    const now = Date.now();
    for (const sid in room.participants) {
      const p = room.participants[sid];
      if (p.status === 'mengerjakan' && now - p.lastPing > 35000) {
        p.status = 'terputus';
        changed = true;
      }
    }
  }
  if (changed) {
    schedulePersistRooms(5000);
  }
}, 1000);

// Helper: Delay utility for retries
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// API 1: Generate Soal Cerdas via Gemini API with fast ThinkingConfig, Timeout & Model Failover
app.post('/api/generate-questions', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(500).json({
      success: false,
      message:
        'Kunci Gemini API (GEMINI_API_KEY) belum dikonfigurasi pada server. Silakan periksa panel Settings > Secrets.',
    });
  }

  const {
    topic = 'Sistem Tata Surya & Gerak Bumi',
    subject = 'Ilmu Pengetahuan Alam (IPA)',
    grade = 'SMP Kelas 7',
    questionType = 'pilihan_ganda',
    totalQuestions = 5,
    difficulty = 'Sedang & HOTS (Analisis)',
    notes = 'Sesuai Capaian Pembelajaran Kurikulum Merdeka',
    referenceMaterial = '',
  } = req.body || {};

  const requestedCount = Math.min(Math.max(parseInt(String(totalQuestions || 5), 10) || 5, 1), 30);

  const prompt = `Anda adalah pakar penyusun soal evaluasi pendidikan Indonesia (asesmen kurikulum nasional / Kurikulum Merdeka & K-13).
Tugas Anda: Buatlah TEPAT ${requestedCount} butir soal ${questionType} untuk:
- Mata Pelajaran: ${subject}
- Tingkat / Kelas: ${grade}
- Topik / Materi: ${topic}
- Tingkat Kesulitan: ${difficulty}
- Catatan Tambahan: ${notes}
${referenceMaterial ? `- Materi Referensi Bahan Ajar Guru:\n"""\n${referenceMaterial}\n"""\n(WAJIB mengacu dan menyesuaikan soal dengan materi referensi bahan ajar di atas)` : ''}

Ketentuan Khusus:
1. Array "questions" WAJIB berisi tepat ${requestedCount} item soal lengkap (TIDAK BOLEH kosong).
2. Pilihan Ganda (jika ada): 4 atau 5 opsi (A, B, C, D atau E) dengan 1 kunci jawaban yang benar dan pengecoh (distractor) yang berkualitas dan masuk akal.
3. Setiap butir soal WAJIB memiliki:
   - Pertanyaan (stimulus yang jelas dan kontekstual)
   - Opsi jawaban (untuk pilihan ganda)
   - Kunci Jawaban
   - Pembahasan mendalam (konseptual, sistematis, dan mudah dipahami siswa)
   - Indikator Kompetensi / Level Kognitif (misal: C2 Pemahaman, C3 Aplikasi, C4 Analisis / HOTS)
   - Bobot Poin nilai (misal: 10 atau 20)

Berikan format JSON terstruktur sesuai schema.`;

  const baseSchemaConfig = {
    systemInstruction:
      'Anda adalah asisten AI resmi Soalpintar.ai yang ahli dalam kurikulum pendidikan Indonesia. Hasilkan output murni JSON tanpa markdown tambahan dan pastikan array questions selalu terisi lengkap sesuai jumlah soal yang diminta.',
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Judul Paket Soal Ujian' },
        subject: { type: Type.STRING },
        grade: { type: Type.STRING },
        topic: { type: Type.STRING },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              number: { type: Type.INTEGER },
              type: { type: Type.STRING, description: 'pilihan_ganda | isian | uraian' },
              stimulus: { type: Type.STRING, description: 'Teks stimulus, bacaan, atau pengantar soal' },
              question: { type: Type.STRING, description: 'Pertanyaan utama' },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING, description: 'A, B, C, D, atau E' },
                    text: { type: Type.STRING },
                  },
                  required: ['key', 'text'],
                },
              },
              correctAnswer: { type: Type.STRING, description: 'Kunci jawaban yang benar' },
              explanation: { type: Type.STRING, description: 'Penjelasan dan pembahasan mendalam' },
              cognitiveLevel: { type: Type.STRING, description: 'C1/C2/C3/C4/C5/C6 atau HOTS' },
              points: { type: Type.INTEGER },
            },
            required: ['number', 'type', 'question', 'correctAnswer', 'explanation', 'cognitiveLevel', 'points'],
          },
        },
      },
      required: ['title', 'subject', 'grade', 'topic', 'questions'],
    },
  };

  const isLargeBatch = requestedCount > 6;
  const attemptsPlan = [
    { model: 'gemini-4-hydrogen', timeoutMs: isLargeBatch ? 22000 : 18000, thinkingLevel: ThinkingLevel.LOW },
    { model: 'gemini-3.1-flash-lite', timeoutMs: 36000, thinkingLevel: ThinkingLevel.MINIMAL },
  ];

  let lastError: any = null;
  let lastStatus = 503;
  let clientClosed = false;
  let activeController: AbortController | null = null;
  const attemptNotes: string[] = [];

  const onResClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      activeController?.abort();
    }
  };
  res.on('close', onResClose);

  try {
    for (let i = 0; i < attemptsPlan.length; i++) {
      if (clientClosed) break;

      const plan = attemptsPlan[i];
      const controller = new AbortController();
      activeController = controller;
      let timedOut = false;
      const attemptStart = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        console.log(`[Gemini API Request] Step ${i + 1}/${attemptsPlan.length} on model '${plan.model}'...`);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error(`Request ke ${plan.model} melebihi batas waktu ${plan.timeoutMs}ms`));
          }, plan.timeoutMs);
        });

        const genPromise = ai.models.generateContent({
          model: plan.model,
          contents: prompt,
          config: {
            ...baseSchemaConfig,
            abortSignal: controller.signal,
            thinkingConfig: { thinkingLevel: plan.thinkingLevel },
          },
        });
        genPromise.catch(() => {});

        const response = await Promise.race([genPromise, timeoutPromise]);

        const rawText = (response.text || '').trim();
        if (!rawText) {
          throw new Error('Respons Gemini API kosong.');
        }

        const parsed = JSON.parse(rawText);
        if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          throw new Error('Model tidak menghasilkan daftar butir soal (questions kosong).');
        }

        const elapsedMs = Date.now() - attemptStart;
        console.log(`[Gemini API Success] Generated ${parsed.questions.length} questions via '${plan.model}' in ${elapsedMs}ms.`);
        return res.json({ success: true, data: parsed, usedModel: plan.model, elapsedMs });
      } catch (err: any) {
        if (clientClosed) break;
        lastError = err;
        const elapsedMs = Date.now() - attemptStart;
        const numericCode = Number(err?.status || err?.code);
        const errMsg = String(err?.message || err || '');

        if (numericCode === 400 || errMsg.includes('API_KEY_INVALID')) {
          lastStatus = 400;
        } else if (numericCode === 403 || errMsg.includes('PERMISSION_DENIED')) {
          lastStatus = 403;
        } else if (numericCode === 404 || errMsg.includes('NOT_FOUND')) {
          lastStatus = 404;
        } else if (numericCode === 429 || errMsg.includes('RESOURCE_EXHAUSTED')) {
          lastStatus = 429;
        } else if (timedOut) {
          lastStatus = 504;
        } else {
          lastStatus = 503;
        }

        attemptNotes.push(`${plan.model}:${lastStatus}(${elapsedMs}ms): ${errMsg.slice(0, 160)}`);
        console.log(
          `[Gemini API Fallback Info] Step ${i + 1} ('${plan.model}') ${
            timedOut ? `timeout ${plan.timeoutMs}ms` : `status ${lastStatus}: ${errMsg}`
          }`
        );

        // Immediate stop for invalid/unauthorized API key
        if (lastStatus === 403 || (lastStatus === 400 && errMsg.includes('API_KEY_INVALID'))) {
          break;
        }

        if (i < attemptsPlan.length - 1) {
          await sleep(300);
        }
      } finally {
        if (timer) clearTimeout(timer);
        if (activeController === controller) {
          activeController = null;
        }
      }
    }
  } finally {
    res.off('close', onResClose);
  }

  if (clientClosed || res.writableEnded) {
    return;
  }

  const rawMsg = String(lastError?.message || '');
  let friendlyMessage =
    'Layanan AI Gemini sedang sibuk atau mengalami gangguan sementara (503). Silakan klik "Generate Soal Cerdas Sekarang" kembali.';

  if (lastStatus === 403 || (lastStatus === 400 && rawMsg.includes('API_KEY_INVALID'))) {
    friendlyMessage =
      'API Key Gemini tidak valid atau ditolak (400/403). Silakan periksa API key pada panel Settings > Secrets.';
  } else if (lastStatus === 429) {
    friendlyMessage =
      'Batas kuota permintaan Gemini API sedang penuh (429). Silakan tunggu beberapa detik lalu coba kembali, atau periksa kuota di Settings > Secrets.';
  } else if (lastStatus === 404) {
    friendlyMessage = 'Model AI yang diminta tidak tersedia (404). Silakan muat ulang dan coba lagi.';
  } else if (lastStatus === 504) {
    friendlyMessage =
      'Proses pembuatan soal melebihi batas waktu server (504). Coba kurangi jumlah soal atau klik "Generate Soal Cerdas Sekarang" kembali.';
  }

  return res.status(lastStatus).json({
    success: false,
    message: friendlyMessage,
    code: lastStatus,
    attempts: attemptNotes,
  });
});

// API 2: Export Google Apps Script (GAS) Generator
app.post('/api/generate-gas-script', (req: Request, res: Response) => {
  try {
    const { title, questions } = req.body;
    const formTitle = title || 'Kuis Soalpintar.ai';

    const gasCode = `/**
 * Google Apps Script - Otomatisasi Pembuatan Google Form Kuis
 * Dihasilkan oleh Soalpintar.ai (v2-soalpintar.ai)
 *
 * CARA MENGGUNAKAN:
 * 1. Buka script.google.com di browser Anda.
 * 2. Buat "Project Baru" (New Project).
 * 3. Hapus kode bawaan, lalu Tempel (Paste) seluruh kode di bawah ini.
 * 4. Klik tombol "Simpan" (Ctrl+S) lalu klik tombol "Jalankan" (Run).
 * 5. Berikan izin otorisasi Google Drive / Forms saat diminta pertama kali.
 * 6. Formulir kuis otomatis tersimpan di Google Drive Anda beserta kunci jawabannya!
 */

function buatKuisOtomatisSoalpintar() {
  // 1. Buat Google Form baru
  var form = FormApp.create(${JSON.stringify(formTitle + ' [Soalpintar.ai]')});
  form.setDescription("Asesmen ini disinkronkan dengan Portal Ujian Aman Anti-Curang Soalpintar.ai.\\nHarap kerjakan dengan teliti dan jujur.");
  form.setIsQuiz(true);
  form.setCollectEmail(true);
  form.setRequireLogin(false); // Bisa diubah true jika wajib akun belajar.id

  // 2. Tambahkan Data Identitas Siswa
  form.addTextItem().setTitle("Nama Lengkap Siswa").setRequired(true);
  form.addTextItem().setTitle("Nomor Induk Siswa / NISN").setRequired(true);
  form.addTextItem().setTitle("Kelas / Rombel").setRequired(true);
  form.addTextItem().setTitle("Token Akses Ujian (Misal: ZJT0P4M)").setRequired(true);

  // 3. Tambahkan Section Lembar Soal
  form.addPageBreakItem().setTitle("Lembar Pengerjaan Soal Asesmen");

  var qList = ${JSON.stringify(questions || [])};

  for (var i = 0; i < qList.length; i++) {
    var q = qList[i];
    var fullPrompt = "";
    if (q.stimulus && q.stimulus.trim() !== "") {
      fullPrompt += q.stimulus + "\\n\\n";
    }
    fullPrompt += q.question;

    if (q.type === 'pilihan_ganda' && q.options && q.options.length > 0) {
      var mcItem = form.addMultipleChoiceItem();
      mcItem.setTitle(fullPrompt).setPoints(q.points || 10).setRequired(true);

      var choices = [];
      var feedback = FormApp.createFeedback()
        .setText("Pembahasan: " + (q.explanation || "Kunci jawaban: " + q.correctAnswer))
        .build();

      var ansNorm = String(q.correctAnswer || "").trim().toUpperCase();
      for (var j = 0; j < q.options.length; j++) {
        var opt = q.options[j];
        var keyNorm = String(opt.key || "").trim().toUpperCase();
        var textNorm = String(opt.text || "").trim().toUpperCase();
        var isCorrect = (ansNorm !== "" && (keyNorm === ansNorm || textNorm === ansNorm || ansNorm.indexOf(keyNorm + ".") === 0));
        choices.push(mcItem.createChoice(opt.key + ". " + opt.text, isCorrect));
      }
      mcItem.setChoices(choices);
      mcItem.setFeedbackForCorrect(feedback);
      mcItem.setFeedbackForIncorrect(feedback);
    } else {
      // Isian Singkat atau Uraian
      var textItem = form.addParagraphTextItem();
      textItem.setTitle(fullPrompt).setPoints(q.points || 20).setRequired(true);
      var textFeedback = FormApp.createFeedback()
        .setText("Pedoman Jawaban & Pembahasan: " + (q.explanation || q.correctAnswer))
        .build();
      textItem.setGeneralFeedback(textFeedback);
    }
  }

  Logger.log("✅ Berhasil membuat Google Form Kuis!");
  Logger.log("🔗 Tautan Pengerjaan Siswa: " + form.getPublishedUrl());
  Logger.log("✏️ Tautan Editor Guru: " + form.getEditUrl());
}
`;

    return res.json({ success: true, script: gasCode, formTitle });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

function parseGasJsonSafe(text: string): { ok: boolean; data: any; errorMessage?: string } {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      data: null,
      errorMessage: 'Web App Google Apps Script mengembalikan respons kosong.',
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { ok: true, data: parsed };
  } catch {
    const looksLikeHtml = trimmed.startsWith('<') || /<html/i.test(trimmed);
    return {
      ok: false,
      data: { raw: trimmed.slice(0, 500) },
      errorMessage: looksLikeHtml
        ? 'Web App Google Apps Script mengembalikan halaman HTML/login, bukan JSON. Pastikan URL berakhir "/exec", deployment diatur "Execute as: Me" & "Who has access: Anyone", lalu Deploy > Manage deployments > New version.'
        : 'Respons dari Web App bukan JSON yang valid.',
    };
  }
}

// Persistent Store for Google Apps Script Web App & Code.gs Settings
export interface PersistedGasSettings {
  webAppUrl: string;
  guruName: string;
  apiSecret: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  customCodeGs: string;
  updatedAt: string | null;
}

const GAS_SETTINGS_FILE = path.resolve(process.cwd(), '.soalpintar-gas-settings.json');

function loadPersistedGasSettings(): PersistedGasSettings {
  const defaults: PersistedGasSettings = {
    webAppUrl: '',
    guruName: 'Apendi Mukdor, S.Pd.',
    apiSecret: '',
    shuffleQuestions: true,
    shuffleOptions: false,
    customCodeGs: '',
    updatedAt: null,
  };
  try {
    if (fs.existsSync(GAS_SETTINGS_FILE)) {
      const raw = fs.readFileSync(GAS_SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          webAppUrl: typeof parsed.webAppUrl === 'string' ? parsed.webAppUrl : defaults.webAppUrl,
          guruName:
            typeof parsed.guruName === 'string' && parsed.guruName.trim()
              ? parsed.guruName
              : defaults.guruName,
          apiSecret: typeof parsed.apiSecret === 'string' ? parsed.apiSecret : '',
          shuffleQuestions:
            typeof parsed.shuffleQuestions === 'boolean'
              ? parsed.shuffleQuestions
              : defaults.shuffleQuestions,
          shuffleOptions:
            typeof parsed.shuffleOptions === 'boolean'
              ? parsed.shuffleOptions
              : defaults.shuffleOptions,
          customCodeGs: typeof parsed.customCodeGs === 'string' ? parsed.customCodeGs : '',
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        };
      }
    }
  } catch (err) {
    console.warn('Could not read persisted GAS settings:', err);
  }
  return defaults;
}

let persistedGasSettings: PersistedGasSettings = loadPersistedGasSettings();

function savePersistedGasSettings(next: PersistedGasSettings): PersistedGasSettings {
  persistedGasSettings = next;
  try {
    fs.writeFileSync(GAS_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write persisted GAS settings:', err);
  }
  return persistedGasSettings;
}

// API 2a: Get / Save Google Apps Script Web App & Code.gs Settings (Survives logout & reload)
app.get('/api/gas/settings', (_req: Request, res: Response) => {
  return res.json({ success: true, settings: persistedGasSettings });
});

const handleUpsertGasSettings = (req: Request, res: Response) => {
  const body = req.body || {};
  const next: PersistedGasSettings = {
    webAppUrl:
      body.webAppUrl !== undefined ? String(body.webAppUrl || '').trim() : persistedGasSettings.webAppUrl,
    guruName:
      body.guruName !== undefined
        ? String(body.guruName || '').trim() || 'Guru'
        : persistedGasSettings.guruName,
    apiSecret:
      body.apiSecret !== undefined ? String(body.apiSecret || '').trim() : persistedGasSettings.apiSecret,
    shuffleQuestions:
      body.shuffleQuestions !== undefined
        ? Boolean(body.shuffleQuestions)
        : persistedGasSettings.shuffleQuestions,
    shuffleOptions:
      body.shuffleOptions !== undefined
        ? Boolean(body.shuffleOptions)
        : persistedGasSettings.shuffleOptions,
    customCodeGs:
      body.customCodeGs !== undefined ? String(body.customCodeGs || '') : persistedGasSettings.customCodeGs,
    updatedAt: new Date().toISOString(),
  };

  savePersistedGasSettings(next);
  return res.json({ success: true, settings: persistedGasSettings });
};

app.put('/api/gas/settings', handleUpsertGasSettings);
app.post('/api/gas/settings', handleUpsertGasSettings);

app.post('/api/gas/settings/sync', (req: Request, res: Response) => {
  const body = req.body || {};
  const hasServerSaved = Boolean(persistedGasSettings.updatedAt || persistedGasSettings.webAppUrl);
  if (!hasServerSaved) {
    const clientUrl = String(body.webAppUrl || '').trim();
    const clientCustomCode = String(body.customCodeGs || '');
    const clientSecret = String(body.apiSecret || '').trim();
    if (clientUrl || clientCustomCode || clientSecret) {
      savePersistedGasSettings({
        webAppUrl: clientUrl,
        guruName: String(body.guruName || '').trim() || persistedGasSettings.guruName,
        apiSecret: clientSecret,
        shuffleQuestions:
          body.shuffleQuestions !== undefined
            ? Boolean(body.shuffleQuestions)
            : persistedGasSettings.shuffleQuestions,
        shuffleOptions:
          body.shuffleOptions !== undefined
            ? Boolean(body.shuffleOptions)
            : persistedGasSettings.shuffleOptions,
        customCodeGs: clientCustomCode,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return res.json({ success: true, settings: persistedGasSettings });
});

// API 2b: Test Connection to Google Apps Script Web App (Code.gs v3.6)
app.post('/api/gas/test-connection', async (req: Request, res: Response) => {
  try {
    const { webAppUrl, token } = req.body || {};
    const cleanUrl = String(webAppUrl || '').trim();
    if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/macros/s/')) {
      return res.status(400).json({
        success: false,
        message: 'URL Web App tidak valid. Format harus: https://script.google.com/macros/s/.../exec',
      });
    }

    const resolvedToken = String(token || persistedGasSettings.apiSecret || '').trim();

    // Uji via POST { action: 'ping', token } agar token tidak berada di URL dan API_SECRET ikut tervalidasi (v3.6)
    const pingPayload: Record<string, any> = { action: 'ping' };
    if (resolvedToken) {
      pingPayload.token = resolvedToken;
    }

    const postRes = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pingPayload),
      redirect: 'follow',
    });

    const postText = await postRes.text();
    const postParsed = parseGasJsonSafe(postText);

    if (postRes.ok && postParsed.ok && postParsed.data) {
      const data = postParsed.data;
      if (data.status === 'ok' || data.status === 'success') {
        const ver = String(data.version || data.script_version || '3.6');
        return res.json({
          success: true,
          message: 'Koneksi ke Web App Google Apps Script & validasi token berhasil terhubung!',
          data,
          version: ver,
          needsScriptUpdate: ver !== '3.6',
        });
      }
      if (data.code === 'unauthorized') {
        return res.status(401).json({
          success: false,
          message:
            data.message ||
            'Otorisasi gagal. Pastikan API Secret di Pengaturan Web App sama persis dengan Script Property API_SECRET di Apps Script.',
          data,
          version: data.version || data.script_version || '3.6',
        });
      }
    }

    // Fallback ke GET ?action=version untuk Web App versi < 3.6 yang belum mendukung POST action
    const tokenParam = resolvedToken ? `&token=${encodeURIComponent(resolvedToken)}` : '';
    const testUrl = cleanUrl.includes('?')
      ? `${cleanUrl}&action=version${tokenParam}`
      : `${cleanUrl}?action=version${tokenParam}`;
    const response = await fetch(testUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const text = await response.text();
    const parsed = parseGasJsonSafe(text);
    if (!response.ok || !parsed.ok) {
      return res.status(400).json({
        success: false,
        message: parsed.errorMessage || `Web App mengembalikan status HTTP ${response.status}.`,
        data: parsed.data,
      });
    }

    const data = parsed.data || {};
    if (data.status === 'error') {
      return res.status(400).json({
        success: false,
        message: data.message || 'Web App mengembalikan error.',
        data,
      });
    }

    const detectedVer = String(data.version || data.script_version || '3.5.2');
    return res.json({
      success: true,
      message:
        detectedVer === '3.6'
          ? 'Koneksi ke Web App Google Apps Script v3.6 berhasil terhubung!'
          : `Web App v${detectedVer} terhubung. Disarankan memperbarui Code.gs ke v3.6 untuk keamanan & fitur terbaru.`,
      data,
      version: detectedVer,
      needsScriptUpdate: detectedVer !== '3.6',
    });
  } catch (err: any) {
    console.error('GAS connection test error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghubungi Web App Google Apps Script: ' + (err.message || 'Network error'),
    });
  }
});

// API 2c: Create Google Form directly via Google Apps Script Web App
app.post('/api/gas/create-form', async (req: Request, res: Response) => {
  try {
    const {
      webAppUrl,
      token,
      title,
      quiz_id,
      guru_name = 'Guru',
      folder_name,
      questions = [],
      shuffle_questions = false,
      shuffle_options = false,
    } = req.body || {};

    const cleanUrl = String(webAppUrl || persistedGasSettings.webAppUrl || '').trim();
    if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/macros/s/')) {
      return res.status(400).json({
        success: false,
        message: 'URL Web App belum dikonfigurasi. Silakan atur di menu Pengaturan Web App.',
      });
    }

    const resolvedToken = String(token || persistedGasSettings.apiSecret || '').trim();

    // Normalisasi payload agar lolos validasi ketat v3.6 (1-200 soal, 2-10 opsi, answer integer 0-based)
    const sanitizedQuestions = (Array.isArray(questions) ? questions : [])
      .slice(0, 200)
      .map((q: any, idx: number) => {
        const cleanedText = String(q?.question || '')
          .replace(/^[\s\u00A0]*(?:undefined\s*\.?\s*|\.+\s+|(?:no\.?\s*)?\d{1,3}[\.\)\-:]\s+)+/i, '')
          .trim()
          .slice(0, 1000);
        const rawOptions = Array.isArray(q?.options) ? q.options.slice(0, 10) : [];
        const isEssay =
          q?.type === 'essay' ||
          q?.type === 'uraian' ||
          q?.type === 'isian' ||
          rawOptions.length < 2;

        if (isEssay) {
          return {
            number: q?.number !== undefined && q?.number !== null ? q.number : '',
            type: 'essay',
            question: cleanedText || `Pertanyaan ${idx + 1}`,
            options: [],
            answer: 0,
          };
        }

        const safeAnswerNum = Number(q?.answer);
        const boundedAnswer =
          Number.isInteger(safeAnswerNum) && safeAnswerNum >= 0 && safeAnswerNum < rawOptions.length
            ? safeAnswerNum
            : 0;

        return {
          number: q?.number !== undefined && q?.number !== null ? q.number : '',
          type: 'choice',
          question: cleanedText || `Pertanyaan ${idx + 1}`,
          options: rawOptions,
          answer: boundedAnswer,
        };
      });

    const payload: Record<string, any> = {
      title: String(title || 'Quiz soalpintar.ai'),
      quiz_id,
      guru_name,
      folder_name: folder_name || guru_name,
      questions: sanitizedQuestions,
      shuffle_questions: Boolean(shuffle_questions),
      shuffle_options: Boolean(shuffle_options),
    };
    if (resolvedToken) {
      payload.token = resolvedToken;
    }

    const response = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    const text = await response.text();
    const parsed = parseGasJsonSafe(text);
    if (!response.ok || !parsed.ok) {
      return res.status(400).json({
        success: false,
        message: parsed.errorMessage || `Web App mengembalikan status HTTP ${response.status}.`,
        data: parsed.data,
      });
    }

    const data = parsed.data || {};
    if (data.status === 'error') {
      return res.status(400).json({ success: false, message: data.message || 'Gagal membuat Google Form.' });
    }
    if (!data.form_url) {
      return res.status(400).json({
        success: false,
        message:
          data.message ||
          'Web App tidak mengembalikan form_url. Pastikan kode Code.gs v3.6 sudah di-Deploy sebagai New version.',
        data,
      });
    }

    const detectedVer = String(data.script_version || data.version || '');
    return res.json({
      success: true,
      data,
      form_url: data.form_url,
      edit_url: data.edit_url,
      form_id: data.form_id,
      folder: data.folder,
      updated: Boolean(data.updated),
      stale: Boolean(data.stale),
      note: data.note || '',
      needsScriptUpdate: detectedVer !== '3.6',
    });
  } catch (err: any) {
    console.error('GAS create form error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat Google Form via Web App: ' + (err.message || 'Error'),
    });
  }
});

// API 2d: Get Google Form responses & live student scores via Web App (v3.6 POST action + legacy GET fallback)
app.post('/api/gas/get-responses', async (req: Request, res: Response) => {
  try {
    const {
      webAppUrl,
      token,
      form_id,
      since,
      offset = 0,
      limit = 1000,
      summary_only,
      nocache,
    } = req.body || {};
    const cleanUrl = String(webAppUrl || persistedGasSettings.webAppUrl || '').trim();
    const cleanFormId = String(form_id || '').trim();
    const resolvedToken = String(token || persistedGasSettings.apiSecret || '').trim();

    if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/macros/s/')) {
      return res.status(400).json({
        success: false,
        message: 'URL Web App Google Apps Script belum valid.',
      });
    }

    if (!cleanFormId) {
      return res.status(400).json({ success: false, message: 'webAppUrl dan form_id wajib diisi' });
    }

    if (cleanFormId === 'e' || /^1FAIpQL/i.test(cleanFormId)) {
      return res.status(400).json({
        success: false,
        message:
          'ID yang dimasukkan berasal dari tautan siswa (/forms/d/e/1FAIpQL.../viewform). Google Apps Script membutuhkan ID Editor (/forms/d/<ID_FORM>/edit) atau Form ID dari Bank Soal.',
      });
    }

    // Prioritaskan POST action (v3.6) agar token tidak muncul di URL query string
    const postBody: Record<string, any> = {
      action: 'responses',
      form_id: cleanFormId,
      offset: Number(offset) || 0,
      limit: Number(limit) || 1000,
    };
    if (since !== undefined && since !== null && since !== '') postBody.since = since;
    if (summary_only) postBody.summary_only = true;
    if (nocache) postBody.nocache = true;
    if (resolvedToken) postBody.token = resolvedToken;

    let response = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
      redirect: 'follow',
    });

    let text = await response.text();
    let parsed = parseGasJsonSafe(text);

    // Fallback ke GET hanya jika Web App versi lama menolak POST action
    const maybeOldScript =
      !parsed.ok ||
      (parsed.data?.status === 'error' &&
        parsed.data?.code !== 'unauthorized' &&
        parsed.data?.code !== 'forbidden' &&
        parsed.data?.code !== 'no_access' &&
        String(parsed.data?.version || '') !== '3.6');

    if (maybeOldScript) {
      const params = new URLSearchParams({
        action: 'responses',
        form_id: cleanFormId,
        offset: String(Number(offset) || 0),
        limit: String(Number(limit) || 1000),
      });
      if (since) params.set('since', String(since));
      if (summary_only) params.set('summary_only', '1');
      if (nocache) params.set('nocache', '1');
      if (resolvedToken) params.set('token', resolvedToken);

      const separator = cleanUrl.includes('?') ? '&' : '?';
      const fetchUrl = `${cleanUrl}${separator}${params.toString()}`;
      response = await fetch(fetchUrl, {
        method: 'GET',
        redirect: 'follow',
      });
      text = await response.text();
      parsed = parseGasJsonSafe(text);
    }

    if (!response.ok || !parsed.ok) {
      return res.status(400).json({
        success: false,
        message: parsed.errorMessage || `Web App mengembalikan status HTTP ${response.status}.`,
        data: parsed.data,
      });
    }

    const data = parsed.data || {};
    if (data.status === 'error') {
      return res.status(400).json({
        success: false,
        message: data.message || 'Google Form tidak ditemukan atau tidak dapat diakses.',
        data,
      });
    }

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('GAS get responses error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil respons dari Google Form: ' + (err.message || 'Error'),
    });
  }
});

// API 2e: Configure shuffle questions & shuffle options on a linked Google Form via Apps Script (set_shuffle)
app.post('/api/gas/set-shuffle', async (req: Request, res: Response) => {
  try {
    const {
      webAppUrl,
      token,
      form_id,
      questions = false,
      options = false,
    } = req.body || {};

    const cleanUrl = String(webAppUrl || persistedGasSettings.webAppUrl || '').trim();
    const cleanFormId = String(form_id || '').trim();
    const resolvedToken = String(token || persistedGasSettings.apiSecret || '').trim();

    if (!cleanUrl || !cleanUrl.startsWith('https://script.google.com/macros/s/')) {
      return res.status(400).json({
        success: false,
        message: 'URL Web App Google Apps Script belum valid. Silakan atur di Setting Web App (Code.gs).',
      });
    }

    if (!cleanFormId) {
      return res.status(400).json({
        success: false,
        message: 'ID Google Form wajib diisi sebelum menyimpan pengaturan acak.',
      });
    }

    if (cleanFormId === 'e' || /^1FAIpQL/i.test(cleanFormId)) {
      return res.status(400).json({
        success: false,
        message: 'Link yang dimasukkan adalah tautan siswa (/forms/d/e/...). Gunakan link editor (/forms/d/<ID>/edit).',
      });
    }

    const postBody: Record<string, any> = {
      action: 'set_shuffle',
      form_id: cleanFormId,
      questions: Boolean(questions),
      options: Boolean(options),
    };
    if (resolvedToken) postBody.token = resolvedToken;

    let response = await fetch(cleanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
      redirect: 'follow',
    });

    let text = await response.text();
    let parsed = parseGasJsonSafe(text);

    const maybeOldScript =
      !parsed.ok ||
      (parsed.data?.status === 'error' &&
        parsed.data?.code !== 'unauthorized' &&
        parsed.data?.code !== 'forbidden' &&
        String(parsed.data?.version || '') !== '3.6');

    if (maybeOldScript) {
      const params = new URLSearchParams({
        action: 'set_shuffle',
        form_id: cleanFormId,
        questions: questions ? '1' : '0',
        options: options ? '1' : '0',
      });
      if (resolvedToken) params.set('token', resolvedToken);
      const separator = cleanUrl.includes('?') ? '&' : '?';
      response = await fetch(`${cleanUrl}${separator}${params.toString()}`, {
        method: 'GET',
        redirect: 'follow',
      });
      text = await response.text();
      parsed = parseGasJsonSafe(text);
    }

    if (!response.ok || !parsed.ok) {
      return res.status(400).json({
        success: false,
        message: parsed.errorMessage || `Web App mengembalikan status HTTP ${response.status}.`,
        data: parsed.data,
      });
    }

    const data = parsed.data || {};
    if (data.status === 'error') {
      return res.status(400).json({
        success: false,
        message: data.message || 'Gagal menerapkan pengaturan acak di Google Form.',
        data,
      });
    }

    return res.json({
      success: true,
      data,
      shuffle_questions: Boolean(data.shuffle_questions),
      shuffle_options: Boolean(data.shuffle_options),
      options_message: data.options_message || '',
    });
  } catch (err: any) {
    console.error('GAS set shuffle error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan pengaturan acak ke Google Form: ' + (err.message || 'Error'),
    });
  }
});

function isRoomExpired(room: LiveExamRoom): boolean {
  if (!room.expiryDateTime) return false;
  const ts = new Date(room.expiryDateTime).getTime();
  return Number.isFinite(ts) && ts > 0 && Date.now() > ts;
}

// API 3: Get Room / Token Info
app.get('/api/rooms/:token', (req: Request, res: Response) => {
  const token = req.params.token.toUpperCase();
  const viewer = String(req.query.viewer || '').toLowerCase();
  const room = rooms[token];
  if (!room) {
    return res.status(404).json({ success: false, notFound: true, message: 'Token ujian tidak ditemukan atau telah kedaluwarsa.' });
  }
  if (viewer === 'teacher') {
    return res.json({ success: true, room });
  }
  if (room.isActive === false) {
    return res.status(403).json({ success: false, paused: true, message: 'Token ujian sedang dijeda sementara oleh pengawas.', room });
  }
  if (isRoomExpired(room)) {
    return res.status(403).json({ success: false, expired: true, message: 'Masa berlaku token ujian telah berakhir.', room });
  }
  return res.json({ success: true, room });
});

// API 3b: Check if Device ID / Identity is already locked for this exam token or Google Form link
app.get('/api/rooms/:token/check-device', (req: Request, res: Response) => {
  const token = req.params.token.toUpperCase();
  const room = rooms[token];
  const deviceId = String(req.query.deviceId || '').trim().toLowerCase();
  const nisn = String(req.query.nisn || '').trim().toLowerCase();
  const googleFormUrl = String(req.query.googleFormUrl || '').trim();
  const localCompletedAt = Number(req.query.localCompletedAt || 0);

  if (room?.isActive === false) {
    return res.json({
      success: true,
      locked: false,
      paused: true,
      message: 'Token ujian sedang dijeda sementara oleh pengawas.',
    });
  }
  if (room && isRoomExpired(room)) {
    return res.json({
      success: true,
      locked: false,
      expired: true,
      message: 'Masa berlaku token ujian telah berakhir.',
    });
  }

  const lock = findMatchingDeviceLock(token, room, deviceId, nisn, googleFormUrl);

  let unlockedByTeacher = false;
  if (!lock && room?.unlockedLocks && localCompletedAt > 0) {
    unlockedByTeacher = room.unlockedLocks.some((u) => {
      const matchDev = Boolean(deviceId && u.deviceId && u.deviceId.toLowerCase() === deviceId);
      const matchNisn = Boolean(nisn && nisn !== '-' && u.nisn && u.nisn.toLowerCase() === nisn);
      return (matchDev || matchNisn) && u.unlockedAt > localCompletedAt;
    });
  }

  return res.json({
    success: true,
    locked: Boolean(lock),
    unlockedByTeacher,
    lockInfo: lock,
  });
});

// API 4: Create or Update Exam Room
app.post('/api/rooms', (req: Request, res: Response) => {
  try {
    const {
      token,
      title,
      subject,
      grade,
      totalQuestions = 0,
      durationMinutes = 90,
      maxViolations = 3,
      waitingRoomEnabled = false,
      isExamStarted,
      isActive,
      expiryDateTime,
      googleFormUrl,
      googleFormEditUrl,
      driveFolderUrl,
    } = req.body;

    const normalizedToken = String(token || Math.random().toString(36).substring(2, 9)).trim().toUpperCase();
    if (!normalizedToken) {
      return res.status(400).json({ success: false, message: 'Kode token tidak boleh kosong.' });
    }
    const existing = rooms[normalizedToken];
    const safeTotalQ = Math.max(
      0,
      Number.isFinite(Number(totalQuestions)) ? Number(totalQuestions) : 0
    );
    const safeDuration = Math.max(0, Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : 90);
    const safeMaxViolations = Math.max(1, Number(maxViolations) || 3);

    const remainingSeconds = existing
      ? existing.durationMinutes === safeDuration
        ? existing.remainingSeconds
        : safeDuration * 60
      : safeDuration * 60;

    rooms[normalizedToken] = {
      token: normalizedToken,
      quizId: existing?.quizId || 'quiz-' + Date.now(),
      title: String(title || existing?.title || 'Asesmen Ujian Berbasis Komputer'),
      subject: String(subject || existing?.subject || 'Umum'),
      grade: String(grade || existing?.grade || 'Kelas VII'),
      totalQuestions: safeTotalQ,
      durationMinutes: safeDuration,
      remainingSeconds,
      maxViolations: safeMaxViolations,
      waitingRoomEnabled: Boolean(waitingRoomEnabled),
      isExamStarted:
        isExamStarted !== undefined ? Boolean(isExamStarted) : !Boolean(waitingRoomEnabled),
      isActive: isActive !== undefined ? Boolean(isActive) : (existing?.isActive ?? true),
      expiryDateTime:
        expiryDateTime !== undefined ? String(expiryDateTime || '') : (existing?.expiryDateTime || ''),
      googleFormUrl:
        googleFormUrl !== undefined ? String(googleFormUrl || '') : (existing?.googleFormUrl || ''),
      googleFormEditUrl:
        googleFormEditUrl !== undefined ? String(googleFormEditUrl || '') : (existing?.googleFormEditUrl || ''),
      driveFolderUrl: String(
        driveFolderUrl || existing?.driveFolderUrl || 'https://drive.google.com/drive/folders/v2-soalpintar-ai'
      ),
      createdAt: existing?.createdAt || Date.now(),
      participants: existing?.participants || {},
      completedLocks: existing?.completedLocks || [],
      unlockedLocks: existing?.unlockedLocks || [],
      lastBroadcastAlert: existing?.lastBroadcastAlert ?? null,
    };

    persistRoomsNow();
    return res.json({ success: true, room: rooms[normalizedToken] });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// API 5: Student Join / Ping / Violation Sync
app.post('/api/rooms/:token/student-sync', (req: Request, res: Response) => {
  const token = req.params.token.toUpperCase();
  const room = rooms[token];
  if (!room) {
    return res.status(404).json({ success: false, message: 'Token tidak valid' });
  }
  if (room.isActive === false) {
    return res.status(403).json({ success: false, paused: true, message: 'Token ujian sedang dijeda sementara oleh guru.' });
  }
  if (isRoomExpired(room)) {
    return res.status(403).json({ success: false, expired: true, message: 'Masa berlaku token ujian telah berakhir.' });
  }

  const {
    studentId,
    name,
    nisn,
    kelas,
    status,
    newViolation,
    score,
    totalScore,
    currentQuestionIndex,
    deviceId,
    deviceType,
    googleFormUrl,
    bypassDeviceLock,
  } = req.body;

  if (!bypassDeviceLock && status !== 'selesai') {
    const existingLock = findMatchingDeviceLock(token, room, deviceId, nisn, googleFormUrl);
    if (existingLock) {
      return res.json({
        success: true,
        alreadyCompleted: true,
        lockInfo: existingLock,
        roomRemainingSeconds: room.remainingSeconds,
        isExamStarted: room.isExamStarted,
      });
    }
  }

  let participant = room.participants[studentId];

  if (!participant) {
    participant = {
      id: studentId,
      name: name || 'Siswa CBT',
      nisn: nisn || '-',
      kelas: kelas || '-',
      token: token,
      status: room.waitingRoomEnabled && !room.isExamStarted ? 'ruang_tunggu' : 'mengerjakan',
      startedAt: Date.now(),
      lastPing: Date.now(),
      violationsCount: 0,
      violationsLog: [],
      currentQuestionIndex: 1,
      deviceId: deviceId ? String(deviceId) : undefined,
      deviceType: deviceType ? String(deviceType) : undefined,
    };
    room.participants[studentId] = participant;
  }

  // Update ping and data
  participant.lastPing = Date.now();
  if (deviceId) participant.deviceId = String(deviceId);
  if (deviceType) participant.deviceType = String(deviceType);
  if (currentQuestionIndex !== undefined) participant.currentQuestionIndex = currentQuestionIndex;
  if (score !== undefined) participant.score = score;
  if (totalScore !== undefined) participant.totalScore = totalScore;

  if (newViolation) {
    participant.violationsCount += 1;
    participant.violationsLog.push({
      id: 'v-' + Date.now(),
      timestamp: Date.now(),
      type: newViolation.type,
      penaltySeconds: newViolation.penaltySeconds || 10,
    });

    if (participant.violationsCount >= room.maxViolations) {
      participant.status = 'diblokir';
    }
  }

  if (status && participant.status !== 'diblokir') {
    participant.status = status;
  }

  // Lock device + identity when exam is submitted
  if (status === 'selesai' && !bypassDeviceLock) {
    const cleanDevice = String(deviceId || participant.deviceId || '').trim().toLowerCase();
    const lockRecord: ExamDeviceLockRecord = {
      token,
      googleFormUrl: googleFormUrl || room.googleFormUrl || '',
      deviceId: cleanDevice,
      nisn: String(nisn || participant.nisn || '-').trim(),
      studentName: String(name || participant.name || 'Siswa CBT').trim(),
      completedAt: Date.now(),
    };
    if (!room.completedLocks) room.completedLocks = [];
    const alreadyInRoom = room.completedLocks.some(
      (l) =>
        (cleanDevice && l.deviceId.toLowerCase() === cleanDevice) ||
        (lockRecord.nisn !== '-' && l.nisn.toLowerCase() === lockRecord.nisn.toLowerCase())
    );
    if (!alreadyInRoom && cleanDevice) {
      room.completedLocks.push(lockRecord);
    }
    const formKey = normalizeFormLinkKey(lockRecord.googleFormUrl);
    if (formKey && cleanDevice) {
      const alreadyInForm = completedFormLocks.some(
        (l) =>
          normalizeFormLinkKey(l.googleFormUrl) === formKey &&
          l.deviceId.toLowerCase() === cleanDevice
      );
      if (!alreadyInForm) {
        completedFormLocks.push(lockRecord);
      }
    }
  }

  const responseWarning = participant.warningMessage || room.lastBroadcastAlert || null;
  // Clear warning after delivered
  if (participant.warningMessage) participant.warningMessage = null;

  schedulePersistRooms(status === 'selesai' || newViolation ? 100 : 2000);

  return res.json({
    success: true,
    participant,
    roomRemainingSeconds: room.remainingSeconds,
    isExamStarted: room.isExamStarted,
    warningMessage: responseWarning,
    isBlocked: participant.status === 'diblokir',
  });
});

// API 6: Teacher Actions (Peringatan, Izinkan Ulang, Perpanjang Waktu)
app.post('/api/rooms/:token/actions', (req: Request, res: Response) => {
  const token = req.params.token.toUpperCase();
  const room = rooms[token];
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room tidak ditemukan' });
  }

  const { action, studentId, message, addMinutes } = req.body;

  if (action === 'send_warning') {
    if (studentId && room.participants[studentId]) {
      room.participants[studentId].warningMessage = message || 'Peringatan Pengawas: Fokus pada lembar ujian Anda!';
    } else {
      room.lastBroadcastAlert = message || 'Peringatan Umum Pengawas: Tetap tertib dalam mengerjakan ujian!';
    }
    persistRoomsNow();
    return res.json({ success: true, message: 'Peringatan berhasil dikirim.' });
  }

  if (action === 'reset_unblock' || action === 'reset_device_lock') {
    const targetDeviceId = String(req.body.deviceId || '').trim().toLowerCase();
    const targetNisn = String(req.body.nisn || '').trim().toLowerCase();

    if (studentId && room.participants[studentId]) {
      const p = room.participants[studentId];
      const pDevice = (p.deviceId || targetDeviceId || '').toLowerCase();
      const pNisn = (p.nisn || targetNisn || '').toLowerCase();

      if (room.completedLocks) {
        room.completedLocks = room.completedLocks.filter(
          (l) =>
            !(
              (pDevice && l.deviceId.toLowerCase() === pDevice) ||
              (pNisn && pNisn !== '-' && l.nisn.toLowerCase() === pNisn)
            )
        );
      }

      for (let i = completedFormLocks.length - 1; i >= 0; i--) {
        const l = completedFormLocks[i];
        if (
          (pDevice && l.deviceId.toLowerCase() === pDevice) ||
          (pNisn && pNisn !== '-' && l.nisn.toLowerCase() === pNisn)
        ) {
          completedFormLocks.splice(i, 1);
        }
      }

      p.status = 'mengerjakan';
      p.violationsCount = 0;
      p.lastPing = Date.now();
      if (!room.unlockedLocks) room.unlockedLocks = [];
      room.unlockedLocks.push({ deviceId: pDevice, nisn: pNisn, unlockedAt: Date.now() });
      persistRoomsNow();
      return res.json({
        success: true,
        message: `Akses & kunci perangkat untuk ${p.name} berhasil dibuka ulang.`,
      });
    }

    if (targetDeviceId || targetNisn) {
      if (room.completedLocks) {
        room.completedLocks = room.completedLocks.filter(
          (l) =>
            !(
              (targetDeviceId && l.deviceId.toLowerCase() === targetDeviceId) ||
              (targetNisn && targetNisn !== '-' && l.nisn.toLowerCase() === targetNisn)
            )
        );
      }
      for (let i = completedFormLocks.length - 1; i >= 0; i--) {
        const l = completedFormLocks[i];
        if (
          (targetDeviceId && l.deviceId.toLowerCase() === targetDeviceId) ||
          (targetNisn && targetNisn !== '-' && l.nisn.toLowerCase() === targetNisn)
        ) {
          completedFormLocks.splice(i, 1);
        }
      }
      if (!room.unlockedLocks) room.unlockedLocks = [];
      room.unlockedLocks.push({
        deviceId: targetDeviceId,
        nisn: targetNisn,
        unlockedAt: Date.now(),
      });
      persistRoomsNow();
      return res.json({ success: true, message: 'Kunci perangkat berhasil di-reset.' });
    }

    return res.status(400).json({ success: false, message: 'Siswa atau perangkat tidak ditemukan' });
  }

  if (action === 'extend_time') {
    const mins = Number(addMinutes) || 15;
    room.durationMinutes = Math.max(1, room.durationMinutes + mins);
    room.remainingSeconds = Math.max(0, room.remainingSeconds + mins * 60);
    persistRoomsNow();
    return res.json({ success: true, remainingSeconds: room.remainingSeconds, durationMinutes: room.durationMinutes });
  }

  if (action === 'set_duration') {
    const rawMins = Number(req.body.durationMinutes);
    const newMins = Number.isFinite(rawMins) ? Math.max(1, Math.min(600, Math.round(rawMins))) : room.durationMinutes;
    room.durationMinutes = newMins;
    room.remainingSeconds = newMins * 60;
    persistRoomsNow();
    return res.json({
      success: true,
      durationMinutes: room.durationMinutes,
      remainingSeconds: room.remainingSeconds,
    });
  }

  if (action === 'start_exam') {
    if (req.body.durationMinutes !== undefined) {
      const rawMins = Number(req.body.durationMinutes);
      if (Number.isFinite(rawMins) && rawMins >= 1) {
        const newMins = Math.min(600, Math.round(rawMins));
        room.durationMinutes = newMins;
        room.remainingSeconds = newMins * 60;
      }
    }
    room.isExamStarted = true;
    for (const sid in room.participants) {
      if (room.participants[sid].status === 'ruang_tunggu') {
        room.participants[sid].status = 'mengerjakan';
      }
    }
    persistRoomsNow();
    return res.json({
      success: true,
      isExamStarted: true,
      durationMinutes: room.durationMinutes,
      remainingSeconds: room.remainingSeconds,
    });
  }

  if (action === 'pause_exam') {
    room.isExamStarted = false;
    persistRoomsNow();
    return res.json({ success: true, isExamStarted: false });
  }

  if (action === 'set_exam_started') {
    room.isExamStarted = Boolean(req.body.isExamStarted);
    if (room.isExamStarted) {
      for (const sid in room.participants) {
        if (room.participants[sid].status === 'ruang_tunggu') {
          room.participants[sid].status = 'mengerjakan';
        }
      }
    }
    persistRoomsNow();
    return res.json({ success: true, isExamStarted: room.isExamStarted });
  }

  if (action === 'set_active') {
    room.isActive = Boolean(req.body.isActive);
    persistRoomsNow();
    return res.json({ success: true, isActive: room.isActive });
  }

  return res.status(400).json({ success: false, message: 'Aksi tidak dikenal' });
});

// API 7: Get All Rooms for Teacher Dashboard
app.get('/api/rooms', (_req: Request, res: Response) => {
  return res.json({ success: true, rooms: Object.values(rooms) });
});

// API 7a: Synchronize persisted client tokens with server rooms (non-destructive upsert)
app.post('/api/rooms/sync', (req: Request, res: Response) => {
  const replaceAll = Boolean(req.body?.replaceAll);
  const incoming = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
  let mutated = false;

  const keepSet = new Set<string>();
  for (const item of incoming) {
    if (!item || typeof item !== 'object' || !item.token) continue;
    const tok = String(item.token).trim().toUpperCase();
    if (!tok) continue;
    keepSet.add(tok);

    const existing = rooms[tok];
    if (existing) {
      existing.title = String(item.quizTitle || item.title || existing.title || 'Ujian CBT');
      existing.subject = String(item.subject || existing.subject || 'Umum');
      existing.grade = String(item.grade || existing.grade || 'SMP');
      existing.totalQuestions = Math.max(
        0,
        Number.isFinite(Number(item.totalQuestions))
          ? Number(item.totalQuestions)
          : existing.totalQuestions
      );
      existing.maxViolations = Math.max(1, Number(item.maxViolations ?? existing.maxViolations) || 3);
      existing.waitingRoomEnabled =
        item.waitingRoomEnabled !== undefined ? Boolean(item.waitingRoomEnabled) : existing.waitingRoomEnabled;
      existing.isExamStarted =
        item.isExamStarted !== undefined ? Boolean(item.isExamStarted) : existing.isExamStarted;
      if (item.isActive !== undefined) existing.isActive = Boolean(item.isActive);
      if (item.expiryDateTime !== undefined) existing.expiryDateTime = String(item.expiryDateTime || '');
      if (item.durationMinutes !== undefined && Number.isFinite(Number(item.durationMinutes))) {
        const nextDur = Math.max(0, Number(item.durationMinutes));
        if (existing.durationMinutes !== nextDur) {
          existing.durationMinutes = nextDur;
          existing.remainingSeconds = nextDur * 60;
        }
      }
      if (item.googleFormUrl !== undefined) existing.googleFormUrl = String(item.googleFormUrl || '');
      if (item.googleFormEditUrl !== undefined) existing.googleFormEditUrl = String(item.googleFormEditUrl || '');
      if (item.driveFolderUrl !== undefined) existing.driveFolderUrl = String(item.driveFolderUrl || existing.driveFolderUrl);
      mutated = true;
    } else {
      const dur =
        item.durationMinutes !== undefined && Number.isFinite(Number(item.durationMinutes))
          ? Math.max(0, Number(item.durationMinutes))
          : 90;
      const totalQ =
        item.totalQuestions !== undefined && Number.isFinite(Number(item.totalQuestions))
          ? Math.max(0, Number(item.totalQuestions))
          : 0;
      rooms[tok] = {
        token: tok,
        quizId: String(item.quizId || 'quiz-' + tok),
        title: String(item.quizTitle || item.title || 'Ujian CBT'),
        subject: String(item.subject || 'Umum'),
        grade: String(item.grade || 'SMP'),
        totalQuestions: totalQ,
        durationMinutes: dur,
        remainingSeconds: dur * 60,
        maxViolations: Math.max(1, Number(item.maxViolations) || 3),
        waitingRoomEnabled: Boolean(item.waitingRoomEnabled),
        isExamStarted: item.isExamStarted !== undefined ? Boolean(item.isExamStarted) : !Boolean(item.waitingRoomEnabled),
        isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
        expiryDateTime: item.expiryDateTime ? String(item.expiryDateTime) : '',
        googleFormUrl: String(item.googleFormUrl || ''),
        googleFormEditUrl: String(item.googleFormEditUrl || ''),
        driveFolderUrl: String(item.driveFolderUrl || 'https://drive.google.com'),
        createdAt: Number(item.createdAt) || Date.now(),
        participants: {},
        completedLocks: [],
        unlockedLocks: [],
        lastBroadcastAlert: null,
      };
      mutated = true;
    }
  }

  // Only prune rooms when explicitly instructed by an authoritative replaceAll request with tokens
  if (replaceAll && keepSet.size > 0) {
    for (const existingKey of Object.keys(rooms)) {
      if (!keepSet.has(existingKey)) {
        delete rooms[existingKey];
        mutated = true;
      }
    }
  }

  if (mutated) {
    persistRoomsNow();
  }

  return res.json({ success: true, rooms: Object.values(rooms) });
});

// API 7b: Delete a single Live Exam Room / Token
app.delete('/api/rooms/:token', (req: Request, res: Response) => {
  const token = req.params.token.toUpperCase();
  if (rooms[token]) {
    delete rooms[token];
  }
  for (let i = completedFormLocks.length - 1; i >= 0; i--) {
    if (completedFormLocks[i].token.toUpperCase() === token) {
      completedFormLocks.splice(i, 1);
    }
  }
  persistRoomsNow();
  return res.json({ success: true, deletedToken: token });
});

// API 8: Clear Data & Reset Logs / Live Sessions / Rooms
app.post('/api/admin/clear-data', (req: Request, res: Response) => {
  const scope = String(req.body?.scope || 'live_sessions');
  const clearRooms = Boolean(req.body?.clearRooms);
  const activeTokens = Array.isArray(req.body?.activeTokens)
    ? new Set(req.body.activeTokens.map((t: unknown) => String(t).toUpperCase()))
    : null;

  if (scope === 'violations') {
    for (const tokenKey of Object.keys(rooms)) {
      const room = rooms[tokenKey];
      for (const sid of Object.keys(room.participants || {})) {
        const p = room.participants[sid];
        p.violationsCount = 0;
        p.violationsLog = [];
        if (p.status === 'diblokir') {
          p.status = 'mengerjakan';
        }
      }
    }
  }

  if (scope === 'live_sessions') {
    for (const tokenKey of Object.keys(rooms)) {
      if (clearRooms || (activeTokens && !activeTokens.has(tokenKey))) {
        delete rooms[tokenKey];
      } else {
        rooms[tokenKey].participants = {};
        rooms[tokenKey].completedLocks = [];
        rooms[tokenKey].unlockedLocks = [];
        rooms[tokenKey].lastBroadcastAlert = null;
      }
    }
    completedFormLocks.splice(0, completedFormLocks.length);
  }

  if (scope === 'tokens' || scope === 'all') {
    for (const tokenKey of Object.keys(rooms)) {
      delete rooms[tokenKey];
    }
    completedFormLocks.splice(0, completedFormLocks.length);
  }

  if (scope === 'restore') {
    for (const tokenKey of Object.keys(rooms)) {
      delete rooms[tokenKey];
    }
    completedFormLocks.splice(0, completedFormLocks.length);
    const seeded = createInitialSeededRooms();
    for (const [k, v] of Object.entries(seeded)) {
      rooms[k] = v;
    }
  }

  persistRoomsNow();
  return res.json({ success: true, scope, roomsCount: Object.keys(rooms).length });
});

// ==========================================================
// Teacher Accounts Store & API (/api/teachers)
// ==========================================================
export interface TeacherAccountRecord {
  id: string;
  name: string;
  email: string;
  password: string;
  subject?: string;
  school?: string;
  role: 'Guru Mapel' | 'Admin Sekolah' | 'Pengawas';
  status: 'Aktif' | 'Nonaktif';
  createdAt: string;
  source?: 'portal_daftar' | 'pengaturan';
}

const registeredTeachers: TeacherAccountRecord[] = [
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

app.get('/api/teachers', (_req: Request, res: Response) => {
  return res.json({ success: true, teachers: registeredTeachers });
});

app.post('/api/teachers', (req: Request, res: Response) => {
  const { name, email, password, subject, school, role, status, source } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ success: false, message: 'Nama dan email guru yang valid wajib diisi.' });
  }
  if (!cleanPassword || cleanPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Kata sandi minimal 4 karakter.' });
  }

  const duplicate = registeredTeachers.find((t) => t.email.toLowerCase() === cleanEmail);
  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: `Email "${cleanEmail}" sudah terdaftar di sistem.`,
    });
  }

  const newTeacher: TeacherAccountRecord = {
    id: 'teacher-' + Date.now(),
    name: cleanName,
    email: cleanEmail,
    password: cleanPassword,
    subject: String(subject || '').trim(),
    school: String(school || '').trim(),
    role: role === 'Admin Sekolah' || role === 'Pengawas' ? role : 'Guru Mapel',
    status: status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
    createdAt: new Date().toISOString(),
    source: source === 'portal_daftar' ? 'portal_daftar' : 'pengaturan',
  };

  registeredTeachers.unshift(newTeacher);
  return res.json({ success: true, teacher: newTeacher, teachers: registeredTeachers });
});

app.post('/api/teachers/login', (req: Request, res: Response) => {
  const { email, password, expectedPortalRole } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  const found = registeredTeachers.find((t) => t.email.toLowerCase() === cleanEmail);
  if (!found) {
    return res.status(404).json({
      success: false,
      message: 'Email guru belum terdaftar. Silakan daftar akun baru terlebih dahulu.',
    });
  }
  if (found.status === 'Nonaktif') {
    return res.status(403).json({
      success: false,
      message: 'Akun guru ini sedang dinonaktifkan oleh Admin Sekolah.',
    });
  }
  if (found.password !== cleanPassword) {
    return res.status(401).json({
      success: false,
      message: 'Kata sandi tidak sesuai.',
    });
  }

  if (expectedPortalRole === 'admin' && found.role !== 'Admin Sekolah') {
    return res.status(403).json({
      success: false,
      message: `Akun "${found.email}" terdaftar sebagai ${found.role}. Silakan masuk melalui tab Login Guru Pengawas.`,
    });
  }
  if (expectedPortalRole === 'pengawas' && found.role === 'Admin Sekolah') {
    return res.status(403).json({
      success: false,
      message: `Akun "${found.email}" terdaftar sebagai Admin Sekolah. Silakan masuk melalui tab Login Admin Sekolah.`,
    });
  }

  return res.json({ success: true, teacher: found });
});

app.post('/api/teachers/sync', (req: Request, res: Response) => {
  const list = Array.isArray(req.body?.teachers) ? req.body.teachers : [];
  for (const item of list) {
    if (!item || !item.email || !item.name) continue;
    const emailLower = String(item.email).trim().toLowerCase();
    const exists = registeredTeachers.some((t) => t.email.toLowerCase() === emailLower);
    if (!exists) {
      registeredTeachers.push({
        id: String(item.id || 'teacher-' + Math.random().toString(36).slice(2, 8)),
        name: String(item.name).trim(),
        email: emailLower,
        password: String(item.password || 'guru123'),
        subject: item.subject ? String(item.subject) : '',
        school: item.school ? String(item.school) : '',
        role: item.role === 'Admin Sekolah' || item.role === 'Pengawas' ? item.role : 'Guru Mapel',
        status: item.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
        createdAt: item.createdAt || new Date().toISOString(),
        source: item.source === 'portal_daftar' ? 'portal_daftar' : 'pengaturan',
      });
    }
  }
  return res.json({ success: true, teachers: registeredTeachers });
});

app.patch('/api/teachers/:id', (req: Request, res: Response) => {
  const target = registeredTeachers.find((t) => t.id === req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'Pengguna guru tidak ditemukan.' });
  }

  const { name, email, password, subject, school, role, status } = req.body || {};
  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase();
    const duplicate = registeredTeachers.find((t) => t.id !== target.id && t.email.toLowerCase() === cleanEmail);
    if (duplicate) {
      return res.status(409).json({ success: false, message: `Email "${cleanEmail}" sudah dipakai akun lain.` });
    }
    if (cleanEmail) target.email = cleanEmail;
  }
  if (name !== undefined && String(name).trim()) target.name = String(name).trim();
  if (password !== undefined && String(password).length >= 4) target.password = String(password);
  if (subject !== undefined) target.subject = String(subject).trim();
  if (school !== undefined) target.school = String(school).trim();
  if (role === 'Guru Mapel' || role === 'Admin Sekolah' || role === 'Pengawas') target.role = role;
  if (status === 'Aktif' || status === 'Nonaktif') target.status = status;

  return res.json({ success: true, teacher: target, teachers: registeredTeachers });
});

app.delete('/api/teachers/:id', (req: Request, res: Response) => {
  const idx = registeredTeachers.findIndex((t) => t.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Pengguna guru tidak ditemukan.' });
  }
  if (registeredTeachers[idx].id === 'teacher-default-1') {
    return res.status(400).json({ success: false, message: 'Akun utama default tidak dapat dihapus.' });
  }
  registeredTeachers.splice(idx, 1);
  return res.json({ success: true, teachers: registeredTeachers });
});

// ==========================================================
// Student Participants Store & API (/api/students)
// ==========================================================
export interface StudentParticipantRecord {
  id: string;
  name: string;
  nisn: string;
  kelas: string;
  ruang?: string;
  pin?: string;
  status: 'Aktif' | 'Nonaktif';
  createdAt: string;
  source?: 'excel' | 'manual';
}

const STUDENTS_STATE_FILE = path.resolve(process.cwd(), '.soalpintar-students.json');

function loadPersistedStudentsState(): {
  students: StudentParticipantRecord[];
  strictParticipantMode: boolean;
} {
  try {
    if (fs.existsSync(STUDENTS_STATE_FILE)) {
      const raw = fs.readFileSync(STUDENTS_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const list: StudentParticipantRecord[] = Array.isArray(parsed.students)
          ? parsed.students
              .filter((s: any) => s && typeof s === 'object' && s.name && s.nisn)
              .map((s: any, idx: number) => ({
                id: String(s.id || `std-${idx}`),
                name: String(s.name).trim(),
                nisn: String(s.nisn).trim(),
                kelas: String(s.kelas || '-').trim(),
                ruang: s.ruang ? String(s.ruang).trim() : '',
                pin: s.pin ? String(s.pin).trim() : '',
                status: s.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
                createdAt: String(s.createdAt || new Date().toISOString()),
                source: s.source === 'excel' ? 'excel' : 'manual',
              }))
          : [];
        return {
          students: list,
          strictParticipantMode: Boolean(parsed.strictParticipantMode),
        };
      }
    }
  } catch (err) {
    console.warn('Could not read persisted students state:', err);
  }
  return { students: [], strictParticipantMode: false };
}

const persistedStudentsState = loadPersistedStudentsState();
const registeredStudents: StudentParticipantRecord[] = persistedStudentsState.students;
let strictParticipantMode = persistedStudentsState.strictParticipantMode;

function savePersistedStudentsNow() {
  try {
    fs.writeFileSync(
      STUDENTS_STATE_FILE,
      JSON.stringify(
        {
          students: registeredStudents,
          strictParticipantMode,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch (err) {
    console.warn('Could not write persisted students state:', err);
  }
}

app.get('/api/students', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    students: registeredStudents,
    strictParticipantMode,
  });
});

app.post('/api/students', (req: Request, res: Response) => {
  const { name, nisn, kelas, ruang, pin, status, source } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanNisn = String(nisn || '').trim();
  const cleanKelas = String(kelas || '').trim() || '-';

  if (!cleanName || !cleanNisn) {
    return res.status(400).json({
      success: false,
      message: 'Nama Lengkap dan NISN / No. Peserta wajib diisi.',
    });
  }

  const duplicate = registeredStudents.find(
    (s) => s.nisn.trim().toLowerCase() === cleanNisn.toLowerCase()
  );
  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: `NISN "${cleanNisn}" sudah terdaftar atas nama ${duplicate.name}.`,
    });
  }

  const created: StudentParticipantRecord = {
    id: 'std-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: cleanName,
    nisn: cleanNisn,
    kelas: cleanKelas,
    ruang: String(ruang || '').trim(),
    pin: String(pin || '').trim(),
    status: status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
    createdAt: new Date().toISOString(),
    source: source === 'excel' ? 'excel' : 'manual',
  };

  registeredStudents.unshift(created);
  savePersistedStudentsNow();
  return res.json({ success: true, student: created, students: registeredStudents });
});

app.post('/api/students/bulk', (req: Request, res: Response) => {
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  if (incoming.length === 0) {
    return res.status(400).json({ success: false, message: 'Tidak ada data peserta yang dikirim.' });
  }

  let addedCount = 0;
  let updatedCount = 0;
  const nowIso = new Date().toISOString();

  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const cleanName = String(item.name || '').trim();
    const cleanNisn = String(item.nisn || '').trim();
    const cleanKelas = String(item.kelas || '').trim() || '-';
    if (!cleanName || !cleanNisn) continue;

    const existing = registeredStudents.find(
      (s) => s.nisn.trim().toLowerCase() === cleanNisn.toLowerCase()
    );
    if (existing) {
      existing.name = cleanName;
      existing.kelas = cleanKelas;
      if (item.ruang !== undefined) existing.ruang = String(item.ruang || '').trim();
      if (item.pin !== undefined && String(item.pin).trim() !== '') {
        existing.pin = String(item.pin).trim();
      }
      if (item.status === 'Aktif' || item.status === 'Nonaktif') {
        existing.status = item.status;
      }
      existing.source = 'excel';
      updatedCount += 1;
    } else {
      registeredStudents.unshift({
        id: String(item.id || 'std-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
        name: cleanName,
        nisn: cleanNisn,
        kelas: cleanKelas,
        ruang: String(item.ruang || '').trim(),
        pin: String(item.pin || '').trim(),
        status: item.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
        createdAt: String(item.createdAt || nowIso),
        source: 'excel',
      });
      addedCount += 1;
    }
  }

  savePersistedStudentsNow();
  return res.json({
    success: true,
    addedCount,
    updatedCount,
    students: registeredStudents,
  });
});

app.post('/api/students/sync', (req: Request, res: Response) => {
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  let mutated = false;

  for (const item of incoming) {
    if (!item || !item.name || !item.nisn) continue;
    const cleanNisn = String(item.nisn).trim().toLowerCase();
    const exists = registeredStudents.some((s) => s.nisn.trim().toLowerCase() === cleanNisn);
    if (!exists) {
      registeredStudents.push({
        id: String(item.id || 'std-' + Math.random().toString(36).slice(2, 8)),
        name: String(item.name).trim(),
        nisn: String(item.nisn).trim(),
        kelas: String(item.kelas || '-').trim(),
        ruang: item.ruang ? String(item.ruang).trim() : '',
        pin: item.pin ? String(item.pin).trim() : '',
        status: item.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
        createdAt: String(item.createdAt || new Date().toISOString()),
        source: item.source === 'excel' ? 'excel' : 'manual',
      });
      mutated = true;
    }
  }

  if (typeof req.body?.strictParticipantMode === 'boolean' && registeredStudents.length === 0) {
    strictParticipantMode = req.body.strictParticipantMode;
    mutated = true;
  }

  if (mutated) {
    savePersistedStudentsNow();
  }

  return res.json({
    success: true,
    students: registeredStudents,
    strictParticipantMode,
  });
});

app.post('/api/students/settings', (req: Request, res: Response) => {
  if (typeof req.body?.strictParticipantMode === 'boolean') {
    strictParticipantMode = req.body.strictParticipantMode;
    savePersistedStudentsNow();
  }
  return res.json({ success: true, strictParticipantMode });
});

app.post('/api/students/verify', (req: Request, res: Response) => {
  const cleanNisn = String(req.body?.nisn || '').trim().toLowerCase();
  const inputPin = String(req.body?.pin || '').trim();

  if (!cleanNisn) {
    return res.status(400).json({ success: false, allowed: false, message: 'NISN wajib diisi.' });
  }

  const matched = registeredStudents.find((s) => s.nisn.trim().toLowerCase() === cleanNisn);
  if (!matched) {
    if (strictParticipantMode) {
      return res.status(403).json({
        success: false,
        allowed: false,
        message: `NISN "${req.body?.nisn}" belum terdaftar dalam daftar Peserta Ujian sekolah. Hubungi Admin Sekolah.`,
      });
    }
    return res.json({
      success: true,
      allowed: true,
      matchedStudent: null,
      strictParticipantMode,
    });
  }

  if (matched.status === 'Nonaktif') {
    return res.status(403).json({
      success: false,
      allowed: false,
      matchedStudent: matched,
      message: `Akun peserta atas nama ${matched.name} sedang dinonaktifkan oleh Admin Sekolah.`,
    });
  }

  if (matched.pin && matched.pin.trim() !== '' && matched.pin.trim() !== inputPin) {
    return res.status(401).json({
      success: false,
      allowed: false,
      requiresPin: true,
      matchedStudent: { ...matched, pin: undefined },
      message: 'PIN / Kata Sandi peserta tidak sesuai.',
    });
  }

  return res.json({
    success: true,
    allowed: true,
    matchedStudent: matched,
    strictParticipantMode,
  });
});

app.patch('/api/students/:id', (req: Request, res: Response) => {
  const target = registeredStudents.find((s) => s.id === req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'Data peserta tidak ditemukan.' });
  }

  const { name, nisn, kelas, ruang, pin, status } = req.body || {};
  if (nisn !== undefined) {
    const cleanNisn = String(nisn).trim();
    const dup = registeredStudents.find(
      (s) => s.id !== target.id && s.nisn.trim().toLowerCase() === cleanNisn.toLowerCase()
    );
    if (dup) {
      return res.status(409).json({
        success: false,
        message: `NISN "${cleanNisn}" sudah dipakai oleh ${dup.name}.`,
      });
    }
    if (cleanNisn) target.nisn = cleanNisn;
  }

  if (name !== undefined && String(name).trim()) target.name = String(name).trim();
  if (kelas !== undefined && String(kelas).trim()) target.kelas = String(kelas).trim();
  if (ruang !== undefined) target.ruang = String(ruang || '').trim();
  if (pin !== undefined) target.pin = String(pin || '').trim();
  if (status === 'Aktif' || status === 'Nonaktif') target.status = status;

  savePersistedStudentsNow();
  return res.json({ success: true, student: target, students: registeredStudents });
});

app.delete('/api/students/:id', (req: Request, res: Response) => {
  const idx = registeredStudents.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
  }
  registeredStudents.splice(idx, 1);
  savePersistedStudentsNow();
  return res.json({ success: true, students: registeredStudents });
});

app.post('/api/students/clear', (req: Request, res: Response) => {
  const kelasFilter = req.body?.kelas ? String(req.body.kelas).trim().toLowerCase() : '';
  if (kelasFilter && kelasFilter !== 'all') {
    for (let i = registeredStudents.length - 1; i >= 0; i--) {
      if (registeredStudents[i].kelas.trim().toLowerCase() === kelasFilter) {
        registeredStudents.splice(i, 1);
      }
    }
  } else {
    registeredStudents.splice(0, registeredStudents.length);
  }
  savePersistedStudentsNow();
  return res.json({ success: true, students: registeredStudents });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, status: 'healthy', timestamp: Date.now() });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (kept server alive):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection (kept server alive):', reason);
});

// Ensure unmatched /api/* routes ALWAYS return JSON instead of SPA <!doctype html>
app.use('/api', (_req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    message: 'Endpoint API tidak ditemukan.',
  });
});

// Setup Vite dev server or static serve
async function startServer() {
  const httpServer = http.createServer(app);
  let viteReady = process.env.NODE_ENV === 'production';
  let viteMiddleware: express.RequestHandler | null = null;

  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      if (viteReady && viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="id" class="dark"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="2"><title>Memuat Soalpintar.ai...</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:#e2e8f0;font-family:sans-serif"><div>Memuat server aplikasi...</div></body></html>'
        );
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Global Express error middleware so unexpected route errors never crash or return HTML for APIs
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled Express route error:', err);
    if (!res.headersSent) {
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      res.status(status).json({
        success: false,
        message: 'Terjadi kesalahan internal pada server.',
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, '0.0.0.0', () => {
      httpServer.off('error', reject);
      console.log(`🚀 Soalpintar.ai Server running at http://localhost:${PORT}`);
      resolve();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    viteMiddleware = vite.middlewares;
    viteReady = true;
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
