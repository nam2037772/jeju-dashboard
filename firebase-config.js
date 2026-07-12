// =============================================================
//  Firebase 설정 — 여기 값만 채우면 됩니다 (README 설정 안내 참고)
// =============================================================
//
// 1) https://console.firebase.google.com 에서 (구글 드라이브와 같은 계정으로 로그인)
//    프로젝트 생성 →  웹 앱(</>) 추가 →  나오는 firebaseConfig 값을 아래에 붙여넣기.
// 2) Firestore Database 만들기 (프로덕션 모드) →  규칙(rules)은 README 참고.
// 3) Authentication →  로그인 방법 →  '이메일/비밀번호' 사용 설정 →
//    사용자 추가에서 아래 EDIT_EMAIL 주소로 계정 1개 생성(비밀번호는 시공사에게 공유).
//
// 아래 값이 비어 있으면 화면에 설정 안내가 표시됩니다.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// 시공사 입력(편집) 전용 계정의 이메일. Authentication에 이 주소로 계정을 만들어 두세요.
// 시공사는 '편집' 버튼을 누른 뒤 비밀번호만 입력하면 됩니다.
export const EDIT_EMAIL = "sitemanager@jeju-dashboard.app";

// Firestore 문서 경로 (그대로 두면 됩니다)
export const DOC_PATH = ["dashboard", "main"];
