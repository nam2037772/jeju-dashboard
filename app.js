import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, getDoc, onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig, EDIT_EMAIL, DOC_PATH } from "./firebase-config.js";

// 시간대 기준(KST). DEFAULT_STATE가 todayStr()를 호출하므로 반드시 그 앞에서 선언한다(TDZ 방지).
const KST = "Asia/Seoul";

// ===================== 기본 데이터 (Firestore 문서가 없을 때 표시/초기값) =====================
const DEFAULT_STATE = {
  siteName: "한국정보통신공사협회 제주지회 신축공사",
  siteInfo: "제주특별자치도 · 현장현황판",
  weather: "맑음 24°C",
  progress: 0.42,
  tomorrowWork: "",
  specialNotes: "",
  tasks: [
    { id: "t1", title: "2층 슬래브 배근 검측 준비", trade: "골조", done: false },
    { id: "t2", title: "지하 전기 배관 매립", trade: "전기", done: true },
    { id: "t3", title: "외부 비계 안전난간 점검", trade: "안전", done: false },
    { id: "t4", title: "정보통신 인입 배관 협의", trade: "통신", done: false },
  ],
  safety: [
    { id: "s1", label: "고소작업 안전대 착용 확인", checked: true },
    { id: "s2", label: "개구부 덮개·난간 설치", checked: true },
    { id: "s3", label: "전기 가설분전반 누전차단기 점검", checked: false },
    { id: "s4", label: "화기작업 소화기 비치", checked: false },
  ],
  workDate: todayStr(),
  personnel: [
    { trade: "골조", prev: 120, today: 12 },
    { trade: "전기", prev: 64, today: 6 },
    { trade: "정보통신", prev: 28, today: 4 },
    { trade: "설비", prev: 40, today: 5 },
  ],
  equipment: [
    { name: "타워크레인", spec: "8T", prev: 20, today: 1 },
    { name: "굴착기", spec: "06W", prev: 15, today: 2 },
    { name: "고소작업차", spec: "14m", prev: 9, today: 1 },
  ],
  materials: [
    { name: "철근", spec: "SD400 D16", unit: "ton", prev: 210, today: 24 },
    { name: "레미콘", spec: "25-24-15", unit: "㎥", prev: 180, today: 0 },
    { name: "전선관", spec: "CD16", unit: "본", prev: 640, today: 80 },
    { name: "UTP 케이블", spec: "Cat6", unit: "롤", prev: 12, today: 3 },
  ],
  deadlines: [
    { title: "2층 슬래브 배근 검측", org: "감리단", manager: "김감리", due: "2026-07-15" },
    { title: "전기 착공 전 안전점검 공문", org: "감독관청", manager: "박감독", due: "2026-07-18" },
    { title: "정보통신 준공도서 제출", org: "협회", manager: "이통신", due: "2026-07-25" },
  ],
  historyDates: [],   // 저장된 일자별 이력 목록 "YYYY-MM-DD"
  updatedAt: null,
};

// ===================== Firebase 초기화 =====================
const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);
let db, auth, DOC;
if (configured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  DOC = doc(db, DOC_PATH[0], DOC_PATH[1]);
}

// ===================== 상태 =====================
let liveState = DEFAULT_STATE;   // Firestore에서 온 최신 데이터
let draft = null;                // 편집 중인 복사본
let editing = false;             // 편집 모드 여부
let isAuthed = false;            // 시공사 로그인 여부
let loginModal = false;
let rolledOver = false;          // 편집 시작 시 전일 이월이 일어났는지
let viewingDate = null;          // 열람 중인 과거 이력 날짜(null=현재)
let historyState = null;         // 불러온 과거 이력 스냅샷
let editBaseUpdatedAt = null;    // 편집 시작 시점의 updatedAt(충돌 감지용)

const $app = document.getElementById("app");

