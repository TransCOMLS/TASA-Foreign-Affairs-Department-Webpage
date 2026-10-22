/**
 * TASA Sporting Integrity: รับเรื่องร้องเรียนจากหน้า report.html
 * บันทึกลง Google Sheet และเก็บไฟล์หลักฐานใน Google Drive ของเจ้าของสคริปต์
 *
 * วิธีติดตั้งครั้งแรก
 * 1) สร้าง Google Sheet ใหม่ (ตั้งเป็นส่วนตัว ไม่แชร์ให้ใครนอกจากผู้รับผิดชอบ)
 * 2) เมนู ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนของเดิม
 * 3) เลือกฟังก์ชัน setup แล้วกด เรียกใช้ และอนุญาตสิทธิ์ (Sheets, Drive, การเรียกบริการภายนอก)
 *    ระบบจะสร้างแท็บ "รับเรื่อง", โฟลเดอร์ "TASA Integrity Evidence" ใน Drive และตัวลบไฟล์ค้างอัตโนมัติ
 * 4) ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท เว็บแอป
 *    เรียกใช้ในฐานะ: ฉัน / ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 5) คัดลอก URL ของเว็บแอป (ลงท้าย /exec) ไปใส่ที่ ENDPOINT ใน report.html
 *
 * ติดตั้งแล้ว ต้องการอัปเดตโค้ด
 * - วางโค้ดใหม่ > เรียกใช้ setup 1 ครั้ง (เพื่ออนุญาตสิทธิ์ใหม่) > ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้
 *   > ไอคอนดินสอ > เวอร์ชัน: เวอร์ชันใหม่ > ทำให้ใช้งานได้ (URL เดิมไม่เปลี่ยน)
 *
 * ผู้ใช้ทั่วไปส่งข้อมูลเข้าได้อย่างเดียว อ่านข้อมูลใน Sheet หรือ Drive ไม่ได้
 */

var SHEET_NAME = 'รับเรื่อง';
var TZ = 'Asia/Bangkok';
var NOTIFY_EMAIL = '';          // ใส่อีเมลเพื่อให้แจ้งเตือนเมื่อมีเรื่องใหม่ (ส่งเฉพาะหมายเลขอ้างอิง ไม่ส่งเนื้อหา)
var MAX_PER_MINUTE = 20;        // จำกัดจำนวนเรื่องต่อนาที

// ไฟล์หลักฐาน
var ROOT_FOLDER_NAME = 'TASA Integrity Evidence';
var INCOMING_FOLDER_NAME = '_ไฟล์ที่ยังไม่ผูกกับเรื่อง';
var MAX_FILES = 5;                          // ต่อ 1 เรื่อง
var MAX_FILE_BYTES = 100 * 1024 * 1024;     // ต่อ 1 ไฟล์ (100 MB)
var MAX_UPLOADS_PER_HOUR = 30;              // จำนวนไฟล์ที่เริ่มอัปโหลดได้ต่อชั่วโมง (ทุกคนรวมกัน)
var KEEP_UNATTACHED_DAYS = 3;               // ไฟล์ที่อัปโหลดแล้วแต่ไม่ได้ส่งเรื่อง จะถูกย้ายลงถังขยะหลังกี่วัน
var CHUNK_ALIGN = 256 * 1024;               // Google Drive กำหนดให้ชิ้นส่วนเป็นพหุคูณของ 256 KiB (ชิ้นสุดท้ายยกเว้น)
var ALLOWED_EXT = {
  jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, heic: 1, heif: 1, bmp: 1,
  pdf: 1, doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1, txt: 1, csv: 1, rtf: 1,
  mp3: 1, m4a: 1, wav: 1, aac: 1, ogg: 1,
  mp4: 1, mov: 1, m4v: 1, avi: 1, mkv: 1, webm: 1, '3gp': 1,
  zip: 1
};

