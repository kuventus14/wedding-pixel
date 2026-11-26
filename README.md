# 픽셀 웨딩 방명록

QR을 찍고 들어온 하객이 픽셀 캐릭터로 웨딩홀에 입장해 축하 메시지를 남기는 방명록입니다.
캐릭터를 누르면 메시지가 보이고, 신랑측·신부측 목록과 웨딩 앨범(좋아요·댓글), 신랑·신부 인삿말, 배경음악이 있습니다.

## 실행

```bash
npm install
ADMIN_TOKEN=관리자비밀번호 npm start
```

- 하객 화면: `/`, 관리자 화면(사진 올리기·QR·엑셀 내려받기): `/admin`
- `ADMIN_TOKEN` 을 주지 않으면 `data/admin-token.txt` 의 값을 쓰고, 그 파일도 없으면 새로 만듭니다. 비밀번호는 저장소에 올리지 않습니다.
- 저장은 `data/` 폴더(`db.json`, `photos/`)에 합니다. `DATA_DIR` 로 위치를 바꿀 수 있습니다.
  파일에 쓰는 구조라서 **서버 디스크가 유지되는 곳**(Railway·Render 디스크·VPS 등)에서 돌려야 기록이 남습니다.
- 시험: `npm test`

## 배경음악 출처

- Canon in D — Felted Classics, CC BY 3.0
- Clair de lune — Laurens Goedhart, CC BY 3.0
- Gymnopédie No.1 — Teknopazzo, CC0

글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1)
