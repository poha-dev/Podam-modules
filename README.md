# 포담 공식 모듈

![license](https://img.shields.io/badge/license-MIT-4C9A2A)
![for](https://img.shields.io/badge/for-%ED%8F%AC%EB%8B%B4-5B7FFF)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%ED%8F%AC%ED%95%98-FFDD00)](https://buymeacoffee.com/poha)

[포담(Podam)](https://github.com/poha-dev/Podam)에 넣어 쓰는 공식 모듈 넷입니다.
**모듈은 폴더 하나**라, 받아서 모듈 폴더에 풀고 포담을 다시 켜면 붙습니다.

| 모듈 | 무엇 |
|---|---|
| 🔑 **정답 판정** `verdict` | 배역마다 「정답:답변」 표를 두고, 플레이어가 정답을 내면 적어 둔 답변이 자동으로 나갑니다. 같은 정답이라도 배역이 다르면 다른 답변이 나갑니다 |
| 🎲 **간이 TRPG** `trpg` | 모두가 같은 배경 그림과 음악을 보고 들으며 떠드는 공용 무대. 3D 주사위도 굴립니다 |
| 👥 **캐릭터 카드** `trpg-chars` | 무대 아래에 HP·MP·상태이상이 붙은 카드를 세워 둡니다. 🎲 간이 TRPG 와 함께 켜세요 |
| 🤖 **AI 시나리오 보조** `ai` | 시나리오 자료(PDF·그림·글)를 읽혀 두고 진행 중에 물어봅니다. 답에는 **원문 인용**이 붙고, 자료에 없으면 **없다고 말합니다**. API 키는 각자의 브라우저에만 두고 모델도 브라우저가 직접 부릅니다 |

## 넣기

1. [Releases](https://github.com/poha-dev/Podam-module/releases) 에서 원하는 모듈의 zip 을 받습니다
2. 포담의 **모듈 폴더**에 풉니다 — 어디인지는 포담을 켤 때 창에 찍힙니다
   (아래는 한 예일 뿐이고, 드라이브나 위치가 정해져 있지는 않습니다)

   ```
   모듈 없음 — 넣을 곳: C:\Users\…\Podam\modules
   ```
3. 포담을 다시 켭니다. 이렇게 나오면 된 겁니다

   ```
   모듈 2개: trpg, verdict  (C:\Users\…\Podam\modules)
   ```
4. 방을 만들 때 「쓸 기능 고르기」에서 체크하거나, GM 화면의 **🧩 모듈** 로 켭니다

잠깐 꺼 두려면 폴더 이름 앞에 `_` 를 붙이세요(`_trpg`). 데이터는 그대로 남습니다.

## 고치거나 직접 만들기

폴더 하나에 `index.js` 만 있으면 모듈입니다. 쓰는 법은 포담 쪽 문서에 있습니다 —
**[docs/모듈-만들기.md](https://github.com/poha-dev/Podam/blob/main/docs/모듈-만들기.md)**

이 저장소를 그대로 베껴 시작해도 됩니다. 가장 작은 본보기는 `modules/verdict/` 입니다.

## 검사

```bash
PODAM_CORE=../podam npm test
```

`test/harness.js` 가 코어를 끌어와 **이 저장소의 `modules/` 를 얹은 채로** 서버를 띄우고,
그 위에서 모듈 검사를 돌립니다. 자기 모듈을 만들 때 이 파일을 그대로 가져다 쓰면 됩니다.

코어가 옆 폴더(`../podam`)에 없으면 `PODAM_CORE` 로 알려 주세요.

## zip 만들기

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-zips.ps1 -Version 0.1.0
```

`dist\` 에 모듈마다 하나씩, 그리고 넷을 한꺼번에 담은 것 하나가 나옵니다.

## 라이선스

MIT

쓸 만하셨다면 커피 한 잔 ☕ → [buymeacoffee.com/poha](https://buymeacoffee.com/poha)
