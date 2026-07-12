import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, onSnapshot, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig, EDIT_EMAIL, DOC_PATH } from "./firebase-config.js";

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
  photos: [
    { caption: "2층 슬래브 배근 현황", date: "2026-07-11", tag: "골조", grad: "linear-gradient(135deg,#1C93BE,#57C7E8)" },
    { caption: "지하 전기 배관 매립", date: "2026-07-10", tag: "전기", grad: "linear-gradient(135deg,#6C4FA3,#9B7FD1)" },
    { caption: "외부 비계 설치", date: "2026-07-09", tag: "안전", grad: "linear-gradient(135deg,#C05A2C,#E0895C)" },
    { caption: "자재 반입 검수", date: "2026-07-08", tag: "자재", grad: "linear-gradient(135deg,#4C7A34,#7CA860)" },
  ],
  notifications: [
    { text: "감리단이 슬래브 검측 일정을 확인했습니다.", time: "오늘 09:12" },
    { text: "레미콘 타설 예약이 필요합니다.", time: "어제 16:40" },
  ],
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
let notifOpen = false;
let loginModal = false;
let rolledOver = false;          // 편집 시작 시 전일 이월이 일어났는지

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
    if (!editing) render();
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

// 오늘 날짜 "YYYY-MM-DD"
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDate(s) {
  if (!s) return "-";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d)) return s;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${WEEK[d.getDay()]})`;
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
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const diff = Math.round((d - today) / 86400000);
  if (isNaN(diff)) return { label: "-", cls: "" };
  let label = diff === 0 ? "D-DAY" : diff > 0 ? "D-" + diff : "D+" + Math.abs(diff);
  let cls = diff <= 1 ? "danger" : diff <= 3 ? "warn" : "";
  return { label, cls };
}

function data() { return editing ? draft : liveState; }

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
          <div class="bell" id="bell">🔔${s.notifications.length ? '<span class="dot"></span>' : ""}</div>
          ${headerControls()}
        </div>
      </div>
    </header>

    <div class="wrap">
      ${editing ? `<div style="margin-top:16px" class="editing-note">✏️ 편집 모드 — 수정 후 <b>저장</b>을 눌러야 모두에게 반영됩니다.${rolledOver ? ` <span style="color:var(--blue)">· 날짜가 바뀌어 어제 '금일'을 '전일 누계'로 자동 이월했습니다.</span>` : ""}</div>` : ""}
      <div class="grid">

        ${card("col-4", "var(--blue)", "오늘의 작업", fmtDate(s.workDate), tasksBody(s))}

        ${card("col-4", "var(--orange)", "안전 점검", `${s.safety.length}건`, safetyBody(s))}

        ${card("col-4", "var(--red)", "검측·공문 마감", `${s.deadlines.length}건`, deadlinesBody(s))}

        ${card("col-6", "var(--purple)", "인력 현황", `누계 ${s.personnel.reduce((a, b) => a + rowTotal(b), 0)}명`, personnelBody(s))}

        ${card("col-6", "var(--purple)", "장비 현황", `${s.equipment.length}종`, equipmentBody(s))}

        ${card("col-6", "var(--green)", "주요 자재", `${s.materials.length}품목`, materialsBody(s))}

        ${card("col-6", "var(--orange)", "명일작업 · 특기사항", "", notesBody(s))}

        ${card("col-12", "var(--blue-lt)", "현장 사진", `${s.photos.length}건`, photosBody(s))}

      </div>
      <div class="footer">
        최종 갱신: ${fmtUpdated(liveState.updatedAt)} · 열람은 공개 / 입력은 시공사 전용
      </div>
    </div>

    ${notifOpen ? notifPanel(s) : ""}
    ${loginModal ? loginModalHtml() : ""}
  `;

  bindEvents();
}

