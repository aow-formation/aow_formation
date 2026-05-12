# 전쟁의 시대

아이소메트릭 실시간 전술 전쟁 게임입니다. 현재 실행 기준은 `web/app.js` 단일 파일이며, 서버/빌드 전환 작업을 시작했습니다.

## 개발 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
npm run preview
```

## 서버 실행

```bash
npm run build
npm run server
```

서버는 기본적으로 `http://localhost:3000`에서 `dist/` 빌드 결과물을 제공합니다.

Windows에서는 루트의 `start-server.cmd`를 더블클릭해도 됩니다. 서버 창을 닫으면 접속도 함께 종료됩니다.

## 현재 전환 방침

- 서버/빌드: Vite + Node/Express
- 게임 로직: 기존 Vanilla JS 로직 유지
- 렌더링: Canvas 기준 동작을 보존하고 PixiJS WebGL 렌더러를 점진 도입
- 데이터: 정적 JSON 유지 후 서버 저장 데이터는 JSON에서 SQLite로 확장
- 멀티/리플레이: 서버 기능으로 후속 확장
