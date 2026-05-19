# HWP AI MVP

브라우저에서 HWP 또는 HWPX 문서를 열고, 문서 내용을 추출한 뒤 AI 수정, HWP 저장, HWPX 저장, 마크다운 저장, HTML 저장을 수행하는 MVP입니다.

## 기능

- HWP 또는 HWPX 파일 열기
- rhwp 편집기 임베드
- 본문 문단 추출
- 표 셀 텍스트 추출
- AI 수정 패치 생성과 문서 반영
- HWP 저장
- HWPX 저장
- 마크다운 저장
- HTML 저장

## 실행

```bash
npm install
npm run dev
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:3000
```

## 윈도우 데스크톱 실행

윈도우에서는 터미널에서 매번 웹 서버를 따로 띄우지 않도록 Electron 데스크톱 껍데기를 사용할 수 있습니다.

```bash
npm install
npm run desktop:dev
```

위 명령은 데스크톱 창을 열고 내부에서 로컬 Next 서버를 자동으로 시작합니다. 이 방식은 윈도우에서도 로컬 Codex CLI와 같은 명령줄 도구를 서버 API에서 실행할 수 있게 해 줍니다.

이미 다른 주소에서 서버를 실행 중이면 아래처럼 외부 주소를 지정할 수 있습니다.

```bash
HWP_AI_DESKTOP_URL=http://localhost:3000 npm run desktop:dev
```

윈도우 설치 파일 실험 빌드는 다음 명령으로 시작합니다.

```bash
npm run build
npm run desktop:win
```

## AI 수정 설정

AI 수정 버튼을 사용하려면 환경 변수를 설정합니다.

```bash
export OPENAI_API_KEY="키를 넣어 주세요"
export OPENAI_MODEL="gpt-4.1-mini"
npm run dev
```

키가 없더라도 HWP 열기, HWP 저장, HWPX 저장, 마크다운 저장, HTML 저장은 사용할 수 있습니다.

## 구조

```text
app/ui.tsx                         화면과 iframe 브리지
app/api/ai/edit/route.ts           AI 수정 패치 생성 API
lib/document.ts                    마크다운과 HTML 변환기
public/rhwp-studio                 rhwp 정적 편집기
scripts/patch-rhwp-bridge.py       rhwp 브리지 확장 스크립트
```

## 주의

- 개인정보 문서는 브라우저 안에서 열고 저장하는 흐름을 우선으로 합니다.
- AI 수정 버튼을 누를 때만 추출된 텍스트가 서버 API로 전달됩니다.
- 복잡한 병합 표와 개체 배치는 후속 단계에서 더 많은 검증이 필요합니다.
