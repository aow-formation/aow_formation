# 배포 가이드

## 정적 배포

```bash
npm install
npm run build
```

생성된 `dist/` 폴더를 Cloudflare Pages, Netlify, Vercel, GitHub Pages 등에 배포할 수 있다.

## Node 서버 배포

```bash
npm install
npm run build
npm run server
```

기본 포트는 `3000`이며, `PORT` 환경변수로 변경할 수 있다.

```bash
PORT=8080 npm run server
```
