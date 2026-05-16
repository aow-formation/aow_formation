# 자산 가이드

최종 갱신: 2026-05-17

## 기본 원칙

- 픽셀 아트 유닛과 타일은 nearest-neighbor 렌더링을 기본으로 한다.
- 같은 계열의 프레임과 효과는 가능하면 스프라이트 시트로 묶는다.
- 경로는 `web/assets/` 아래에 둔다.
- 코드에서 참조하는 자산명은 의미가 드러나게 유지한다.

권장 분류:

```text
web/assets/
  background/
  effects/
  objects/
  portraits/
  terrain_tiles_v3/
  ui/
  units/
```

## 유닛

- 보병 보행 스프라이트는 `web/assets/units/ancient_infantry_helmet_walk.png` 계열을 사용한다.
- 보병 정지 이미지는 별도 idle 이미지를 사용한다.
- 적군 보병은 blue 변형 이미지를 사용한다.
- 기병은 `ancient_cavity_helmet_walk.png`, `ancient_cavity_helmet_walk_blue.png` 계열을 사용한다.
- 기병 스프라이트 시트는 6프레임 기준이다.
- 기병은 그림자를 표시하지 않는다.

## 지형

- 1x1 지형 타일은 48x24 규격으로 정리했다.
- 기존 1x1 지형 타일은 `_backup_tile_1x1_20260515`에 백업되어 있다.
- 미세 경계선 완화를 위해 1x1 타일은 정확한 2:1 비율을 유지한다.
- 3x3, 마스크, 산지 타일은 기존 렌더링 규칙을 유지한다.

## 오브젝트

- 원본 오브젝트 시트는 `web/assets/objects/object_sheet.png`다.
- 분리된 타일은 `web/assets/objects/object_sheet_tiles/object_00.png`부터 `object_15.png`까지 사용한다.
- 평지 타일에는 약 2% 확률로 랜덤 오브젝트가 배치된다.

## 배경

- 홈 화면 배경은 PNG 대신 압축된 JPG를 우선 사용한다.
- 홈 화면 랜덤 배경 후보에서 `MAIN2`는 제외한다.
- 홈 화면 배경은 약 0.4 투명도로 표시한다.

## UI 아이콘

모바일 전투 능력치 표시는 텍스트 대신 PNG 아이콘을 사용할 수 있다.

- 근접 공격
- 근접 방어
- 원거리 공격
- 원거리 방어

관련 경로는 `web/assets/ui/` 아래에 둔다.

## 시나리오 선택 아이콘

- 원본: `web/assets/ui/scenario_icons.png`
- 크롭 결과: `web/assets/ui/scenario_icons_cropped.png`
- 크롭 결과는 7개의 256x256 아이콘을 가로로 이어 붙인 스프라이트 시트다.
- CSS에서 `background-position`으로 카드별 아이콘을 선택한다.

아이콘 순서:

1. 칸나에 전투
2. 가우가멜라 전투
3. 박망파 전투
4. 칼카강 전투
5. 흥화진/귀주 대첩
6. 주필산 전투
7. 이릉 대첩

## 칸나에 지형 자산

- 지형 데이터: `web/data/scenarios/cannae_terrain.json`
- 생성 스크립트: `scripts/generate-cannae-terrain.mjs`
- 확인 도구: `web/terrain-json-viewer.html`

칸나에 지형은 북쪽 강, 중앙 평원, 남쪽 산지/초지대, 하단 도로를 기본 구도로 한다. 강과 산지, 평지 경계는 완전한 직선이 되지 않도록 생성 단계에서 노이즈를 적용한다.
