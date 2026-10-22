/**
 * TASA Sporting Integrity: รับเรื่องร้องเรียนจากหน้า report.html แล้วบันทึกลง Google Sheet
 *
 * วิธีใช้
 * 1) สร้าง Google Sheet ใหม่ (ตั้งเป็นส่วนตัว ไม่แชร์ให้ใครนอกจากผู้รับผิดชอบ)
 * 2) เมนู ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนของเดิม
 * 3) เลือกฟังก์ชัน setup แล้วกด เรียกใช้ (อนุญาตสิทธิ์ครั้งแรก) จะสร้างแท็บ "รับเรื่อง" พร้อมหัวตาราง
 * 4) ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท เว็บแอป
 *    เรียกใช้ในฐานะ: ฉัน / ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 5) คัดลอก URL ของเว็บแอป (ลงท้าย /exec) ไปใส่ที่ ENDPOINT ใน report.html
 *
 * หมายเหตุ: ผู้ใช้ทั่วไปส่งข้อมูลเข้าได้อย่างเดียว อ่านข้อมูลใน Sheet ไม่ได้
 * หากแก้โค้ดภายหลัง ต้องสร้างเวอร์ชันใหม่ที่ ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ (URL เดิมไม่เปลี่ยน)
 */

var SHEET_NAME = 'รับเรื่อง';
var TZ = 'Asia/Bangkok';
var NOTIFY_EMAIL = '';   // ใส่อีเมลเพื่อให้แจ้งเตือนเมื่อมีเรื่องใหม่ (ส่งเฉพาะหมายเลขอ้างอิง ไม่ส่งเนื้อหาเรื่อง)
var MAX_PER_MINUTE = 20; // จำกัดจำนวนเรื่องต่อนาที ป้องกันการส่งซ้ำจำนวนมาก

var HEADERS = [
  'เวลาที่รับ (เวลาไทย)', 'หมายเลขอ้างอิง', 'ไม่ระบุตัวตน', 'ประเภทเรื่อง', 'ลักษณะการกระทำ',
  'รายละเอียดเหตุการณ์', 'วันหรือช่วงเวลาที่เกิดเหตุ', 'รายการแข่งขันหรืองานที่เกี่ยวข้อง', 'สถานที่',
  'ผู้เยาว์เกี่ยวข้อง', 'มีผู้เสี่ยงอันตรายขณะนี้', 'ผู้ถูกกล่าวถึง', 'สถานะของผู้ถูกกล่าวถึง',
  'หลักฐานที่มี', 'ลิงก์หลักฐาน', 'ชื่อผู้แจ้ง', 'ความสัมพันธ์กับเรื่อง', 'ช่องทางติดต่อ',
  'ยินยอมเปิดเผยตัวตน', 'ภาษาที่ใช้กรอก', 'ข้อสังเกตจากระบบ',
  'สถานะดำเนินการ (เจ้าหน้าที่กรอก)', 'ผู้รับผิดชอบ (เจ้าหน้าที่กรอก)', 'บันทึกของเจ้าหน้าที่'
];

function setup() {
  getSheet_();
}

function doGet() {
  return json_({ ok: true, service: 'TASA integrity intake' });
}

function doPost(e) {
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // ช่องดักบอท: คนจริงมองไม่เห็นและไม่กรอก
    if (d.website) return json_({ ok: true, ref: newRef_() });

    var cats = list_(d.categories, 15, 300);
    var desc = clean_(d.description, 5000);
    if (!cats.length || desc.length < 20 || d.consentTruth !== true || d.consentPrivacy !== true) {
      return json_({ ok: false, error: 'invalid' });
    }

    var cache = CacheService.getScriptCache();
    var key = 'n' + Math.floor(Date.now() / 60000);
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), 120);
    if (n > MAX_PER_MINUTE) return json_({ ok: false, error: 'busy' });

    var anon = d.anonymous === 'ใช่';
    var ref = newRef_();
    var minor = { yes: 'มี', no: 'ไม่มี', unsure: 'ไม่แน่ใจ' }[d.minor] || '';
    var note = (typeof d.elapsedMs === 'number' && d.elapsedMs < 2000) ? 'ส่งเร็วผิดปกติ' : '';

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

    return json_({ ok: true, ref: ref });
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#e8eef6');
    sh.setFrozenRows(1);
    sh.setColumnWidth(6, 420);
    sh.getRange(2, 6, 1000, 1).setWrap(true);
  }
  return sh;
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

function list_(a, maxItems, maxLen) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, maxItems).map(function (x) { return clean_(x, maxLen); }).filter(String);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