var FILES_HEADER = 'ไฟล์หลักฐาน (Google Drive)';
var HEADERS = [
  'เวลาที่รับ (เวลาไทย)', 'หมายเลขอ้างอิง', 'ไม่ระบุตัวตน', 'ประเภทเรื่อง', 'ลักษณะการกระทำ',
  'รายละเอียดเหตุการณ์', 'วันหรือช่วงเวลาที่เกิดเหตุ', 'รายการแข่งขันหรืองานที่เกี่ยวข้อง', 'สถานที่',
  'ผู้เยาว์เกี่ยวข้อง', 'มีผู้เสี่ยงอันตรายขณะนี้', 'ผู้ถูกกล่าวถึง', 'สถานะของผู้ถูกกล่าวถึง',
  'หลักฐานที่มี', 'ลิงก์หลักฐาน', FILES_HEADER, 'ชื่อผู้แจ้ง', 'ความสัมพันธ์กับเรื่อง', 'ช่องทางติดต่อ',
  'ยินยอมเปิดเผยตัวตน', 'ภาษาที่ใช้กรอก', 'ข้อสังเกตจากระบบ',
  'สถานะดำเนินการ (เจ้าหน้าที่กรอก)', 'ผู้รับผิดชอบ (เจ้าหน้าที่กรอก)', 'บันทึกของเจ้าหน้าที่'
];
var FILES_COL = 16; // ตำแหน่งคอลัมน์ไฟล์หลักฐาน (นับจาก 1)

/* ---------- ติดตั้ง ---------- */

function setup() {
  getSheet_();
  var f = getFolders_();
  ensureCleanupTrigger_();
  Logger.log('โฟลเดอร์เก็บหลักฐาน: ' + DriveApp.getFolderById(f.rootId).getUrl());
}

function ensureCleanupTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cleanupIncoming'; });
  if (!has) ScriptApp.newTrigger('cleanupIncoming').timeBased().everyDays(1).atHour(3).create();
}

// ลบไฟล์ที่อัปโหลดแล้วแต่ไม่มีการส่งเรื่อง (ย้ายลงถังขยะของ Drive)
function cleanupIncoming() {
  var f = getFolders_();
  var it = DriveApp.getFolderById(f.incomingId).getFiles();
  var limit = Date.now() - KEEP_UNATTACHED_DAYS * 86400000;
  while (it.hasNext()) {
    var file = it.next();
    if (file.getDateCreated().getTime() < limit) file.setTrashed(true);
  }
}

/* ---------- web app ---------- */

function doGet() {
  return json_({ ok: true, service: 'TASA integrity intake', uploads: true, maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES });
}

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action === 'init') return json_(initUpload_(d));
    if (d.action === 'chunk') return json_(uploadChunk_(d));
    return json_(submitReport_(d));
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}

/* ---------- รับเรื่อง ---------- */

