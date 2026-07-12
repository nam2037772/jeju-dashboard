# 제주지회 신축공사 현장현황판 (공유형)

한국정보통신공사협회 제주지회 신축공사 현장현황판입니다.
**시공사가 입력하면 감리·감독·협력사가 같은 화면을 실시간으로 열람**할 수 있습니다.

- **열람**: 로그인 없이 누구나 링크로 현황 확인
- **입력**: 시공사만 비밀번호로 로그인 후 수정 → 저장하면 모두에게 즉시 반영
- 빌드/프레임워크 없음 (순수 HTML/CSS/JS) → GitHub Pages에 그대로 배포
- 데이터 저장·동기화·로그인은 **Firebase**가 담당 (구글 드라이브와 같은 구글 계정 사용)

---

## 파일 구성
| 파일 | 역할 |
|------|------|
| `index.html` | 화면 골격 |
| `styles.css` | 디자인(제주 바다색 테마) |
| `app.js` | 렌더링·편집·실시간 동기화 로직 |
| `firebase-config.js` | **여기만 값 채우면 됨** (Firebase 연결 정보) |

---

## 설정 1 — Firebase 프로젝트 만들기 (약 3분, 무료)

1. https://console.firebase.google.com 접속 → **구글 드라이브와 같은 계정으로 로그인**
2. **프로젝트 추가** → 이름 예: `jeju-dashboard` → 생성 (애널리틱스는 꺼도 됨)
3. 프로젝트 화면에서 **웹 앱 아이콘 `</>`** 클릭 → 앱 등록 → 나오는 `firebaseConfig` 값을
   `firebase-config.js`의 같은 항목에 붙여넣기:
   ```js
   export const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "jeju-dashboard.firebaseapp.com",
     projectId: "jeju-dashboard",
     storageBucket: "jeju-dashboard.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```

## 설정 2 — Firestore(데이터베이스) 만들기

1. 왼쪽 메뉴 **빌드 → Firestore Database → 데이터베이스 만들기**
2. 위치는 `asia-northeast3 (서울)` 권장, **프로덕션 모드**로 시작
3. **규칙(Rules)** 탭에서 아래로 교체 후 **게시**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /dashboard/{docId} {
         allow read: if true;                    // 누구나 열람
         allow write: if request.auth != null;   // 로그인한 시공사만 입력
       }
     }
   }
   ```

## 설정 3 — 시공사 로그인 계정 만들기

1. 왼쪽 메뉴 **빌드 → Authentication → 시작하기**
2. **로그인 방법** 탭 → **이메일/비밀번호** 사용 설정(첫 번째 토글만 켜면 됨)
3. **Users 탭 → 사용자 추가**
   - 이메일: `firebase-config.js`의 `EDIT_EMAIL` 값과 **똑같이** (기본 `sitemanager@jeju-dashboard.app`)
   - 비밀번호: 시공사에게 공유할 값 → 이 비밀번호가 곧 "입력 비밀번호"입니다.

> 시공사는 현황판에서 **편집 → 비밀번호 입력**만 하면 됩니다. 이메일은 입력할 필요 없습니다.

---

## 배포 — GitHub Pages

이 폴더를 GitHub 저장소로 올리고 Pages를 켜면 링크가 생성됩니다.

```bash
cd jeju-dashboard
git init
git add .
git commit -m "제주지회 현장현황판"
git branch -M main
gh repo create jeju-dashboard --public --source=. --remote=origin --push
```
그다음 **저장소 Settings → Pages → Source: `main` / `(root)`** 선택 → 저장.
약 1분 뒤 `https://<깃허브계정>.github.io/jeju-dashboard/` 링크가 생기면 감리·감독·협력사에게 공유하세요.

> ⚠️ `firebase-config.js`의 `apiKey`는 공개돼도 됩니다(웹 앱 식별용). 실제 보안은 위 Firestore **규칙**과 로그인 계정으로 지켜집니다.

---

## 사용법 요약
- **감리·감독·협력사**: 링크 접속 → 현황 열람(자동 실시간 갱신)
- **시공사**: 우측 상단 **편집** → 비밀번호 입력 → 작업/안전/인력/장비/자재/마감/사진 수정 → **저장**
  - 작업·안전 체크박스는 로그인 상태면 클릭 즉시 저장됩니다.

## 실제 데이터로 바꾸기
편집 모드에서 화면상 각 항목의 `+ 추가` / `×` 버튼과 입력칸으로 직접 수정합니다.
현장 사진은 편집 모드에서 **사진 첨부** 버튼으로 JPEG, PNG, WebP, HEIC 파일을 업로드할 수 있습니다(장당 15MB 이하).
업로드 파일은 Firebase Storage의 `site-photos/` 폴더에 저장되고 공개 화면에는 실제 사진으로 표시됩니다.

Firebase Console의 **Storage → Rules**에는 로그인한 편집자만 업로드하고 누구나 사진을 볼 수 있도록 다음 규칙을 설정합니다.

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /site-photos/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.size < 15 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

## 디자인 토큰
- 배경 `#F3F5F6`, 카드 `#fff`, 테두리 `#E4E7EA`
- 헤더 그라디언트 `#0B4F6C → #123B4B → #22272B`
- 포인트: 파랑 `#1C93BE`(작업), 주황 `#C05A2C`(안전), 보라 `#6C4FA3`(인력·장비), 초록 `#4C7A34`(자재), 빨강 `#B23A3A`(마감 임박)
- 폰트 Pretendard, 카드 radius 14px, 배지/버튼 radius 20px
