# Age of War

아이소메트릭 실시간 전술 전쟁 시뮬레이션 게임입니다. 현재 실행 기준은 `web/app.js`이며, Vite + Node/Express 기반 웹 프로젝트로 전환 중입니다.

## 개발 실행

```bash
npm install
npm run dev
```

기본 개발 주소:

```text
http://localhost:3000
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

서버는 기본적으로 `http://localhost:3000`에서 빌드 결과물을 제공합니다.

Windows에서는 루트의 `start-server.cmd`를 실행해도 됩니다.

## 현재 방향

- 서버/빌드: Vite + Node/Express
- 게임 로직: 기존 Vanilla JS 런타임 유지
- 렌더링: Canvas 기반 동작을 보존하면서 PixiJS WebGL로 점진 이관
- 데이터: JSON 우선, 이후 SQLite 확장
- 멀티/리플레이: 이후 서버 기능으로 확장

## 주요 문서

- 현재 구현 상태: `docs/CURRENT_STATUS.md`
- 게임 설계 원문: `GAME_DESIGN.md`
- 기술 설계: `TECH_DESIGN.md`
- 자산 가이드: `docs/ASSET_GUIDE.md`
- 배포 가이드: `docs/DEPLOYMENT.md`

## 개발용 도구

칸나에 고정 지형 재생성:

```bash
npm run scenario:terrain:cannae
```

지형 JSON 뷰어:

```text
http://localhost:3000/terrain-json-viewer.html
```