function submitReport_(d) {
  // ช่องดักบอท: คนจริงมองไม่เห็นและไม่กรอก
  if (d.website) return { ok: true, ref: newRef_() };

  var cats = list_(d.categories, 15, 300);
  var desc = clean_(d.description, 5000);
  if (!cats.length || desc.length < 20 || d.consentTruth !== true || d.consentPrivacy !== true) {
    return { ok: false, error: 'invalid' };
  }

  var cache = CacheService.getScriptCache();
  var key = 'n' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  if (n > MAX_PER_MINUTE) return { ok: false, error: 'busy' };

  var anon = d.anonymous === 'ใช่';
  var ref = newRef_();
  var minor = { yes: 'มี', no: 'ไม่มี', unsure: 'ไม่แน่ใจ' }[d.minor] || '';
  var note = (typeof d.elapsedMs === 'number' && d.elapsedMs < 2000) ? 'ส่งเร็วผิดปกติ' : '';

  // ผูกไฟล์ที่อัปโหลดไว้แล้วเข้ากับเรื่องนี้ (ย้ายเข้าโฟลเดอร์ชื่อเดียวกับหมายเลขอ้างอิง)
  var attached = null;
  if (Array.isArray(d.files) && d.files.length) {
    try { attached = attachFiles_(d.files, ref); } catch (fe) { note = (note ? note + '; ' : '') + 'แนบไฟล์ไม่สำเร็จ'; }
  }

  var row = [
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
    ref,
    anon ? 'ใช่' : 'ไม่',
    cats.join('; '),
    list_(d.subtypes, 10, 300).join('; '),
    desc,
    clean_(d.when, 200),
    clean_(d.event, 300),
    clean_(d.place, 300),
    minor,
    d.danger === 'ใช่' ? 'ใช่' : '',
    clean_(d.subject, 500),
    clean_(d.subjectRole, 200),
    clean_(d.evidence, 2000),
    clean_(d.links, 1000),
    attached ? attached.text : '',
    // กรณีไม่ระบุตัวตน ไม่เก็บข้อมูลผู้แจ้งใดๆ แม้ผู้ส่งจะแนบมา
    anon ? '' : clean_(d.reporterName, 200),
    anon ? '' : clean_(d.reporterRole, 200),
    anon ? '' : clean_(d.reporterContact, 200),
    anon ? '' : clean_(d.consentDisclose, 50),
    d.lang === 'en' ? 'อังกฤษ' : 'ไทย',
    note,
    'รอตรวจสอบ', '', ''
  ];

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var r = sheet.getLastRow() + 1;
    var range = sheet.getRange(r, 1, 1, row.length);
    range.setNumberFormat('@'); // เก็บเป็นข้อความล้วน กันสูตร (=, +, -, @) ที่ผู้ส่งอาจแทรกมา
    range.setValues([row]);
    if (attached) {
      sheet.getRange(r, FILES_COL).setRichTextValue(
        SpreadsheetApp.newRichTextValue().setText(attached.text).setLinkUrl(attached.url).build());
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  if (NOTIFY_EMAIL) {
    try {
      MailApp.sendEmail(NOTIFY_EMAIL,
        '[TASA Integrity] มีเรื่องใหม่ ' + ref + (row[10] ? ' (มีผู้เสี่ยงอันตราย)' : ''),
        'มีการแจ้งเรื่องใหม่ หมายเลขอ้างอิง ' + ref + '\nโปรดตรวจสอบรายละเอียดใน Google Sheet');
    } catch (mailErr) { /* ไม่ให้การส่งอีเมลล้มเหลวกระทบการบันทึก */ }
  }

  return { ok: true, ref: ref };
}

/* ---------- อัปโหลดไฟล์หลักฐาน (resumable upload ผ่านสคริปต์) ---------- */

// ขั้นที่ 1: เปิดช่องอัปโหลดใน Drive แล้วส่ง uploadId กลับ
function initUpload_(d) {
  if (d.website) return { ok: false, error: 'invalid' };
  var size = Number(d.size);
  var name = safeName_(d.name);
  var ext = name.indexOf('.') > 0 ? name.split('.').pop().toLowerCase() : '';
  if (!(size > 0) || size > MAX_FILE_BYTES || !ALLOWED_EXT[ext]) return { ok: false, error: 'invalid' };

  var cache = CacheService.getScriptCache();
  var key = 'h' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 7200);
  if (n > MAX_UPLOADS_PER_HOUR) return { ok: false, error: 'busy' };

  var mime = /^[\w.+-]+\/[\w.+-]+$/.test(d.mime || '') ? d.mime : 'application/octet-stream';
  var f = getFolders_();
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss');
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size)
    },
    payload: JSON.stringify({ name: stamp + '_' + name, parents: [f.incomingId] }),
    muteHttpExceptions: true
  });
  var h = res.getAllHeaders();
  var uri = h.Location || h.location;
  if (res.getResponseCode() !== 200 || !uri) return { ok: false, error: 'drive' };

  var id = Utilities.getUuid();
  putUp_(id, { uri: uri, size: size, offset: 0, id: '' });
  return { ok: true, uploadId: id };
}

