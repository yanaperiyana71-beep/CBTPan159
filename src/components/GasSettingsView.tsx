import React, { useState, useEffect } from 'react';
import {
  FileCode,
  Copy,
  Check,
  Download,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  Shuffle,
  Folder,
  RefreshCw,
  Sparkles,
  Info,
  Pencil,
  RotateCcw,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react';

export const EXACT_CODE_GS = String.raw`/**
 * soalpintar.ai — Google Form Creator Bridge
 *
 * VERSI 3.6 (Perbaikan Keamanan & Stabilitas)
 *
 * PERUBAHAN PENTING DARI 3.5.3:
 * - API_SECRET WAJIB diisi. Jika kosong, semua request ditolak
 *   (kecuali ?action=version). Mode terbuka hanya jika Script Property
 *   ALLOW_OPEN = 1 (tidak disarankan).
 * - Akses form dibatasi ke folder v2-soalpintar.ai milik akun ini.
 *   Untuk mengizinkan form di luar folder itu, isi Script Property
 *   ALLOW_ANY_FORM = 1.
 * - Aksi baca/pemeliharaan (responses, find_form, set_shuffle,
 *   clean_titles) kini bisa dikirim lewat POST dengan field "action"
 *   dan "token" di JSON body, supaya token tidak muncul di URL.
 *   GET lama tetap berfungsi.
 * - Payload divalidasi (1-200 soal, pertanyaan wajib terisi, 2-10 pilihan,
 *   answer harus bilangan bulat 0-based yang valid).
 * - Pesan error ke klien dibuat umum; detail ditulis ke Logger.
 * - Quiz yang sudah ada diperbarui otomatis jika soal berubah dan belum
 *   ada respons. Jika sudah ada respons, form lama dikembalikan dengan
 *   stale = true.
 * - total pada jalur forms_api_v1 kini akurat (total_exact = true) dan
 *   respons diurutkan agar paging stabil.
 * - Parameter since divalidasi, cache PUB_MAP_ dirotasi saat penuh, folder root
 *   hanya dipilih jika dimiliki akun ini.
 *
 * SCRIPT PROPERTIES:
 *   API_SECRET     (wajib)  rahasia acak, minimal 24 karakter
 *   ALLOW_OPEN     (opsional) 1 = izinkan tanpa token (tidak disarankan)
 *   ALLOW_ANY_FORM (opsional) 1 = izinkan form di luar folder root
 */

var SCRIPT_VERSION = '3.6';
var ROOT_FOLDER_NAME = 'v2-soalpintar.ai';
var MAX_QUESTIONS = 200;
var MAX_OPTIONS = 10;
var MAX_PAYLOAD_CHARS = 500000;
var MAX_PUB_MAP_KEYS = 2000;

/**
 * SHIM GOOGLE FORMS API v1 (via UrlFetchApp - Opsional)
 * Otomatis fallback ke FormApp jika Google Forms REST API belum aktif di GCP.
 */
var Forms = {
  Form: {
    get: function (formId) {
      return formsApi_('get', 'https://forms.googleapis.com/v1/forms/' + formId);
    },
    batchUpdate: function (requestBody, formId) {
      return formsApi_(
        'post',
        'https://forms.googleapis.com/v1/forms/' + formId + ':batchUpdate',
        requestBody
      );
    },
    Responses: {
      list: function (formId, opts) {
        opts = opts || {};
        var qs = [];
        if (opts.pageSize) qs.push('pageSize=' + opts.pageSize);
        if (opts.pageToken) qs.push('pageToken=' + encodeURIComponent(opts.pageToken));
        if (opts.filter) qs.push('filter=' + encodeURIComponent(opts.filter));
        var url = 'https://forms.googleapis.com/v1/forms/' + formId + '/responses' +
          (qs.length ? '?' + qs.join('&') : '');
        return formsApi_('get', url);
      }
    }
  }
};

function formsApi_(method, url, body) {
  var cache = CacheService.getScriptCache();
  if (cache.get('FORMS_REST_DISABLED') === '1') {
    throw new Error('FORMS_REST_DISABLED');
  }

  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    var text = res.getContentText();
    if (code === 403 && text.indexOf('SERVICE_DISABLED') !== -1) {
      cache.put('FORMS_REST_DISABLED', '1', 600);
    }
    throw new Error('Forms API ' + code + ': ' + text);
  }
  return JSON.parse(res.getContentText());
}

// =====================================================================
// UTILITAS KEAMANAN
// =====================================================================

function flag_(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function cleanText_(v, maxLen) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Perbandingan string dengan waktu konstan (anti timing attack). */
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Validasi token. API_SECRET wajib kecuali ALLOW_OPEN = 1.
 */
function isAuthorized(tokenFromRequest) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty('API_SECRET');
  if (!expectedSecret) {
    return props.getProperty('ALLOW_OPEN') === '1';
  }
  return safeEqual_(tokenFromRequest || '', expectedSecret);
}

function unauthorizedOut_() {
  var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  return jsonOut({
    status: 'error',
    code: 'unauthorized',
    version: SCRIPT_VERSION,
    message: secret ? 'Token API tidak valid.' : 'API_SECRET belum diatur di Script Properties.'
  });
}

function genericErrorOut_(error, context) {
  Logger.log('[' + (context || 'error') + '] ' + error);
  return jsonOut({
    status: 'error',
    code: 'server_error',
    version: SCRIPT_VERSION,
    message: 'Terjadi kesalahan pada server. Periksa log Apps Script.'
  });
}

/**
 * Folder root milik akun ini. Mengabaikan folder bernama sama yang
 * dibagikan oleh orang lain.
 */
function getRootFolder_(createIfMissing) {
  var me = '';
  try {
    me = DriveApp.getRootFolder().getOwner().getEmail();
  } catch (e) {}

  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  while (it.hasNext()) {
    var f = it.next();
    try {
      if (!me || f.getOwner().getEmail() === me) return f;
    } catch (e2) {}
  }
  return createIfMissing ? DriveApp.createFolder(ROOT_FOLDER_NAME) : null;
}

/** Apakah form berada di dalam folder root (langsung atau di folder guru)? */
function isFormInRoot_(formId) {
  if (!formId) return false;
  var cache = CacheService.getScriptCache();
  var key = 'INROOT_' + formId;
  if (cache.get(key) === '1') return true;

  var root = getRootFolder_(false);
  if (!root) return false;
  var rootId = root.getId();

  try {
    var parents = DriveApp.getFileById(formId).getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      if (parent.getId() === rootId) {
        cache.put(key, '1', 21600);
        return true;
      }
      var grand = parent.getParents();
      while (grand.hasNext()) {
        if (grand.next().getId() === rootId) {
          cache.put(key, '1', 21600);
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

function isFormAllowed_(formId) {
  if (PropertiesService.getScriptProperties().getProperty('ALLOW_ANY_FORM') === '1') return true;
  return isFormInRoot_(formId);
}

function forbiddenOut_() {
  return {
    status: 'error',
    code: 'forbidden',
    version: SCRIPT_VERSION,
    message: 'Form berada di luar folder ' + ROOT_FOLDER_NAME + '.'
  };
}

/**
 * Validasi payload pembuatan form. Mengembalikan pesan error atau null.
 */
function validatePayload_(data) {
  var qs = Array.isArray(data.questions) ? data.questions : [];
  if (qs.length === 0) return 'Minimal harus ada 1 soal dalam quiz.';
  if (qs.length > MAX_QUESTIONS) return 'Maksimal ' + MAX_QUESTIONS + ' soal per quiz.';

  for (var i = 0; i < qs.length; i++) {
    var q = qs[i] || {};
    if (!cleanText_(q.question, 1000)) {
      return 'Soal ' + (i + 1) + ': teks pertanyaan tidak boleh kosong.';
    }
    if (q.type === 'essay') continue;

    var opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2 || opts.length > MAX_OPTIONS) {
      return 'Soal ' + (i + 1) + ': jumlah pilihan harus 2 sampai ' + MAX_OPTIONS + '.';
    }
    var ansStr = String(q.answer === null || q.answer === undefined ? '' : q.answer).trim();
    if (!/^\d+$/.test(ansStr)) {
      return 'Soal ' + (i + 1) + ': kunci jawaban (answer) harus berupa bilangan bulat non-negatif.';
    }
    var idx = Number(ansStr);
    if (idx < 0 || idx >= opts.length) {
      return 'Soal ' + (i + 1) + ': kunci jawaban (answer) harus angka 0 sampai ' + (opts.length - 1) + '.';
    }
  }
  return null;
}

// =====================================================================
// UTILITAS FORM
// =====================================================================

/**
 * Membersihkan awalan "undefined.", tanda titik berlebih,
 * serta nomor urut soal (1–3 digit diikuti tanda baca + spasi wajib).
 */
function cleanQuestionTitle(str) {
  return String(str || '')
    .replace(/^[\s\u00A0]*(?:undefined\s*\.?\s*|\.+\s+|(?:no\.?\s*)?\d{1,3}[\.\)\-:]\s+)+/i, '')
    .trim();
}

function cleanExistingFormTitles(form) {
  var items = form.getItems();
  var T = FormApp.ItemType;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var tp = it.getType();
    if (tp === T.MULTIPLE_CHOICE || tp === T.PARAGRAPH_TEXT || tp === T.CHECKBOX || tp === T.LIST) {
      var curTitle = it.getTitle() || '';
      var cleaned = cleanQuestionTitle(curTitle);
      if (cleaned && cleaned !== curTitle) {
        it.setTitle(cleaned);
      }
    }
  }
}

/**
 * Menyimpan pemetaan published_id -> form_id dengan rotasi entri lama
 * agar tidak melampaui kuota Script Properties.
 */
function cacheFormMapping(form) {
  try {
    var pubUrl = form.getPublishedUrl() || '';
    var match = pubUrl.match(/\/forms\/d\/e\/([^\/]+)/);
    if (!match || !match[1]) return;

    var props = PropertiesService.getScriptProperties();
    var targetKey = 'PUB_MAP_' + match[1];
    if (props.getProperty(targetKey)) return;

    var keys = props.getKeys();
    if (keys.length >= MAX_PUB_MAP_KEYS) {
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('PUB_MAP_') === 0) {
          props.deleteProperty(keys[i]);
          break;
        }
      }
    }
    props.setProperty(targetKey, form.getId());
  } catch (e) {}
}

/**
 * Menghapus cache respons halaman pertama saat struktur/judul form diubah.
 */
function invalidateFormCache_(formId) {
  try {
    CacheService.getScriptCache().removeAll([
      'RESP_' + formId + '_0_0_1000_0',
      'RESP_' + formId + '_0_0_1000_1'
    ]);
  } catch (e) {}
}

function sanitizeChoices(rawOptions, correctIndex) {
  var list = Array.isArray(rawOptions) ? rawOptions : [];
  var targetIdx = parseInt(correctIndex, 10);
  var seen = {};
  var cleaned = [];

  for (var j = 0; j < list.length; j++) {
    var text = String(list[j] === null || list[j] === undefined ? '' : list[j]).trim();
    if (!text) text = 'Opsi ' + (j + 1);

    while (seen[text]) {
      text += '\u200B';
    }
    seen[text] = true;
    cleaned.push({
      text: text,
      isCorrect: (!isNaN(targetIdx) && j === targetIdx)
    });
  }

  if (cleaned.length === 0) {
    cleaned.push({ text: 'Pilihan A', isCorrect: true });
  }
  return cleaned;
}

/** Sidik jari isi quiz, disimpan di deskripsi form untuk mendeteksi perubahan. */
function computeRev_(title, questions, shuffleQ, shuffleO) {
  var raw = JSON.stringify([title, questions, !!shuffleQ, !!shuffleO]);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    hex += (v.length === 1 ? '0' : '') + v;
  }
  return hex.slice(0, 12);
}

/**
 * Mengisi form (deskripsi, data siswa, soal). Dipakai untuk form baru
 * maupun membangun ulang form yang belum punya respons.
 */
function populateForm_(form, ctx) {
  var questions = ctx.questions;
  var totalQuestions = questions.length;
  var pointsPerQuestion = 1;
  var remainder = 0;
  var targetTotalPoints = 100;

  if (totalQuestions > 0) {
    if (totalQuestions <= 100) {
      pointsPerQuestion = Math.floor(100 / totalQuestions);
      remainder = 100 - (pointsPerQuestion * totalQuestions);
    } else {
      targetTotalPoints = totalQuestions;
    }
  }

  form.setIsQuiz(true);

  var description = 'Quiz dibuat oleh ' + ctx.guruName + ' \n\nIsi data diri Anda di bagian pertama, lalu kerjakan soal di bagian berikutnya.';
  if (ctx.quizId) {
    description += '\n\n[Quiz ID: ' + ctx.quizId + ']';
  }
  description += '\n[Rev: ' + ctx.rev + ']';
  form.setDescription(description);

  // SECTION 1: Data Siswa
  var namaItem = form.addTextItem();
  namaItem.setTitle('Nama Lengkap');
  namaItem.setRequired(true);
  namaItem.setHelpText('Masukkan nama lengkap Anda');

  var absenItem = form.addTextItem();
  absenItem.setTitle('Nomor Absen');
  absenItem.setRequired(true);
  absenItem.setHelpText('Masukkan nomor absen Anda');

  var kelasItem = form.addTextItem();
  kelasItem.setTitle('Kelas');
  kelasItem.setRequired(true);
  kelasItem.setHelpText('Contoh: 9A, 10 IPA 2, 7B');

  // SECTION 2: Soal-Soal
  var pageBreak = form.addPageBreakItem();
  pageBreak.setTitle('Soal Ujian');
  pageBreak.setHelpText('Kerjakan soal berikut dengan teliti. Pilih satu jawaban yang paling tepat.\nTotal nilai: ' + targetTotalPoints);

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i] || {};
    var pts = pointsPerQuestion + (i < remainder ? 1 : 0);
    var cleanTitle = cleanQuestionTitle(q.question) || ('Pertanyaan ' + (i + 1));

    if (q.type === 'essay') {
      var essayItem = form.addParagraphTextItem();
      essayItem.setTitle(cleanTitle);
      essayItem.setRequired(true);
      essayItem.setPoints(pts);
    } else {
      var mcItem = form.addMultipleChoiceItem();
      mcItem.setTitle(cleanTitle);
      mcItem.setRequired(true);
      mcItem.setPoints(pts);

      var safeChoices = sanitizeChoices(q.options, q.answer);
      var choices = [];
      for (var j = 0; j < safeChoices.length; j++) {
        choices.push(mcItem.createChoice(safeChoices[j].text, safeChoices[j].isCorrect));
      }
      mcItem.setChoices(choices);
    }
  }

  return { pointsPerQuestion: pointsPerQuestion, targetTotalPoints: targetTotalPoints };
}

// =====================================================================
// ENDPOINT
// =====================================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ status: 'error', version: SCRIPT_VERSION, message: 'Payload kosong.' });
    }
    if (e.postData.contents.length > MAX_PAYLOAD_CHARS) {
      return jsonOut({ status: 'error', code: 'payload_too_large', version: SCRIPT_VERSION, message: 'Payload terlalu besar.' });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOut({ status: 'error', code: 'invalid_json', version: SCRIPT_VERSION, message: 'Payload bukan JSON yang valid.' });
    }
    if (!data || typeof data !== 'object') {
      return jsonOut({ status: 'error', code: 'invalid_json', version: SCRIPT_VERSION, message: 'Payload bukan objek JSON.' });
    }

    var urlToken = (e.parameter && e.parameter.token) || data.token;
    if (!isAuthorized(urlToken)) {
      return unauthorizedOut_();
    }

    // Aksi baca/pemeliharaan lewat POST (token tidak muncul di URL)
    if (data.action) {
      return jsonOut(safeRoute_(data));
    }

    var invalid = validatePayload_(data);
    if (invalid) {
      return jsonOut({ status: 'error', code: 'invalid_payload', version: SCRIPT_VERSION, message: invalid });
    }

    hasLock = lock.tryLock(15000);
    if (!hasLock) {
      return jsonOut({
        status: 'error',
        code: 'server_busy',
        version: SCRIPT_VERSION,
        message: 'Server sedang sibuk memproses permintaan lain. Silakan coba beberapa saat lagi.'
      });
    }

    var quizId = String(data.quiz_id || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 64);
    var title = cleanText_(data.title, 200) || 'Quiz soalpintar.ai';
    var guruName = cleanText_(data.guru_name, 100) || 'Guru';
    var folderName = cleanText_(data.folder_name, 100) || guruName;
    var questions = Array.isArray(data.questions) ? data.questions : [];
    var shuffleQ = flag_(data.shuffle_questions);
    var shuffleO = flag_(data.shuffle_options);
    var rev = computeRev_(title, questions, shuffleQ, shuffleO);
    var ctx = { title: title, guruName: guruName, quizId: quizId, rev: rev, questions: questions };

    // Folder root & folder guru
    var parentFolder = getRootFolder_(true);
    var guruFolders = parentFolder.getFoldersByName(folderName);
    var guruFolder = guruFolders.hasNext() ? guruFolders.next() : parentFolder.createFolder(folderName);

    // Cek form yang sudah pernah dibuat untuk Quiz ID ini
    if (quizId) {
      var searchName = 'Quiz: ' + title + ' [ID-' + quizId + ']';
      var files = guruFolder.getFilesByName(searchName);
      if (files.hasNext()) {
        var file = files.next();
        var existingForm = null;
        try {
          existingForm = FormApp.openById(file.getId());
        } catch (openErr) {
          existingForm = null;
        }

        if (existingForm) {
          var revMatch = String(existingForm.getDescription() || '').match(/\[Rev: ([0-9a-f]+)\]/);
          var currentRev = revMatch ? revMatch[1] : null;
          var updated = false;
          var stale = false;
          var shuffleNote = '';

          if (currentRev && currentRev !== rev) {
            if (existingForm.getResponses().length === 0) {
              // Belum ada respons: bangun ulang isi form dengan soal terbaru
              var oldItems = existingForm.getItems();
              for (var di = oldItems.length - 1; di >= 0; di--) {
                existingForm.deleteItem(di);
              }
              populateForm_(existingForm, ctx);
              var reShuffle = applyShuffle(existingForm, shuffleQ, shuffleO);
              shuffleNote = reShuffle.message;
              updated = true;
              invalidateFormCache_(existingForm.getId());
            } else {
              stale = true;
            }
          } else {
            cleanExistingFormTitles(existingForm);
          }

          cacheFormMapping(existingForm);
          return jsonOut({
            status: 'success',
            version: SCRIPT_VERSION,
            script_version: SCRIPT_VERSION,
            form_url: existingForm.getPublishedUrl(),
            edit_url: existingForm.getEditUrl(),
            form_id: existingForm.getId(),
            folder: folderName,
            is_existing: true,
            updated: updated,
            stale: stale,
            shuffle_note: shuffleNote,
            note: stale
              ? 'Soal berubah tetapi form sudah memiliki respons, jadi form lama tidak diubah.'
              : (updated ? 'Isi form diperbarui sesuai soal terbaru.' : '')
          });
        }
      }
    }

    // Buat Google Form baru
    var form = FormApp.create(title);
    var info = populateForm_(form, ctx);
    var shuffleInfo = applyShuffle(form, shuffleQ, shuffleO);

    var formFile = DriveApp.getFileById(form.getId());
    if (quizId) {
      formFile.setName('Quiz: ' + title + ' [ID-' + quizId + ']');
    }
    formFile.moveTo(guruFolder);

    cacheFormMapping(form);

    return jsonOut({
      status: 'success',
      version: SCRIPT_VERSION,
      script_version: SCRIPT_VERSION,
      form_url: form.getPublishedUrl(),
      edit_url: form.getEditUrl(),
      form_id: form.getId(),
      folder: folderName,
      total_points: info.targetTotalPoints,
      points_per_question: info.pointsPerQuestion,
      shuffle_questions: shuffleInfo.questions,
      shuffle_options: shuffleInfo.options,
      shuffle_note: shuffleInfo.message
    });

  } catch (error) {
    return genericErrorOut_(error, 'doPost');
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * doGet: aksi BACA & PEMELIHARAAN (token lewat ?token=...).
 *   ?action=version
 *   ?action=responses&form_id=ID[&since=ms][&offset=0&limit=1000&summary_only=1&nocache=1]
 *   ?action=find_form&published_id=PID
 *   ?action=set_shuffle&form_id=ID&questions=1&options=1
 *   ?action=clean_titles&form_id=ID
 * Aksi yang sama juga tersedia lewat POST dengan field "action" dan "token".
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'version') {
      return jsonOut({ status: 'ok', version: SCRIPT_VERSION, script_version: SCRIPT_VERSION });
    }
    if (!isAuthorized(p.token)) {
      return unauthorizedOut_();
    }
    return jsonOut(safeRoute_(p));
  } catch (error) {
    return genericErrorOut_(error, 'doGet');
  }
}

function safeRoute_(p) {
  try {
    return routeAction_(p);
  } catch (error) {
    Logger.log('[routeAction_] ' + error);
    return {
      status: 'error',
      code: 'server_error',
      version: SCRIPT_VERSION,
      message: 'Terjadi kesalahan pada server. Periksa log Apps Script.'
    };
  }
}

function routeAction_(p) {
  var action = String(p.action || '');

  if (action === 'version') {
    return { status: 'ok', version: SCRIPT_VERSION, script_version: SCRIPT_VERSION };
  }

  if (action === 'responses') {
    if (!p.form_id) return { status: 'error', message: 'form_id wajib diisi', version: SCRIPT_VERSION };
    if (!isFormAllowed_(p.form_id)) return forbiddenOut_();
    return getFormResponses(
      p.form_id,
      p.since,
      p.offset,
      p.limit,
      flag_(p.summary_only),
      flag_(p.nocache)
    );
  }

  if (action === 'find_form') {
    return findFormByPublishedId(p.published_id);
  }

  if (action === 'set_shuffle') {
    if (!p.form_id) return { status: 'error', message: 'form_id wajib diisi', version: SCRIPT_VERSION };
    if (!isFormAllowed_(p.form_id)) return forbiddenOut_();
    var target = FormApp.openById(p.form_id);
    var info = applyShuffle(target, flag_(p.questions), flag_(p.options));
    invalidateFormCache_(p.form_id);
    return {
      status: 'success',
      version: SCRIPT_VERSION,
      shuffle_questions: info.questions,
      shuffle_options: info.options,
      options_message: info.message
    };
  }

  if (action === 'clean_titles') {
    if (!p.form_id) return { status: 'error', message: 'form_id wajib diisi', version: SCRIPT_VERSION };
    if (!isFormAllowed_(p.form_id)) return forbiddenOut_();
    cleanExistingFormTitles(FormApp.openById(p.form_id));
    invalidateFormCache_(p.form_id);
    return {
      status: 'success',
      version: SCRIPT_VERSION,
      form_id: p.form_id,
      message: 'Judul soal berhasil dibersihkan.'
    };
  }

  return {
    status: 'ok',
    message: 'soalpintar.ai Form Creator is running!',
    version: SCRIPT_VERSION,
    script_version: SCRIPT_VERSION
  };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// RESPONS
// =====================================================================

/**
 * Ambil respons form beserta skor kuis.
 */
function getFormResponses(formId, sinceParam, offsetParam, limitParam, summaryOnly, noCache) {
  if (!formId) return { status: 'error', message: 'form_id wajib diisi', version: SCRIPT_VERSION };

  var since = null;
  if (sinceParam !== undefined && sinceParam !== null && sinceParam !== '') {
    since = Number(sinceParam);
    if (!isFinite(since) || since < 0) {
      return { status: 'error', code: 'invalid_since', message: 'Parameter since harus berupa angka milidetik.', version: SCRIPT_VERSION };
    }
  }

  var offset = Math.max(0, parseInt(offsetParam, 10) || 0);
  var limit = Math.min(2000, Math.max(1, parseInt(limitParam, 10) || 1000));
  var cacheKey = 'RESP_' + formId + '_' + (since || '0') + '_' + offset + '_' + limit + '_' + (summaryOnly ? '1' : '0');

  var cache = CacheService.getScriptCache();
  if (!noCache) {
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        var parsedCache = JSON.parse(cached);
        parsedCache.from_cache = true;
        return parsedCache;
      } catch (e) {}
    }
  }

  // Jalur Cepat: Google Forms REST API v1
  if (typeof Forms !== 'undefined' && cache.get('FORMS_REST_DISABLED') !== '1') {
    try {
      var fastResult = getResponsesViaFormsApi(formId, since, offset, limit, summaryOnly);
      if (fastResult) {
        try {
          var serialized = JSON.stringify(fastResult);
          if (serialized.length < 95000) cache.put(cacheKey, serialized, 60);
        } catch (e) {}
        return fastResult;
      }
    } catch (apiErr) {}
  }

  // Jalur Utama / Fallback: FormApp
  var form;
  try {
    form = FormApp.openById(formId);
  } catch (err) {
    return {
      status: 'error',
      code: 'no_access',
      message: 'Form tidak bisa dibuka oleh akun Google ini. Pastikan form ada di akun yang sama dengan Apps Script.',
      version: SCRIPT_VERSION
    };
  }

  var isQuiz = form.isQuiz();
  var items = form.getItems();
  var maxScore = 0;
  var itemMeta = [];
  var idItems = { name: null, absen: null, kelas: null };
  var pastIdentitySection = false;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var title = (it.getTitle() || '').toLowerCase();
    var type = it.getType();

    if (type === FormApp.ItemType.PAGE_BREAK) {
      pastIdentitySection = true;
    }

    if (!pastIdentitySection && type === FormApp.ItemType.TEXT) {
      if (!idItems.name && title.indexOf('nama') !== -1) idItems.name = it;
      else if (!idItems.absen && title.indexOf('absen') !== -1) idItems.absen = it;
      else if (!idItems.kelas && title.indexOf('kelas') !== -1) idItems.kelas = it;
    }

    if (isQuiz && offset === 0) {
      var pts = itemPoints(it);
      maxScore += pts;
      if (pts > 0) itemMeta.push(describeItem(it, pts));
    }
  }

  var responses = since ? form.getResponses(new Date(since)) : form.getResponses();
  var total = responses.length;
  var end = Math.min(total, offset + limit);
  var rows = [];

  for (var r = offset; r < end; r++) {
    var resp = responses[r];
    var rName = idItems.name ? resp.getResponseForItem(idItems.name) : null;
    var rAbsen = idItems.absen ? resp.getResponseForItem(idItems.absen) : null;
    var rKelas = idItems.kelas ? resp.getResponseForItem(idItems.kelas) : null;

    var row = {
      id: resp.getId(),
      submitted_at: resp.getTimestamp().toISOString(),
      email: resp.getRespondentEmail() || null,
      name: rName ? String(rName.getResponse() || '') : null,
      absen: rAbsen ? String(rAbsen.getResponse() || '') : null,
      kelas: rKelas ? String(rKelas.getResponse() || '') : null,
      score: null
    };

    if (isQuiz) {
      var score = 0;
      var graded = resp.getGradableItemResponses();
      if (!summaryOnly) row.answers = {};

      for (var g = 0; g < graded.length; g++) {
        var gScore = Number(graded[g].getScore() || 0);
        score += gScore;

        if (!summaryOnly) {
          var raw = graded[g].getResponse();
          row.answers[String(graded[g].getItem().getId())] = {
            r: Array.isArray(raw) ? raw.join(' | ') : (raw === null || raw === undefined ? '' : String(raw)),
            s: gScore
          };
        }
      }
      row.score = score;
    }
    rows.push(row);
  }

  var output = {
    status: 'success',
    version: SCRIPT_VERSION,
    engine: 'formapp_fast',
    form_id: form.getId(),
    title: form.getTitle(),
    is_quiz: isQuiz,
    max_score: isQuiz ? maxScore : null,
    items: offset === 0 ? itemMeta : [],
    total: total,
    total_exact: true,
    offset: offset,
    has_more: end < total,
    next_offset: end < total ? end : null,
    accepting_responses: form.isAcceptingResponses(),
    responses: rows
  };

  try {
    var outStr = JSON.stringify(output);
    if (outStr.length < 95000) cache.put(cacheKey, outStr, 60);
  } catch (e) {}

  return output;
}

/**
 * Jalur Cepat: mengambil respons via Google Forms API v1.
 * Seluruh respons diambil dan diurutkan, sehingga total akurat dan
 * paging berbasis offset konsisten.
 */
function getResponsesViaFormsApi(formId, since, offset, limit, summaryOnly) {
  var formMeta = Forms.Form.get(formId);
  var isQuiz = Boolean(formMeta.settings && formMeta.settings.quizSettings && formMeta.settings.quizSettings.isQuiz);
  var maxScore = 0;
  var itemMeta = [];
  var qIdToItemId = {};
  var idQIds = { name: null, absen: null, kelas: null };
  var pastIdentitySection = false;

  (formMeta.items || []).forEach(function (item) {
    if (item.pageBreakItem) {
      pastIdentitySection = true;
      return;
    }

    var q = item.questionItem && item.questionItem.question;
    if (!q) return;

    var qId = q.questionId;
    var decItemId = typeof BigInt !== 'undefined'
      ? BigInt('0x' + item.itemId).toString()
      : String(parseInt(item.itemId, 16));
    qIdToItemId[qId] = decItemId;

    var lowerTitle = (item.title || '').toLowerCase();
    if (!pastIdentitySection && q.textQuestion && !q.textQuestion.paragraph) {
      if (!idQIds.name && lowerTitle.indexOf('nama') !== -1) idQIds.name = qId;
      else if (!idQIds.absen && lowerTitle.indexOf('absen') !== -1) idQIds.absen = qId;
      else if (!idQIds.kelas && lowerTitle.indexOf('kelas') !== -1) idQIds.kelas = qId;
    }

    if (isQuiz && offset === 0) {
      var pts = Number((q.grading && q.grading.pointValue) || 0);
      maxScore += pts;
      if (pts > 0) {
        var choices = [];
        var correctVals = {};
        if (q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers) {
          q.grading.correctAnswers.answers.forEach(function (a) { correctVals[a.value] = true; });
        }
        if (q.choiceQuestion && q.choiceQuestion.options) {
          q.choiceQuestion.options.forEach(function (opt) {
            choices.push({ value: opt.value, correct: Boolean(correctVals[opt.value]) });
          });
        }
        itemMeta.push({
          id: decItemId,
          title: item.title || '',
          type: q.choiceQuestion ? 'MULTIPLE_CHOICE' : 'PARAGRAPH_TEXT',
          points: pts,
          choices: choices
        });
      }
    }
  });

  var allResponses = [];
  var pageToken = null;
  do {
    var listOpts = { pageSize: 5000 };
    if (since) listOpts.filter = 'timestamp >= ' + new Date(since).toISOString();
    if (pageToken) listOpts.pageToken = pageToken;

    var apiRes = Forms.Form.Responses.list(formId, listOpts);
    if (apiRes.responses && apiRes.responses.length) {
      allResponses = allResponses.concat(apiRes.responses);
    }
    pageToken = apiRes.nextPageToken || null;
  } while (pageToken);

  allResponses.sort(function (a, b) {
    var ta = String(a.lastSubmittedTime || a.createTime || '');
    var tb = String(b.lastSubmittedTime || b.createTime || '');
    return ta < tb ? -1 : (ta > tb ? 1 : 0);
  });

  var total = allResponses.length;
  var end = Math.min(total, offset + limit);
  var rows = [];

  for (var r = offset; r < end; r++) {
    var resp = allResponses[r];
    var ansMap = resp.answers || {};

    var extractText = function (qId) {
      if (!qId || !ansMap[qId] || !ansMap[qId].textAnswers || !ansMap[qId].textAnswers.answers) return null;
      return ansMap[qId].textAnswers.answers.map(function (a) { return a.value || ''; }).join(' | ');
    };

    var row = {
      id: resp.responseId,
      submitted_at: resp.lastSubmittedTime || resp.createTime,
      email: resp.respondentEmail || null,
      name: extractText(idQIds.name),
      absen: extractText(idQIds.absen),
      kelas: extractText(idQIds.kelas),
      score: isQuiz ? Number(resp.totalScore || 0) : null
    };

    if (isQuiz && !summaryOnly) {
      row.answers = {};
      Object.keys(ansMap).forEach(function (qId) {
        var decId = qIdToItemId[qId];
        if (!decId) return;
        var aObj = ansMap[qId];
        var valStr = (aObj.textAnswers && aObj.textAnswers.answers)
          ? aObj.textAnswers.answers.map(function (x) { return x.value || ''; }).join(' | ')
          : '';
        row.answers[decId] = {
          r: valStr,
          s: Number((aObj.grade && aObj.grade.score) || 0)
        };
      });
    }

    rows.push(row);
  }

  var formObj = FormApp.openById(formId);
  return {
    status: 'success',
    version: SCRIPT_VERSION,
    engine: 'forms_api_v1',
    form_id: formId,
    title: (formMeta.info && formMeta.info.title) || formObj.getTitle(),
    is_quiz: isQuiz,
    max_score: isQuiz ? maxScore : null,
    items: offset === 0 ? itemMeta : [],
    total: total,
    total_exact: true,
    offset: offset,
    has_more: end < total,
    next_offset: end < total ? end : null,
    accepting_responses: formObj.isAcceptingResponses(),
    responses: rows
  };
}

function itemPoints(it) {
  var T = FormApp.ItemType;
  switch (it.getType()) {
    case T.MULTIPLE_CHOICE: return it.asMultipleChoiceItem().getPoints();
    case T.CHECKBOX: return it.asCheckboxItem().getPoints();
    case T.LIST: return it.asListItem().getPoints();
    case T.TEXT: return it.asTextItem().getPoints();
    case T.PARAGRAPH_TEXT: return it.asParagraphTextItem().getPoints();
    case T.SCALE: return it.asScaleItem().getPoints();
    case T.DATE: return it.asDateItem().getPoints();
    case T.TIME: return it.asTimeItem().getPoints();
    case T.DATETIME: return it.asDateTimeItem().getPoints();
    case T.DURATION: return it.asDurationItem().getPoints();
    case T.GRID: return it.asGridItem().getPoints();
    case T.CHECKBOX_GRID: return it.asCheckboxGridItem().getPoints();
    default: return 0;
  }
}

function describeItem(it, points) {
  var T = FormApp.ItemType;
  var meta = { id: String(it.getId()), title: it.getTitle(), type: String(it.getType()), points: points, choices: [] };
  var choices = null;
  if (it.getType() === T.MULTIPLE_CHOICE) choices = it.asMultipleChoiceItem().getChoices();
  else if (it.getType() === T.CHECKBOX) choices = it.asCheckboxItem().getChoices();
  else if (it.getType() === T.LIST) choices = it.asListItem().getChoices();
  if (choices) {
    for (var c = 0; c < choices.length; c++) {
      meta.choices.push({ value: choices[c].getValue(), correct: choices[c].isCorrectAnswer() });
    }
  }
  return meta;
}

/**
 * Acak urutan soal & pilihan jawaban.
 */
function applyShuffle(form, shuffleQuestions, shuffleOptions) {
  var messages = [];
  var result = { questions: shuffleQuestions, options: false, message: '' };
  form.setShuffleQuestions(shuffleQuestions);

  if (shuffleQuestions) {
    messages.push('Catatan: Google Forms juga mengacak urutan isian identitas siswa (Nama/Absen/Kelas) saat acak soal aktif.');
  }

  if (!shuffleOptions) {
    result.message = messages.join(' ');
    return result;
  }

  try {
    var full = Forms.Form.get(form.getId());
    var requests = [];
    (full.items || []).forEach(function (item, index) {
      var q = item.questionItem && item.questionItem.question;
      if (q && q.choiceQuestion) {
        requests.push({
          updateItem: {
            item: { questionItem: { question: { choiceQuestion: { shuffle: true } } } },
            location: { index: index },
            updateMask: 'questionItem.question.choiceQuestion.shuffle'
          }
        });
      }
    });
    if (requests.length) Forms.Form.batchUpdate({ requests: requests }, form.getId());
    result.options = true;
  } catch (err) {
    Logger.log('[applyShuffle] ' + err);
    messages.push('Acak pilihan jawaban dilewati (Google Forms REST API tidak aktif di GCP).');
  }

  result.message = messages.join(' ');
  return result;
}

// =====================================================================
// PENCARIAN FORM
// =====================================================================

function scanFilesForPublishedId_(fileIterator, publishedId, counterObj, maxChecks) {
  while (fileIterator.hasNext() && counterObj.count < maxChecks) {
    var file = fileIterator.next();
    counterObj.count++;
    try {
      var f = FormApp.openById(file.getId());
      if ((f.getPublishedUrl() || '').indexOf(publishedId) !== -1) {
        cacheFormMapping(f);
        return f;
      }
    } catch (err) {}
  }
  return null;
}

/**
 * Cari form berdasarkan published_id. Secara bawaan hanya mencari di
 * folder root; pencarian seluruh Drive hanya jika ALLOW_ANY_FORM = 1.
 */
function findFormByPublishedId(publishedId) {
  if (!publishedId) return { status: 'error', message: 'published_id wajib diisi', version: SCRIPT_VERSION };

  var props = PropertiesService.getScriptProperties();
  var anyForm = props.getProperty('ALLOW_ANY_FORM') === '1';
  var cachedId = props.getProperty('PUB_MAP_' + publishedId);

  if (cachedId) {
    try {
      if (anyForm || isFormInRoot_(cachedId)) {
        var cachedForm = FormApp.openById(cachedId);
        return {
          status: 'success',
          version: SCRIPT_VERSION,
          form_id: cachedForm.getId(),
          title: cachedForm.getTitle(),
          is_quiz: cachedForm.isQuiz(),
          from_cache: true
        };
      }
    } catch (e) {
      props.deleteProperty('PUB_MAP_' + publishedId);
    }
  }

  var counter = { count: 0 };
  var MAX_CHECKS = 60;

  var rootFolder = getRootFolder_(false);
  if (rootFolder) {
    var foundInRoot = scanFilesForPublishedId_(
      rootFolder.getFilesByType(MimeType.GOOGLE_FORMS),
      publishedId,
      counter,
      MAX_CHECKS
    );
    if (foundInRoot) {
      return {
        status: 'success',
        version: SCRIPT_VERSION,
        form_id: foundInRoot.getId(),
        title: foundInRoot.getTitle(),
        is_quiz: foundInRoot.isQuiz()
      };
    }

    var subFolders = rootFolder.getFolders();
    while (subFolders.hasNext() && counter.count < MAX_CHECKS) {
      var sub = subFolders.next();
      var foundInSub = scanFilesForPublishedId_(
        sub.getFilesByType(MimeType.GOOGLE_FORMS),
        publishedId,
        counter,
        MAX_CHECKS
      );
      if (foundInSub) {
        return {
          status: 'success',
          version: SCRIPT_VERSION,
          form_id: foundInSub.getId(),
          title: foundInSub.getTitle(),
          is_quiz: foundInSub.isQuiz()
        };
      }
    }
  }

  if (anyForm && counter.count < MAX_CHECKS) {
    var allFiles = DriveApp.getFilesByType(MimeType.GOOGLE_FORMS);
    var foundGlobal = scanFilesForPublishedId_(allFiles, publishedId, counter, MAX_CHECKS);
    if (foundGlobal) {
      return {
        status: 'success',
        version: SCRIPT_VERSION,
        form_id: foundGlobal.getId(),
        title: foundGlobal.getTitle(),
        is_quiz: foundGlobal.isQuiz()
      };
    }
  }

  return {
    status: 'error',
    code: 'not_found',
    message: 'Form tidak ditemukan (dicek ' + counter.count + ' form).',
    version: SCRIPT_VERSION
  };
}

// =====================================================================
// UJI (jalankan dari editor, hasil di Execution log)
// =====================================================================

/**
 * Uji koneksi FormApp dan Google Forms REST API.
 */
function testFormsApi() {
  var files = DriveApp.getFilesByType(MimeType.GOOGLE_FORMS);
  if (!files.hasNext()) {
    Logger.log('[INFO] Belum ada file Google Form di Drive akun ini.');
    return;
  }

  var formId = files.next().getId();
  var form = FormApp.openById(formId);
  Logger.log('[OK] FormApp berhasil terhubung. Judul Form: ' + form.getTitle());

  try {
    CacheService.getScriptCache().remove('FORMS_REST_DISABLED');
    var f = Forms.Form.get(formId);
    Logger.log('[OK] Google Forms REST API v1 aktif. documentTitle: ' + f.info.documentTitle);
  } catch (err) {
    Logger.log('[INFO] Google Forms REST API v1 tidak aktif. Script berjalan normal dengan FormApp.');
  }
}

/**
 * Uji keamanan dasar. Aman dijalankan: tes POST hanya berjalan jika
 * API_SECRET sudah diisi (sehingga tidak ada form yang terbuat).
 */
function testSecurity() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('API_SECRET');
  var out = [];

  function check(name, ok, detail) {
    out.push((ok ? '[LULUS] ' : '[GAGAL] ') + name + (detail ? '  -> ' + detail : ''));
  }
  function get(params) {
    return JSON.parse(doGet({ parameter: params }).getContent());
  }

  check('API_SECRET sudah diisi', !!secret,
    secret ? 'panjang ' + secret.length + ' karakter' : 'semua request ditolak sampai diisi');
  if (secret) check('API_SECRET minimal 24 karakter', secret.length >= 24);
  check('ALLOW_OPEN tidak aktif', props.getProperty('ALLOW_OPEN') !== '1');
  check('ALLOW_ANY_FORM tidak aktif', props.getProperty('ALLOW_ANY_FORM') !== '1',
    props.getProperty('ALLOW_ANY_FORM') === '1' ? 'token bocor = semua form di akun terbuka' : '');

  var actions = ['responses', 'find_form', 'set_shuffle', 'clean_titles'];
  for (var i = 0; i < actions.length; i++) {
    var r = get({ action: actions[i], form_id: 'x', published_id: 'x' });
    check(actions[i] + ' tanpa token ditolak', r.code === 'unauthorized', r.code || r.message);
  }

  var wrong = get({ action: 'responses', form_id: 'x', token: 'token-salah-123' });
  check('token salah ditolak', wrong.code === 'unauthorized', wrong.code || wrong.message);

  if (secret) {
    var res = doPost({
      postData: { contents: JSON.stringify({ title: 'uji', questions: [] }) },
      parameter: {}
    });
    var p1 = JSON.parse(res.getContent());
    check('POST tanpa token ditolak', p1.code === 'unauthorized', p1.code || p1.message);

    var bad = validatePayload_({ questions: [{ type: 'mc', question: 'Contoh soal?', options: ['a', 'b'], answer: 'B' }] });
    check('answer non-angka ditolak validator', !!bad, bad || 'tidak ditolak');
  }

  Logger.log('\n' + out.join('\n'));
}
// END OF FILE`;

interface GasSettingsViewProps {
  webAppUrl: string;
  onSaveWebAppUrl: (url: string) => void;
  guruName: string;
  onSaveGuruName: (name: string) => void;
  apiSecret?: string;
  shuffleQuestions: boolean;
  onSaveShuffleQuestions: (val: boolean) => void;
  shuffleOptions: boolean;
  onSaveShuffleOptions: (val: boolean) => void;
  customCodeGs?: string;
  onSaveAllSettings?: (next: {
    webAppUrl: string;
    guruName: string;
    apiSecret: string;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    customCodeGs: string;
  }) => void;
}

export const GasSettingsView: React.FC<GasSettingsViewProps> = ({
  webAppUrl = '',
  onSaveWebAppUrl,
  guruName = 'Apendi Mukdor, S.Pd.',
  onSaveGuruName,
  apiSecret = '',
  shuffleQuestions = true,
  onSaveShuffleQuestions,
  shuffleOptions = false,
  onSaveShuffleOptions,
  customCodeGs = '',
  onSaveAllSettings,
}) => {
  const safeWebAppUrl = String(webAppUrl ?? '');
  const safeGuruName = String(guruName ?? '');
  const safeApiSecret = String(apiSecret ?? '');
  const safeCustomCodeGs = String(customCodeGs ?? '');

  const [urlInput, setUrlInput] = useState(safeWebAppUrl);
  const [nameInput, setNameInput] = useState(safeGuruName || 'Apendi Mukdor, S.Pd.');
  const [apiSecretInput, setApiSecretInput] = useState(() => {
    if (safeApiSecret) return safeApiSecret;
    try {
      return localStorage.getItem('soalpintar_gas_api_secret') || '';
    } catch {
      return '';
    }
  });
  const [shuffleQ, setShuffleQ] = useState(Boolean(shuffleQuestions));
  const [shuffleO, setShuffleO] = useState(Boolean(shuffleOptions));
  const [codeGsInput, setCodeGsInput] = useState(() => safeCustomCodeGs || EXACT_CODE_GS);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [isSecretCopied, setIsSecretCopied] = useState(false);

  const [isCopied, setIsCopied] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    version?: string;
  } | null>(null);

  const [isCreatingDemo, setIsCreatingDemo] = useState(false);
  const [demoCreatedResult, setDemoCreatedResult] = useState<{
    form_url: string;
    edit_url: string;
    form_id: string;
  } | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const savedCodeGs = safeCustomCodeGs || EXACT_CODE_GS;
  const isCustomCode = String(codeGsInput ?? '').trim() !== EXACT_CODE_GS.trim();
  const hasUnsavedChanges =
    String(urlInput ?? '').trim() !== safeWebAppUrl.trim() ||
    (String(nameInput ?? '').trim() || 'Apendi Mukdor, S.Pd.') !== (safeGuruName.trim() || 'Apendi Mukdor, S.Pd.') ||
    String(apiSecretInput ?? '').trim() !== safeApiSecret.trim() ||
    shuffleQ !== Boolean(shuffleQuestions) ||
    shuffleO !== Boolean(shuffleOptions) ||
    codeGsInput !== savedCodeGs;

  useEffect(() => {
    setUrlInput(safeWebAppUrl);
  }, [safeWebAppUrl]);

  useEffect(() => {
    setNameInput(safeGuruName || 'Apendi Mukdor, S.Pd.');
  }, [safeGuruName]);

  useEffect(() => {
    setApiSecretInput(safeApiSecret);
  }, [safeApiSecret]);

  useEffect(() => {
    setShuffleQ(Boolean(shuffleQuestions));
  }, [shuffleQuestions]);

  useEffect(() => {
    setShuffleO(Boolean(shuffleOptions));
  }, [shuffleOptions]);

  useEffect(() => {
    setCodeGsInput(safeCustomCodeGs || EXACT_CODE_GS);
  }, [safeCustomCodeGs]);

  const handleSaveSettings = () => {
    const cleanUrl = String(urlInput ?? '').trim();
    const cleanName = String(nameInput ?? '').trim() || 'Guru';
    const cleanSecret = String(apiSecretInput ?? '').trim();
    const safeCodeInput = String(codeGsInput ?? '');
    const nextCustomCode = safeCodeInput.trim() === EXACT_CODE_GS.trim() ? '' : safeCodeInput;

    if (onSaveAllSettings) {
      onSaveAllSettings({
        webAppUrl: cleanUrl,
        guruName: cleanName,
        apiSecret: cleanSecret,
        shuffleQuestions: shuffleQ,
        shuffleOptions: shuffleO,
        customCodeGs: nextCustomCode,
      });
    } else {
      onSaveWebAppUrl(cleanUrl);
      onSaveGuruName(cleanName);
      onSaveShuffleQuestions(shuffleQ);
      onSaveShuffleOptions(shuffleO);
      try {
        if (cleanSecret) {
          localStorage.setItem('soalpintar_gas_api_secret', cleanSecret);
        } else {
          localStorage.removeItem('soalpintar_gas_api_secret');
        }
        if (nextCustomCode) {
          localStorage.setItem('soalpintar_gas_custom_code_gs', nextCustomCode);
        } else {
          localStorage.removeItem('soalpintar_gas_custom_code_gs');
        }
      } catch {
        // Ignore storage error
      }
    }

    setIsEditingCode(false);
    showToast('Pengaturan URL Web App & Script Code.gs tersimpan permanen!');
  };

  const handleTestConnection = async () => {
    if (!urlInput.trim()) {
      showToast('Harap masukkan URL Web App terlebih dahulu.');
      return;
    }
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/gas/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: urlInput.trim(),
          token: apiSecretInput.trim() || undefined,
        }),
      });
      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText && !rawText.trim().startsWith('<') ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (!data) {
        setTestResult({
          success: false,
          message: `Respons Web App bukan JSON valid (HTTP ${res.status}). Pastikan Web App sudah di-Deploy ulang sebagai New version dengan akses "Anyone".`,
        });
        return;
      }
      setTestResult({
        success: Boolean(res.ok && data.success),
        message: data.message || 'Respons diterima dari Web App.',
        version: data.version || '3.6',
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Gagal terhubung ke Web App: ' + (err.message || 'Network error'),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCreateDemoQuiz = async () => {
    if (!urlInput.trim()) {
      showToast('Harap simpan dan masukkan URL Web App terlebih dahulu.');
      return;
    }
    setIsCreatingDemo(true);
    setDemoCreatedResult(null);

    try {
      const res = await fetch('/api/gas/create-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webAppUrl: urlInput.trim(),
          token: apiSecretInput.trim() || undefined,
          title: 'Tes Kuis Soalpintar.ai Bridge v3.6',
          quiz_id: 'demo-' + Date.now().toString().slice(-5),
          guru_name: nameInput.trim() || 'Guru',
          folder_name: nameInput.trim() || 'Guru',
          shuffle_questions: shuffleQ,
          shuffle_options: shuffleO,
          questions: [
            {
              type: 'choice',
              question: 'Planet apakah yang memiliki julukan Planet Merah dalam tata surya kita?',
              options: ['Merkurius', 'Venus', 'Mars', 'Jupiter'],
              answer: 2, // Mars (index 2)
            },
            {
              type: 'choice',
              question: 'Organel sel yang berfungsi sebagai tempat terjadinya respirasi seluler adalah...',
              options: ['Mitokondria', 'Ribosom', 'Kloroplas', 'Badan Golgi'],
              answer: 0, // Mitokondria
            },
            {
              type: 'essay',
              question: 'Jelaskan perbedaan mendasar antara sel tumbuhan dan sel hewan beserta fungsinya!',
              options: [],
              answer: 0,
            },
          ],
        }),
      });

      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText && !rawText.trim().startsWith('<') ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (res.ok && data?.success && data.form_url) {
        setDemoCreatedResult({
          form_url: data.form_url,
          edit_url: data.edit_url || '',
          form_id: data.form_id || '',
        });
        showToast('Form demo Google Forms berhasil dibuat!');
      } else {
        showToast('Gagal membuat demo form: ' + (data?.message || `HTTP ${res.status}`));
      }
    } catch (err: any) {
      showToast('Error: ' + err.message);
    } finally {
      setIsCreatingDemo(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(codeGsInput);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleGenerateSecret = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let generated = '';
    const arr = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(arr);
      for (let i = 0; i < arr.length; i++) {
        generated += chars[arr[i] % chars.length];
      }
    } else {
      for (let i = 0; i < 32; i++) {
        generated += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    setApiSecretInput(generated);
    setShowApiSecret(true);
    showToast('Secret 32 karakter dibuat! Salin ke Script Properties Apps Script & klik Simpan Pengaturan.');
  };

  const handleCopySecret = () => {
    if (!apiSecretInput.trim()) return;
    navigator.clipboard.writeText(apiSecretInput.trim());
    setIsSecretCopied(true);
    setTimeout(() => setIsSecretCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([codeGsInput], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Code.gs';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
            GOOGLE APPS SCRIPT BRIDGE v3.6
          </span>
          <span className="text-xs text-slate-400">· Perbaikan Keamanan, Validasi Payload &amp; Stabilitas</span>
          {hasUnsavedChanges ? (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              · Ada perubahan belum disimpan
            </span>
          ) : (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              · Tersimpan permanen (aman saat keluar/login ulang)
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
          Pengaturan URL Web App & Script Code.gs
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Hubungkan Web App Google Apps Script ke dashboard Soalpintar.ai untuk membuat formulir kuis otomatis di Google Drive Anda dan menarik hasil nilai siswa secara real-time.
        </p>
      </div>

      {/* Grid: Settings Left, Instructions & Code Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Settings Configuration */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <FileCode className="w-4 h-4 text-emerald-600" />
                <span>Konfigurasi URL Web App</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">Versi 3.6</span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  URL Web App Google Apps Script:
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Dapatkan URL ini setelah melakukan <em>Deploy &gt; New deployment &gt; Web app</em> di script.google.com
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Guru / Folder Penyimpanan di Drive:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Nama Guru atau Mapel"
                    className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block flex items-center gap-1">
                  <Folder className="w-3 h-3 text-emerald-600 inline" />
                  Disimpan ke folder Google Drive: <code className="text-emerald-600 font-mono">v2-soalpintar.ai / {nameInput || 'Guru'}</code>
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    API Secret / Token Keamanan (Wajib di v3.6):
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateSecret}
                    className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-500 flex items-center gap-1 cursor-pointer"
                    title="Buat token acak 32 karakter secara otomatis"
                  >
                    <KeyRound className="w-3 h-3" />
                    Buat Secret Acak
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={showApiSecret ? 'text' : 'password'}
                      value={apiSecretInput}
                      onChange={(e) => setApiSecretInput(e.target.value)}
                      placeholder="Minimal 24 karakter acak (wajib sama dengan Script Properties)"
                      className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 pr-9 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiSecret((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      title={showApiSecret ? 'Sembunyikan secret' : 'Tampilkan secret'}
                    >
                      {showApiSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    disabled={!apiSecretInput.trim()}
                    className="px-2.5 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium cursor-pointer disabled:opacity-40"
                    title="Salin API_SECRET"
                  >
                    {isSecretCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Di v3.6, wajib isi properti <code className="font-mono text-emerald-600">API_SECRET</code> (min. 24 karakter) di Apps Script <em>Project Settings &gt; Script Properties</em> agar semua permintaan diotorisasi aman.
                </span>
              </div>

              {/* Shuffling Options */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Shuffle className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Opsi Pengacakan Soal (Anti-Contek)</span>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shuffleQ}
                    onChange={(e) => setShuffleQ(e.target.checked)}
                    className="mt-0.5 rounded-sm text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <span className="font-semibold block">Acak Urutan Soal (setShuffleQuestions)</span>
                    <span className="text-[11px] text-slate-400">
                      Setiap siswa menerima urutan nomor soal yang berbeda di Google Form.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                  <input
                    type="checkbox"
                    checked={shuffleO}
                    onChange={(e) => setShuffleO(e.target.checked)}
                    className="mt-0.5 rounded-sm text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <span className="font-semibold block">Acak Urutan Pilihan Jawaban (A/B/C/D)</span>
                    <span className="text-[11px] text-slate-400">
                      Memerlukan layanan <em>Google Forms API</em> diaktifkan di menu Services (+) Apps Script.
                    </span>
                  </div>
                </label>
              </div>

              {/* Test Connection Button */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="py-2.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  {isTesting ? 'Mengecek...' : 'Uji Koneksi Web App'}
                </button>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  Simpan Pengaturan
                </button>
              </div>

              {/* Test Status Banner */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs ${
                    testResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  }`}
                >
                  <div className="font-bold flex items-center gap-1.5">
                    {testResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    )}
                    <span>{testResult.success ? 'Web App Terhubung Aktif!' : 'Koneksi Gagal'}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed">{testResult.message}</p>
                  {testResult.version && (
                    <div className="mt-1 font-mono text-[10px] opacity-80">
                      Versi Script: {testResult.version} · Siap untuk pembuatan kuis otomatis & live grading.
                    </div>
                  )}
                </div>
              )}

              {/* Action: Test Create Demo Form in Drive */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Uji Langsung Pembuatan Form ke Google Drive:
                </div>
                <button
                  type="button"
                  onClick={handleCreateDemoQuiz}
                  disabled={isCreatingDemo}
                  className="w-full py-2.5 px-3 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  <Play className={`w-3.5 h-3.5 ${isCreatingDemo ? 'animate-spin' : ''}`} />
                  {isCreatingDemo ? 'Sedang Membuat Form di Google Drive...' : 'Buat Form Uji Coba ke Google Drive'}
                </button>

                {demoCreatedResult && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                    <div className="font-bold text-emerald-600 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Form Berhasil Dibuat di Google Drive!</span>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div>
                        <strong>Tautan Siswa:</strong>{' '}
                        <a
                          href={demoCreatedResult.form_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 underline font-mono break-all"
                        >
                          {demoCreatedResult.form_url}
                        </a>
                      </div>
                      <div>
                        <strong>Editor Guru:</strong>{' '}
                        <a
                          href={demoCreatedResult.edit_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 underline font-mono break-all"
                        >
                          {demoCreatedResult.edit_url}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Code.gs Viewer & 10-Step Setup Guide */}
        <div className="lg:col-span-7 space-y-6">
          {/* Step by step guide */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Info className="w-4 h-4 text-emerald-600" />
              <span>Petunjuk Setup Google Apps Script (Hanya 1x Saja)</span>
            </div>

            <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside leading-relaxed">
              <li>
                Buka tab baru ke{' '}
                <a
                  href="https://script.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 underline font-semibold"
                >
                  https://script.google.com
                </a>
              </li>
              <li>
                Klik tombol <strong className="text-slate-900 dark:text-slate-100">"New Project"</strong> (Project Baru).
              </li>
              <li>
                Hapus seluruh isi file default, lalu tempelkan (<em className="text-emerald-600">Paste</em>) seluruh kode script di bawah ini.
              </li>
              <li>
                Buka <strong className="text-slate-900 dark:text-slate-100">Project Settings &gt; Script Properties</strong>, tambahkan properti <code className="font-mono text-emerald-600">API_SECRET</code> (minimal 24 karakter acak) sesuai kolom di sebelah kiri.
              </li>
              <li>
                Klik menu <strong className="text-slate-900 dark:text-slate-100">Deploy &gt; New deployment</strong> (atau <em>Manage deployments &gt; New version</em>).
              </li>
              <li>
                Pilih jenis type: <strong className="text-slate-900 dark:text-slate-100">Web app</strong>.
              </li>
              <li>
                Atur <strong>Execute as:</strong> <span className="font-semibold text-emerald-600">Me (akun Anda)</span>.
              </li>
              <li>
                Atur <strong>Who has access:</strong> <span className="font-semibold text-emerald-600">Anyone</span> (Siapa saja, agar dashboard dapat mengirimkan soal dengan validasi API_SECRET).
              </li>
              <li>
                Klik tombol <strong className="text-slate-900 dark:text-slate-100">Deploy</strong> dan berikan izin akses Google Drive saat diminta.
              </li>
              <li>
                Salin (<em className="text-emerald-600">Copy</em>) URL Web App yang muncul (berakhiran <code className="font-mono text-emerald-600">/exec</code>).
              </li>
              <li>
                Tempelkan URL tersebut ke kolom <strong>URL Web App</strong> di sebelah kiri, lalu klik <strong>Simpan Pengaturan</strong>.
              </li>
            </ol>
          </div>

          {/* Script Code Box */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Kode Script Lengkap: Code.gs ({isCustomCode ? 'Kustom Tersimpan' : 'Versi 3.6 - Keamanan API_SECRET, Validasi Payload & Auto-Update Form'})
                </span>
                <p className="text-[11px] text-slate-400">
                  {isCustomCode
                    ? 'Anda menggunakan versi kustom. Klik Simpan Pengaturan untuk menyimpan perubahan atau Reset Default untuk kembali ke v3.6.'
                    : 'Dilengkapi wajib API_SECRET, proteksi folder v2-soalpintar.ai, aksi POST aman tanpa token di URL, validasi 1-200 soal, auto-rebuild form jika soal berubah & belum ada respons, serta fungsi testSecurity().'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isCustomCode && (
                  <button
                    type="button"
                    onClick={() => {
                      setCodeGsInput(EXACT_CODE_GS);
                      showToast('Script dikembalikan ke default v3.6. Klik Simpan Pengaturan untuk menerapkan.');
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    title="Kembalikan script ke default v3.6"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingCode((prev) => !prev)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  title="Edit atau sesuaikan isi Code.gs secara manual"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {isEditingCode ? 'Mode Baca' : 'Edit Script'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  title="Unduh file Code.gs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh .gs
                </button>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {isCopied ? 'Tersalin ke Clipboard!' : 'Salin Seluruh Kode Script'}
                </button>
              </div>
            </div>

            <div className="relative">
              {isEditingCode ? (
                <textarea
                  value={codeGsInput}
                  onChange={(e) => setCodeGsInput(e.target.value)}
                  spellCheck={false}
                  rows={16}
                  className="w-full p-4 bg-slate-950 text-emerald-400 rounded-xl text-xs font-mono leading-relaxed border border-emerald-500/60 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              ) : (
                <pre className="p-4 bg-slate-950 text-emerald-400 rounded-xl text-xs font-mono max-h-96 overflow-y-auto leading-relaxed border border-slate-800 select-all">
                  {codeGsInput}
                </pre>
              )}
            </div>
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
