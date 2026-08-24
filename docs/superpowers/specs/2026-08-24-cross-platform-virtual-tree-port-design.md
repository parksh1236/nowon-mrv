# 가상 나무 시뮬레이션 교차 플랫폼 이식 설계

## 1. 목적

검증·배포된 `nowon-mrv/solar/` 가상 나무 기능을 `nowon-mrv` 메인 화면과 `nowon-energy-platform/platform/`의 통합 솔라랩에서도 동일하게 사용할 수 있게 한다.

## 2. 현재 구조

- `nowon-mrv/index.html`은 `./solar/`를 iframe으로 표시한다. 기능 코드는 이미 공유되므로 iframe URL 버전만 갱신한다.
- `nowon-energy-platform/platform/`은 자체 `solar-lab.mjs`, `solar-core.mjs`, `index.html`을 사용하는 독립 통합판이다. 지도와 패널 배치를 유지하면서 기능을 이식한다.
- 두 저장소는 서로 다른 GitHub Pages 배포 단위다.

## 3. 포함 범위

- 높이 1~50m, 수관 지름 1~30m인 가상 나무 최대 50개
- 지도 클릭 배치와 즉시 3D 표시
- 목록의 `나무 선택`, `나무 삭제`, 선택 나무 크기 수정
- 선택 시 지도 카메라 이동과 목록 강조
- 시간별 Cesium 그림자 표시
- 불투명 수직 원기둥 기반 정밀 음영 계산
- 나무 미반영·반영 발전량과 감소량 비교
- 프로젝트 저장·복원과 CSV 내보내기
- Kenney Nature Kit 2.1 `tree_default.glb`와 CC0 기록
- 기존 저장 프로젝트의 `trees: []` 기본 호환

## 4. 제외 범위

- 나무 위치 드래그 이동
- 사각형 또는 사용자 정의 3D 장애물
- 수종·낙엽·계절·투과율 모델
- 두 저장소가 원격 JavaScript 파일을 런타임 공유하는 구조

## 5. 구현 방식

### nowon-mrv

`index.html`의 Solar Lab iframe 쿼리 버전을 갱신해 브라우저가 최신 `solar/index.html`을 다시 받게 한다. 기존 `solar/` 구현을 복제하지 않는다.

### nowon-energy-platform

현재 통합 지도와 사이드 패널을 유지한다.

- `platform/index.html`: 가상 나무 입력, 수정 버튼, 선택·삭제 목록 스타일, 지도 범례, 모듈 캐시 버전
- `platform/solar-lab.mjs`: 나무 상태, 지도 클릭 배치, Cesium 모델, 선택·수정·삭제, 저장·복원, 정밀 결과 비교
- `platform/solar-core.mjs`: 나무 검증, 직렬화, ENU 좌표 변환, 광선-원기둥 교차, 기준·나무 반영 정밀 결과, CSV
- `platform/solar-lab.test.mjs` 및 기존 계산 테스트: 배치 흐름과 계산 회귀
- `platform/assets/tree.glb`, `platform/assets/NOTICE.md`: 검증된 CC0 파일을 `nowon-mrv`에서 동일 바이트로 복사

기존 플랫폼의 VWorld 지도 어댑터와 DOM ID를 그대로 사용하고 새 프레임워크나 의존성을 추가하지 않는다.

## 6. 데이터와 계산

```js
trees: [{
  id: "tree-1",
  center: { lat: 37.654, lon: 127.056 },
  heightM: 12,
  crownDiameterM: 8
}]
```

정밀 분석은 기존 건물·지형 광선 판정 결과를 `baselineShaded`로 보존하고, 동일 광선이 가상 나무 원기둥과 교차하면 최종 `shaded`를 참으로 만든다. VWorld 광선을 두 번 호출하지 않고 두 결과를 함께 계산한다.

## 7. 오류와 호환성

- 노원구 밖 위치, 입력 범위 초과, 51번째 나무는 배치하지 않고 상태 문구를 표시한다.
- GLB가 로드되지 않아도 계산 데이터는 유지한다.
- 손상된 개별 나무는 복원 시 제외하고 나머지 프로젝트를 유지한다.
- 나무가 없는 기존 프로젝트는 빈 배열로 복원한다.
- 나무 수정·삭제는 이전 분석 결과와 CSV를 무효화한다.

## 8. 검증과 완료 조건

- 두 저장소의 Node 테스트, JavaScript 문법 검사, `git diff --check` 통과
- 플랫폼 지도에서 나무가 줌 조작 없이 즉시 표시됨
- 선택 버튼이 삭제 버튼 왼쪽에 있고 크기 수정이 즉시 3D 모델에 반영됨
- 저장 후 새로고침해도 나무가 복원됨
- 정밀 분석에서 나무 반영 발전량이 기준 발전량보다 크지 않음
- 두 저장소를 각각 GitHub `master`에 푸시하고 Pages 작업 성공 확인
- 공개 URL에서 나무 입력과 VWorld 지도 로드 확인