// ขั้นที่ 2: รับไฟล์ทีละชิ้น (base64) แล้วส่งต่อให้ Drive
function uploadChunk_(d) {
  var st = getUp_(d.uploadId);
  if (!st) return { ok: false, error: 'expired' };
  if (st.id) return { ok: true, id: st.id };                 // อัปโหลดเสร็จแล้ว (กรณีส่งซ้ำ)
  var start = Number(d.start);
  if (start < st.offset) return { ok: true, skipped: true }; // ชิ้นนี้รับไปแล้ว (กรณีส่งซ้ำ)
  if (start !== st.offset) return { ok: false, error: 'order' };

  var bytes = Utilities.base64Decode(String(d.data || ''));
  if (!bytes.length) return { ok: false, error: 'invalid' };
  var end = start + bytes.length - 1;
  if (end >= st.size) return { ok: false, error: 'invalid' };
  if (end < st.size - 1 && bytes.length % CHUNK_ALIGN) return { ok: false, error: 'invalid' };

  var res = UrlFetchApp.fetch(st.uri, {
    method: 'put',
    contentType: 'application/octet-stream',
    headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size },
    payload: Utilities.newBlob(bytes, 'application/octet-stream'),
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = res.getResponseCode();
  if (code === 308) {
    st.offset = end + 1;
    putUp_(d.uploadId, st);
    return { ok: true };
  }
  if (code === 200 || code === 201) {
    st.id = JSON.parse(res.getContentText()).id;
    st.offset = st.size;
    putUp_(d.uploadId, st);
    return { ok: true, id: st.id };
  }
  return { ok: false, error: 'drive' + code };
}

function putUp_(id, st) { CacheService.getScriptCache().put('up_' + id, JSON.stringify(st), 21600); }
function getUp_(id) {
  var v = id ? CacheService.getScriptCache().get('up_' + id) : null;
  return v ? JSON.parse(v) : null;
}

// ย้ายไฟล์ที่อัปโหลดไว้เข้าโฟลเดอร์ของเรื่องนี้ (รับเฉพาะไฟล์ที่อยู่ในโฟลเดอร์รอผูกเรื่องเท่านั้น)
function attachFiles_(list, ref) {
  var f = getFolders_();
  var ok = [];
  list.slice(0, MAX_FILES).forEach(function (x) {
    try {
      var file = DriveApp.getFileById(String(x.id));
      var inside = false, it = file.getParents();
      while (it.hasNext()) { if (it.next().getId() === f.incomingId) inside = true; }
      if (inside) ok.push(file);
    } catch (e) { /* ข้ามไฟล์ที่ไม่ถูกต้อง */ }
  });
  if (!ok.length) return null;
  var folder = DriveApp.getFolderById(f.rootId).createFolder(ref);
  var names = ok.map(function (file) {
    file.moveTo(folder);
    return file.getName() + ' (' + fmtSize_(file.getSize()) + ')';
  });
  return { url: folder.getUrl(), count: ok.length, text: ok.length + ' ไฟล์: ' + names.join('; ') };
}

/* ---------- เครื่องมือช่วย ---------- */

function getFolders_() {
  var p = PropertiesService.getScriptProperties();
  var rootId = p.getProperty('ROOT_ID') || '', inId = p.getProperty('INCOMING_ID') || '';
  try { if (rootId) DriveApp.getFolderById(rootId); } catch (e) { rootId = ''; }
  if (!rootId) { rootId = DriveApp.createFolder(ROOT_FOLDER_NAME).getId(); p.setProperty('ROOT_ID', rootId); inId = ''; }
  try { if (inId) DriveApp.getFolderById(inId); } catch (e) { inId = ''; }
  if (!inId) { inId = DriveApp.getFolderById(rootId).createFolder(INCOMING_FOLDER_NAME).getId(); p.setProperty('INCOMING_ID', inId); }
  return { rootId: rootId, incomingId: inId };
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    writeHeaders_(sh);
    sh.getRange(2, 6, 1000, 1).setWrap(true);
  } else if (sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf(FILES_HEADER) < 0) {
    // อัปเกรด Sheet เดิม: เพิ่มคอลัมน์ไฟล์หลักฐานก่อนคอลัมน์ "ชื่อผู้แจ้ง"
    var idx = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('ชื่อผู้แจ้ง');
    if (idx > -1) sh.insertColumnBefore(idx + 1);
    writeHeaders_(sh);
  }
  return sh;
}

function writeHeaders_(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#e8eef6');
  sh.setFrozenRows(1);
  sh.setColumnWidth(6, 420);
}

function newRef_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'TASA-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + s;
}

function clean_(v, max) {
  v = (v == null ? '' : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return v.length > max ? v.slice(0, max) : v;
}

function safeName_(v) {
  var s = String(v == null ? '' : v).replace(/[\\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/^\.+/, '').trim();
  return s.length > 120 ? s.slice(-120) : s;
}

function fmtSize_(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}

function list_(a, maxItems, maxLen) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, maxItems).map(function (x) { return clean_(x, maxLen); }).filter(String);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