// ===================== 구동 =====================
// (모든 상수/함수 정의 이후 파일 끝에서 boot()를 호출한다 — TDZ 방지)
function boot() {
  if (!configured) {
    renderConfigWarning();
    return;
  }
  onAuthStateChanged(auth, (user) => {
    isAuthed = !!user;
    if (!isAuthed && editing) { editing = false; draft = null; }
    render();
  });
  onSnapshot(DOC, (snap) => {
    liveState = normalizeRows(snap.exists() ? { ...DEFAULT_STATE, ...snap.data() } : { ...DEFAULT_STATE });
    if (!editing && !viewingDate) render();
  }, (err) => {
    console.error(err);
    $app.innerHTML = `<div class="config-warn">데이터를 불러오지 못했습니다: ${esc(err.message)}<br>Firestore 규칙과 설정을 확인하세요 (README 참고).</div>`;
  });
}

// ===================== 유틸 =====================
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function uid() { return "x" + Math.random().toString(36).slice(2, 8); }

// KST(Asia/Seoul) 기준 오늘 날짜 "YYYY-MM-DD"
function todayStr() {
  // en-CA 로케일은 항상 YYYY-MM-DD 형식으로 출력
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
function fmtDate(s) {
  if (!s) return "-";
  // 날짜 문자열을 KST 자정 시점으로 고정해 요일을 계산
  const d = new Date(s + "T00:00:00+09:00");
  if (isNaN(d)) return s;
  const [y, m, day] = s.split("-").map(Number);
  const wd = new Intl.DateTimeFormat("ko-KR", { timeZone: KST, weekday: "short" }).format(d);
  return `${y}. ${m}. ${day} (${wd})`;
}
// 누계 = 전일 + 금일
function rowTotal(r) { return (+r.prev || 0) + (+r.today || 0); }

// 예전(단일 count/qty) 구조 → 신(전일/금일) 구조로 변환. workDate 보정.
function normalizeRows(state) {
  state.personnel = (state.personnel || []).map((r) =>
    ("prev" in r || "today" in r)
      ? { trade: r.trade || "", prev: +r.prev || 0, today: +r.today || 0 }
      : { trade: r.trade || "", prev: 0, today: +r.count || 0 });
  state.equipment = (state.equipment || []).map((r) =>
    ("prev" in r || "today" in r)
      ? { name: r.name || "", spec: r.spec || "", prev: +r.prev || 0, today: +r.today || 0 }
      : { name: r.name || "", spec: "", prev: 0, today: +r.active || 0 });
  state.materials = (state.materials || []).map((r) =>
    ("prev" in r || "today" in r)
      ? { name: r.name || "", spec: r.spec || "", unit: r.unit || "", prev: +r.prev || 0, today: +r.today || 0 }
      : { name: r.name || "", spec: r.qty || "", unit: "", prev: 0, today: 0 });
  if (!state.workDate) state.workDate = todayStr();
  return state;
}

// 행 위/아래 이동 (path 예: "personnel.2")
function moveRow(obj, path, dir) {
  const parts = path.split(".");
  const idx = +parts[parts.length - 1];
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  const j = idx + dir;
  if (j < 0 || j >= cur.length) return;
  [cur[idx], cur[j]] = [cur[j], cur[idx]];
}
function moveBtns(key, i, len) {
  return `<span class="mv">
    <button class="icon-btn sm" data-move="${key}.${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}>▲</button>
    <button class="icon-btn sm" data-move="${key}.${i}" data-dir="1" ${i === len - 1 ? "disabled" : ""}>▼</button>
  </span>`;
}

function ddayInfo(due) {
  if (!due) return { label: "-", cls: "" };
  // KST 자정 기준으로 오늘과 마감일 차이 계산
  const today = new Date(todayStr() + "T00:00:00+09:00");
  const d = new Date(due + "T00:00:00+09:00");
  const diff = Math.round((d - today) / 86400000);
  if (isNaN(diff)) return { label: "-", cls: "" };
  let label = diff === 0 ? "D-DAY" : diff > 0 ? "D-" + diff : "D+" + Math.abs(diff);
  let cls = diff <= 1 ? "danger" : diff <= 3 ? "warn" : "";
  return { label, cls };
}

function data() {
  if (editing) return draft;
  if (viewingDate && historyState) return historyState;
  return liveState;
}

// ===================== 렌더 =====================
function render() {
  const s = data();

  $app.innerHTML = `
    <header class="header">
      <div class="header-inner">
        <div>
          <div class="header-title">${editSpan("siteName", s.siteName, "text")}</div>
          <div class="header-sub">${editSpan("siteInfo", s.siteInfo, "text")}</div>
        </div>
        <div class="header-meta">
          <div class="meta-item">
            <div class="meta-label">날씨</div>
            <div class="meta-value">${editSpan("weather", s.weather, "text")}</div>
          </div>
          <div class="progress-wrap">
            <div class="progress-top"><span>공정률</span><span class="progress-value">${editing ? (s.progress * 100).toFixed(2) : formatPercent(s.progress * 100)}%</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${s.progress * 100}%"></div></div>
            ${editing ? `<input class="inp progress-input" style="margin-top:6px" type="number" min="0" max="100" step="0.01"
                 value="${(s.progress * 100).toFixed(2)}" data-set="progress" data-pct="1"> %` : ""}
          </div>
        </div>
        <div class="header-right">
          ${headerControls()}
        </div>
      </div>
    </header>

    <div class="wrap">
      ${editing ? `<div style="margin-top:16px" class="editing-note">✏️ 편집 모드 — 수정 후 <b>저장</b>을 눌러야 모두에게 반영됩니다.${rolledOver ? ` <span style="color:var(--blue)">· 날짜가 바뀌어 어제 '금일'을 '전일 누계'로 자동 이월했습니다.</span>` : ""}</div>` : ""}
      ${(!editing && viewingDate) ? `<div style="margin-top:16px" class="history-note">📅 <b>${fmtDate(viewingDate)}</b> 이력을 열람 중입니다. (읽기 전용) <button class="btn btn-primary sm" id="backToNow">현재로 돌아가기</button></div>` : ""}
      <div class="grid">

        ${card("col-4", "var(--blue)", "오늘의 작업", fmtDate(s.workDate), tasksBody(s))}

        ${card("col-4", "var(--orange)", "안전 점검", `${s.safety.length}건`, safetyBody(s))}

        ${card("col-4", "var(--red)", "검측·공문 마감", `${s.deadlines.length}건`, deadlinesBody(s))}

        ${card("col-6", "var(--purple)", "인력 현황", `누계 ${s.personnel.reduce((a, b) => a + rowTotal(b), 0)}명`, personnelBody(s))}

        ${card("col-6", "var(--purple)", "장비 현황", `${s.equipment.length}종`, equipmentBody(s))}

        ${card("col-6", "var(--green)", "주요 자재", `${s.materials.length}품목`, materialsBody(s))}

        ${card("col-6", "var(--orange)", "명일작업 · 특기사항", "", notesBody(s))}

      </div>
      <div class="footer">
        최종 갱신: ${fmtUpdated((viewingDate && historyState) ? historyState.updatedAt : liveState.updatedAt)} · 열람은 공개 / 입력은 시공사 전용
      </div>
    </div>

    ${loginModal ? loginModalHtml() : ""}
  `;

  bindEvents();
}

function fmtUpdated(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("ko-KR", { timeZone: KST, month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function formatPercent(value) {
  return Number(value || 0).toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function headerControls() {
  if (editing) {
    return `<div class="save-bar">
      <button class="btn btn-primary" id="save">저장</button>
      <button class="btn btn-ghost" id="cancel">취소</button>
    </div>`;
  }
  if (viewingDate) {
    // 과거 이력 열람 중: 날짜 이동만 (편집/로그아웃 숨김)
    return dayNav();
  }
  return `${dayNav()}
    <div class="mode-toggle">
      <button class="active">열람</button>
      <button id="editBtn">편집</button>
    </div>
    ${isAuthed ? `<button class="btn btn-ghost" id="logout">로그아웃</button>` : ""}`;
}

function historySelect() {
  // 오늘(현재)은 별도 항목으로 있으므로 과거 날짜만 나열(중복 방지)
  const dates = (liveState.historyDates || []).filter((d) => d !== liveState.workDate).slice().sort().reverse();
  if (!dates.length && !viewingDate) return "";
  const opts = [`<option value="">오늘(현재)</option>`]
    .concat(dates.map((d) => `<option value="${esc(d)}" ${d === viewingDate ? "selected" : ""}>${esc(d)}</option>`))
    .join("");
  return `<select class="history-select" id="historySelect" title="지난 일자 이력 보기">${opts}</select>`;
}

// 이력 날짜(오름차순)
function historyDatesAsc() {
  return (liveState.historyDates || []).slice().sort();
}
// 현재 열람 중인 날짜(현재 화면이면 오늘의 작업일자)
function currentViewDate() {
  return viewingDate || liveState.workDate || todayStr();
}
// 지금보다 하루 이전(가장 가까운 과거) 이력 날짜
function prevHistoryDate() {
  const cur = currentViewDate();
  const older = historyDatesAsc().filter((d) => d < cur);
  return older.length ? older[older.length - 1] : null;
}
// 지금보다 하루 뒤(가장 가까운 미래) 이력 날짜 (현재 화면이면 없음)
function nextHistoryDate() {
  if (!viewingDate) return null;
  const newer = historyDatesAsc().filter((d) => d > viewingDate);
  return newer.length ? newer[0] : null;
}

// 전일 ◀ / 익일 ▶ 하루 단위 이동 + 날짜 선택
function dayNav() {
  const prev = prevHistoryDate();
  const next = viewingDate ? nextHistoryDate() : null;
  if (!prev && !next && !viewingDate) return "";   // 오갈 지난 기록이 없으면 숨김
  return `<div class="day-nav">
    <button class="day-btn" id="prevDay" ${prev ? "" : "disabled"} title="전일 작업 보기">◀ 전일</button>
    ${historySelect()}
    <button class="day-btn" id="nextDay" ${next ? "" : "disabled"} title="다음 날 작업 보기">익일 ▶</button>
  </div>`;
}

function card(col, accent, title, count, body) {
  return `<section class="card ${col}">
    <div class="card-head">
      <div class="card-title"><span class="accent-dot" style="background:${accent}"></span>${title}</div>
      <div class="card-count">${count}</div>
    </div>
    ${body}
  </section>`;
}

function editHead(labels, cls = "") {
  return `<div class="edit-list-head ${cls}">${labels.map((label) => `<span>${label}</span>`).join("")}</div>`;
}

// -------- 작업 --------
function tasksBody(s) {
  if (editing) {
    return `<div class="edit-row" style="border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:4px">
        <span style="font-size:12px;color:var(--text-sub);white-space:nowrap">작업일자</span>
        <input class="inp" type="date" value="${esc(s.workDate)}" data-set="workDate">
      </div>`
      + editHead(["작업 내용", "공종"], "edit-head-tasks")
      + s.tasks.map((t, i) => `
      <div class="edit-row">
        ${moveBtns("tasks", i, s.tasks.length)}
        <input class="inp" value="${esc(t.title)}" data-set="tasks.${i}.title">
        <input class="inp inp-sm" value="${esc(t.trade)}" data-set="tasks.${i}.trade" placeholder="공종">
        <button class="icon-btn" data-del="tasks.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="tasks">+ 작업 추가</button>`;
  }
  return s.tasks.map((t) => `
    <div class="task">
      <div class="task-body"><div class="task-title">${esc(t.title)}</div></div>
      <span class="tag">${esc(t.trade)}</span>
    </div>`).join("") || emptyRow();
}

// -------- 안전 --------
function safetyBody(s) {
  if (editing) {
    return editHead(["안전 점검 항목"], "edit-head-safety") + s.safety.map((t, i) => `
      <div class="edit-row">
        <input class="inp" value="${esc(t.label)}" data-set="safety.${i}.label">
        <button class="icon-btn" data-del="safety.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="safety">+ 점검항목 추가</button>`;
  }
  return s.safety.map((t) => `
    <div class="safety">
      <div class="safety-label">${esc(t.label)}</div>
    </div>`).join("") || emptyRow();
}

// -------- 마감일 --------
function deadlinesBody(s) {
  if (editing) {
    return editHead(["제목", "기관", "담당", "마감일"], "edit-head-deadlines") + s.deadlines.map((t, i) => `
      <div class="edit-row" style="flex-wrap:wrap">
        <input class="inp" style="flex:1 1 100%" value="${esc(t.title)}" data-set="deadlines.${i}.title" placeholder="제목">
        <input class="inp" value="${esc(t.org)}" data-set="deadlines.${i}.org" placeholder="기관">
        <input class="inp" value="${esc(t.manager)}" data-set="deadlines.${i}.manager" placeholder="담당">
        <input class="inp" type="date" value="${esc(t.due)}" data-set="deadlines.${i}.due">
        <button class="icon-btn" data-del="deadlines.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="deadlines">+ 마감 추가</button>`;
  }
  return s.deadlines.map((t) => {
    const d = ddayInfo(t.due);
    return `<div class="deadline">
      <div>
        <div class="d-title">${esc(t.title)}</div>
        <div class="d-sub">${esc(t.org)} · ${esc(t.manager)} · ${esc(t.due)}</div>
      </div>
      <span class="dday ${d.cls}">${d.label}</span>
    </div>`;
  }).join("") || emptyRow();
}

// -------- 인력 (공종 / 전일·금일·누계) --------
function personnelBody(s) {
  if (editing) {
    return editHead(["공종", "전일", "금일", "누계"], "edit-head-personnel") + s.personnel.map((t, i) => `
      <div class="edit-row">
        ${moveBtns("personnel", i, s.personnel.length)}
        <input class="inp" style="flex:1;min-width:70px" value="${esc(t.trade)}" data-set="personnel.${i}.trade" placeholder="공종">
        <input class="inp num" type="number" value="${esc(t.prev)}" data-set="personnel.${i}.prev" data-num="1" data-row="personnel.${i}" placeholder="전일">
        <input class="inp num" type="number" value="${esc(t.today)}" data-set="personnel.${i}.today" data-num="1" data-row="personnel.${i}" placeholder="금일">
        <span class="tot" data-total="personnel.${i}">누계 ${rowTotal(t)}</span>
        <button class="icon-btn" data-del="personnel.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="personnel">+ 공종 추가</button>`;
  }
  return `<div class="dt dt-p">
    <div class="dt-head"><span>공종</span><span>전일</span><span>금일</span><span>누계</span></div>
    ${s.personnel.map((t) => `<div class="dt-row"><span class="nm">${esc(t.trade)}</span><span>${esc(t.prev)}</span><span class="td">${esc(t.today)}</span><span class="tt">${rowTotal(t)}</span></div>`).join("") || emptyRow()}
  </div>`;
}

// -------- 장비 (장비명·규격 / 전일·금일·누계) --------
function equipmentBody(s) {
  if (editing) {
    return editHead(["장비명", "규격", "전일", "금일", "누계"], "edit-head-equipment") + s.equipment.map((t, i) => `
      <div class="edit-row">
        ${moveBtns("equipment", i, s.equipment.length)}
        <input class="inp" style="flex:1;min-width:70px" value="${esc(t.name)}" data-set="equipment.${i}.name" placeholder="장비명">
        <input class="inp" style="width:84px" value="${esc(t.spec)}" data-set="equipment.${i}.spec" placeholder="규격">
        <input class="inp num" type="number" value="${esc(t.prev)}" data-set="equipment.${i}.prev" data-num="1" data-row="equipment.${i}" placeholder="전일">
        <input class="inp num" type="number" value="${esc(t.today)}" data-set="equipment.${i}.today" data-num="1" data-row="equipment.${i}" placeholder="금일">
        <span class="tot" data-total="equipment.${i}">누계 ${rowTotal(t)}</span>
        <button class="icon-btn" data-del="equipment.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="equipment">+ 장비 추가</button>`;
  }
  return `<div class="dt dt-e">
    <div class="dt-head"><span>장비명</span><span>규격</span><span>전일</span><span>금일</span><span>누계</span></div>
    ${s.equipment.map((t) => `<div class="dt-row"><span class="nm">${esc(t.name)}</span><span class="spec">${esc(t.spec)}</span><span>${esc(t.prev)}</span><span class="td">${esc(t.today)}</span><span class="tt">${rowTotal(t)}</span></div>`).join("") || emptyRow()}
  </div>`;
}

// -------- 자재 (자재명·규격·단위 / 전일·금일·누계) --------
function materialsBody(s) {
  if (editing) {
    return editHead(["자재명", "규격", "단위", "전일", "금일", "누계"], "edit-head-materials") + s.materials.map((t, i) => `
      <div class="edit-row">
        ${moveBtns("materials", i, s.materials.length)}
        <input class="inp material-name" value="${esc(t.name)}" data-set="materials.${i}.name" placeholder="자재명">
        <input class="inp material-spec" value="${esc(t.spec)}" data-set="materials.${i}.spec" placeholder="규격">
        <input class="inp material-unit" value="${esc(t.unit)}" data-set="materials.${i}.unit" placeholder="단위">
        <input class="inp num" type="text" inputmode="decimal" value="${formatNumber(t.prev)}" data-set="materials.${i}.prev" data-num="1" data-comma="1" data-row="materials.${i}" placeholder="전일">
        <input class="inp num" type="text" inputmode="decimal" value="${formatNumber(t.today)}" data-set="materials.${i}.today" data-num="1" data-comma="1" data-row="materials.${i}" placeholder="금일">
        <span class="tot" data-total="materials.${i}">누계 ${formatNumber(rowTotal(t))}</span>
        <button class="icon-btn" data-del="materials.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="materials">+ 자재 추가</button>`;
  }
  return `<div class="dt dt-m">
    <div class="dt-head"><span>자재명</span><span>규격</span><span>단위</span><span>전일</span><span>금일</span><span>누계</span></div>
    ${s.materials.map((t) => `<div class="dt-row"><span class="nm">${esc(t.name)}</span><span class="spec">${esc(t.spec)}</span><span class="spec">${esc(t.unit)}</span><span>${formatNumber(t.prev)}</span><span class="td">${formatNumber(t.today)}</span><span class="tt">${formatNumber(rowTotal(t))}</span></div>`).join("") || emptyRow()}
  </div>`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "0";
}

function notesBody(s) {
  return notesSection("명일작업", "tomorrowWork", s.tomorrowWork, "명일(내일) 예정 작업을 입력하세요.", "등록된 명일작업이 없습니다.")
    + notesSection("특기사항", "specialNotes", s.specialNotes, "현장 특기사항을 입력하세요.", "등록된 특기사항이 없습니다.");
}

function notesSection(label, key, value, placeholder, emptyText) {
  const body = editing
    ? `<textarea class="inp notes-input" data-set="${key}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : (value
        ? `<div class="notes-view">${esc(value)}</div>`
        : `<div class="notes-empty">${esc(emptyText)}</div>`);
  return `<div class="notes-block"><div class="notes-subhead">${label}</div>${body}</div>`;
}

function emptyRow() { return `<div style="padding:14px 0;color:var(--text-mute);font-size:13px">항목이 없습니다.</div>`; }

// -------- 편집 가능한 헤더 텍스트 --------
function editSpan(key, val, type) {
  if (!editing) return esc(val);
  return `<input class="inp" style="min-width:120px;display:inline-block;width:auto" value="${esc(val)}" data-set="${key}">`;
}

// -------- 로그인 모달 --------
function loginModalHtml() {
  return `<div class="modal-back" id="modalBack">
    <div class="modal">
      <h3>시공사 입력 로그인</h3>
      <p>현황을 입력·수정하려면 비밀번호를 입력하세요. (열람은 로그인 없이 가능합니다.)</p>
      <div class="err" id="loginErr"></div>
      <input class="inp" type="password" id="pw" placeholder="비밀번호" autocomplete="current-password">
      <div class="row-btns">
        <button class="btn btn-primary" id="doLogin">입력 시작</button>
        <button class="btn btn-ghost" id="closeLogin">취소</button>
      </div>
    </div>
  </div>`;
}

function renderConfigWarning() {
  // 설정 전에도 기본 데이터로 디자인 미리보기를 보여주고, 맨 위에 안내 배너를 붙인다.
  render();
  $app.insertAdjacentHTML("afterbegin", `<div class="config-warn">
    <b>⚙️ Firebase 설정이 필요합니다.</b><br>
    <code>firebase-config.js</code>에 Firebase 프로젝트 값을 채워 넣으면 실시간 공유 현황판이 켜집니다.
    설정 방법은 함께 있는 <code>README.md</code>를 참고하세요.
    아래는 설정 전 디자인 미리보기입니다. (편집·저장은 설정 후 동작합니다.)
  </div>`);
}

// ===================== 이벤트 =====================
function bindEvents() {
  const historySelect = document.getElementById("historySelect");
  if (historySelect) historySelect.onchange = () => openHistory(historySelect.value);
  const backToNow = document.getElementById("backToNow");
  if (backToNow) backToNow.onclick = () => openHistory("");

  const prevDay = document.getElementById("prevDay");
  if (prevDay) prevDay.onclick = () => { const d = prevHistoryDate(); if (d) openHistory(d); };
  const nextDay = document.getElementById("nextDay");
  if (nextDay) nextDay.onclick = () => {
    const d = nextHistoryDate();
    if (!d) return;
    const newest = historyDatesAsc().slice(-1)[0];
    openHistory(d === newest ? "" : d);   // 가장 최신 날짜면 '오늘(현재)'로 복귀
  };

  const editBtn = document.getElementById("editBtn");
  if (editBtn) editBtn.onclick = () => {
    if (!configured) { alert("Firebase 설정 후 편집이 가능합니다. README.md를 참고하세요."); return; }
    if (isAuthed) { startEdit(); }
    else { loginModal = true; render(); }
  };

  const logout = document.getElementById("logout");
  if (logout) logout.onclick = async () => { await signOut(auth); };

  const save = document.getElementById("save");
  if (save) save.onclick = saveDraft;
  const cancel = document.getElementById("cancel");
  if (cancel) cancel.onclick = () => { editing = false; draft = null; render(); };

  // 로그인 모달
  const doLogin = document.getElementById("doLogin");
  if (doLogin) doLogin.onclick = tryLogin;
  const pw = document.getElementById("pw");
  if (pw) { pw.focus(); pw.onkeydown = (e) => { if (e.key === "Enter") tryLogin(); }; }
  const closeLogin = document.getElementById("closeLogin");
  if (closeLogin) closeLogin.onclick = () => { loginModal = false; render(); };

  // 편집 인풋
  document.querySelectorAll("[data-set]").forEach(el => {
    el.oninput = () => {
      let v = el.value;
      if (el.getAttribute("data-num")) v = +(v.replace ? v.replace(/,/g, "") : v) || 0;
      if (el.getAttribute("data-pct")) v = Math.min(100, Math.max(0, +v || 0)) / 100;
      setPath(draft, el.getAttribute("data-set"), v);
      // 진행률 바만 즉시 시각 갱신 (재렌더는 하지 않아 포커스 유지)
      if (el.getAttribute("data-pct")) {
        const fill = document.querySelector(".progress-fill");
        if (fill) fill.style.width = Math.round(v * 100) + "%";
        const valueLabel = document.querySelector(".progress-value");
        if (valueLabel) valueLabel.textContent = (v * 100).toFixed(2) + "%";
      }
      // 전일/금일 입력 시 해당 행의 누계를 즉시 갱신 (재렌더 없이 포커스 유지)
      const rowPath = el.getAttribute("data-row");
      if (rowPath) {
        const parts = rowPath.split(".");
        const r = draft[parts[0]][+parts[1]];
        const totEl = document.querySelector(`[data-total="${rowPath}"]`);
        if (totEl) totEl.textContent = "누계 " + (el.getAttribute("data-comma") ? formatNumber(rowTotal(r)) : rowTotal(r));
      }
    };
  });

  document.querySelectorAll("[data-comma]").forEach(el => {
    el.onfocus = () => { el.value = el.value.replace(/,/g, ""); };
    el.onblur = () => { el.value = formatNumber(el.value.replace(/,/g, "")); };
  });

  document.querySelectorAll("[data-del]").forEach(el => {
    el.onclick = () => { removeAt(draft, el.getAttribute("data-del")); render(); };
  });
  document.querySelectorAll("[data-add]").forEach(el => {
    el.onclick = () => { addTo(draft, el.getAttribute("data-add")); render(); };
  });
  document.querySelectorAll("[data-move]").forEach(el => {
    el.onclick = () => { moveRow(draft, el.getAttribute("data-move"), +el.getAttribute("data-dir")); render(); };
  });
}

function startEdit() {
  editing = true;
  draft = deepCopy(liveState);
  editBaseUpdatedAt = liveState.updatedAt || null;   // 편집 시작 시점 기준(충돌 감지)
  rolledOver = false;
  const t = todayStr();
  if (draft.workDate && draft.workDate < t) {
    // 날짜가 바뀜: 어제 '금일'을 '전일 누계'로 이월하고 금일 0으로 초기화
    ["personnel", "equipment", "materials"].forEach((k) => {
      (draft[k] || []).forEach((r) => { r.prev = (+r.prev || 0) + (+r.today || 0); r.today = 0; });
    });
    draft.workDate = t;
    rolledOver = true;
  } else if (!draft.workDate) {
    draft.workDate = t;
  }
  viewingDate = null;
  historyState = null;
  render();
}

// 지난 일자 이력 열람 (dateId="" 이면 현재로 복귀)
async function openHistory(dateId) {
  if (!dateId) {
    viewingDate = null;
    historyState = null;
    render();
    return;
  }
  try {
    const snap = await getDoc(doc(db, DOC_PATH[0], "history-" + dateId));
    if (!snap.exists()) { alert("해당 일자의 이력을 찾을 수 없습니다."); return; }
    historyState = normalizeRows({ ...DEFAULT_STATE, ...snap.data() });
    viewingDate = dateId;
    render();
  } catch (e) {
    alert("이력을 불러오지 못했습니다: " + e.message);
  }
}

async function tryLogin() {
  const pw = document.getElementById("pw").value;
  const err = document.getElementById("loginErr");
  err.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, EDIT_EMAIL, pw);
    loginModal = false;
    startEdit();
  } catch (e) {
    err.textContent = "비밀번호가 올바르지 않습니다.";
  }
}

async function saveDraft() {
  const next = deepCopy(draft);
  editing = false;
  draft = null;
  await persist(next);
}

function tsMillis(ts) { return (ts && ts.toMillis) ? ts.toMillis() : null; }

async function persist(obj) {
  // 제거된 기능의 잔여 데이터 정리(옛 문서에 남아있을 수 있는 사진/알림)
  delete obj.photos;
  delete obj.notifications;
  // 이력 날짜 목록에 작업일자를 추가(중복 제거·정렬)
  const dates = new Set(obj.historyDates || []);
  if (obj.workDate) dates.add(obj.workDate);
  obj.historyDates = [...dates].sort();
  try {
    await runTransaction(db, async (tx) => {
      // 편집 시작 이후 다른 사람이 저장했는지 확인(충돌 감지)
      const cur = await tx.get(DOC);
      const curMs = cur.exists() ? tsMillis(cur.data().updatedAt) : null;
      const baseMs = tsMillis(editBaseUpdatedAt);
      if (curMs !== baseMs) throw new Error("CONFLICT");

      obj.updatedAt = serverTimestamp();
      tx.set(DOC, obj);   // 현재 화면(dashboard/main) — 전체 덮어쓰기
      if (obj.workDate) {
        // 그날 기록을 날짜별 문서(dashboard/history-YYYY-MM-DD)로 보관
        const snapshot = { ...obj };
        delete snapshot.historyDates;   // 이력 문서에는 목록이 필요 없음
        tx.set(doc(db, DOC_PATH[0], "history-" + obj.workDate), snapshot);
      }
    });
  } catch (e) {
    if (e.message === "CONFLICT") {
      editing = false; draft = null;
      alert("다른 기기나 사용자가 먼저 저장했습니다.\n최신 내용으로 화면을 새로고침했으니, 확인 후 다시 편집해 주세요.");
      render();
      return;
    }
    alert("저장에 실패했습니다: " + e.message + "\n(로그인/권한/네트워크를 확인하세요.)");
  }
  render();
}

// ===================== 경로 헬퍼 =====================
function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}
function removeAt(obj, path) {
  const parts = path.split(".");
  const idx = +parts[parts.length - 1];
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur.splice(idx, 1);
}
const NEW_ROW = {
  tasks: () => ({ id: uid(), title: "", trade: "", done: false }),
  safety: () => ({ id: uid(), label: "", checked: false }),
  personnel: () => ({ trade: "", prev: 0, today: 0 }),
  equipment: () => ({ name: "", spec: "", prev: 0, today: 0 }),
  materials: () => ({ name: "", spec: "", unit: "", prev: 0, today: 0 }),
  deadlines: () => ({ title: "", org: "", manager: "", due: "" }),
};
function addTo(obj, key) { obj[key].push(NEW_ROW[key]()); }

// ===================== 시작 =====================
boot();
