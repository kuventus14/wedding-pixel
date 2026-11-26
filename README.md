# 픽셀 웨딩 방명록

QR을 찍고 들어온 하객이 픽셀 캐릭터로 웨딩홀에 입장해 축하 메시지를 남기는 방명록입니다.
캐릭터를 누르면 메시지가 보이고, 신랑측·신부측 목록과 웨딩 앨범(좋아요·댓글), 신랑·신부 인삿말, 배경음악이 있습니다.

## Vercel 에 배포

1. Vercel → **Add New → Project** → 이 저장소를 Import → 설정은 그대로 두고 Deploy
2. 프로젝트 → **Storage** 탭
   - **Upstash for Redis** (Marketplace) 를 만들어 이 프로젝트에 연결 — 방명록 기록이 여기에 저장됩니다.
     지역은 한국과 가까운 곳(서울·도쿄)으로 고르세요.
   - **Blob** 저장소를 **Public** 으로 만들어 이 프로젝트에 연결 — 배포 후 관리자 화면에서 새로 올리는 사진이 여기에 저장됩니다.
3. 프로젝트 → **Settings → Environment Variables** 에 `ADMIN_TOKEN` = 관리자 비밀번호 추가
4. **Deployments** 에서 최근 배포를 **Redeploy** (저장소·비밀번호가 붙은 상태로 다시 켜기)

처음 열릴 때 저장소의 `data/db.json`(신랑·신부 정보, 하객, 앨범 목록)이 Redis 로 옮겨지고,
`data/photos`·`data/stage` 의 사진은 정적 파일로 나갑니다. 그 뒤의 기록은 Redis 에만 쌓입니다.

## 내 컴퓨터에서 실행

```bash
npm install
npm start
```

- 하객 화면 `/`, 관리자 화면(사진 올리기·QR·엑셀 내려받기) `/admin`
- 컴퓨터에서는 `data/` 폴더에 저장합니다. 비밀번호는 `ADMIN_TOKEN` 이 없으면 `data/admin-token.txt`(없으면 새로 만듦)를 씁니다.
  비밀번호 파일은 저장소에 올리지 않습니다.
- 시험: `npm test` (파일 저장 방식 + 가짜 Redis 로 Vercel 방식)

## 배경음악 출처

- Canon in D — Felted Classics, CC BY 3.0
- Clair de lune — Laurens Goedhart, CC BY 3.0
- Gymnopédie No.1 — Teknopazzo, CC0

글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1)