function fmtUpdated(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  return `<div class="mode-toggle">
      <button class="active">열람</button>
      <button id="editBtn">편집</button>
    </div>
    ${isAuthed ? `<button class="btn btn-ghost" id="logout">로그아웃</button>` : ""}`;
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

// -------- 사진 --------
function photosBody(s) {
  if (editing) {
    return editHead(["사진", "내용", "촬영일", "태그"], "edit-head-photos") + s.photos.map((t, i) => `
      <div class="edit-row photo-edit-row">
        <div class="photo-edit-preview" style="background:${t.img ? `url('${esc(t.img)}') center/cover` : (esc(t.grad) || "linear-gradient(135deg,#1C93BE,#57C7E8)")}"></div>
        <label class="photo-upload-btn">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-photo-file="${i}">
          ${t.img ? "사진 변경" : "사진 첨부"}
        </label>
        <span class="photo-upload-status" data-photo-status="${i}">${t.img ? "첨부됨" : "사진을 선택하세요"}</span>
        <input class="inp" style="flex:1 1 100%" value="${esc(t.caption)}" data-set="photos.${i}.caption" placeholder="사진 내용">
        <input class="inp" type="date" value="${esc(t.date)}" data-set="photos.${i}.date">
        <input class="inp inp-sm" style="width:90px" value="${esc(t.tag)}" data-set="photos.${i}.tag" placeholder="태그">
        <button class="icon-btn" data-del="photos.${i}">×</button>
      </div>`).join("")
      + `<button class="add-btn" data-add="photos">+ 사진 추가</button>`;
  }
  return `<div class="photos">` + s.photos.map((t) => `
    <div class="photo">
      <div class="photo-img" style="background:${t.img ? `url('${esc(t.img)}')` : (esc(t.grad) || "linear-gradient(135deg,#1C93BE,#57C7E8)")};background-size:cover;background-position:center"></div>
      <div class="photo-cap">
        <div class="c-title">${esc(t.caption)}</div>
        <div class="c-sub">${esc(t.date)} · ${esc(t.tag)}</div>
      </div>
    </div>`).join("") + `</div>`;
}

function emptyRow() { return `<div style="padding:14px 0;color:var(--text-mute);font-size:13px">항목이 없습니다.</div>`; }

// -------- 편집 가능한 헤더 텍스트 --------
function editSpan(key, val, type) {
  if (!editing) return esc(val);
  return `<input class="inp" style="min-width:120px;display:inline-block;width:auto" value="${esc(val)}" data-set="${key}">`;
}

// -------- 알림 패널 --------
function notifPanel(s) {
  return `<div class="notif-panel">
    <h4>알림</h4>
    ${s.notifications.map(n => `<div class="notif-item">${esc(n.text)}<div class="t">${esc(n.time)}</div></div>`).join("") || `<div class="notif-item">새 알림이 없습니다.</div>`}
  </div>`;
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
  const bell = document.getElementById("bell");
  if (bell) bell.onclick = () => { notifOpen = !notifOpen; render(); };

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

  document.querySelectorAll("[data-photo-file]").forEach(el => {
    el.onchange = () => uploadPhoto(el);
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

async function uploadPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const index = +input.getAttribute("data-photo-file");
  const status = document.querySelector(`[data-photo-status="${index}"]`);
  const maxSize = 15 * 1024 * 1024;
  if (file.size > maxSize) {
    alert("사진은 한 장당 15MB 이하만 첨부할 수 있습니다.");
    input.value = "";
    return;
  }
  if (status) status.textContent = "사진 압축 중…";
  input.disabled = true;
  try {
    const photoBlob = await optimizePhoto(file);
    const url = await blobToDataUrl(photoBlob);
    if (!editing || !draft.photos[index]) return;
    const otherBytes = draft.photos.reduce((sum, photo, photoIndex) =>
      sum + (photoIndex !== index && String(photo.img || "").startsWith("data:") ? photo.img.length : 0), 0);
    if (otherBytes + url.length > 800 * 1024) {
      throw new Error("첨부 사진의 전체 용량이 큽니다. 기존 사진을 일부 삭제한 뒤 다시 첨부하세요.");
    }
    draft.photos[index].img = url;
    if (!draft.photos[index].date) draft.photos[index].date = todayStr();
    render();
  } catch (e) {
    console.error(e);
    if (status) status.textContent = "업로드 실패";
    input.disabled = false;
    alert("사진 첨부에 실패했습니다: " + e.message);
  }
}

async function optimizePhoto(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    let blob;
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const quality = Math.max(0.48, 0.76 - attempt * 0.07);
      blob = await canvasToBlob(canvas, quality);
      if (blob.size <= 170 * 1024) break;
      width = Math.max(480, Math.round(width * 0.82));
      height = Math.max(360, Math.round(height * 0.82));
    }
    bitmap.close();
    return blob;
  } catch (e) {
    console.error(e);
    throw new Error("이 사진 형식을 읽을 수 없습니다. JPG 또는 PNG 사진으로 다시 선택하세요.");
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("사진 압축 실패")), "image/jpeg", quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function startEdit() {
  editing = true;
  draft = deepCopy(liveState);
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
  notifOpen = false;
  render();
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

async function persist(obj) {
  obj.updatedAt = serverTimestamp();
  try {
    await setDoc(DOC, obj, { merge: false });
  } catch (e) {
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
  photos: () => ({ caption: "", date: "", tag: "", grad: "linear-gradient(135deg,#1C93BE,#57C7E8)" }),
};
function addTo(obj, key) { obj[key].push(NEW_ROW[key]()); }

// ===================== 시작 =====================
boot();
