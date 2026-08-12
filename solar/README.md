# SOLAR LAB

노원구 기준의 태양광 설치 가능 면적과 개략·정밀 발전량을 사전 분석하는 도구입니다. 기존 건물 검색과 수동 입력 fallback, 가상 건물 지붕·제외 영역, 개략 분석과 지도 기반 정밀 추정, 월별 비교, CSV 내보내기, localStorage 프로젝트 저장을 제공합니다.

독립 실행 경로는 `/solar/`입니다. 배포본은 <https://parksh1236.github.io/nowon-mrv/solar/>에서 확인할 수 있습니다.

## Local setup

`solar/config.local.js`를 다음처럼 만들고 발급받은 VWorld 키를 넣으세요. 이 파일은 Git에서 제외됩니다.

```js
// solar/config.local.js
window.SOLAR_CONFIG = {
  vworldApiKey: "발급받은_키",
  allowedRegion: "노원구",
};
```

로컬용 키와 배포용 키를 분리하세요. 로컬용 키에는 `localhost`만, 배포용 키에는 `parksh1236.github.io`만 허용합니다. 키는 브라우저에서 보이므로 비밀값으로 간주하지 말고 정확한 도메인 제한을 사용하세요.

GitHub Pages 배포에는 저장소 Actions secret `VWORLD_API_KEY`에 배포용 키를 등록합니다. 배포 워크플로가 Git에 포함되지 않는 `config.local.js`를 배포 산출물에 생성합니다.

```powershell
python -m http.server 8737
```

브라우저에서 <http://localhost:8737/solar/>를 엽니다. 설정 파일이 없거나 지도를 불러오지 못해도 수동 입력으로 개략 분석을 실행할 수 있습니다.

## Analysis notes

기후 데이터가 `prototype-calibration-required`이면 KMA 격자 데이터 검증 전 기본값을 사용 중이라는 경고가 표시됩니다. 설치 가능 면적, 경사·방위각, 음영, 표본 cap은 프로토타입 근사치입니다.

이 도구는 허가·구조 안전·화재·일조권·발전량 보증·경제성 분석을 대체하지 않습니다. 정밀 분석도 실제 현장 조사와 설계 검토 전의 추정 결과이며, 정확하지 않을 수 있습니다.

## Checks

```powershell
node --test solar/solar-core.test.mjs
node --check solar/app.mjs
git diff --check
```
